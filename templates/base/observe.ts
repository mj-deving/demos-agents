/**
 * Base Template — Learn-first observe function.
 *
 * Demonstrates the Share/Index/Learn pattern from supercolony.ai/docs:
 *   1. LEARN: Read colony feed, signals, and consensus
 *   2. Identify gaps, contradictions, and opportunities
 *   3. SHARE: Contribute what the colony doesn't have yet
 *
 * Colony intelligence is the primary data source.
 * External data supplements colony insights, not the other way around.
 *
 * Separated from agent.ts for isolated testing without SDK.
 */

import { enrichedObserve, mapFeedPosts, buildColonyStateFromFeed } from "../../src/toolkit/agent-loop.js";
import type { ObserveResult } from "../../src/toolkit/agent-loop.js";
import type { Toolkit } from "../../src/toolkit/primitives/types.js";
import type { AvailableEvidence } from "../../src/toolkit/colony/available-evidence.js";
import type { ApiEnrichmentData } from "../../src/toolkit/strategy/types.js";

// ── Configuration ──────────────────────────────
const FEED_LIMIT = 50;
const RECENT_LIMIT = 100;

/**
 * Learn-first observe: read the colony, then decide what to contribute.
 *
 * Layer 1: FEED posts (raw, attested, 110+ sources) — shared factual base
 * Layer 2: Agent posts (OBSERVATION, ANALYSIS, PREDICTION) — existing analysis
 * Layer 3: Oracle intelligence (consensus, divergences, polymarket) — colony consensus
 */
export async function learnFirstObserve(toolkit: Toolkit, ourAddress: string): Promise<ObserveResult> {
  // ── Layer 1: Read colony FEED (raw attested sources) ──
  // FEED posts are DAHR-attested raw data from 110+ sources.
  // Agents cite them via feedRefs — inheriting the proof chain.
  const [feedResult, recentResult, base] = await Promise.all([
    toolkit.feed.getRecent({ limit: FEED_LIMIT, category: "FEED" }),
    toolkit.feed.getRecent({ limit: RECENT_LIMIT }),
    enrichedObserve(toolkit, ourAddress),
  ]);

  const feedPosts = mapFeedPosts(feedResult as any);
  const recentPosts = mapFeedPosts(recentResult as any);
  const apiEnrichment = base.context?.apiEnrichment as ApiEnrichmentData | undefined;

  // ── Layer 2: Analyze agent posts for colony state ──
  // What are agents talking about? Where are the gaps?
  const colonyState = buildColonyStateFromFeed(recentPosts, ourAddress);
  const coveredTopics = new Set(
    colonyState.activity.trendingTopics.map(t => t.topic.toLowerCase()),
  );

  // ── Layer 3: Colony consensus from oracle + signals ──
  const signals = apiEnrichment?.signals ?? [];
  const divergences = apiEnrichment?.oracle?.divergences ?? [];
  const assetSentiments = apiEnrichment?.assetSentiments ?? [];

  // ── Build evidence from colony intelligence ──
  const evidence: AvailableEvidence[] = [...(base.evidence ?? [])];

  // Evidence from FEED posts not yet discussed by agents
  // (gaps = raw data exists but no agent has analyzed it)
  for (const feedPost of feedPosts) {
    const feedTopicTokens = feedPost.text.toLowerCase().split(/\s+/).filter(t => t.length > 3);
    const isCovered = feedTopicTokens.some(token => coveredTopics.has(token));

    if (!isCovered && feedPost.text.length > 100) {
      evidence.push({
        sourceId: `feed-gap-${feedPost.txHash}`,
        subject: feedPost.text.slice(0, 80),
        metrics: [`feedRef=${feedPost.txHash}`, "colony-gap"],
        richness: feedPost.text.length,
        freshness: 0,
        stale: false,
      });
    }
  }

  // Evidence from colony consensus signals
  for (const signal of signals) {
    if (signal.agentCount >= 3) {
      evidence.push({
        sourceId: `colony-signal-${signal.topic}`,
        subject: `Colony consensus: ${signal.topic} (${signal.agentCount} agents, ${signal.direction ?? "mixed"})`,
        metrics: [
          `agents=${signal.agentCount}`,
          `consensus=${signal.consensus}`,
          `direction=${signal.direction ?? "unknown"}`,
        ],
        richness: signal.text.length,
        freshness: 0,
        stale: false,
      });
    }
  }

  // Evidence from divergences (colony vs market disagreement)
  for (const div of divergences) {
    if (div.severity !== "low") {
      evidence.push({
        sourceId: `divergence-${div.asset}`,
        subject: `${div.asset} divergence: ${div.description}`,
        metrics: [`severity=${div.severity}`, `type=${div.type}`],
        richness: div.description.length,
        freshness: 0,
        stale: false,
      });
    }
  }

  // Evidence from per-asset sentiment (colony's voice on each ticker)
  for (const sentiment of assetSentiments) {
    if (sentiment.posts >= 5) {
      evidence.push({
        sourceId: `sentiment-${sentiment.ticker}`,
        subject: `Colony sentiment: ${sentiment.ticker} ${sentiment.direction} (score ${sentiment.score}, ${sentiment.posts} posts)`,
        metrics: [
          `direction=${sentiment.direction}`,
          `score=${sentiment.score}`,
          `posts=${sentiment.posts}`,
        ],
        richness: 200,
        freshness: 0,
        stale: false,
      });
    }
  }

  return {
    colonyState,
    evidence,
    context: {
      ...base.context,
      apiEnrichment,
    },
  };
}
