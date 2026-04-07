import { Demos } from "@kynesyslabs/demosdk/websdk";
import { info } from "../lib/network/sdk.js";
import { observe } from "../lib/pipeline/observe.js";
import { attestTlsnViaPlaywrightBridge } from "../lib/tlsn-playwright-bridge.js";
import type { AttestResult } from "./publish-pipeline.js";

/** DAHR proxy surface — SDK doesn't export types for web2.createDahr() */
interface DahrProxy {
  startProxy(opts: { url: string; method: string }): Promise<{
    status?: number;
    statusCode?: number;
    httpStatus?: number;
    responseHash: string;
    txHash: string;
    data?: string | unknown;
  }>;
}

/** Demos instance with web2 DAHR surface (not in SDK types) */
interface DemosWithDahr {
  web2: { createDahr(): Promise<DahrProxy> };
}

/**
 * Create a DAHR attestation for a URL.
 * Returns attested data + on-chain proof hash.
 */
export async function attestDahr(
  demos: Demos,
  url: string,
  method: string = "GET"
): Promise<AttestResult> {
  const attestUrl = url;
  info(`DAHR attesting: ${attestUrl}`);
  const dahr = await (demos as unknown as DemosWithDahr).web2.createDahr();
  const proxyResponse = await dahr.startProxy({ url: attestUrl, method });

  const httpStatus = proxyResponse.status ?? proxyResponse.statusCode ?? proxyResponse.httpStatus;
  if (typeof httpStatus === "number" && (httpStatus < 200 || httpStatus >= 300)) {
    observe("error", `DAHR source returned HTTP ${httpStatus}`, {
      substage: "publish",
      source: "publish-pipeline-attestation.ts:attestDahr",
      data: { url: attestUrl, httpStatus },
    });
    throw new Error(
      `DAHR source returned HTTP ${httpStatus} — refusing to attest error response. ` +
      `URL: ${attestUrl}`
    );
  }

  let data: unknown;
  if (typeof proxyResponse.data === "string") {
    const trimmed = proxyResponse.data.trim();
    if (trimmed.startsWith("<")) {
      throw new Error(
        "DAHR returned XML/HTML instead of JSON. Use JSON API endpoints only " +
        `(not RSS/XML feeds). First 100 chars: ${trimmed.slice(0, 100)}`
      );
    }
    try {
      data = JSON.parse(proxyResponse.data);
    } catch {
      throw new Error(`DAHR returned non-JSON response. First 100 chars: ${trimmed.slice(0, 100)}`);
    }
  } else {
    data = proxyResponse.data;
  }

  if (data && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    const errField = record.error ?? record.Error ?? record.message ?? record.detail;
    if (typeof errField === "string") {
      const errLower = errField.toLowerCase();
      if (
        errLower.includes("unauthorized") ||
        errLower.includes("forbidden") ||
        errLower.includes("rate limit") ||
        errLower.includes("api key") ||
        errLower.includes("authentication") ||
        errLower.includes("access denied")
      ) {
        throw new Error(
          `DAHR source returned error payload: "${errField}" — refusing to attest. URL: ${attestUrl}`
        );
      }
    }
  }

  info(`DAHR attested: hash=${proxyResponse.responseHash}, tx=${proxyResponse.txHash}`);
  observe("pattern", "DAHR attestation succeeded", {
    substage: "publish",
    source: "publish-pipeline-attestation.ts:attestDahr",
    data: { url: attestUrl, txHash: proxyResponse.txHash },
  });

  return {
    type: "dahr",
    url: attestUrl,
    requestedUrl: url,
    responseHash: proxyResponse.responseHash,
    txHash: proxyResponse.txHash,
    data,
  };
}

/**
 * Create a TLSN attestation for an HTTPS URL.
 *
 * Flow:
 * 1) request TLSN token + proxy from node
 * 2) run tlsn-js prover in Node bridge runtime
 * 3) store proof on-chain via native tlsn_store tx
 */
export async function attestTlsn(
  demos: Demos,
  url: string,
  method: string = "GET"
): Promise<AttestResult> {
  try {
    info(`TLSN attesting: ${url}`);
    const tlsnStart = Date.now();
    const result = await attestTlsnViaPlaywrightBridge(demos, url, method);
    const tlsnDurationMs = Date.now() - tlsnStart;
    observe("pattern", `TLSN attestation succeeded in ${tlsnDurationMs}ms`, {
      substage: "publish",
      source: "publish-pipeline-attestation.ts:attestTlsn",
      data: { url, durationMs: tlsnDurationMs, txHash: result.proofTxHash },
    });
    return {
      type: "tlsn",
      url: result.attestedUrl,
      requestedUrl: result.requestedUrl,
      txHash: result.proofTxHash,
      data: {
        tokenId: result.tokenId,
        requestTxHash: result.requestTxHash,
        storageFee: result.storageFee,
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    observe("error", `TLSN failed: ${msg}`, {
      substage: "publish",
      source: "publish-pipeline-attestation.ts:attestTlsn",
      data: { url },
    });
    throw new Error(`TLSN unavailable: ${msg}`);
  }
}
