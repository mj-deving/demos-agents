/**
 * V3 Strategy Bridge — connects the strategy engine to the session runner.
 *
 * Provides three functions mapping to V3 phases:
 *   sense()   → ColonyState + AvailableEvidence + DecisionContext
 *   plan()    → StrategyAction[] + DecisionLog (via decideActions)
 *   confirm() → PostPerformance[] (via computePerformanceScores)
 *
 * This is the glue between:
 *   - Colony intelligence layer (toolkit/colony/)
 *   - Strategy engine (toolkit/strategy/)
 *   - Session runner (cli/session-runner.ts)
 */

import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

import { initColonyCache, type ColonyDatabase } from "../src/toolkit/colony/schema.js";
import { extractColonyState, type ColonyState } from "../src/toolkit/colony/state-extraction.js";
import { computeAvailableEvidence, type AvailableEvidence } from "../src/toolkit/colony/available-evidence.js";
import { computePerformanceScores } from "../src/toolkit/colony/performance.js";
import { decideActions } from "../src/toolkit/strategy/engine.js";
import { loadStrategyConfig } from "../src/toolkit/strategy/config-loader.js";
import { FileStateStore } from "../src/toolkit/state-store.js";
import { getWriteRateRemaining } from "../src/toolkit/guards/write-rate-limit.js";
import type { AgentSourceView } from "../src/toolkit/sources/catalog.js";
import type {
  StrategyAction,
  StrategyConfig,
  DecisionContext,
  DecisionLog,
  PostPerformance,
} from "../src/toolkit/strategy/types.js";

// Re-export for session runner convenience
export type { StrategyAction, StrategyConfig, DecisionContext, DecisionLog, PostPerformance };

const DAILY_LIMIT = 14;
const HOURLY_LIMIT = 5;

// ── Colony DB Management ────────────────────────────

export interface StrategyBridgeContext {
  db: ColonyDatabase;
  config: StrategyConfig;
  walletAddress: string;
  store: FileStateStore;
}

/**
 * Initialize the strategy bridge for a session.
 * Opens/creates colony cache, loads strategy config.
 *
 * walletAddress may be the agent name as fallback if the actual address
 * isn't known yet (wallet is connected lazily during publish).
 * Rate limit lookups are wallet-scoped in the StateStore, so consistency
 * with the publish phase's key is important. The session runner should
 * update ctx.walletAddress when connectWallet() succeeds.
 */
export function initStrategyBridge(
  agentName: string,
  strategyYamlPath: string,
  walletAddress: string,
): StrategyBridgeContext {
  const colonyDir = resolve(homedir(), `.${agentName}`, "colony");
  mkdirSync(colonyDir, { recursive: true });
  const dbPath = resolve(colonyDir, "cache.db");
  const db = initColonyCache(dbPath);

  const yamlContent = readFileSync(strategyYamlPath, "utf-8");
  const config = loadStrategyConfig(yamlContent);

  const stateDir = resolve(homedir(), `.${agentName}`, "state");
  mkdirSync(stateDir, { recursive: true });
  const store = new FileStateStore(stateDir);

  return { db, config, walletAddress, store };
}

/** Close the colony database. Call at end of session. */
export function closeStrategyBridge(ctx: StrategyBridgeContext): void {
  ctx.db.close();
}

// ── SENSE Phase ─────────────────────────────────────

export interface SenseResult {
  colonyState: ColonyState;
  evidence: AvailableEvidence[];
}

/**
 * SENSE: Extract colony intelligence from the cached database.
 *
 * Should be called AFTER the scan-feed subprocess populates the colony cache
 * with fresh posts from the chain. This extracts structured state from that cache.
 */
export function sense(
  ctx: StrategyBridgeContext,
  sourceView: AgentSourceView,
): SenseResult {
  const colonyState = extractColonyState(ctx.db, {
    ourAddress: ctx.walletAddress,
  });

  const catalogSources = sourceView.sources.map((source) => ({
    id: source.id,
    topics: source.topics ?? [],
    domainTags: source.domainTags,
  }));

  const evidence = computeAvailableEvidence(ctx.db, catalogSources);

  return { colonyState, evidence };
}

// ── ACT Phase (plan) ────────────────────────────────

export interface PlanResult {
  actions: StrategyAction[];
  log: DecisionLog;
}

/**
 * Build the DecisionContext from live rate limit state.
 *
 * Reads actual post counts from the write-rate-limit guard
 * (StateStore-backed, wallet-scoped).
 */
export async function buildDecisionContext(
  ctx: StrategyBridgeContext,
  sessionReactionsUsed: number,
): Promise<DecisionContext> {
  const remaining = await getWriteRateRemaining(ctx.store, ctx.walletAddress);

  return {
    ourAddress: ctx.walletAddress,
    sessionReactionsUsed,
    postsToday: DAILY_LIMIT - remaining.dailyRemaining,
    postsThisHour: HOURLY_LIMIT - remaining.hourlyRemaining,
    now: new Date(),
  };
}

/**
 * ACT/plan: Run the strategy engine to decide what actions to take.
 *
 * Returns prioritized actions + full decision log for observability.
 * Does NOT execute actions — that remains in the session runner's
 * existing engage/gate/publish substage code.
 */
export async function plan(
  ctx: StrategyBridgeContext,
  senseResult: SenseResult,
  sessionReactionsUsed: number,
): Promise<PlanResult> {
  const context = await buildDecisionContext(ctx, sessionReactionsUsed);

  const { actions, log } = decideActions(
    senseResult.colonyState,
    senseResult.evidence,
    ctx.config,
    context,
  );

  return { actions, log };
}

// ── CONFIRM Phase ───────────────────────────────────

/**
 * CONFIRM: Compute performance scores for our posts.
 *
 * Should be called during the CONFIRM phase after verifying
 * published posts. Updates performance metrics for feedback
 * into future strategy decisions.
 */
export function computePerformance(
  ctx: StrategyBridgeContext,
): PostPerformance[] {
  return computePerformanceScores(
    ctx.db,
    ctx.walletAddress,
    ctx.config.performance,
  );
}

// ── Action Filtering Helpers ────────────────────────

/** Filter strategy actions by type. */
export function filterActions(
  actions: StrategyAction[],
  type: StrategyAction["type"],
): StrategyAction[] {
  return actions.filter((action) => action.type === type);
}

/** Count actions by type for logging. */
export function summarizeActions(
  actions: StrategyAction[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const action of actions) {
    counts[action.type] = (counts[action.type] ?? 0) + 1;
  }
  return counts;
}
