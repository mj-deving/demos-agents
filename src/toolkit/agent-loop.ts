/**
 * Agent Loop — generic observe-decide-act-sleep loop.
 *
 * Delegates action execution to injected executors. Templates wire in
 * the concrete executors from cli/action-executor.ts and cli/publish-executor.ts.
 * This keeps src/toolkit/ free from cli/ imports (ADR-0002 boundary).
 */

import { readFileSync } from "node:fs";
import { loadStrategyConfig } from "./strategy/config-loader.js";
import { decideActions } from "./strategy/engine.js";
import type { StrategyAction, DecisionContext } from "./strategy/types.js";
import type { ColonyState } from "./colony/state-extraction.js";
import type { AvailableEvidence } from "./colony/available-evidence.js";
import type { AgentRuntime } from "./agent-runtime.js";
import type { Toolkit } from "./primitives/types.js";

// ── Public interfaces ────────────────────────────

export interface ObserveResult {
  colonyState: ColonyState;
  evidence: AvailableEvidence[];
  context?: Partial<DecisionContext>;
}

export type ObserveFn = (toolkit: Toolkit, address: string) => Promise<ObserveResult>;

/** Result from executing light-path actions (ENGAGE + TIP). */
export interface LightExecutionResult {
  executed: Array<{ action: StrategyAction; success: boolean }>;
  skipped: Array<{ action: StrategyAction; reason: string }>;
}

/** Result from executing heavy-path actions (PUBLISH + REPLY + VOTE + BET). */
export interface HeavyExecutionResult {
  executed: Array<{ action: StrategyAction; success: boolean }>;
  skipped: Array<{ action: StrategyAction; reason: string }>;
}

/** Injected executor for light-path actions. */
export type LightExecutor = (actions: StrategyAction[], runtime: AgentRuntime) => Promise<LightExecutionResult>;

/** Injected executor for heavy-path actions. */
export type HeavyExecutor = (actions: StrategyAction[], runtime: AgentRuntime, opts: AgentLoopOptions) => Promise<HeavyExecutionResult>;

export interface AgentLoopOptions {
  intervalMs?: number;          // default: 300_000 (5 min)
  strategyPath: string;         // path to strategy.yaml
  maxIterations?: number;       // default: Infinity (run forever)
  /** Injected executor for light actions (ENGAGE + TIP). */
  executeLightActions: LightExecutor;
  /** Injected executor for heavy actions (PUBLISH + REPLY + VOTE + BET). */
  executeHeavyActions: HeavyExecutor;
  onAction?: (action: StrategyAction, result: unknown) => void;
  onError?: (error: unknown) => void;
}

// ── Feed post shape for buildColonyStateFromFeed ─

interface FeedPost {
  author: string;
  /** Timestamp in MILLISECONDS (not seconds). */
  timestamp: number;
  text: string;
  category: string;
  txHash: string;
  reactions?: { agree: number; disagree: number };
  tags?: string[];
}

// ── buildColonyStateFromFeed ─────────────────────

/**
 * Build a ColonyState from API feed data (no colony DB required).
 * Approximates the shape extractColonyState() returns from the DB.
 * With colony DB: use extractColonyState() directly instead.
 *
 * Timestamps are MILLISECONDS. Trending topics come from TAGS (not category).
 */
export function buildColonyStateFromFeed(
  posts: FeedPost[],
  ourAddress: string,
): ColonyState {
  const now = Date.now();
  const hourAgo = now - 3_600_000;
  const recentPosts = posts.filter(p => p.timestamp > hourAgo);

  // Build topic frequency map from TAGS (not category)
  const topicCounts = new Map<string, number>();
  for (const p of posts) {
    if (p.tags) {
      for (const tag of p.tags) {
        topicCounts.set(tag, (topicCounts.get(tag) ?? 0) + 1);
      }
    }
  }

  // Build author frequency map
  const authorCounts = new Map<string, { count: number; totalReactions: number }>();
  for (const p of posts) {
    const entry = authorCounts.get(p.author) ?? { count: 0, totalReactions: 0 };
    entry.count++;
    entry.totalReactions += (p.reactions?.agree ?? 0) + (p.reactions?.disagree ?? 0);
    authorCounts.set(p.author, entry);
  }

  return {
    activity: {
      postsPerHour: recentPosts.length,
      activeAuthors: new Set(recentPosts.map(p => p.author)).size,
      trendingTopics: [...topicCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([topic, count]) => ({ topic, count })),
    },
    gaps: {
      underservedTopics: [],   // Cannot detect gaps without historical DB data
      unansweredQuestions: [],
      staleThreads: [],
    },
    threads: {
      activeDiscussions: [],   // Would need thread resolution
      mentionsOfUs: posts
        .filter(p => p.text.includes(ourAddress))
        .map(p => ({ txHash: p.txHash, author: p.author, text: p.text })),
    },
    agents: {
      topContributors: [...authorCounts.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10)
        .map(([author, stats]) => ({
          author,
          postCount: stats.count,
          avgReactions: stats.count > 0 ? stats.totalReactions / stats.count : 0,
        })),
    },
  };
}

