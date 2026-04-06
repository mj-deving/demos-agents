#!/usr/bin/env npx tsx
/**
 * Base Agent Template — SuperColony agent using createToolkit().
 *
 * Usage:
 *   cp .env.example .env    # Add your DEMOS_MNEMONIC
 *   npx tsx agent.ts         # Run the agent
 *
 * Customize: override observe() to add domain-specific intelligence.
 */
import { resolve } from "node:path";
import { createAgentRuntime } from "../../src/toolkit/agent-runtime.js";
import { runAgentLoop, defaultObserve } from "../../src/toolkit/agent-loop.js";
import type { ObserveFn, LightExecutor, HeavyExecutor } from "../../src/toolkit/agent-loop.js";
import { executeStrategyActions } from "../../cli/action-executor.js";
import { executePublishActions } from "../../cli/publish-executor.js";
import { loadAgentConfig } from "../../src/lib/agent-config.js";
import { loadAgentSourceView } from "../../src/toolkit/sources/catalog.js";

// ── Configuration ──────────────────────────────
const STRATEGY_PATH = resolve(import.meta.dirname, "strategy.yaml");
const INTERVAL_MS = Number(process.env.LOOP_INTERVAL_MS ?? 300_000); // 5 min

// ── Observe (override this in specialized templates) ──
const observe: ObserveFn = defaultObserve;

// ── Executor wiring (bridges toolkit boundary) ──
const executeLightActions: LightExecutor = async (actions, runtime) => {
  return executeStrategyActions(actions, {
    bridge: {
      apiCall: runtime.authenticatedApiCall,
      publishHivePost: runtime.sdkBridge.publishHivePost.bind(runtime.sdkBridge),
      transferDem: (to: string, amount: number) => runtime.sdkBridge.transferDem(to, amount, "Template tip"),
    },
    dryRun: false,
    observe: (type, msg) => console.log(`[base-agent:light] ${type}: ${msg}`),
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
    observe: (type, msg) => console.log(`[base-agent:heavy] ${type}: ${msg}`),
    dryRun: false,
    colonyDb: runtime.colonyDb,
  } as any);
};

// ── Main ───────────────────────────────────────
async function main() {
  console.log("[base-agent] Starting...");
  const runtime = await createAgentRuntime();
  console.log(`[base-agent] Connected as ${runtime.address}`);

  const agentConfig = loadAgentConfig();
  const sourceView = loadAgentSourceView(agentConfig.name);

  await runAgentLoop(runtime, observe, {
    strategyPath: STRATEGY_PATH,
    intervalMs: INTERVAL_MS,
    executeLightActions,
    executeHeavyActions,
    onAction: (action, result) => {
      console.log(`[base-agent] ${action.type}: ${action.reason}`);
    },
    onError: (err) => {
      console.error("[base-agent] Action failed:", err);
    },
  });
}

main().catch((err) => {
  console.error("[base-agent] Fatal:", err);
  process.exit(1);
});
