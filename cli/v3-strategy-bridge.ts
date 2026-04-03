/**
 * V3 Strategy Bridge — connects the strategy engine to the session runner.
 *
 * Implements Disposable for automatic resource cleanup via `using`:
 *   using bridge = initStrategyBridge(...)
 *   // bridge.db auto-closed when scope exits (normal or throw)
 *
 * Provides three functions mapping to V3 phases:
 *   sense()   → ColonyState + AvailableEvidence
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
import { computePerformanceScores, computeCalibration } from "../src/toolkit/colony/performance.js";
import { getAgentProfile, getInteractionHistory } from "../src/toolkit/colony/intelligence.js";
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
  ApiEnrichmentData,
  CalibrationState,
} from "../src/toolkit/strategy/types.js";

// Re-export for session runner convenience
export type { StrategyAction, StrategyConfig, DecisionContext, DecisionLog, PostPerformance, ApiEnrichmentData, CalibrationState };

const DAILY_LIMIT = 14;
const HOURLY_LIMIT = 5;

// ── Strategy Bridge (Disposable) ────────────────────

/**
 * Strategy bridge context — implements Disposable for automatic DB cleanup.
 *
 * Usage with `using` (preferred):
 *   using bridge = initStrategyBridge(agentName, yamlPath, wallet);
 *   // bridge.db closed automatically when scope exits
 *
 * Usage with manual close (for long-lived contexts):
 *   const bridge = initStrategyBridge(...);
 *   try { ... } finally { bridge[Symbol.dispose](); }
 */
export class StrategyBridge implements Disposable {
  readonly db: ColonyDatabase;
  readonly config: StrategyConfig;
  readonly store: FileStateStore;
  walletAddress: string;
  private disposed = false;

  constructor(db: ColonyDatabase, config: StrategyConfig, store: FileStateStore, walletAddress: string) {
    this.db = db;
    this.config = config;
    this.store = store;
    this.walletAddress = walletAddress;
  }

  /** Update wallet address after connectWallet() resolves. */
  updateWalletAddress(walletAddress: string): void {
    this.walletAddress = walletAddress;
  }

  /** Close the colony database. Idempotent — safe to call multiple times. */
  close(): void {
    if (!this.disposed) {
      this.db.close();
      this.disposed = true;
    }
  }

  /** Disposable protocol — called by `using` declarations. */
  [Symbol.dispose](): void {
    this.close();
  }
}

// Keep type alias for backward compat with existing session runner imports
export type StrategyBridgeContext = StrategyBridge;

/**
 * Initialize the strategy bridge for a session.
 *
 * Reads/validates config BEFORE opening DB to prevent handle leaks on parse errors.
 * Returns a Disposable — use `using bridge = initStrategyBridge(...)` for automatic cleanup.
 */
export function initStrategyBridge(
  agentName: string,
  strategyYamlPath: string,
  walletAddress: string,
): StrategyBridge {
  // Read and validate config BEFORE opening DB to avoid leaking the handle on parse errors
  const yamlContent = readFileSync(strategyYamlPath, "utf-8");
  const config = loadStrategyConfig(yamlContent);

  const colonyDir = resolve(homedir(), `.${agentName}`, "colony");
  mkdirSync(colonyDir, { recursive: true });
  const dbPath = resolve(colonyDir, "cache.db");
  const db = initColonyCache(dbPath);

  const stateDir = resolve(homedir(), `.${agentName}`, "state");
  mkdirSync(stateDir, { recursive: true });
  const store = new FileStateStore(stateDir);

  return new StrategyBridge(db, config, store, walletAddress);
}

/** @deprecated Use bridge[Symbol.dispose]() or bridge.close() instead. */
export function closeStrategyBridge(ctx: StrategyBridge): void {
  ctx.close();
}

