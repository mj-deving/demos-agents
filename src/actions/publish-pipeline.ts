/**
 * Autonomous publish pipeline for Sentinel session-runner.
 *
 * Orchestrates: DAHR attestation → HIVE post → txHash capture.
 * Used by session-runner in autonomous/approve modes.
 *
 * Uses the same SDK patterns as supercolony.ts (post + attest commands).
 */

import { Demos, DemosTransactions } from "@kynesyslabs/demosdk/websdk";
import { apiCall, info } from "../lib/network/sdk.js";
import { observe } from "../lib/pipeline/observe.js";
import { normalizeFeedPosts } from "../lib/pipeline/feed-filter.js";
import { attestTlsnViaPlaywrightBridge } from "../lib/tlsn-playwright-bridge.js";
import { executeChainTx } from "../toolkit/chain/tx-pipeline.js";
import { extractTxHash } from "../toolkit/sdk-bridge.js";

// ── Constants ──────────────────────────────────────

const HIVE_PREFIX = new Uint8Array([0x48, 0x49, 0x56, 0x45]); // "HIVE"
const INDEXER_CHECK_DELAYS_MS = [5000, 10000, 15000] as const;

let sessionIndexerLagDetected = false;

// ── SDK Extended Interfaces (untyped in SDK) ───────

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

// ── Types ──────────────────────────────────────────

export interface PublishInput {
  text: string;
  category: string;
  tags: string[];
  confidence: number;
  replyTo?: string;
  assets?: string[];
  sourceAttestations?: Array<{
    url: string;
    responseHash: string;
    txHash: string;
    timestamp?: number;
  }>;
  tlsnAttestations?: Array<{
    url: string;
    txHash: string;
    timestamp?: number;
  }>;
}

export interface AttestResult {
  type: "dahr" | "tlsn";
  /** The URL that was actually attested (may differ from requested due to guardrails) */
  url: string;
  /** The original URL requested before any guardrail rewrites */
  requestedUrl: string;
  responseHash?: string;
  txHash: string;
  data?: unknown;
}

export interface PublishResult {
  txHash: string;
  category: string;
  textLength: number;
  attestation?: AttestResult;
  warnings?: string[];
}

export interface PublishOptions {
  feedToken?: string | null;
  /** Pre-attested results from claim-driven attestation (skips attestAndPublish's own attest step) */
  preAttested?: AttestResult[];
  /** Skip per-post indexer health check (verify phase catches unindexed posts via retries) */
  skipIndexerCheck?: boolean;
}

// ── HIVE Encoding ──────────────────────────────────

function encodeHivePost(post: object): Uint8Array {
  const json = JSON.stringify(post);
  const jsonBytes = new TextEncoder().encode(json);
  const combined = new Uint8Array(HIVE_PREFIX.length + jsonBytes.length);
  combined.set(HIVE_PREFIX, 0);
  combined.set(jsonBytes, HIVE_PREFIX.length);
  return combined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function checkIndexerHealth(txHash: string, feedToken: string): Promise<boolean> {
  for (const delayMs of INDEXER_CHECK_DELAYS_MS) {
    info(`Indexer check in ${Math.floor(delayMs / 1000)}s for ${txHash.slice(0, 16)}...`);
    await sleep(delayMs);

    const feedRes = await apiCall("/api/feed?limit=5", feedToken);
    if (!feedRes.ok) {
      info(`Indexer check feed read failed (${feedRes.status}) for ${txHash.slice(0, 16)}...`);
      continue;
    }

    const posts = normalizeFeedPosts(feedRes.data);
    if (posts.some((post) => String((post as Record<string, unknown>)?.txHash || "") === txHash)) {
      info(`Indexer confirmed ${txHash.slice(0, 16)}... in recent feed`);
      return true;
    }
  }

  return false;
}

// ── DAHR Attestation ───────────────────────────────

/**
 * Create a DAHR attestation for a URL.
 * Returns attested data + on-chain proof hash.
 */
export async function attestDahr(
  demos: Demos,
  url: string,
  method: string = "GET"
): Promise<AttestResult> {
  // HN Algolia hitsPerPage guardrail moved to hn-algolia adapter (Phase 4).
  const attestUrl = url;
  info(`DAHR attesting: ${attestUrl}`);
  const dahr = await (demos as unknown as DemosWithDahr).web2.createDahr();
  const proxyResponse = await dahr.startProxy({ url: attestUrl, method });

  // GUARDRAIL: Reject non-2xx / auth-error / rate-limit responses before attesting.
  // The SDK proxy returns the upstream status — a 401/403/429 response is valid HTTP
  // but garbage evidence. Fail closed so callers can fall back or abort.
  const httpStatus = proxyResponse.status ?? proxyResponse.statusCode ?? proxyResponse.httpStatus;
  if (typeof httpStatus === "number" && (httpStatus < 200 || httpStatus >= 300)) {
    observe("error", `DAHR source returned HTTP ${httpStatus}`, {
      substage: "publish",
      source: "publish-pipeline.ts:attestDahr",
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
        `DAHR returned XML/HTML instead of JSON. Use JSON API endpoints only (not RSS/XML feeds). ` +
        `First 100 chars: ${trimmed.slice(0, 100)}`
      );
    }
    try {
      data = JSON.parse(proxyResponse.data);
    } catch {
      throw new Error(
        `DAHR returned non-JSON response. First 100 chars: ${trimmed.slice(0, 100)}`
      );
    }
  } else {
    data = proxyResponse.data;
  }

  // GUARDRAIL: Detect auth/error responses in JSON body even when SDK doesn't expose status code.
  // Some APIs return 200 with error payloads (e.g., {"error": "Unauthorized"}).
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    const errField = d.error ?? d.Error ?? d.message ?? d.detail;
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
  observe("pattern", `DAHR attestation succeeded`, {
    substage: "publish",
    source: "publish-pipeline.ts:attestDahr",
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
      source: "publish-pipeline.ts:attestTlsn",
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
      source: "publish-pipeline.ts:attestTlsn",
      data: { url },
    });
    throw new Error(`TLSN unavailable: ${msg}`);
  }
}

