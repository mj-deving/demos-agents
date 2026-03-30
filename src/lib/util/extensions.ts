/**
 * Extension dispatcher — typed hook system for the v2 loop.
 *
 * Extensions hook into the core SENSE→ACT→CONFIRM loop at defined points.
 * The registry is built once by loadExtensions() and passed to all dispatchers.
 *
 * Hook points:
 *   - beforeSense: runs before SENSE phase (e.g., calibrate)
 *   - beforePublishDraft: inside ACT/publish, before LLM generation (e.g., source preflight)
 *   - afterPublishDraft: inside ACT/publish, after draft validation (e.g., source match)
 *   - afterAct: runs after ACT completion, even if nothing was published (e.g., tips)
 *   - afterConfirm: runs after CONFIRM phase (e.g., predictions tracking)
 */

import type { KNOWN_EXTENSIONS } from "../state.js";
import type { AgentConfig } from "../agent-config.js";
import type { AnySessionState, V2SessionState, PublishedPostRecord } from "../state.js";
import type { AttestationType } from "../attestation/attestation-policy.js";
import type { LLMProvider } from "../llm/llm-provider.js";
import type { AgentSourceView, SourceRecordV2 } from "../sources/catalog.js";
import type { PreflightCandidate } from "../sources/policy.js";

// ── Logger Interface ──────────────────────────────

/** Logger injected into hook contexts by the session runner. */
export interface HookLogger {
  /** Informational message (e.g., "Extension: signals (fetching...)") */
  info(msg: string): void;
  /** Phase result summary (e.g., "Signals: 3 topic(s), 1 alert(s)") */
  result(msg: string): void;
}

// ── Context Types ─────────────────────────────────

export interface BeforeSenseContext {
  state: V2SessionState;
  config: AgentConfig;
  // Keep this subset local: session-runner owns RunnerFlags and imports this
  // module, so importing RunnerFlags here would introduce a circular dependency.
  flags: BeforeSenseFlags;
  /** Populated by runBeforeSense — tracks hook failures/timeouts for observability */
  hookErrors?: Array<{ hook: string; error: string; elapsed: number; isTimeout: boolean }>;
  /** Optional logger — provided by session-runner for CLI output */
  logger?: HookLogger;
}

type BeforeSenseFlags = {
  agent: string;
  env: string;
  log: string;
  dryRun: boolean;
  pretty: boolean;
};

export interface BeforePublishDraftContext {
  topic: string;
  category: string;
  config: AgentConfig;
  state: AnySessionState;
  /** Source view for the current agent (loaded by caller) */
  sourceView?: AgentSourceView;
}

export interface AfterPublishDraftContext {
  topic: string;
  postText: string;
  postTags: string[];
  category: string;
  config: AgentConfig;
  state: AnySessionState;
  /** Candidates from preflight (beforePublishDraft) — includes resolved URL + method */
  preflightCandidates?: PreflightCandidate[];
  /** Source view for the current agent */
  sourceView?: AgentSourceView;
  /** Optional LLM provider for enhanced claim extraction (PR6 wiring) */
  llm?: LLMProvider | null;
  /** Pre-fetched responses — avoids double-fetching sources already fetched for LLM context */
  prefetchedResponses?: Map<string, import("../sources/providers/types.js").FetchedResponse>;
}

export interface AfterConfirmContext {
  state: V2SessionState;
  config: AgentConfig;
  /** Full context for posts published this session — includes text, category, confidence */
  publishedPosts: PublishedPostRecord[];
  /** Confirm phase result (verify output) */
  confirmResult?: unknown;
  /** Optional logger — provided by session-runner for CLI output */
  logger?: HookLogger;
}

export interface AfterActContext {
  state: V2SessionState;
  config: AgentConfig;
  actResult?: unknown;
  flags: BeforeSenseFlags;
  /** Optional logger — provided by session-runner for CLI output */
  logger?: HookLogger;
}

// ── Decision Types ────────────────────────────────

export interface PublishGateDecision {
  pass: boolean;
  reason: string;
  reasonCode: string;
  /** Pre-selected candidates for downstream match() — includes resolved URL + method */
  candidates?: PreflightCandidate[];
}

