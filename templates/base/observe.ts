/**
 * Base Template — Strategy-driven observe function.
 *
 * Single-fetch architecture: the observe router prefetches all API data
 * once, runs extractors with prefetched results, and builds enrichment
 * data from the same fetch. No duplicate API calls.
 *
 * The strategy.yaml is the agent's DNA — it controls which categories
 * are active. This observe function is identical across all templates.
 *
 * Separated from agent.ts for isolated testing without SDK.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mapFeedPosts, buildColonyStateFromFeed } from "../../src/toolkit/agent-loop.js";
import { loadStrategyConfig } from "../../src/toolkit/strategy/config-loader.js";
import { strategyObserve } from "../../src/toolkit/observe/observe-router.js";
import type { ObserveResult } from "../../src/toolkit/agent-loop.js";
import type { Toolkit } from "../../src/toolkit/primitives/types.js";

// ── Configuration ──────────────────────────────
const RECENT_LIMIT = 100;

/**
 * Strategy-driven observe: single-fetch, no duplicate API calls.
 *
 * 1. Router prefetches all API data for active categories in one parallel batch
 * 2. Extractors receive prefetched data (zero additional API calls)
 * 3. ApiEnrichmentData built from same prefetched results
 * 4. Colony state built from recent feed (also prefetched when colony-feeds is active)
 */
export async function learnFirstObserve(
  toolkit: Toolkit,
  ourAddress: string,
  strategyPath?: string,
): Promise<ObserveResult> {
  // Load strategy to determine active evidence categories
  const resolvedPath = strategyPath ?? resolve(import.meta.dirname, "strategy.yaml");
  const strategyYaml = readFileSync(resolvedPath, "utf-8");
  const config = loadStrategyConfig(strategyYaml);

  // Single-fetch: router prefetches all data, runs extractors, builds enrichment
  const { evidence, apiEnrichment, prefetched } = await strategyObserve(toolkit, config);

  // Build colony state from all recent posts (not FEED-only; fetch if not prefetched)
  const recentResult = prefetched.recentPosts ?? await toolkit.feed.getRecent({ limit: RECENT_LIMIT });
  const recentPosts = mapFeedPosts(recentResult as any);
  const colonyState = buildColonyStateFromFeed(recentPosts, ourAddress);

  return {
    colonyState,
    evidence,
    context: {
      apiEnrichment,
    },
  };
}