// ── defaultObserve ───────────────────────────────

/**
 * Default observe() — builds ColonyState from API feed.
 * Override in specialized templates to add domain evidence.
 */
export async function defaultObserve(toolkit: Toolkit, ourAddress: string): Promise<ObserveResult> {
  const feedResult = await toolkit.feed.getRecent({ limit: 100 });
  // NULL SAFETY: ApiResult can be null — use optional chaining
  const posts = feedResult?.ok
    ? (feedResult.data as any).posts.map((p: any) => ({
        txHash: p.txHash,
        author: p.author,
        timestamp: p.timestamp,
        text: String(p.payload?.text ?? p.text ?? ""),
        category: String(p.payload?.cat ?? p.payload?.category ?? ""),
        tags: p.tags ?? [],
        reactions: p.reactions,
      }))
    : [];

  return {
    colonyState: buildColonyStateFromFeed(posts, ourAddress),
    evidence: [],
  };
}

// ── Loop state (rate-limit tracking) ─────────────

/** Mutable loop state — tracks rate limits across iterations. */
interface LoopState {
  postsToday: number;
  postsThisHour: number;
  reactionsUsed: number;
  lastDayBoundary: number;   // epoch day number
  lastHourBoundary: number;  // epoch hour number
}

function resetIfBoundary(state: LoopState): void {
  const now = Date.now();
  const currentDay = Math.floor(now / 86_400_000);
  const currentHour = Math.floor(now / 3_600_000);
  if (currentDay > state.lastDayBoundary) {
    state.postsToday = 0;
    state.lastDayBoundary = currentDay;
  }
  if (currentHour > state.lastHourBoundary) {
    state.postsThisHour = 0;
    state.lastHourBoundary = currentHour;
  }
}

// ── runAgentLoop ─────────────────────────────────

/**
 * Run the agent loop: observe -> decide -> act -> sleep.
 * Action execution is delegated to injected executors (ADR-0002 boundary compliance).
 */
export async function runAgentLoop(
  runtime: AgentRuntime,
  observe: ObserveFn,
  opts: AgentLoopOptions,
): Promise<void> {
  const strategyYaml = readFileSync(opts.strategyPath, "utf-8");
  const config = loadStrategyConfig(strategyYaml);
  const interval = opts.intervalMs ?? 300_000;
  let iteration = 0;
  let running = true;

  // Rate-limit state persists across iterations
  const loopState: LoopState = {
    postsToday: 0,
    postsThisHour: 0,
    reactionsUsed: 0,
    lastDayBoundary: Math.floor(Date.now() / 86_400_000),
    lastHourBoundary: Math.floor(Date.now() / 3_600_000),
  };

  const shutdown = () => { running = false; };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    while (running && iteration < (opts.maxIterations ?? Infinity)) {
      iteration++;
      console.log(`[loop] iteration ${iteration}`);

      // Reset counters on day/hour boundary
      resetIfBoundary(loopState);

      try {
        // 1. Observe
        const observed = await observe(runtime.toolkit, runtime.address);

        // 2. Decide (with real rate-limit counts)
        const decisionContext: DecisionContext = {
          ourAddress: runtime.address,
          sessionReactionsUsed: loopState.reactionsUsed,
          postsToday: loopState.postsToday,
          postsThisHour: loopState.postsThisHour,
          ...observed.context,
        };
        const { actions } = decideActions(
          observed.colonyState, observed.evidence, config, decisionContext,
        );

        // 3. Act — split into light and heavy paths
        const light = actions.filter(a => a.type === "ENGAGE" || a.type === "TIP");
        const heavy = actions.filter(a =>
          a.type === "PUBLISH" || a.type === "REPLY" || a.type === "VOTE" || a.type === "BET",
        );

        if (light.length > 0) {
          const lightResult = await opts.executeLightActions(light, runtime);
          // Only count ENGAGE as reactions — TIP doesn't consume reaction budget
          loopState.reactionsUsed += lightResult.executed.filter(r => r.action.type === "ENGAGE").length;
          for (const r of lightResult.executed) opts.onAction?.(r.action, r);
        }

        if (heavy.length > 0) {
          const heavyResult = await opts.executeHeavyActions(heavy, runtime, opts);
          const published = heavyResult.executed.filter(r => r.success);
          loopState.postsToday += published.length;
          loopState.postsThisHour += published.length;
          for (const p of published) opts.onAction?.(p.action, p);
        }
      } catch (err) {
        if (opts.onError) {
          opts.onError(err);
        } else {
          console.error(`[loop] iteration ${iteration} error:`, err);
        }
      }

      // 4. Sleep
      if (running && iteration < (opts.maxIterations ?? Infinity)) {
        await new Promise(r => setTimeout(r, interval));
      }
    }
  } finally {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
  }
}
