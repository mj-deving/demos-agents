import type { Demos } from "@kynesyslabs/demosdk/websdk";
import { attestTlsnViaPlaywrightBridge } from "../../../src/lib/tlsn-playwright-bridge.js";
import type { AttestResult, ToolResult } from "../../../src/toolkit/types.js";
import { err } from "../../../src/toolkit/types.js";
import type { DemosSession } from "../../../src/toolkit/session.js";
import { validateUrl } from "../../../src/toolkit/url-validator.js";

export async function attestTlsnWithSession(session: DemosSession, url: string): Promise<ToolResult<AttestResult>> {
  if (session.urlAllowlist.length > 0) {
    const urlObj = new URL(url);
    if (!session.urlAllowlist.some((allowed) => urlObj.origin.startsWith(allowed) || url.startsWith(allowed))) {
      return err<AttestResult>(
        { code: "INVALID_INPUT", message: `URL not in allowlist: ${urlObj.hostname}`, retryable: false },
        { path: "local", latencyMs: 0 },
      );
    }
  }

  const urlCheck = await validateUrl(url, {
    allowInsecure: session.allowInsecureUrls,
  });
  if (!urlCheck.valid) {
    return err<AttestResult>(
      { code: "INVALID_INPUT", message: `Attestation URL blocked: ${urlCheck.reason}`, retryable: false },
      { path: "local", latencyMs: 0 },
    );
  }

  const demos = session.getSigningHandle().demos as Demos | undefined;
  if (!demos) {
    return err<AttestResult>(
      { code: "AUTH_FAILED", message: "TLSN requires a connected Demos wallet session", retryable: true },
      { path: "local", latencyMs: 0 },
    );
  }

  try {
    const result = await attestTlsnViaPlaywrightBridge(demos, url, "GET");
    return {
      ok: true,
      data: {
        txHash: result.proofTxHash,
        responseHash: "",
        method: "tlsn",
        requestTxHash: result.requestTxHash,
        tokenId: result.tokenId,
        storageFee: result.storageFee,
      },
      provenance: {
        path: "local",
        latencyMs: 0,
        attestation: { txHash: result.proofTxHash, responseHash: "" },
      },
    };
  } catch (e) {
    return err<AttestResult>(
      { code: "ATTEST_FAILED", message: `TLSN unavailable: ${(e as Error).message}`, retryable: true },
      { path: "local", latencyMs: 0 },
    );
  }
}
