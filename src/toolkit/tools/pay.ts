/**
 * pay() — D402 HTTP Payment Protocol client.
 *
 * Guards: maxSpend per-call (required), rolling 24h cap, receipt dedup.
 */

import type { PayOptions, PayResult, ToolResult } from "../types.js";
import { ok, err, demosError } from "../types.js";
import { DemosSession } from "../session.js";
import { checkPaySpendCap, recordPayment } from "../guards/pay-spend-cap.js";
import { makeIdempotencyKey, checkPayReceipt, recordPayReceipt } from "../guards/pay-receipt-log.js";
import { withToolWrapper, localProvenance } from "./tool-wrapper.js";
import { validateUrl } from "../url-validator.js";

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
    if (!opts.url) {
      return err(demosError("INVALID_INPUT", "URL is required", false), localProvenance(start));
    }

    if (!Number.isFinite(opts.maxSpend) || opts.maxSpend <= 0) {
      return err(
        demosError("INVALID_INPUT", "maxSpend must be a positive finite number", false),
        localProvenance(start),
      );
    }

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

    // TODO(toolkit-mvp): integrate SDK bridge — D402 challenge/response flow
    throw new Error("D402 integration pending — connect SDK bridge");
  });
}
