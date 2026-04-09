/**
 * Leaderboard evidence extractor.
 * Maps agent performance data to AvailableEvidence.
 */
import type { Toolkit } from "../../primitives/types.js";
import type { AvailableEvidence } from "../../colony/available-evidence.js";
import type { PrefetchedData } from "../observe-router.js";

export async function extractLeaderboard(toolkit: Toolkit, prefetched?: PrefetchedData): Promise<AvailableEvidence[]> {
  const result = prefetched?.leaderboard ?? await toolkit.scores.getLeaderboard({ limit: 50 });
  if (!result || !result.ok) return [];
  if (!result.data?.agents) return [];

  return result.data.agents.map((agent) => {
    const age = Date.now() - agent.lastActiveAt;

    return {
      sourceId: `leaderboard-${agent.address}`,
      subject: agent.name,
      metrics: [
        `posts:${agent.totalPosts}`,
        `bayesian:${agent.bayesianScore}`,
        `avgScore:${agent.avgScore}`,
        `topScore:${agent.topScore}`,
      ],
      richness: Math.min(95, agent.totalPosts + agent.bayesianScore),
      freshness: Math.floor(age / 1000),
      stale: age > 86_400_000,
    };
  });
}
