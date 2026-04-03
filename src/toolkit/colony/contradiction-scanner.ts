/**
 * Contradiction Scanner — finds conflicting claims in the claim ledger.
 *
 * Phase 8b: Scans for (subject, metric) pairs where multiple agents
 * claim different values within a time window. Returns structured
 * ContradictionEntry[] for the strategy engine.
 *
 * Review fixes applied:
 * - [Fabric M8] Self-exclusion: skip contradictions involving only our own claims
 * - [Fabric M9] `since` is required (not optional)
 * - [Threat M10] `maxResults` caps output (default 3)
 * - [Codex H3] Target selection: newest contradictory post by different author
 */

import type { ColonyDatabase } from "./schema.js";
import type { ContradictionEntry } from "../strategy/types.js";
import { findContradictions } from "./claims.js";

/** Default time windows per metric type (milliseconds). */
export const METRIC_WINDOWS: Record<string, number> = {
  price: 3_600_000,
  price_usd: 3_600_000,
  volume: 3_600_000,
  tvl: 86_400_000,
  total_supply: 86_400_000,
  hash_rate: 21_600_000,
  difficulty: 21_600_000,
  block_count: 3_600_000,
  tx_count: 3_600_000,
  default: 3_600_000,
};

export interface ContradictionScanOptions {
  /** ISO timestamp — only scan claims after this time. Required. */
  since: string;
  /** Our wallet address — used for self-exclusion. */
  ourAddress: string;
  /** Override metric windows. */
  metricWindows?: Record<string, number>;
  /** Max contradictions to return (default 3). */
  maxResults?: number;
}

/**
 * Scan the claim ledger for contradictions: (subject, metric) pairs where
 * multiple agents claim different values within a metric-specific time window.
 */
export function scanForContradictions(
  db: ColonyDatabase,
  options: ContradictionScanOptions,
): ContradictionEntry[] {
  const windows = { ...METRIC_WINDOWS, ...options.metricWindows };
  const maxResults = options.maxResults ?? 3;
  const ourAddr = options.ourAddress.trim().toLowerCase();

  // Get distinct (subject, metric) pairs with claims since the cutoff
  const pairs = db.prepare(`
    SELECT DISTINCT subject, metric
    FROM claim_ledger
    WHERE claimed_at >= ?
    ORDER BY claimed_at DESC
  `).all(options.since) as Array<{ subject: string; metric: string }>;

  const results: ContradictionEntry[] = [];

  for (const { subject, metric } of pairs) {
    if (results.length >= maxResults) break;

    const windowMs = windows[metric] ?? windows.default;
    // findContradictions scans [since, since+windowMs]. For recent contradictions,
    // use (now - windowMs) as the scan start so the window covers the present.
    const windowSince = new Date(Date.now() - windowMs).toISOString();
    const effectiveSince = windowSince > options.since ? windowSince : options.since;
    const claims = findContradictions(db, subject, metric, windowMs, effectiveSince);

    if (claims.length === 0) continue;

    // Self-exclusion: skip if all claims are from us
    const otherAuthors = claims.filter((c) => c.author.trim().toLowerCase() !== ourAddr);
    if (otherAuthors.length === 0) continue;

    // Skip same-author updates: if all distinct values come from the same author, it's an update
    const uniqueAuthors = new Set(claims.map((c) => c.author.trim().toLowerCase()));
    if (uniqueAuthors.size === 1) continue;

    // Target selection: newest post by a different author
    const targetClaim = otherAuthors.sort(
      (a, b) => new Date(b.claimedAt).getTime() - new Date(a.claimedAt).getTime(),
    )[0];

    // Our supported value (if we have a claim in this window)
    const ourClaim = claims.find((c) => c.author.trim().toLowerCase() === ourAddr);

    results.push({
      subject,
      metric,
      claims: claims.map((c) => ({
        author: c.author,
        value: c.value,
        unit: c.unit,
        postTxHash: c.postTxHash,
        claimedAt: c.claimedAt,
        verified: c.verified,
      })),
      targetPostTxHash: targetClaim.postTxHash,
      // Only set supportedValue if our claim was verified — don't rebut with unverified data
      supportedValue: ourClaim?.verified ? ourClaim.value : null,
    });
  }

  return results;
}
