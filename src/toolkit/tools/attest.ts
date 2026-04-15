/**
 * attest() — create a DAHR attestation for a URL.
 *
 * SSRF validation runs before any network request.
 * Auth guard: specs with auth.mode !== "none" return error to prevent
 * API key leakage in on-chain attestation URLs.
 */

import type { AttestOptions, AttestResult, ToolResult } from "../types.js";
import { ok, err, demosError } from "../types.js";
import { DemosSession } from "../session.js";
import { withToolWrapper, localProvenance } from "./tool-wrapper.js";
import { validateUrl } from "../url-validator.js";
import { validateInput, AttestOptionsSchema } from "../schemas.js";

/**
 * Create a DAHR attestation for a URL.
 *
 * Validates URL against SSRF blocklist before making any request.
 */
export async function attest(
  session: DemosSession,
  opts: AttestOptions,
): Promise<ToolResult<AttestResult>> {
  return withToolWrapper(session, "attest", "ATTEST_FAILED", async (start) => {
    const inputError = validateInput(AttestOptionsSchema, opts);
    if (inputError) return err(inputError, localProvenance(start));

    // URL allowlist enforcement (if configured)
    if (session.urlAllowlist.length > 0) {
      const urlObj = new URL(opts.url);
      if (!session.urlAllowlist.some((allowed) => urlObj.origin.startsWith(allowed) || opts.url.startsWith(allowed))) {
        return err(
          demosError("INVALID_INPUT", `URL not in allowlist: ${urlObj.hostname}`, false),
          localProvenance(start),
        );
      }
    }

    // SSRF validation — DNS resolution + IP blocklist
    const urlCheck = await validateUrl(opts.url, {
      allowInsecure: session.allowInsecureUrls,
    });
    if (!urlCheck.valid) {
      return err(
        demosError("INVALID_INPUT", `Attestation URL blocked: ${urlCheck.reason}`, false),
        localProvenance(start),
      );
    }

    // SDK bridge attestation (withToolWrapper catches exceptions)
    const bridge = session.getBridge();
    const result = await bridge.attestDahr(opts.url, "GET");
    return ok<AttestResult>(
      { responseHash: result.responseHash, txHash: result.txHash },
      {
        path: "local",
        latencyMs: Date.now() - start,
        attestation: { txHash: result.txHash, responseHash: result.responseHash },
      },
    );
  });
}

/**
 * Create a TLSN attestation for a URL.
 *
 * Uses the local Playwright bridge because the upstream tlsnotary SDK path is
 * browser-only and is not currently reliable under this package's Node runtime.
 */
export async function attestTlsn(
  session: DemosSession,
  opts: AttestOptions,
): Promise<ToolResult<AttestResult>> {
  return withToolWrapper(session, "attestTlsn", "ATTEST_FAILED", async (start) => {
    const inputError = validateInput(AttestOptionsSchema, opts);
    if (inputError) return err(inputError, localProvenance(start));

    if (session.urlAllowlist.length > 0) {
      const urlObj = new URL(opts.url);
      if (!session.urlAllowlist.some((allowed) => urlObj.origin.startsWith(allowed) || opts.url.startsWith(allowed))) {
        return err(
          demosError("INVALID_INPUT", `URL not in allowlist: ${urlObj.hostname}`, false),
          localProvenance(start),
        );
      }
    }

    const urlCheck = await validateUrl(opts.url, {
      allowInsecure: session.allowInsecureUrls,
    });
    if (!urlCheck.valid) {
      return err(
        demosError("INVALID_INPUT", `Attestation URL blocked: ${urlCheck.reason}`, false),
        localProvenance(start),
      );
    }

    const bridge = session.getBridge();
    if (typeof bridge.attestTlsn !== "function") {
      return err(
        demosError("ATTEST_FAILED", "TLSN bridge is not available in this runtime", false),
        localProvenance(start),
      );
    }

    const result = await bridge.attestTlsn(opts.url, "GET");
    return ok<AttestResult>(
      {
        txHash: result.txHash,
        responseHash: "",
        method: "tlsn",
        requestTxHash: result.requestTxHash,
        tokenId: result.tokenId,
        storageFee: result.storageFee,
      },
      {
        path: "local",
        latencyMs: Date.now() - start,
        attestation: { txHash: result.txHash, responseHash: "" },
      },
    );
  });
}
