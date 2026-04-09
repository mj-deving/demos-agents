#!/usr/bin/env npx tsx
/**
 * Run a single live iteration of a generated agent.
 * Usage: DEMOS_MNEMONIC=... npx tsx scripts/run-live-session.ts engagement-optimizer
 */
import { resolve } from "node:path";
import { createAgentRuntime } from "../src/toolkit/agent-runtime.js";
import { runAgentLoop } from "../src/toolkit/agent-loop.js";
import { learnFirstObserve } from "../src/toolkit/observe/learn-first-observe.js";
import { loadAgentConfig } from "../src/lib/agent-config.js";
import { loadAgentSourceView } from "../src/toolkit/sources/catalog.js";
import { createTemplateExecutors, wireSourceDeps, syncColonyAtStartup } from "../templates/shared/executors.js";

const agentName = process.argv[2] ?? "engagement-optimizer";
const STRATEGY_PATH = resolve("templates/generated", agentName, "strategy.yaml");
const DRY_RUN = process.env.DRY_RUN === "true";
const MAX_ITERATIONS = Number(process.env.MAX_ITERATIONS ?? 1);

console.log(`[live] Agent: ${agentName}`);
console.log(`[live] DRY_RUN: ${DRY_RUN}`);
console.log(`[live] MAX_ITERATIONS: ${MAX_ITERATIONS}`);
console.log(`[live] Strategy: ${STRATEGY_PATH}`);

const runtime = await createAgentRuntime({ agentName });
console.log(`[live] Connected as ${runtime.address}`);

const agentConfig = loadAgentConfig(agentName);
const sourceView = loadAgentSourceView(agentConfig.name);
const { executeLightActions, executeHeavyActions } = createTemplateExecutors(
  agentName, agentConfig, sourceView, DRY_RUN,
);
const observe = wireSourceDeps(runtime, sourceView, agentName, STRATEGY_PATH);

// Sync colony DB before first observe — needed for resolveAgentToRecentPost (TIP/ENGAGE)
await syncColonyAtStartup(runtime, agentName);

console.log(`[live] Starting loop (${MAX_ITERATIONS} iteration${MAX_ITERATIONS > 1 ? "s" : ""})...`);

await runAgentLoop(runtime, observe, {
  strategyPath: STRATEGY_PATH,
  intervalMs: 300_000,
  maxIterations: MAX_ITERATIONS,
  executeLightActions,
  executeHeavyActions,
  agentConfig,
  sourceView,
  onAction: (action) => console.log(`[live] ACTION: ${action.type} (priority ${action.priority}): ${action.reason}`),
  onError: (err) => console.error(`[live] ERROR:`, err),
});

console.log(`[live] Session complete.`);
process.exit(0);