// ── Publish ────────────────────────────────────────

/**
 * Publish a HIVE-encoded post to the Demos chain.
 * Returns the transaction hash.
 */
export async function publishPost(
  demos: Demos,
  input: PublishInput,
  options: PublishOptions = {}
): Promise<PublishResult> {
  const warnings: string[] = [];
  if (sessionIndexerLagDetected) {
    const warning = "Previous publish did not appear in feed during indexer check; SuperColony indexer may still be behind.";
    warnings.push(warning);
    info(`Publish warning: ${warning}`);
  }

  const hasDahr = Array.isArray(input.sourceAttestations) && input.sourceAttestations.length > 0;
  const hasTlsn = Array.isArray(input.tlsnAttestations) && input.tlsnAttestations.length > 0;
  if (!hasDahr && !hasTlsn) {
    throw new Error("Refusing unattested publish: sourceAttestations or tlsnAttestations is required");
  }

  if (hasDahr) {
    for (const att of input.sourceAttestations || []) {
      if (!att?.url || !att?.responseHash || !att?.txHash) {
        throw new Error("Refusing publish: invalid sourceAttestations entry (url/responseHash/txHash required)");
      }
    }
  }
  if (hasTlsn) {
    for (const att of input.tlsnAttestations || []) {
      if (!att?.url || !att?.txHash) {
        throw new Error("Refusing publish: invalid tlsnAttestations entry (url/txHash required)");
      }
    }
  }

  const post: Record<string, unknown> = {
    v: 1,
    cat: input.category,
    text: input.text,
  };
  if (input.tags.length > 0) post.tags = input.tags;
  if (input.confidence !== undefined) post.confidence = input.confidence;
  if (input.replyTo) post.replyTo = input.replyTo;
  if (input.assets && input.assets.length > 0) post.assets = input.assets;
  if (input.sourceAttestations && input.sourceAttestations.length > 0) {
    post.sourceAttestations = input.sourceAttestations.map((a) => ({
      url: a.url,
      responseHash: a.responseHash,
      txHash: a.txHash,
      timestamp: typeof a.timestamp === "number" ? a.timestamp : Date.now(),
    }));
  }
  if (input.tlsnAttestations && input.tlsnAttestations.length > 0) {
    post.tlsnAttestations = input.tlsnAttestations.map((a) => ({
      url: a.url,
      txHash: a.txHash,
      timestamp: typeof a.timestamp === "number" ? a.timestamp : Date.now(),
    }));
  }

  info(`Publishing ${input.category} post (${input.text.length} chars)...`);

  const encoded = encodeHivePost(post);
  info(`HIVE encoded: ${encoded.length} bytes`);
  const stages = {
    store: async (payload: Uint8Array) => {
      const tx = await DemosTransactions.store(payload, demos);
      info("Transaction created, confirming...");
      return tx;
    },
    confirm: async (tx: unknown) => {
      const validity = await DemosTransactions.confirm(
        tx as Parameters<typeof DemosTransactions.confirm>[0],
        demos,
      );
      info("Confirmed, broadcasting...");
      return validity;
    },
    broadcast: (validity: unknown) =>
      DemosTransactions.broadcast(
        validity as Parameters<typeof DemosTransactions.broadcast>[0],
        demos,
      ),
  };

  const chainTx = await executeChainTx(stages, encoded).catch((error: unknown) => {
    if (error instanceof Error && error.message === "Confirmed transaction missing txHash") {
      observe("error", "Broadcast succeeded but txHash not found in response", {
        substage: "publish",
        source: "publish-pipeline.ts:publishPost",
      });
      throw new Error("Broadcast succeeded but txHash not found in response");
    }
    throw error;
  });

  const txHash = extractTxHash({ txHash: chainTx.txHash });

  if (!txHash) {
    observe("error", "Broadcast succeeded but txHash not found in response", {
      substage: "publish",
      source: "publish-pipeline.ts:publishPost",
    });
    throw new Error("Broadcast succeeded but txHash not found in response");
  }

  info(`Published: txHash=${String(txHash).slice(0, 16)}...`);
  observe("pattern", `Post published: ${String(txHash).slice(0, 16)}...`, {
    substage: "publish",
    source: "publish-pipeline.ts:publishPost",
    data: { txHash: String(txHash), category: input.category, textLength: input.text.length },
  });

  if (options.feedToken && !options.skipIndexerCheck) {
    const indexed = await checkIndexerHealth(String(txHash), options.feedToken);
    if (!indexed) {
      sessionIndexerLagDetected = true;
      const warning = `Indexer lag detected: published tx ${String(txHash).slice(0, 16)}... did not appear in /api/feed?limit=5 after 3 checks.`;
      warnings.push(warning);
      observe("inefficiency", warning, {
        substage: "publish",
        source: "publish-pipeline.ts:checkIndexerHealth",
        data: { txHash: String(txHash) },
      });
    }
  }

  return {
    txHash: String(txHash),
    category: input.category,
    textLength: input.text.length,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Full pipeline: attest data source, then publish post.
 * Combines DAHR attestation with HIVE publishing.
 */
export async function attestAndPublish(
  demos: Demos,
  input: PublishInput,
  attestUrl?: string,
  options: PublishOptions = {}
): Promise<PublishResult> {
  let attestation: AttestResult | undefined;

  // Step 1: Use pre-attested results if available, otherwise attest
  if (options.preAttested && options.preAttested.length > 0) {
    // Claim-driven attestation already ran — use those results
    attestation = options.preAttested[0]; // Primary for reporting

    const sourceAttestations = options.preAttested
      .filter((a) => a.type === "dahr")
      .map((a) => ({
        url: a.url,
        responseHash: String(a.responseHash || ""),
        txHash: a.txHash,
        timestamp: Date.now(),
      }));
    const tlsnAttestations = options.preAttested
      .filter((a) => a.type === "tlsn")
      .map((a) => ({
        url: a.url,
        txHash: a.txHash,
        timestamp: Date.now(),
      }));

    const result = await publishPost(demos, {
      ...input,
      sourceAttestations: sourceAttestations.length > 0 ? sourceAttestations : input.sourceAttestations,
      tlsnAttestations: tlsnAttestations.length > 0 ? tlsnAttestations : input.tlsnAttestations,
    }, options);
    result.attestation = attestation;
    return result;
  }

  // Legacy single-attestation path
  if (attestUrl) {
    attestation = await attestDahr(demos, attestUrl);
  }

  // Step 2: Publish
  const sourceAttestations = attestation?.type === "dahr"
    ? [{
        url: attestation.url,
        responseHash: String(attestation.responseHash || ""),
        txHash: attestation.txHash,
        timestamp: Date.now(),
      }]
    : input.sourceAttestations;
  const tlsnAttestations = attestation?.type === "tlsn"
    ? [{
        url: attestation.url,
        txHash: attestation.txHash,
        timestamp: Date.now(),
      }]
    : input.tlsnAttestations;

  if ((!sourceAttestations || sourceAttestations.length === 0) && (!tlsnAttestations || tlsnAttestations.length === 0)) {
    throw new Error("Refusing unattested publish: attestation step did not produce a source attestation");
  }

  const result = await publishPost(demos, {
    ...input,
    sourceAttestations,
    tlsnAttestations,
  }, options);
  result.attestation = attestation;

  return result;
}
