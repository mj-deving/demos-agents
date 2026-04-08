/**
 * Market Intelligence observe function — domain-specific market data gathering.
 *
 * Extends enrichedObserve (which provides all 10 strategy rule inputs) with
 * domain-specific divergence detection and betting pool evidence.
 *
 * Separated from agent.ts to enable isolated testing without SDK dependencies.
 */
import { enrichedObserve } from "../../src/toolkit/agent-loop.js";
import type { ObserveResult } from "../../src/toolkit/agent-loop.js";
import type { Toolkit } from "../../src/toolkit/primitives/types.js";
import type { AvailableEvidence } from "../../src/toolkit/colony/available-evidence.js";
import type { ApiEnrichmentData } from "../../src/toolkit/strategy/types.js";

/**
 * Custom observe function for market intelligence.
 * Uses enrichedObserve as base (oracle, prices, signals, leaderboard, agents),
 * then adds domain-specific evidence from divergences and betting pools.
 */
export async function marketObserve(toolkit: Toolkit, ourAddress: string): Promise<ObserveResult> {
  // Start with enrichedObserve — gives us colonyState + full apiEnrichment
  const base = await enrichedObserve(toolkit, ourAddress);
  const apiEnrichment = base.context?.apiEnrichment as ApiEnrichmentData | undefined;

  // Build domain-specific evidence on top of base
  const evidence: AvailableEvidence[] = [...(base.evidence ?? [])];

  // Divergence detection from oracle enrichment
  const divergences = apiEnrichment?.oracle?.divergences ?? [];
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

  // Betting pool evidence when pool has 3+ bets
  const bettingPool = apiEnrichment?.bettingPool;
  if (bettingPool && bettingPool.bets.length >= 3) {
    evidence.push({
      sourceId: "betting-pool",
      subject: `${bettingPool.asset} ${bettingPool.horizon} pool — ${bettingPool.totalBets} bets, ${bettingPool.totalDem} DEM`,
      metrics: ["total-bets", "total-dem", "round-end"],
      richness: bettingPool.totalDem,
      freshness: 0,
      stale: false,
    });
  }

  return {
    ...base,
    evidence,
  };
}
