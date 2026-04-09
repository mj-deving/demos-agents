#!/usr/bin/env npx tsx
/**
 * Quick smoke test for generated agents.
 * Runs one observe iteration in DRY_RUN mode and reports results.
 */
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { createAgentRuntime } from "../src/toolkit/agent-runtime.js";
import { loadStrategyConfig } from "../src/toolkit/strategy/config-loader.js";
import { strategyObserve } from "../src/toolkit/observe/observe-router.js";
import { mapFeedPosts, buildColonyStateFromFeed } from "../src/toolkit/agent-loop.js";
import { decideActions } from "../src/toolkit/strategy/engine.js";

const agentName = process.argv[2] ?? "prediction-tracker";
const strategyPath = resolve("templates/generated", agentName, "strategy.yaml");

console.log(`[test] Agent: ${agentName}`);
console.log(`[test] Strategy: ${strategyPath}`);

// Load strategy
const strategyYaml = readFileSync(strategyPath, "utf-8");
const config = loadStrategyConfig(strategyYaml);
console.log(`[test] Strategy loaded: ${config.rules.length} rules`);

// Create runtime
console.log("[test] Creating agent runtime...");
const runtime = await createAgentRuntime();
console.log(`[test] Connected as ${runtime.address}`);

// Run observe
console.log("[test] Running strategyObserve...");
const { evidence, apiEnrichment, prefetched } = await strategyObserve(runtime.toolkit, config);
console.log(`[test] Evidence: ${evidence.length} items`);
console.log(`[test] Enrichment keys: ${Object.keys(apiEnrichment).join(", ")}`);
console.log(`[test] Prefetched keys: ${Object.keys(prefetched).filter(k => (prefetched as any)[k] != null).join(", ")}`);

// Build colony state
const recentResult = prefetched.recentPosts ?? await runtime.toolkit.feed.getRecent({ limit: 100 });
const recentPosts = mapFeedPosts(recentResult as any);
const colonyState = buildColonyStateFromFeed(recentPosts, runtime.address);
console.log(`[test] Colony: ${colonyState.activity.postsPerHour} posts/hr, ${colonyState.activity.activeAuthors} authors`);

// Decide actions
const actions = decideActions(colonyState, evidence, config, {
  ourAddress: runtime.address,
  sessionReactionsUsed: 0,
  postsToday: 0,
  postsThisHour: 0,
  apiEnrichment,
});
console.log(`[test] Actions decided: ${actions.actions.length} selected, ${actions.log.rejected.length} rejected`);
for (const a of actions.actions) {
  console.log(`  → ${a.type} (priority ${a.priority}): ${a.reason}`);
}

console.log("[test] DRY_RUN complete — observe + decide pipeline verified.");
process.exit(0);