/** @deprecated Use bridge.updateWalletAddress() instead. */
export function updateWalletAddress(ctx: StrategyBridge, walletAddress: string): void {
  ctx.updateWalletAddress(walletAddress);
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
  ctx: StrategyBridge,
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
  ctx: StrategyBridge,
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
 * Does NOT execute actions — the session runner routes actions to
 * existing engage/gate/publish substage code or V3 executors.
 *
 * @param options - Optional enrichment and configuration for the plan phase.
 */
export interface PlanOptions {
  /** API enrichment data from the sense phase (Phase 6+). */
  apiEnrichment?: ApiEnrichmentData;
  /** Rolling calibration state (Phase 6d). */
  calibration?: import("../src/toolkit/strategy/types.js").CalibrationState;
  /** Colony report summary from /api/report (Phase 7). */
  briefingContext?: string;
  /** Function to enrich agent profiles with social handles (Phase 7). */
  identityLookup?: (address: string) => Promise<Array<{ platform: string; username: string }> | null>;
}

export async function plan(
  ctx: StrategyBridge,
  senseResult: SenseResult,
  sessionReactionsUsed: number,
  options?: PlanOptions,
): Promise<PlanResult> {
  const context = await buildDecisionContext(ctx, sessionReactionsUsed);

  if (options?.apiEnrichment) {
    context.apiEnrichment = options.apiEnrichment;
  }

  if (options?.calibration) {
    context.calibration = options.calibration;
  }

  if (options?.briefingContext) {
    context.briefingContext = options.briefingContext;
  }

  // Pre-compute intelligence from colony DB (pure data extraction)
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentInteractions = getInteractionHistory(ctx.db, { since: since24h, limit: 200 });

    // Separate tip interactions from other types — tip avoidance should only consider tips
    const tipCounts: Record<string, number> = {};
    const allCounts: Record<string, number> = {};
    for (const interaction of recentInteractions) {
      allCounts[interaction.theirAddress] = (allCounts[interaction.theirAddress] ?? 0) + 1;
      if (interaction.interactionType === "we_tipped") {
        tipCounts[interaction.theirAddress] = (tipCounts[interaction.theirAddress] ?? 0) + 1;
      }
    }

    const profileAddresses = [
      ...senseResult.colonyState.agents.topContributors.map((c) => c.author),
      ...senseResult.colonyState.threads.mentionsOfUs.map((m) => m.author),
    ];
    const agentProfiles: Record<string, {
      postCount: number;
      avgAgrees: number;
      avgDisagrees: number;
      topics: string[];
      socialHandles?: Array<{ platform: string; username: string }>;
    }> = {};
    for (const address of new Set(profileAddresses)) {
      const profile = getAgentProfile(ctx.db, address);
      if (profile) {
        // Key by lowercased address — engine reads with normalize() (trim+lowercase)
        agentProfiles[address.trim().toLowerCase()] = {
          postCount: profile.postCount,
          avgAgrees: profile.avgAgrees,
          avgDisagrees: profile.avgDisagrees,
          topics: profile.topics,
        };
      }
    }

    // Phase 7: Enrich agent profiles with social handles via identity lookup (parallel)
    if (options?.identityLookup) {
      const addresses = Object.keys(agentProfiles);
      const results = await Promise.allSettled(addresses.map((addr) => options.identityLookup!(addr)));
      for (let i = 0; i < addresses.length; i++) {
        const result = results[i];
        if (result.status === "fulfilled" && result.value) {
          agentProfiles[addresses[i]].socialHandles = result.value;
        }
      }
    }

    context.intelligence = {
      recentInteractions: allCounts,
      recentTips: tipCounts,
      agentProfiles,
    };
  } catch {
    // Intelligence is optional — continue without it
  }

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
  ctx: StrategyBridge,
): PostPerformance[] {
  return computePerformanceScores(
    ctx.db,
    ctx.walletAddress,
    ctx.config.performance,
  );
}

// ── Auto-Calibration (Phase 6d) ──────────────────

/**
 * Compute rolling calibration offset from our performance vs colony median.
 * Replaces the static readCalibrationOffset(JSON) function in v3-loop.ts.
 */
export function computeAutoCalibration(
  ctx: StrategyBridge,
): CalibrationState {
  return computeCalibration(ctx.db, ctx.walletAddress, ctx.config.performance);
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
