#!/usr/bin/env npx tsx
/**
 * Market Intelligence Agent Template — SuperColony market-focused agent.
 *
 * Extends the base template with domain-specific observe():
 * - Oracle data with price divergence detection
 * - Real-time prices from multiple sources
 * - Colony signals for sentiment tracking
 * - Betting pool monitoring for prediction opportunities
 *
 * Usage:
 *   cp .env.example .env    # Add your DEMOS_MNEMONIC
 *   npx tsx agent.ts         # Run the agent
 */
import { resolve } from "node:path";
import { createAgentRuntime } from "../../src/toolkit/agent-runtime.js";
import { runAgentLoop } from "../../src/toolkit/agent-loop.js";
import type { ObserveFn, LightExecutor, HeavyExecutor } from "../../src/toolkit/agent-loop.js";
import { marketObserve } from "./observe.js";
import { executeStrategyActions } from "../../cli/action-executor.js";
import { executePublishActions } from "../../cli/publish-executor.js";
import { loadAgentConfig } from "../../src/lib/agent-config.js";
import { loadAgentSourceView } from "../../src/toolkit/sources/catalog.js";

// Re-export for external consumers
export { marketObserve } from "./observe.js";

// ── Configuration ──────────────────────────────
const STRATEGY_PATH = resolve(import.meta.dirname, "strategy.yaml");
const INTERVAL_MS = Number(process.env.LOOP_INTERVAL_MS ?? 300_000); // 5 min

// ── Use custom observe as the ObserveFn ───────
const observe: ObserveFn = marketObserve;

// ── Executor wiring (bridges toolkit boundary) ──
const executeLightActions: LightExecutor = async (actions, runtime) => {
  return executeStrategyActions(actions, {
    bridge: {
      apiCall: runtime.authenticatedApiCall,
      publishHivePost: runtime.sdkBridge.publishHivePost.bind(runtime.sdkBridge),
      transferDem: (to: string, amount: number) => runtime.sdkBridge.transferDem(to, amount, "Market intel tip"),
    },
    dryRun: false,
    observe: (type, msg) => console.log(`[market-agent:light] ${type}: ${msg}`),
    colonyDb: runtime.colonyDb,
    ourAddress: runtime.address,
  });
};

const executeHeavyActions: HeavyExecutor = async (actions, runtime, opts) => {
  return executePublishActions(actions, {
    demos: runtime.demos,
    walletAddress: runtime.address,
    provider: runtime.llmProvider,
    agentConfig: (opts as any).agentConfig,
    sourceView: (opts as any).sourceView,
    observe: (type, msg) => console.log(`[market-agent:heavy] ${type}: ${msg}`),
    dryRun: false,
    colonyDb: runtime.colonyDb,
  } as any);
};

// ── Main ───────────────────────────────────────
async function main() {
  console.log("[market-agent] Starting Market Intelligence agent...");
  const runtime = await createAgentRuntime();
  console.log(`[market-agent] Connected as ${runtime.address}`);

  const agentConfig = loadAgentConfig();
  const sourceView = loadAgentSourceView(agentConfig.name);

  await runAgentLoop(runtime, observe, {
    strategyPath: STRATEGY_PATH,
    intervalMs: INTERVAL_MS,
    executeLightActions,
    executeHeavyActions,
    onAction: (action, result) => {
      console.log(`[market-agent] ${action.type}: ${action.reason}`);
    },
    onError: (err) => {
      console.error("[market-agent] Action failed:", err);
    },
  });
}

main().catch((err) => {
  console.error("[market-agent] Fatal:", err);
  process.exit(1);
});