export interface SourceMatchDecision {
  pass: boolean;
  reason: string;
  reasonCode: string;
  best?: {
    sourceId: string;
    method: AttestationType;
    url: string;
    score: number;
    matchedClaims: string[];
    evidence: string[];
  };
  considered?: Array<{ sourceId: string; score?: number; error?: string }>;
}

// ── Hook Interface ────────────────────────────────

export interface LoopExtensionHooks {
  beforeSense?(ctx: BeforeSenseContext): Promise<void>;
  beforePublishDraft?(ctx: BeforePublishDraftContext): Promise<PublishGateDecision | void>;
  afterPublishDraft?(ctx: AfterPublishDraftContext): Promise<SourceMatchDecision | void>;
  afterAct?(ctx: AfterActContext): Promise<void>;
  afterConfirm?(ctx: AfterConfirmContext): Promise<void>;
}

// ── Extension Type ────────────────────────────────

export type KnownExtension = (typeof KNOWN_EXTENSIONS)[number];

// ── Extension Hook Registry ──────────────────────

/**
 * Immutable registry of extension hook implementations, built once by loadExtensions().
 * Passed to all dispatchers — no module-level mutable state.
 */
export type ExtensionHookRegistry = ReadonlyMap<string, LoopExtensionHooks>;

// ── Loader ───────────────────────────────────────

import type { RunToolFn } from "../../types.js";

export interface LoadExtensionsDeps {
  enabledExtensions: string[];
  runTool?: RunToolFn;
}

/**
 * Dynamically import hook implementations for enabled extensions and build
 * an immutable registry. Uses switch/case over known extension names to
 * preserve isolation — no SDK transitive deps at load time.
 */
export async function loadExtensions(deps: LoadExtensionsDeps): Promise<ExtensionHookRegistry> {
  const registry = new Map<string, LoopExtensionHooks>();

  for (const ext of deps.enabledExtensions) {
    switch (ext) {
      case "calibrate": {
        if (!deps.runTool) {
          throw new Error("calibrate extension requires runTool dependency");
        }
        const { createCalibrateBeforeSense } = await import("../../plugins/calibrate-plugin.js");
        registry.set("calibrate", {
          beforeSense: createCalibrateBeforeSense(deps.runTool),
        });
        break;
      }
      case "sources": {
        const { sourcesBeforePublishDraft, sourcesAfterPublishDraft } = await import("../../plugins/sources-plugin.js");
        registry.set("sources", {
          beforePublishDraft: sourcesBeforePublishDraft,
          afterPublishDraft: sourcesAfterPublishDraft,
        });
        break;
      }
      case "observe": {
        // Observe is inline (appendFileSync calls), not hook-driven.
        registry.set("observe", {});
        break;
      }
      case "signals": {
        const { signalsBeforeSense } = await import("../../plugins/signals-plugin.js");
        registry.set("signals", {
          beforeSense: signalsBeforeSense,
        });
        break;
      }
      case "predictions": {
        const { predictionsBeforeSense, predictionsAfterConfirm } = await import("../../plugins/predictions-plugin.js");
        registry.set("predictions", {
          beforeSense: predictionsBeforeSense,
          afterConfirm: predictionsAfterConfirm,
        });
        break;
      }
      case "tips": {
        const { tipsBeforeSense, tipsAfterAct } = await import("../../plugins/tips-plugin.js");
        registry.set("tips", {
          beforeSense: tipsBeforeSense,
          afterAct: tipsAfterAct,
        });
        break;
      }
      case "lifecycle": {
        const { lifecycleBeforeSense } = await import("../../plugins/lifecycle-plugin.js");
        registry.set("lifecycle", {
          beforeSense: lifecycleBeforeSense,
        });
        break;
      }
      case "sc-oracle": {
        const { scOracleBeforeSense } = await import("../../plugins/sc-oracle-plugin.js");
        registry.set("sc-oracle", {
          beforeSense: scOracleBeforeSense,
        });
        break;
      }
      case "sc-prices": {
        const { scPricesBeforeSense } = await import("../../plugins/sc-prices-plugin.js");
        registry.set("sc-prices", {
          beforeSense: scPricesBeforeSense,
        });
        break;
      }
      // Unknown extensions are silently skipped — agent config validation
      // catches invalid names upstream.
    }
  }

  return registry;
}

