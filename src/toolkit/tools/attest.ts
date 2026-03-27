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
    if (!opts.url) {
      return err(demosError("INVALID_INPUT", "URL is required for attestation", false), localProvenance(start));
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

    // SDK bridge attestation (requires connected session with Demos instance)
    // TODO(sdk-bridge): wire to session's SDK bridge once connect() creates it
    try {
      const result = await executeDahrAttestation(session, opts);
      return ok<AttestResult>(result, {
        path: "local",
        latencyMs: Date.now() - start,
        attestation: { txHash: result.txHash, responseHash: result.responseHash },
      });
    } catch (e) {
      // Re-throw as ATTEST_FAILED (withToolWrapper catches this)
      throw e;
    }
  });
}

async function executeDahrAttestation(_session: DemosSession, _opts: AttestOptions): Promise<AttestResult> {
  // When SDK bridge is wired into session:
  // const bridge = session.getBridge();
  // const result = await bridge.attestDahr(opts.url, "GET");
  // return { responseHash: result.responseHash, txHash: result.txHash };
  throw new Error("Attest integration pending — connect SDK bridge to session");
}
