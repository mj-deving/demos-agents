/**
 * Agent quality index from colony DB.
 * Builds an in-memory index of agent activity and detects topic convergence.
 */

import type { ColonyDatabase } from "./schema.js";

export interface AgentIndexEntry {
  address: string;
  postCount: number;
  avgScore: number;
  recentTopics: string[];
  lastActiveAt: string;
}

interface AgentIndexRow {
  address: string;
  post_count: number;
  avg_score: number;
  last_active_at: string;
  all_tags: string;
}

/**
 * Build an agent quality index by aggregating posts from the last 24 hours.
 * Groups by author, counts posts, averages agrees from reaction_cache,
 * and collects distinct tags as recent topics.
 */
export function buildAgentIndex(db: ColonyDatabase): AgentIndexEntry[] {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const rows = db.prepare(`
    SELECT
      p.author AS address,
      COUNT(*) AS post_count,
      COALESCE(AVG(rc.agrees), 0) AS avg_score,
      MAX(p.timestamp) AS last_active_at,
      GROUP_CONCAT(p.tags, '|||') AS all_tags
    FROM posts p
    LEFT JOIN reaction_cache rc ON rc.post_tx_hash = p.tx_hash
    WHERE p.timestamp >= ?
    GROUP BY p.author
    ORDER BY avg_score DESC
  `).all(cutoff) as AgentIndexRow[];

  return rows.map((row) => ({
    address: row.address,
    postCount: row.post_count,
    avgScore: row.avg_score,
    lastActiveAt: row.last_active_at,
    recentTopics: extractTopics(row.all_tags),
  }));
}

/**
 * Detect convergence: how many agents recently posted on a similar topic.
 * Returns whether the count meets or exceeds the threshold.
 */
export function detectConvergence(
  topic: string,
  agentIndex: AgentIndexEntry[],
  threshold = 3,
): { isConvergent: boolean; agentCount: number; agents: string[] } {
  const needle = topic.toLowerCase();

  const matchingAgents = agentIndex
    .filter((entry) =>
      entry.recentTopics.some((t) => t.toLowerCase() === needle),
    )
    .map((entry) => entry.address);

  return {
    isConvergent: matchingAgents.length >= threshold,
    agentCount: matchingAgents.length,
    agents: matchingAgents,
  };
}

/** Parse concatenated tags JSON arrays into a deduplicated topic list. */
function extractTopics(allTags: string | null): string[] {
  if (!allTags) return [];

  const seen = new Set<string>();
  for (const chunk of allTags.split("|||")) {
    try {
      const parsed = JSON.parse(chunk);
      if (Array.isArray(parsed)) {
        for (const tag of parsed) {
          if (typeof tag === "string" && tag.length > 0) {
            seen.add(tag);
          }
        }
      }
    } catch {
      // Skip malformed tags
    }
  }
  return [...seen];
}
