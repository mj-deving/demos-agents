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
  /** Max retries before marking as CHAIN_FAILED (default: 5). */
  maxRetries?: number;
}

interface UnresolvedRow {
  id: number;
  attestation_tx_hash: string;
  source_url: string;
  method: string;
  data_snapshot: string | null;
  post_author: string;
  retry_count: number;
}

const DEFAULT_LIMIT = 20;
const DEFAULT_MAX_RETRIES = 5;
const CLAIM_EXPIRY_MINUTES = 5;

/**
 * Compare chain-resolved URL against self-reported URL by hostname.
 * Rejects empty URLs (attacker can't bypass with missing URL field).
 * Rejects subdomain embedding (api.example.com.evil.com !== api.example.com).
 */
function compareUrls(chainUrl: string, claimedUrl: string): boolean {
  if (!chainUrl || !claimedUrl) return false;

  const chainHost = extractHostname(chainUrl);
  const claimedHost = extractHostname(claimedUrl);

  if (!chainHost || !claimedHost) return false;

  return chainHost === claimedHost;
}

function extractHostname(urlOrHost: string): string | null {
  try {
    // If it looks like a full URL, parse it
    if (urlOrHost.includes("://")) {
      return new URL(urlOrHost).hostname.toLowerCase();
    }
    // If it's just a hostname (e.g., "api.coingecko.com" from TLSN serverName)
    return urlOrHost.toLowerCase().split("/")[0].split(":")[0];
  } catch {
    return null;
  }
}

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
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const result: IngestionResult = { resolved: 0, verified: 0, failed: 0, skipped: 0 };

  // Concurrency guard: exclude rows claimed within the last N minutes.
  // Claims auto-expire so crashes don't permanently lock rows.
  const rows = db.prepare(
    `SELECT a.id, a.attestation_tx_hash, a.source_url, a.method, a.data_snapshot, a.retry_count, p.author as post_author
     FROM attestations a
     JOIN posts p ON a.post_tx_hash = p.tx_hash
     WHERE a.chain_verified = 0 AND a.retry_count < ?
       AND (a.claimed_at IS NULL OR a.claimed_at < datetime('now', '-${CLAIM_EXPIRY_MINUTES} minutes'))
     ORDER BY a.id DESC
     LIMIT ?`,
  ).all(maxRetries, limit) as UnresolvedRow[];

  if (rows.length === 0) {
    return result;
  }

  // Claim rows atomically before async RPC work to prevent double-processing
  const claimStmt = db.prepare(`UPDATE attestations SET claimed_at = datetime('now') WHERE id = ?`);
  const claimAll = db.transaction((ids: number[]) => { for (const id of ids) claimStmt.run(id); });
  claimAll(rows.map((r) => r.id));

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
     SET chain_verified = ?, chain_method = ?, chain_data = ?, resolved_at = ?, claimed_at = NULL
     WHERE id = ?`,
  );

  const retryStmt = db.prepare(
    `UPDATE attestations SET retry_count = retry_count + 1, claimed_at = NULL WHERE id = ?`,
  );

  const retryExhaustStmt = db.prepare(
    `UPDATE attestations
     SET chain_verified = ?, chain_data = ?, retry_count = retry_count + 1, resolved_at = ?, claimed_at = NULL
     WHERE id = ?`,
  );

  const now = new Date().toISOString();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const settledResult = settled[i];

    // Promise rejected = unexpected bug in resolveAttestation (it has its own try/catch for RPC).
    // Increment retry_count so it eventually stops; mark CHAIN_FAILED if retries exhausted.
    if (settledResult.status === "rejected") {
      if (row.retry_count + 1 >= maxRetries) {
        retryExhaustStmt.run(CHAIN_FAILED, JSON.stringify({ reason: "retries_exhausted" }), now, row.id);
        result.failed += 1;
      } else {
        retryStmt.run(row.id);
        result.skipped += 1;
      }
      continue;
    }

    const resolution: ResolutionResult = settledResult.value;

    if (!resolution.verified) {
      if (PERMANENT_FAILURES.has(resolution.reason)) {
        updateStmt.run(CHAIN_FAILED, null, JSON.stringify({ reason: resolution.reason }), now, row.id);
        result.failed += 1;
      } else {
        // Retryable (rpc_error, rpc_unavailable, tx_not_confirmed) — increment retry_count
        if (row.retry_count + 1 >= maxRetries) {
          retryExhaustStmt.run(CHAIN_FAILED, JSON.stringify({ reason: "retries_exhausted", lastReason: resolution.reason }), now, row.id);
          result.failed += 1;
        } else {
          retryStmt.run(row.id);
          result.skipped += 1;
        }
      }
      continue;
    }

    // Validate chain-resolved data against self-reported claims.
    // Three checks prevent attestation spoofing:
    // 1. Ownership: tx sender must match post author (prevents claiming others' attestations)
    // 2. Method: chain tx type must match claimed method (DAHR/TLSN)
    // 3. URL: chain source must match claimed source URL (prevents URL substitution)
    const ownerMatch = resolution.txSender.toLowerCase() === row.post_author.toLowerCase();
    const methodMatch = resolution.method === row.method;
    const urlMatch = compareUrls(resolution.sourceUrl, row.source_url);

    const comparison = compareProofToSnapshot(resolution, snapshots[i]);
    const chainDataPayload = JSON.stringify({
      proof: resolution.chainData,
      comparison,
      ownerMatch,
      methodMatch,
      urlMatch,
    });

    if (!ownerMatch || !methodMatch || !urlMatch) {
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

/** Release claims older than CLAIM_EXPIRY_MINUTES that were never resolved (crash recovery). */
export function releaseExpiredClaims(db: ColonyDatabase): number {
  const info = db.prepare(
    `UPDATE attestations SET claimed_at = NULL WHERE claimed_at IS NOT NULL AND claimed_at < datetime('now', '-${CLAIM_EXPIRY_MINUTES} minutes') AND chain_verified = 0`,
  ).run();
  return info.changes;
}