// ── Dispatcher ────────────────────────────────────

/** Per-hook timeout budgets (ms). Lifecycle tests 10 sources sequentially, needs more time. */
export const HOOK_TIMEOUT_MS: Partial<Record<KnownExtension, number>> = {
  lifecycle: 90_000,
  calibrate: 45_000,
  signals: 30_000,
};
const DEFAULT_HOOK_TIMEOUT_MS = 30_000;

/**
 * Run all beforeSense hooks for the agent's enabled extensions.
 * Each hook is isolated: failure or timeout of one hook doesn't block others.
 */
export async function runBeforeSense(
  registry: ExtensionHookRegistry,
  enabledExtensions: string[],
  ctx: BeforeSenseContext
): Promise<void> {
  for (const ext of enabledExtensions) {
    const hooks = registry.get(ext);
    if (!hooks?.beforeSense) continue;

    const timeoutMs = HOOK_TIMEOUT_MS[ext as KnownExtension] ?? DEFAULT_HOOK_TIMEOUT_MS;
    const startMs = Date.now();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        hooks.beforeSense(ctx),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`Hook "${ext}" timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } catch (e: unknown) {
      // Log hook failure/timeout but continue to next hook
      const elapsed = Date.now() - startMs;
      const message = e instanceof Error ? e.message : String(e);
      const isTimeout = message.includes("timed out");
      ctx.hookErrors = ctx.hookErrors || [];
      ctx.hookErrors.push({ hook: ext, error: message, elapsed, isTimeout });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}

/**
 * Run all beforePublishDraft hooks for the agent's enabled extensions.
 * Short-circuits on rejection (pass=false). Accumulates last passing decision
 * so later extensions can observe/augment the result.
 */
export async function runBeforePublishDraft(
  registry: ExtensionHookRegistry,
  enabledExtensions: string[],
  ctx: BeforePublishDraftContext
): Promise<PublishGateDecision | void> {
  let lastDecision: PublishGateDecision | undefined;
  for (const ext of enabledExtensions) {
    const hooks = registry.get(ext);
    if (hooks?.beforePublishDraft) {
      const decision = await hooks.beforePublishDraft(ctx);
      if (decision) {
        if (!decision.pass) return decision; // short-circuit on rejection
        lastDecision = decision;
      }
    }
  }
  return lastDecision;
}

/**
 * Run all afterPublishDraft hooks for the agent's enabled extensions.
 * Short-circuits on rejection (pass=false). Accumulates last passing decision.
 */
export async function runAfterPublishDraft(
  registry: ExtensionHookRegistry,
  enabledExtensions: string[],
  ctx: AfterPublishDraftContext
): Promise<SourceMatchDecision | void> {
  let lastDecision: SourceMatchDecision | undefined;
  for (const ext of enabledExtensions) {
    const hooks = registry.get(ext);
    if (hooks?.afterPublishDraft) {
      const decision = await hooks.afterPublishDraft(ctx);
      if (decision) {
        if (!decision.pass) return decision; // short-circuit on rejection
        lastDecision = decision;
      }
    }
  }
  return lastDecision;
}

/**
 * Run all afterAct hooks for the agent's enabled extensions.
 * Hooks run sequentially. No short-circuit — all hooks execute.
 */
export async function runAfterAct(
  registry: ExtensionHookRegistry,
  enabledExtensions: string[],
  ctx: AfterActContext
): Promise<void> {
  for (const ext of enabledExtensions) {
    const hooks = registry.get(ext);
    if (hooks?.afterAct) {
      await hooks.afterAct(ctx);
    }
  }
}

/**
 * Run all afterConfirm hooks for the agent's enabled extensions.
 * Hooks run sequentially. No short-circuit — all hooks execute.
 */
export async function runAfterConfirm(
  registry: ExtensionHookRegistry,
  enabledExtensions: string[],
  ctx: AfterConfirmContext
): Promise<void> {
  for (const ext of enabledExtensions) {
    const hooks = registry.get(ext);
    if (hooks?.afterConfirm) {
      await hooks.afterConfirm(ctx);
    }
  }
}
