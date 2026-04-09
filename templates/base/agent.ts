#!/usr/bin/env npx tsx
/**
 * Base Agent Template — Learn-first SuperColony agent.
 *
 * Embodies the Share/Index/Learn agenda from supercolony.ai/docs:
 *   LEARN: Read colony feed, signals, consensus — discover what others observe
 *   SHARE: Contribute what the colony doesn't have yet
 *
 * Usage:
 *   cp .env.example .env    # Add your DEMOS_MNEMONIC
 *   DRY_RUN=false npx tsx agent.ts  # Run live (default: dry-run)
 */
import { resolve } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { createAgentRuntime } from "../../src/toolkit/agent-runtime.js";
import { runAgentLoop } from "../../src/toolkit/agent-loop.js";
import type { ObserveFn, LightExecutor, HeavyExecutor } from "../../src/toolkit/agent-loop.js";
import { learnFirstObserve } from "./observe.js";
import { executeStrategyActions } from "../../cli/action-executor.js";
import { executePublishActions } from "../../cli/publish-executor.js";
import { loadAgentConfig } from "../../src/lib/agent-config.js";
import { loadAgentSourceView } from "../../src/toolkit/sources/catalog.js";
import { FileStateStore } from "../../src/toolkit/state-store.js";

// Re-export for external consumers
export { learnFirstObserve } from "./observe.js";

// ── Configuration ──────────────────────────────
const STRATEGY_PATH = resolve(import.meta.dirname, "strategy.yaml");
const INTERVAL_MS = Number(process.env.LOOP_INTERVAL_MS ?? 300_000); // 5 min
const AGENT_LABEL = "base-agent";
const DRY_RUN = process.env.DRY_RUN !== "false"; // Default dry-run=true for safety (real DEM on mainnet)

// ── Observe ──────────────────────────────────
const observe: ObserveFn = (toolkit, address) =>
  learnFirstObserve(toolkit, address, STRATEGY_PATH);

// ── Executor wiring (bridges toolkit boundary per ADR-0019) ──
function createExecutors(label: string, agentConfig: any, sourceView: any) {
  const executeLightActions: LightExecutor = async (actions, runtime) => {
    return executeStrategyActions(actions, {
      bridge: {
        apiCall: runtime.authenticatedApiCall,
        publishHivePost: runtime.sdkBridge.publishHivePost.bind(runtime.sdkBridge),
        transferDem: (to: string, amount: number) => runtime.sdkBridge.transferDem(to, amount, "Template tip"),
      },
      dryRun: DRY_RUN,
      observe: (type, msg) => console.log(`[${label}:light] ${type}: ${msg}`),
      colonyDb: runtime.colonyDb,
      ourAddress: runtime.address,
    });
  };

  const executeHeavyActions: HeavyExecutor = async (actions, runtime) => {
    const sessionsDir = resolve(homedir(), `.${agentConfig.name}/sessions`);
    mkdirSync(sessionsDir, { recursive: true });
    const stateStore = new FileStateStore(resolve(homedir(), `.${agentConfig.name}`));

    return executePublishActions(actions, {
      demos: runtime.demos,
      walletAddress: runtime.address,
      provider: runtime.llmProvider,
      agentConfig,
      sourceView,
      state: { loopVersion: 3, sessionNumber: 0, agentName: agentConfig.name, startedAt: new Date().toISOString(), pid: process.pid, phases: {}, posts: [], engagements: [] } as any,
      sessionsDir,
      observe: (type, msg) => console.log(`[${label}:heavy] ${type}: ${msg}`),
      dryRun: DRY_RUN,
      stateStore,
      colonyDb: runtime.colonyDb,
      calibrationOffset: 0,
      scanContext: { activity_level: "normal", posts_per_hour: 0 },
      logSession: () => {},
      logQuality: () => {},
    });
  };

  return { executeLightActions, executeHeavyActions };
}

// ── Main ───────────────────────────────────────
async function main() {
  console.log(`[${AGENT_LABEL}] Starting...`);
  const runtime = await createAgentRuntime();
  console.log(`[${AGENT_LABEL}] Connected as ${runtime.address}`);

  const agentConfig = loadAgentConfig();
  const sourceView = loadAgentSourceView(agentConfig.name);
  const { executeLightActions, executeHeavyActions } = createExecutors(AGENT_LABEL, agentConfig, sourceView);

  await runAgentLoop(runtime, observe, {
    strategyPath: STRATEGY_PATH,
    intervalMs: INTERVAL_MS,
    executeLightActions,
    executeHeavyActions,
    agentConfig,
    sourceView,
    onAction: (action) => console.log(`[${AGENT_LABEL}] ${action.type}: ${action.reason}`),
    onError: (err) => console.error(`[${AGENT_LABEL}] Action failed:`, err),
  });
}

main().catch((err) => {
  console.error(`[${AGENT_LABEL}] Fatal:`, err);
  process.exit(1);
});
