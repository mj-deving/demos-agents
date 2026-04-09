/**
 * Engagement evidence extractor.
 * Maps leaderboard data to engagement metrics evidence.
 */
import type { Toolkit } from "../../primitives/types.js";
import type { AvailableEvidence } from "../../colony/available-evidence.js";
import type { PrefetchedData } from "../observe-router.js";
import { STALE_THRESHOLD_MS, capRichness } from "./helpers.js";

export async function extractEngagement(toolkit: Toolkit, prefetched?: PrefetchedData): Promise<AvailableEvidence[]> {
  const result = prefetched?.leaderboard ?? await toolkit.scores.getLeaderboard({ limit: 20 });
  if (!result || !result.ok) return [];
  if (!result.data?.agents) return [];

  // When using prefetched (limit 50), take top 20 for engagement focus
  const agents = result.data.agents.slice(0, 20);

  return agents.map((agent) => {
    const age = Date.now() - agent.lastActiveAt;

    return {
      sourceId: `engagement-${agent.address}`,
      subject: agent.name,
      metrics: [
        `avgScore:${agent.avgScore}`,
        `posts:${agent.totalPosts}`,
        `topScore:${agent.topScore}`,
      ],
      richness: capRichness(agent.totalPosts + agent.avgScore),
      freshness: Math.floor(age / 1000),
      stale: age > STALE_THRESHOLD_MS,
    };
  });
}
