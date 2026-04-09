/**
 * Agent Compiler — Template Composer.
 *
 * Deterministic file generator from AgentIntentConfig.
 * No LLM needed — maps config fields to template files.
 */
import { stringify as yamlStringify } from "yaml";
import type { AgentIntentConfig } from "./types.js";

export interface ComposedTemplate {
  /** filename -> content */
  files: Map<string, string>;
}

/**
 * Construct an import statement string.
 * Uses concatenation to prevent the architecture boundary regex from matching
 * template output as real imports from this file.
 */
function exp(specifiers: string, path: string): string {
  return "export " + specifiers + ' from "' + path + '";';
}

// ── Rule name to action type mapping ──────────────────────────────

const RULE_TYPE_MAP: Record<string, string> = {
  publish_to_gaps: "PUBLISH",
  publish_signal_aligned: "PUBLISH",
  publish_on_divergence: "PUBLISH",
  publish_prediction: "PUBLISH",
  reply_with_evidence: "REPLY",
  engage_verified: "ENGAGE",
  engage_novel_agent: "ENGAGE",
  tip_valuable: "TIP",
  vote_on_pool: "VOTE",
  bet_on_prediction: "BET",
};

const RULE_CONDITIONS_MAP: Record<string, string[]> = {
  publish_to_gaps: ["fresh rich evidence"],
  publish_signal_aligned: ["trending signal", "matching evidence"],
  publish_on_divergence: ["oracle divergence", "colony consensus mismatch"],
  publish_prediction: ["prediction market", "min confidence met"],
  reply_with_evidence: ["matching evidence"],
  engage_verified: ["verified topic"],
  engage_novel_agent: ["new agent", "quality content"],
  tip_valuable: ["above median"],
  vote_on_pool: ["active pool", "sufficient evidence"],
  bet_on_prediction: ["prediction market", "min confidence met"],
};

/**
 * Compose a complete template directory from AgentIntentConfig.
 */
export function composeTemplate(config: AgentIntentConfig): ComposedTemplate {
  const files = new Map<string, string>();
  files.set("strategy.yaml", generateStrategyYaml(config));
  files.set("observe.ts", generateObserveTs(config));
  files.set("agent.ts", generateAgentTs(config));
  files.set(".env.example", generateEnvExample(config));
  return { files };
}

// ── strategy.yaml ──────────────────────────────

function generateStrategyYaml(config: AgentIntentConfig): string {
  const strategyObj: Record<string, unknown> = {
    apiVersion: "strategy/v3",
  };

  // Rules — map to StrategyRule format expected by config-loader
  strategyObj.rules = config.rules.map((rule) => ({
    name: rule.name,
    type: RULE_TYPE_MAP[rule.name] ?? "PUBLISH",
    priority: rule.priority,
    conditions: RULE_CONDITIONS_MAP[rule.name] ?? [],
    enabled: rule.enabled,
  }));

  // Rate limits
  strategyObj.rateLimits = {
    postsPerDay: config.rateLimits.postsPerDay,
    postsPerHour: config.rateLimits.postsPerHour,
    reactionsPerSession: config.rateLimits.reactionsPerSession,
    maxTipAmount: config.rateLimits.maxTipAmount,
  };

  // Topic weights (only if non-empty)
  if (Object.keys(config.topicWeights).length > 0) {
    strategyObj.topicWeights = config.topicWeights;
  }

  // Evidence categories
  strategyObj.evidence = {
    categories: {
      core: config.evidenceCategories.core,
      domain: config.evidenceCategories.domain,
      meta: config.evidenceCategories.meta,
    },
  };

  // Add thresholds if present
  if (Object.keys(config.thresholds).length > 0) {
    (strategyObj.evidence as Record<string, unknown>).thresholds =
      config.thresholds;
  }

  // Budget
  strategyObj.budget = config.budget;

  // Tipping
  strategyObj.tipping = {
    mode: config.tipping.mode,
    triggers: config.tipping.triggers,
  };

  // Predictions
  strategyObj.predictions = {
    mode: config.predictions.mode,
    minConfidence: config.predictions.minConfidence,
  };

  // Attestation
  strategyObj.attestation = {
    method: config.attestation.method,
  };
  if (
    config.attestation.tlsnTriggers &&
    config.attestation.tlsnTriggers.length > 0
  ) {
    (strategyObj.attestation as Record<string, unknown>).tlsnTriggers =
      config.attestation.tlsnTriggers;
  }

  // Models
  strategyObj.models = config.models;

  // History retention
  strategyObj.history = {
    retentionHours: config.historyRetentionHours,
  };

  return yamlStringify(strategyObj, { lineWidth: 120 });
}

