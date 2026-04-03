/**
 * Batch proof ingestion — resolves unverified attestations against the chain.
 *
 * Queries attestations with chain_verified=0, resolves each via proof-resolver,
 * updates DB with results. Runs incrementally (configurable limit per batch).
 */

import type { ColonyDatabase } from "./schema.js";
import type { ChainReaderRpc } from "../chain-reader.js";
import {
  resolveAttestation,
  compareProofToSnapshot,
  CHAIN_VERIFIED,
  CHAIN_FAILED,
  PERMANENT_FAILURES,
  type ResolutionResult,
} from "./proof-resolver.js";

export interface IngestionResult {
  resolved: number;
  verified: number;
  failed: number;
  skipped: number;
}

export interface IngestionOptions {
  /** Max attestations to resolve per batch (default: 20). */
  limit?: number;
}

interface UnresolvedRow {
  id: number;
  attestation_tx_hash: string;
  source_url: string;
  method: string;
  data_snapshot: string | null;
}

const DEFAULT_LIMIT = 20;

/**
 * Process unresolved attestations by resolving them against the chain in parallel.
 *
 * For each unresolved attestation:
 * 1. Call resolveAttestation() to fetch and classify the on-chain tx
 * 2. Compare resolved data against self-reported snapshot
 * 3. Update DB with chain_verified status, chain_method, chain_data, resolved_at
 */
export async function ingestProofs(
  db: ColonyDatabase,
  rpc: ChainReaderRpc,
  options?: IngestionOptions,
): Promise<IngestionResult> {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const result: IngestionResult = { resolved: 0, verified: 0, failed: 0, skipped: 0 };

  const rows = db.prepare(
    `SELECT id, attestation_tx_hash, source_url, method, data_snapshot
     FROM attestations
     WHERE chain_verified = 0
     ORDER BY id DESC
     LIMIT ?`,
  ).all(limit) as UnresolvedRow[];

  if (rows.length === 0) {
    return result;
  }

  // Resolve all attestations in parallel — each RPC call is independent
  const settled = await Promise.allSettled(
    rows.map((row) => resolveAttestation(rpc, row.attestation_tx_hash)),
  );

  // Pre-parse snapshots (cheap CPU work, done after RPC completes)
  const snapshots = rows.map((row) => {
    if (!row.data_snapshot) return null;
    try { return JSON.parse(row.data_snapshot) as Record<string, unknown>; }
    catch { return null; }
  });

  const updateStmt = db.prepare(
    `UPDATE attestations
     SET chain_verified = ?, chain_method = ?, chain_data = ?, resolved_at = ?
     WHERE id = ?`,
  );

  const now = new Date().toISOString();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const settledResult = settled[i];

    // Promise rejected = unexpected error in resolveAttestation (shouldn't happen, it has its own try/catch)
    if (settledResult.status === "rejected") {
      updateStmt.run(CHAIN_FAILED, null, JSON.stringify({ error: "unexpected_rejection" }), now, row.id);
      result.failed += 1;
      continue;
    }

    const resolution: ResolutionResult = settledResult.value;

    if (!resolution.verified) {
      if (PERMANENT_FAILURES.has(resolution.reason)) {
        updateStmt.run(CHAIN_FAILED, null, JSON.stringify({ reason: resolution.reason }), now, row.id);
        result.failed += 1;
      } else {
        // Retryable (rpc_error, rpc_unavailable, tx_not_confirmed) — leave as 0 for next batch
        result.skipped += 1;
      }
      continue;
    }

    // Validate that chain-resolved data matches self-reported claims
    // A post citing a real txHash for a different URL/method is spoofing
    const methodMatch = resolution.method === row.method;
    const chainUrl = resolution.sourceUrl.toLowerCase();
    const claimedUrl = row.source_url.toLowerCase();
    const urlMatch = !chainUrl || !claimedUrl
      || chainUrl.includes(claimedUrl) || claimedUrl.includes(chainUrl);

    const comparison = compareProofToSnapshot(resolution, snapshots[i]);
    const chainDataPayload = JSON.stringify({
      proof: resolution.chainData,
      comparison,
      methodMatch,
      urlMatch,
    });

    if (!methodMatch || !urlMatch) {
      // Chain tx exists but doesn't match what the post claims — mark as failed (spoofing)
      updateStmt.run(CHAIN_FAILED, resolution.method, chainDataPayload, now, row.id);
      result.failed += 1;
      continue;
    }

    updateStmt.run(CHAIN_VERIFIED, resolution.method, chainDataPayload, now, row.id);
    result.resolved += 1;
    result.verified += 1;
  }

  return result;
}
