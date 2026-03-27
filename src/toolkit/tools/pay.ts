/**
 * pay() — D402 HTTP Payment Protocol client.
 *
 * Guards: maxSpend per-call (required), rolling 24h cap, receipt dedup.
 */

import { z } from "zod";
import type { PayOptions, PayResult, ToolResult } from "../types.js";
import { ok, err, demosError } from "../types.js";
import { DemosSession } from "../session.js";
import { checkPaySpendCap, recordPayment } from "../guards/pay-spend-cap.js";
import { makeIdempotencyKey, checkPayReceipt, recordPayReceipt } from "../guards/pay-receipt-log.js";
import { withToolWrapper, localProvenance } from "./tool-wrapper.js";
import { validateUrl } from "../url-validator.js";
import { validateInput, PayOptionsSchema } from "../schemas.js";

/** Validate 402 response body shape */
const D402RequirementSchema = z.object({
  amount: z.number().positive().finite(),
  recipient: z.string().min(1),
  resourceId: z.string().min(1),
  description: z.string().optional(),
});

/**
 * Make an HTTP request with automatic D402 payment on 402 responses.
 *
 * `maxSpend` is required — the toolkit refuses to pay without an explicit limit.
 */
export async function pay(
  session: DemosSession,
  opts: PayOptions,
): Promise<ToolResult<PayResult>> {
  return withToolWrapper(session, "pay", "TX_FAILED", async (start) => {
    const inputError = validateInput(PayOptionsSchema, opts);
    if (inputError) return err(inputError, localProvenance(start));

    // Idempotency check FIRST — if we have a receipt, skip everything
    const idempotencyKey = makeIdempotencyKey(opts.url, opts.method, opts.body);
    const existingReceipt = await checkPayReceipt(
      session.stateStore,
      session.walletAddress,
      idempotencyKey,
    );
    if (existingReceipt) {
      return ok<PayResult>(
        {
          response: { status: 200, headers: {}, body: null },
          receipt: { txHash: existingReceipt.txHash, amount: existingReceipt.amount },
        },
        localProvenance(start),
      );
    }

    // SSRF validation — DNS resolution + IP blocklist + HTTPS
    const urlCheck = await validateUrl(opts.url, {
      allowInsecure: session.allowInsecureUrls,
    });
    if (!urlCheck.valid) {
      return err(
        demosError("INVALID_INPUT", `Payment URL blocked: ${urlCheck.reason}`, false),
        localProvenance(start),
      );
    }

    // Guard: pay spend cap
    const capError = await checkPaySpendCap(
      session.stateStore,
      session.walletAddress,
      opts.maxSpend,
      session.payPolicy,
    );
    if (capError) {
      return err(capError, localProvenance(start));
    }

    // ── D402 challenge/response flow ────────────────────

    const bridge = session.getBridge();
    const fetchOpts: RequestInit = {
      method: opts.method ?? "GET",
      headers: opts.headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      redirect: "manual", // SSRF: prevent proof/credentials leaking via redirect
    };

    // Step 1: Initial HTTP request
    let initialResponse: Response;
    try {
      initialResponse = await fetch(opts.url, fetchOpts);
    } catch (e) {
      return err(
        demosError("NETWORK_ERROR", `Payment request failed: ${(e as Error).message}`, true),
        localProvenance(start),
      );
    }

    // Step 2: Non-402 → return response directly (no payment needed)
    if (initialResponse.status !== 402) {
      const body = await safeReadBody(initialResponse);
      return ok<PayResult>(
        {
          response: {
            status: initialResponse.status,
            headers: Object.fromEntries(initialResponse.headers.entries()),
            body,
          },
        },
        localProvenance(start),
      );
    }

    // Step 3: Parse 402 requirement
    let requirementBody: unknown;
    try {
      requirementBody = await initialResponse.json();
    } catch {
      return err(
        demosError("TX_FAILED", "402 response body is not valid JSON", false, { step: "parse_requirement" }),
        localProvenance(start),
      );
    }

    const parsed = D402RequirementSchema.safeParse(requirementBody);
    if (!parsed.success) {
      return err(
        demosError("TX_FAILED", `Invalid 402 requirement: ${parsed.error.issues.map(i => i.message).join("; ")}`, false, { step: "parse_requirement" }),
        localProvenance(start),
      );
    }
    const requirement = parsed.data;

    // Step 4: Payee validation
    if (session.payPolicy.requirePayeeApproval) {
      const trusted = session.payPolicy.trustedPayees ?? [];
      if (!trusted.includes(requirement.recipient)) {
        return err(
          demosError("INVALID_INPUT", `Untrusted payee: ${requirement.recipient}. Add to trustedPayees or set requirePayeeApproval: false`, false),
          localProvenance(start),
        );
      }
    }

    // Step 5: Amount guard (defense-in-depth, spend cap guard already checked)
    if (requirement.amount > opts.maxSpend) {
      return err(
        demosError("SPEND_LIMIT", `Requested amount ${requirement.amount} exceeds maxSpend ${opts.maxSpend}`, false),
        localProvenance(start),
      );
    }

    // Step 6: Settle payment via bridge
    const settlement = await bridge.payD402(requirement);
    if (!settlement.success) {
      return err(
        demosError("TX_FAILED", `D402 settlement failed: ${settlement.message ?? "unknown error"}`, true, { step: "settle" }),
        localProvenance(start),
      );
    }

    // Record spend immediately after settlement — funds are committed on-chain
    // regardless of whether the retry succeeds. Receipt is deferred to 2xx retry.
    await recordPayment(session.stateStore, session.walletAddress, requirement.amount, opts.url);

    // Step 7: Retry with payment proof
    let retryResponse: Response;
    try {
      retryResponse = await fetch(opts.url, {
        ...fetchOpts,
        headers: {
          ...opts.headers,
          "X-Payment-Proof": settlement.hash,
        },
      });
    } catch (e) {
      return err(
        demosError("NETWORK_ERROR", `Payment retry failed: ${(e as Error).message}`, true, { step: "retry", txHash: settlement.hash }),
        localProvenance(start),
      );
    }

    // Step 8: Check retry response — only record receipt on success
    if (retryResponse.status < 200 || retryResponse.status >= 300) {
      // Payment was made but resource not delivered — do NOT record receipt
      // so next call can retry the HTTP request with the same proof
      return err(
        demosError("TX_FAILED", `Payment accepted but resource delivery failed (HTTP ${retryResponse.status})`, false, { step: "retry", txHash: settlement.hash }),
        localProvenance(start),
      );
    }

    // Step 9: Success — record receipt (spend already recorded after settlement)
    await recordPayReceipt(session.stateStore, session.walletAddress, {
      txHash: settlement.hash,
      url: opts.url,
      amount: requirement.amount,
      timestamp: Date.now(),
      idempotencyKey,
    });

    const retryBody = await safeReadBody(retryResponse);
    return ok<PayResult>(
      {
        response: {
          status: retryResponse.status,
          headers: Object.fromEntries(retryResponse.headers.entries()),
          body: retryBody,
        },
        receipt: {
          txHash: settlement.hash,
          amount: requirement.amount,
        },
      },
      localProvenance(start),
    );
  });
}

async function safeReadBody(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    try { return JSON.parse(text); } catch { return text; }
  } catch { return null; }
}
