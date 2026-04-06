/**
 * Market Intelligence observe function — domain-specific market data gathering.
 *
 * Fetches oracle, prices, signals, and betting pool data in parallel.
 * Detects price divergences and builds evidence from market data.
 *
 * Separated from agent.ts to enable isolated testing without SDK dependencies.
 */
import { buildColonyStateFromFeed, mapFeedPosts } from "../../src/toolkit/agent-loop.js";
import type { ObserveResult } from "../../src/toolkit/agent-loop.js";
import type { Toolkit } from "../../src/toolkit/primitives/types.js";
import type { AvailableEvidence } from "../../src/toolkit/colony/available-evidence.js";
import type { ApiEnrichmentData } from "../../src/toolkit/strategy/types.js";

// ── Configuration ──────────────────────────────
const DEFAULT_ASSETS = ["BTC", "ETH"];
const DEFAULT_DIVERGENCE_THRESHOLD = 10; // percent

/**
 * Custom observe function for market intelligence.
 * Fetches oracle, prices, predictions, signals, and betting pool in parallel.
 * Detects price divergences and builds evidence from market data.
 */
export async function marketObserve(toolkit: Toolkit, ourAddress: string): Promise<ObserveResult> {
  // Fetch all data sources in parallel
  const [feedResult, oracleResult, pricesResult, signalsResult, poolResult] = await Promise.all([
    toolkit.feed.getRecent({ limit: 100 }),
    toolkit.oracle.get({ assets: DEFAULT_ASSETS }),
    toolkit.prices.get(DEFAULT_ASSETS),
    toolkit.intelligence.getSignals(),
    toolkit.ballot.getPool(),
  ]);

  // Build colony state from feed using shared mapper
  const posts = mapFeedPosts(feedResult as any);
  const colonyState = buildColonyStateFromFeed(posts, ourAddress);

  // Build evidence array
  const evidence: AvailableEvidence[] = [];

  // Divergence detection: real oracle API has divergences[] at top level
  // Shape: { type, asset, description, severity, details }
  if (oracleResult?.ok) {
    const oracle = oracleResult.data as any;
    const divergences = oracle.divergences ?? oracle.priceDivergences ?? [];
    for (const div of divergences) {
      evidence.push({
        sourceId: `oracle-divergence-${div.asset ?? "unknown"}`,
        subject: `${div.asset ?? "unknown"} ${div.type ?? "divergence"}: ${div.description ?? ""}`.slice(0, 120),
        metrics: [
          `severity=${div.severity ?? "unknown"}`,
          `type=${div.type ?? "unknown"}`,
          ...(div.details?.agentConfidence ? [`confidence=${div.details.agentConfidence}`] : []),
        ],
        richness: div.severity === "high" ? 1.0 : div.severity === "medium" ? 0.7 : 0.4,
        freshness: 0,
        stale: false,
      });
    }
  }

  // Betting pool evidence when pool has 3+ bets
  if (poolResult?.ok) {
    const pool = poolResult.data;
    if (pool.bets.length >= 3) {
      evidence.push({
        sourceId: "betting-pool",
        subject: `${pool.asset} ${pool.horizon} pool — ${pool.totalBets} bets, ${pool.totalDem} DEM`,
        metrics: ["total-bets", "total-dem", "round-end"],
        richness: pool.totalDem,
        freshness: 0,
        stale: false,
      });
    }
  }

  // Build apiEnrichment context for the strategy engine
  const apiEnrichment: ApiEnrichmentData = {};
  if (oracleResult?.ok) apiEnrichment.oracle = oracleResult.data;
  if (pricesResult?.ok) apiEnrichment.prices = pricesResult.data;
  if (signalsResult?.ok) apiEnrichment.signals = signalsResult.data;
  if (poolResult?.ok) apiEnrichment.bettingPool = poolResult.data;

  return {
    colonyState,
    evidence,
    context: { apiEnrichment },
  };
}
