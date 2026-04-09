/**
 * Colony Intelligence Summary — aggregates all colony intelligence for strategy decisions.
 *
 * Phase 8d: Consolidates interactions, profiles, claim freshness, evidence quality,
 * and colony health into a single ColonyIntelligenceSummary for the strategy bridge.
 * Replaces inline intelligence computation in v3-strategy-bridge.ts plan().
 */

import type { ColonyDatabase } from "./schema.js";
import { getAgentProfile, getInteractionHistory } from "./intelligence.js";

export interface ColonyIntelligenceSummary {
  recentInteractions: Record<string, number>;
  recentTips: Record<string, number>;
  agentProfiles: Record<string, {
    postCount: number;
    avgAgrees: number;
    avgDisagrees: number;
    topics: string[];
    socialHandles?: Array<{ platform: string; username: string }>;
  }>;
  claimFreshness: Record<string, string>;
  evidenceQuality: Record<string, number>;
  colonyHealth: {
    postsLast24h: number;
    activeAgents: number;
    verifiedPostRatio: number;
    avgClaimsPerPost: number;
  };
}

export interface IntelligenceOptions {
  ourAddress: string;
  topContributorAddresses: string[];
  mentionAuthors: string[];
  since24h: string;
}

/**
 * Build a comprehensive intelligence summary from the colony DB.
 * All queries are read-only against indexed SQLite tables (<50ms combined).
 */
export function buildColonyIntelligence(
  db: ColonyDatabase,
  options: IntelligenceOptions,
): ColonyIntelligenceSummary {
  // Interactions and tips
  const recentInteractions: Record<string, number> = {};
  const recentTips: Record<string, number> = {};

  try {
    const interactions = getInteractionHistory(db, { since: options.since24h, limit: 200 });
    for (const interaction of interactions) {
      const addr = interaction.theirAddress.trim().toLowerCase();
      recentInteractions[addr] = (recentInteractions[addr] ?? 0) + 1;
      if (interaction.interactionType === "we_tipped") {
        recentTips[addr] = (recentTips[addr] ?? 0) + 1;
        // Also key by post txHash for post-specific tip dedup (tip_valuable redesign)
        if (interaction.theirTxHash) {
          recentTips[interaction.theirTxHash] = (recentTips[interaction.theirTxHash] ?? 0) + 1;
        }
      }
    }
  } catch {
    // Non-fatal
  }

  // Agent profiles
  const agentProfiles: ColonyIntelligenceSummary["agentProfiles"] = {};
  const profileAddresses = new Set([
    ...options.topContributorAddresses,
    ...options.mentionAuthors,
  ]);

  for (const address of profileAddresses) {
    try {
      const profile = getAgentProfile(db, address);
      if (profile) {
        agentProfiles[address.trim().toLowerCase()] = {
          postCount: profile.postCount,
          avgAgrees: profile.avgAgrees,
          avgDisagrees: profile.avgDisagrees,
          topics: profile.topics,
        };
      }
    } catch {
      // Skip failed profile lookups
    }
  }

  // Claim freshness — most recent claim per subject
  const claimFreshness: Record<string, string> = {};
  try {
    const rows = db.prepare(`
      SELECT subject, MAX(claimed_at) as latest
      FROM claim_ledger
      WHERE claimed_at >= ?
      GROUP BY subject
      ORDER BY latest DESC
      LIMIT 50
    `).all(options.since24h) as Array<{ subject: string; latest: string }>;
    for (const row of rows) {
      claimFreshness[row.subject] = row.latest;
    }
  } catch {
    // Non-fatal
  }

  // Evidence quality — source freshness and richness
  const evidenceQuality: Record<string, number> = {};
  try {
    const rows = db.prepare(`
      SELECT source_id, response_size, last_fetched_at, consecutive_failures
      FROM source_response_cache
      WHERE consecutive_failures < 3
      LIMIT 200
    `).all() as Array<{ source_id: string; response_size: number; last_fetched_at: string; consecutive_failures: number }>;
    const now = Date.now();
    for (const row of rows) {
      const ageMs = now - new Date(row.last_fetched_at).getTime();
      const freshnessFactor = Math.max(0, 1 - ageMs / (3_600_000 * 24)); // 0-1, decays over 24h
      evidenceQuality[row.source_id] = Math.round(row.response_size * freshnessFactor);
    }
  } catch {
    // Non-fatal
  }

  // Colony health metrics
  let postsLast24h = 0;
  let activeAgents = 0;
  let verifiedPostRatio = 0;
  let avgClaimsPerPost = 0;

  try {
    const postCount = db.prepare(
      "SELECT COUNT(*) FROM posts WHERE timestamp >= ?",
    ).pluck().get(options.since24h) as number;
    postsLast24h = postCount;

    const agentCount = db.prepare(
      "SELECT COUNT(DISTINCT author) FROM posts WHERE timestamp >= ?",
    ).pluck().get(options.since24h) as number;
    activeAgents = agentCount;

    if (postCount > 0) {
      const verifiedCount = db.prepare(`
        SELECT COUNT(DISTINCT a.post_tx_hash)
        FROM attestations a
        JOIN posts p ON a.post_tx_hash = p.tx_hash
        WHERE a.chain_verified = 1
          AND p.timestamp >= ?
      `).pluck().get(options.since24h) as number;
      verifiedPostRatio = verifiedCount / postCount;

      const claimCount = db.prepare(
        "SELECT COUNT(*) FROM claim_ledger WHERE claimed_at >= ?",
      ).pluck().get(options.since24h) as number;
      avgClaimsPerPost = claimCount / postCount;
    }
  } catch {
    // Non-fatal
  }

  return {
    recentInteractions,
    recentTips,
    agentProfiles,
    claimFreshness,
    evidenceQuality,
    colonyHealth: {
      postsLast24h,
      activeAgents,
      verifiedPostRatio,
      avgClaimsPerPost,
    },
  };
}
