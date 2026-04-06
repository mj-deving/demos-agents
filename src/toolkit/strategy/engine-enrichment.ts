/**
 * Enrichment-aware strategy rules (Phase 6a/6b).
 *
 * These rules depend on optional API enrichment data (leaderboard, signals,
 * oracle prices, ballot accuracy). Extracted from engine.ts to keep each
 * module under 300 lines.
 */

import type { DecisionContext, DecisionLog, StrategyConfig } from "./types.js";
import { normalize, getRule, createAction, type EngineCandidate, buildEvidenceIndex } from "./engine-helpers.js";

/**
 * Evaluate enrichment-aware rules and append candidates/considered.
 * Called from decideActions() in engine.ts after core rules have run.
 */
export function evaluateEnrichmentRules(
  config: StrategyConfig,
  context: DecisionContext,
  evidenceIndex: ReturnType<typeof buildEvidenceIndex>,
  candidates: EngineCandidate[],
  considered: DecisionLog["considered"],
): void {
  const enrichment = context.apiEnrichment;

  // ── engage_novel_agents ─────────────────────────
  const engageNovelRule = getRule(config, "engage_novel_agents");
  if (engageNovelRule && enrichment?.leaderboard) {
    const recentTargets = new Set(
      candidates
        .filter((c) => c.action.type === "ENGAGE")
        .map((c) => normalize(c.action.target ?? "")),
    );

    const recencyThresholdMs = 48 * 60 * 60 * 1000; // 48h — matches resolveAgentToRecentPost
    const recencyCutoff = (context.now ?? new Date()).getTime() - recencyThresholdMs;

    for (const agent of enrichment.leaderboard.agents.slice(0, 10)) {
      if (recentTargets.has(normalize(agent.address))) continue;
      if (agent.bayesianScore < (enrichment.leaderboard.globalAvg ?? 0)) continue;
      if ((context.intelligence?.recentInteractions?.[normalize(agent.address)] ?? 0) > 0) continue;
      if (agent.lastActiveAt < recencyCutoff) continue; // Skip agents inactive >48h

      const action = createAction(
        engageNovelRule,
        `Engage novel high-quality agent ${agent.name ?? agent.address} (score ${agent.bayesianScore.toFixed(1)})`,
        {
          target: agent.address,
          targetType: "agent",
          metadata: {
            bayesianScore: agent.bayesianScore,
            totalPosts: agent.totalPosts,
          },
        },
      );

      candidates.push({ action, rule: engageNovelRule.name });
      considered.push({ action, rule: engageNovelRule.name });
    }
  }

  // ── publish_signal_aligned ──────────────────────
  const signalAlignedRule = getRule(config, "publish_signal_aligned");
  if (signalAlignedRule && enrichment?.signals) {
    for (const signal of enrichment.signals) {
      if (!signal.trending || signal.agents < (config.enrichment?.minSignalAgents ?? 2)) continue;

      const matchingEvidence = (evidenceIndex.get(normalize(signal.topic)) ?? [])
        .filter((item) => !item.stale);

      if (matchingEvidence.length === 0) continue;

      const action = createAction(
        signalAlignedRule,
        `Publish signal-aligned content on trending topic ${signal.topic} (${signal.agents} agents)`,
        {
          target: signal.topic,
          evidence: matchingEvidence.map((item) => item.sourceId),
          metadata: {
            signalConsensus: signal.consensus,
            signalAgents: signal.agents,
            signalSummary: signal.summary,
          },
        },
      );

      candidates.push({ action, rule: signalAlignedRule.name });
      considered.push({ action, rule: signalAlignedRule.name });
    }
  }

  // ── publish_on_divergence ───────────────────────
  const divergenceRule = getRule(config, "publish_on_divergence");
  if (divergenceRule && enrichment?.oracle?.priceDivergences) {
    const divergenceThreshold = config.enrichment?.divergenceThreshold ?? 10;

    for (const div of enrichment.oracle.priceDivergences) {
      if (Math.abs(div.spread) < divergenceThreshold) continue;

      const action = createAction(
        divergenceRule,
        `Publish divergence analysis: ${div.asset} spread ${div.spread > 0 ? "+" : ""}${div.spread}%`,
        {
          target: div.asset.toLowerCase(),
          metadata: {
            asset: div.asset,
            cexPrice: div.cex,
            dexPrice: div.dex,
            spread: div.spread,
            sentiment: enrichment.oracle.sentiment?.[div.asset],
          },
        },
      );

      candidates.push({ action, rule: divergenceRule.name });
      considered.push({ action, rule: divergenceRule.name });
    }
  }

  // ── publish_prediction ──────────────────────────
  // Fires when a betting pool is active with sufficient participation AND price data is available.
  // Replaces the deprecated ballotAccuracy check (/api/ballot returns 410 — now /api/bets/pool).
  const predictionRule = getRule(config, "publish_prediction");
  const minPoolBets = 3; // Minimum bets in pool to indicate meaningful market signal
  if (
    predictionRule
    && enrichment?.bettingPool
    && enrichment.bettingPool.totalBets >= minPoolBets
    && enrichment.prices
    && enrichment.prices.length > 0
  ) {
    const action = createAction(
      predictionRule,
      `Publish prediction — ${enrichment.bettingPool.asset} pool active (${enrichment.bettingPool.totalBets} bets, ${enrichment.bettingPool.totalDem} DEM)`,
      {
        metadata: {
          poolAsset: enrichment.bettingPool.asset,
          totalBets: enrichment.bettingPool.totalBets,
          totalDem: enrichment.bettingPool.totalDem,
          roundEnd: enrichment.bettingPool.roundEnd,
          availableAssets: enrichment.prices.map((p) => p.asset),
        },
      },
    );

    candidates.push({ action, rule: predictionRule.name });
    considered.push({ action, rule: predictionRule.name });
  }
}
