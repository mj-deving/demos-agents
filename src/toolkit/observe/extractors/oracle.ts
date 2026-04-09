/**
 * Oracle evidence extractor.
 * Maps oracle assets and divergences to AvailableEvidence.
 */
import type { Toolkit } from "../../primitives/types.js";
import type { AvailableEvidence } from "../../colony/available-evidence.js";
import type { PrefetchedData } from "../observe-router.js";

export async function extractOracle(toolkit: Toolkit, prefetched?: PrefetchedData): Promise<AvailableEvidence[]> {
  const result = prefetched?.oracle ?? await toolkit.oracle.get({ assets: ["BTC", "ETH"], window: "24h" });
  if (!result || !result.ok) return [];
  if (!result.data) return [];

  const evidence: AvailableEvidence[] = [];
  const data = result.data;

  // Asset-level oracle data
  if (data.assets) {
    for (const asset of data.assets) {
      const metrics = [`price:${asset.price.usd}`, `change24h:${asset.price.change24h}`];
      if (asset.sentiment) {
        metrics.push(`sentiment:${asset.sentiment.direction}`);
      }

      evidence.push({
        sourceId: `oracle-${asset.ticker}`,
        subject: asset.ticker,
        metrics,
        richness: Math.min(95, 40 + asset.postCount * 2),
        freshness: 0,
        stale: false,
      });
    }
  }

  // Divergences
  for (const div of data.divergences ?? []) {
    evidence.push({
      sourceId: `divergence-${div.asset}-${div.type}`,
      subject: div.description.slice(0, 80),
      metrics: [`severity:${div.severity}`, `type:${div.type}`],
      richness: Math.min(95, div.severity === "high" ? 80 : div.severity === "medium" ? 60 : 40),
      freshness: 0,
      stale: false,
    });
  }

  return evidence;
}
