/**
 * Autonomous publish pipeline for Sentinel session-runner.
 *
 * Orchestrates: DAHR attestation → HIVE post → txHash capture.
 * Used by session-runner in autonomous/approve modes.
 *
 * Uses the same SDK patterns as supercolony.ts (post + attest commands).
 */

import { Demos, DemosTransactions } from "@kynesyslabs/demosdk/websdk";
import { info } from "./sdk.js";

// ── Constants ──────────────────────────────────────

const HIVE_PREFIX = new Uint8Array([0x48, 0x49, 0x56, 0x45]); // "HIVE"

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
}

export interface AttestResult {
  type: "dahr";
  /** The URL that was actually attested (may differ from requested due to guardrails) */
  url: string;
  /** The original URL requested before any guardrail rewrites */
  requestedUrl: string;
  responseHash: string;
  txHash: string;
  data: any;
}

export interface PublishResult {
  txHash: string;
  category: string;
  textLength: number;
  attestation?: AttestResult;
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
  // GUARDRAIL: Force HN Algolia hitsPerPage to 2 — responses >16KB hit TLSN max_recv limit
  let attestUrl = url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "hn.algolia.com") {
      info(`GUARDRAIL: Forcing hitsPerPage=2 for HN Algolia (16KB TLSN limit)`);
      parsed.searchParams.set("hitsPerPage", "2");
      attestUrl = parsed.toString();
    }
  } catch {
    // Not a valid URL — proceed with original, will likely fail downstream
  }

  info(`DAHR attesting: ${attestUrl}`);
  const dahr = await (demos as any).web2.createDahr();
  const proxyResponse = await dahr.startProxy({ url: attestUrl, method });

  let data: any;
  if (typeof proxyResponse.data === "string") {
    const trimmed = proxyResponse.data.trim();
    if (trimmed.startsWith("<")) {
      throw new Error(
        `DAHR returned XML/HTML instead of JSON. Use JSON API endpoints only (not RSS/XML feeds). ` +
        `First 100 chars: ${trimmed.slice(0, 100)}`
      );
    }
    data = JSON.parse(proxyResponse.data);
  } else {
    data = proxyResponse.data;
  }

  info(`DAHR attested: hash=${proxyResponse.responseHash}, tx=${proxyResponse.txHash}`);

  return {
    type: "dahr",
    url: attestUrl,
    requestedUrl: url,
    responseHash: proxyResponse.responseHash,
    txHash: proxyResponse.txHash,
    data,
  };
}

// ── Publish ────────────────────────────────────────

/**
 * Publish a HIVE-encoded post to the Demos chain.
 * Returns the transaction hash.
 */
export async function publishPost(
  demos: Demos,
  input: PublishInput
): Promise<PublishResult> {
  const post: any = {
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

  info(`Publishing ${input.category} post (${input.text.length} chars)...`);

  const encoded = encodeHivePost(post);
  info(`HIVE encoded: ${encoded.length} bytes`);

  const tx = await DemosTransactions.store(encoded, demos);
  info("Transaction created, confirming...");

  const validity = await DemosTransactions.confirm(tx, demos);
  info("Confirmed, broadcasting...");

  const result = await DemosTransactions.broadcast(validity, demos);

  // Extract txHash across known SDK response shapes.
  const confirmHash = (validity as any)?.response?.data?.transaction?.hash;
  const results = (result as any).response?.results;
  const txHash = confirmHash || (results
    ? results[Object.keys(results)[0]]?.hash
    : (result as any)?.response?.data?.transaction?.hash ||
      (result as any)?.response?.data?.hash ||
      (result as any)?.data?.transaction?.hash ||
      (result as any)?.hash ||
      (result as any)?.txHash);

  if (!txHash) {
    throw new Error("Broadcast succeeded but txHash not found in response");
  }

  info(`Published: txHash=${String(txHash).slice(0, 16)}...`);

  return {
    txHash: String(txHash),
    category: input.category,
    textLength: input.text.length,
  };
}

/**
 * Full pipeline: attest data source, then publish post.
 * Combines DAHR attestation with HIVE publishing.
 */
export async function attestAndPublish(
  demos: Demos,
  input: PublishInput,
  attestUrl?: string
): Promise<PublishResult> {
  let attestation: AttestResult | undefined;

  // Step 1: Attest if URL provided
  if (attestUrl) {
    attestation = await attestDahr(demos, attestUrl);
  }

  // Step 2: Publish
  const result = await publishPost(demos, {
    ...input,
    sourceAttestations: attestation ? [{
      url: attestation.url,
      responseHash: attestation.responseHash,
      txHash: attestation.txHash,
      timestamp: Date.now(),
    }] : input.sourceAttestations,
  });
  result.attestation = attestation;

  return result;
}
