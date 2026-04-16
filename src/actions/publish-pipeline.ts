/**
 * Autonomous publish pipeline for Sentinel session-runner.
 *
 * Orchestrates: DAHR attestation -> HIVE post -> txHash capture.
 * Used by session-runner in autonomous/approve modes.
 *
 * Uses the same SDK patterns as supercolony.ts (post + attest commands).
 */

import { Demos, DemosTransactions } from "@kynesyslabs/demosdk/websdk";
import { observe } from "../lib/pipeline/observe.js";
import { executeChainTx } from "../toolkit/chain/tx-pipeline.js";
import { extractTxHash } from "../toolkit/sdk-bridge.js";
import { attestDahr, attestTlsn } from "./publish-pipeline-attestation.js";
import {
  applyPreAttestedInput,
  buildNormalizedHivePost,
  encodeHivePost,
  resolveAttestedPublishInput,
} from "./publish-pipeline-normalize.js";
import { pollIndexerForTx } from "./publish-pipeline-indexer.js";

// ── Types ──────────────────────────────────────────

export interface PublishInput {
  text: string;
  category: string;
  tags: string[];
  confidence: number;
  replyTo?: string;
  assets?: string[];
  mentions?: string[];
  payload?: Record<string, unknown>;
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
  /** Allow publishing without attestation (lower score, used when attestation fails gracefully) */
  allowUnattested?: boolean;
}

let sessionIndexerLagDetected = false;

async function checkIndexerHealth(txHash: string, feedToken: string): Promise<boolean> {
  return pollIndexerForTx(txHash, feedToken);
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
    warnings.push(
      "Previous publish did not appear in feed during indexer check; SuperColony indexer may still be behind.",
    );
  }

  const post = buildNormalizedHivePost(input, options);

  const encoded = encodeHivePost(post);
  const stages = {
    // These SDK writes are not abortable. Failing fast on a timeout would risk
    // a duplicate retry if the original transaction lands after the caller gives up.
    store: async (payload: Uint8Array) => DemosTransactions.store(payload, demos),
    confirm: async (tx: unknown) =>
      DemosTransactions.confirm(
        tx as Parameters<typeof DemosTransactions.confirm>[0],
        demos,
      ),
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

  observe("pattern", `Post published: ${String(txHash).slice(0, 16)}...`, {
    substage: "publish",
    source: "publish-pipeline.ts:publishPost",
    data: { txHash: String(txHash), category: input.category, textLength: input.text.length },
  });

  if (options.feedToken && !options.skipIndexerCheck) {
    const indexed = await checkIndexerHealth(String(txHash), options.feedToken);
    if (!indexed) {
      sessionIndexerLagDetected = true;
      const warning =
        `Indexer lag detected: published tx ${String(txHash).slice(0, 16)}... ` +
        "did not appear in /api/feed?limit=5 after 3 checks.";
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

  if (options.preAttested && options.preAttested.length > 0) {
    const normalized = applyPreAttestedInput(input, options.preAttested);
    attestation = normalized.attestation;

    const result = await publishPost(demos, normalized.input, options);
    result.attestation = attestation;
    return result;
  }

  if (attestUrl) {
    attestation = await attestDahr(demos, attestUrl);
  }

  const normalizedInput = resolveAttestedPublishInput(input, attestation);

  if (
    (!normalizedInput.sourceAttestations || normalizedInput.sourceAttestations.length === 0) &&
    (!normalizedInput.tlsnAttestations || normalizedInput.tlsnAttestations.length === 0)
  ) {
    throw new Error(
      "Refusing unattested publish: attestation step did not produce a source attestation",
    );
  }

  const result = await publishPost(demos, normalizedInput, options);
  result.attestation = attestation;
  return result;
}

export { attestDahr, attestTlsn };
