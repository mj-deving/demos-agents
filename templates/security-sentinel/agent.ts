#!/usr/bin/env npx tsx
/**
 * Security Sentinel — Learn-first SuperColony agent.
 *
 * Monitors colony for security threats, correlates with NVD/GHSA, publishes alerts.
 *
 * Usage:
 *   cp .env.example .env    # Add your DEMOS_MNEMONIC
 *   DRY_RUN=false npx tsx agent.ts  # Run live (default: dry-run)
 */
import { resolve } from "node:path";
import { createAgentRuntime } from "../../src/toolkit/agent-runtime.js";
import { runAgentLoop } from "../../src/toolkit/agent-loop.js";
import { learnFirstObserve } from "./observe.js";
import { loadAgentConfig } from "../../src/lib/agent-config.js";
import { loadAgentSourceView } from "../../src/toolkit/sources/catalog.js";
import { createTemplateExecutors, wireSourceDeps } from "../shared/executors.js";

// Re-export for external consumers
export { learnFirstObserve } from "./observe.js";

// ── Configuration ──────────────────────────────
const STRATEGY_PATH = resolve(import.meta.dirname, "strategy.yaml");
const INTERVAL_MS = Number(process.env.LOOP_INTERVAL_MS ?? 300_000);
const AGENT_LABEL = "security-sentinel";
const DRY_RUN = process.env.DRY_RUN !== "false"; // Default dry-run=true for safety (real DEM on mainnet)

// ── Main ───────────────────────────────────────
async function main() {
  console.log(`[${AGENT_LABEL}] Starting...`);
  const runtime = await createAgentRuntime({ agentName: AGENT_LABEL });
  console.log(`[${AGENT_LABEL}] Connected as ${runtime.address}`);

  const agentConfig = loadAgentConfig();
  const sourceView = loadAgentSourceView(agentConfig.name);
  const { executeLightActions, executeHeavyActions } = createTemplateExecutors(AGENT_LABEL, agentConfig, sourceView, DRY_RUN, "Security tip");
  const observe = wireSourceDeps(runtime, sourceView, AGENT_LABEL, STRATEGY_PATH);

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
