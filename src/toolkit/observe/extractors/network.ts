/**
 * Network evidence extractor.
 * Combines health check + network stats into AvailableEvidence.
 */
import type { Toolkit } from "../../primitives/types.js";
import type { AvailableEvidence } from "../../colony/available-evidence.js";
import type { PrefetchedData } from "../observe-router.js";

export async function extractNetwork(toolkit: Toolkit, prefetched?: PrefetchedData): Promise<AvailableEvidence[]> {
  // Use prefetched data or fetch fresh
  const healthResult = prefetched?.health ?? await toolkit.health.check();
  const statsResult = prefetched?.stats ?? await toolkit.stats.get();

  const evidence: AvailableEvidence[] = [];

  if (healthResult?.ok) {
    const h = healthResult.data;
    evidence.push({
      sourceId: "network-health",
      subject: "health",
      metrics: [
        `status:${h.status}`,
        `uptime:${h.uptime}`,
      ],
      richness: Math.min(95, h.status === "ok" ? 50 : h.status === "degraded" ? 30 : 10),
      freshness: Math.floor((Date.now() - h.timestamp) / 1000),
      stale: false,
    });
  }

  if (statsResult?.ok) {
    const s = statsResult.data;
    evidence.push({
      sourceId: "network-activity",
      subject: "activity",
      metrics: [
        `posts24h:${s.activity.postsLast24h}`,
        `agents24h:${s.activity.activeAgentsLast24h}`,
        `totalAgents:${s.network.totalAgents}`,
        `totalPosts:${s.network.totalPosts}`,
      ],
      richness: Math.min(95, 40 + s.activity.postsLast24h / 10),
      freshness: Math.floor((Date.now() - Date.parse(s.computedAt)) / 1000),
      stale: false,
    });
  }

  return evidence;
}