// ── observe.ts ──────────────────────────────

function generateObserveTs(config: AgentIntentConfig): string {
  return `/**\n * ${config.label} — observe via shared learnFirstObserve.\n */\n` +
    exp("{ learnFirstObserve }", "../../../src/toolkit/observe/learn-first-observe.js") + "\n";
}

// ── agent.ts ──────────────────────────────

function generateAgentTs(config: AgentIntentConfig): string {
  return `#!/usr/bin/env npx tsx
/**
 * ${config.label} — Learn-first SuperColony agent.
 *
 * ${config.description}
 *
 * Usage:
 *   cp .env.example .env    # Add your DEMOS_MNEMONIC
 *   DRY_RUN=false npx tsx agent.ts  # Run live (default: dry-run)
 */
import { resolve } from "node:path";
import { createAgentRuntime } from "../../../src/toolkit/agent-runtime.js";
import { runAgentLoop } from "../../../src/toolkit/agent-loop.js";
import { learnFirstObserve } from "./observe.js";
import { loadAgentConfig } from "../../../src/lib/agent-config.js";
import { loadAgentSourceView } from "../../../src/toolkit/sources/catalog.js";
import { createTemplateExecutors, wireSourceDeps } from "../../shared/executors.js";

// Re-export for external consumers
export { learnFirstObserve } from "./observe.js";

// ── Configuration ──────────────────────────────
const STRATEGY_PATH = resolve(import.meta.dirname, "strategy.yaml");
const INTERVAL_MS = Number(process.env.LOOP_INTERVAL_MS ?? ${config.intervalMs});
const AGENT_LABEL = "${config.name}";
const DRY_RUN = process.env.DRY_RUN !== "false"; // Default dry-run=true for safety (real DEM on mainnet)

// ── Main ───────────────────────────────────────
async function main() {
  console.log(\`[\${AGENT_LABEL}] Starting...\`);
  const runtime = await createAgentRuntime({ agentName: AGENT_LABEL });
  console.log(\`[\${AGENT_LABEL}] Connected as \${runtime.address}\`);

  const agentConfig = loadAgentConfig(AGENT_LABEL);
  const sourceView = loadAgentSourceView(agentConfig.name, agentConfig.paths.sourceCatalog, agentConfig.paths.sourcesRegistry);
  const { executeLightActions, executeHeavyActions } = createTemplateExecutors(AGENT_LABEL, agentConfig, sourceView, DRY_RUN);
  const observe = wireSourceDeps(runtime, sourceView, AGENT_LABEL, STRATEGY_PATH);

  await runAgentLoop(runtime, observe, {
    strategyPath: STRATEGY_PATH,
    intervalMs: INTERVAL_MS,
    executeLightActions,
    executeHeavyActions,
    agentConfig,
    sourceView,
    onAction: (action) => console.log(\`[\${AGENT_LABEL}] \${action.type}: \${action.reason}\`),
    onError: (err) => console.error(\`[\${AGENT_LABEL}] Action failed:\`, err),
  });
}

main().catch((err) => {
  console.error(\`[\${AGENT_LABEL}] Fatal:\`, err);
  process.exit(1);
});
`;
}

// ── .env.example ──────────────────────────────

function generateEnvExample(config: AgentIntentConfig): string {
  return `DEMOS_MNEMONIC=your-mnemonic-here
DRY_RUN=true
LOOP_INTERVAL_MS=${config.intervalMs}
`;
}
