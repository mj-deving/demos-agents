/**
 * Extension dispatcher — typed hook system for the v2 loop.
 *
 * Extensions hook into the core SENSE→ACT→CONFIRM loop at defined points.
 * Compile-time registry — no dynamic loading. Agents declare which extensions
 * they use in persona.yaml → loop.extensions.
 *
 * Hook points:
 *   - beforeSense: runs before SENSE phase (e.g., calibrate)
 *   - beforePublishDraft: inside ACT/publish, before LLM generation (e.g., source preflight)
 *   - afterPublishDraft: inside ACT/publish, after draft validation (e.g., source match)
 *   - afterAct: runs after ACT completion, even if nothing was published (e.g., tips)
 */

import type { KNOWN_EXTENSIONS } from "./state.js";
import type { AgentConfig } from "./agent-config.js";
import type { AnySessionState, V2SessionState, PublishedPostRecord } from "./state.js";
import type { AttestationType } from "./attestation-policy.js";
import type { LLMProvider } from "./llm-provider.js";
import type { AgentSourceView, SourceRecordV2 } from "./sources/catalog.js";
import { preflight as sourcesPreflight, type PreflightCandidate } from "./sources/policy.js";
import { match as sourcesMatch } from "./sources/matcher.js";

// ── Context Types ─────────────────────────────────

export interface BeforeSenseContext {
  state: V2SessionState;
  config: AgentConfig;
  // Keep this subset local: session-runner owns RunnerFlags and imports this
  // module, so importing RunnerFlags here would introduce a circular dependency.
  flags: BeforeSenseFlags;
  /** Populated by runBeforeSense — tracks hook failures/timeouts for observability */
  hookErrors?: Array<{ hook: string; error: string; elapsed: number; isTimeout: boolean }>;
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
  prefetchedResponses?: Map<string, import("./sources/providers/types.js").FetchedResponse>;
}

export interface AfterConfirmContext {
  state: V2SessionState;
  config: AgentConfig;
  /** Full context for posts published this session — includes text, category, confidence */
  publishedPosts: PublishedPostRecord[];
  /** Confirm phase result (verify output) */
  confirmResult?: unknown;
}

export interface AfterActContext {
  state: V2SessionState;
  config: AgentConfig;
  actResult?: unknown;
  flags: BeforeSenseFlags;
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

// ── Sources Hook Implementations ─────────────────

/**
 * beforePublishDraft hook for sources extension.
 * Runs preflight check using the catalog index.
 */
async function runSourcesPreflightHook(
  ctx: BeforePublishDraftContext
): Promise<PublishGateDecision | void> {
  if (!ctx.sourceView) return; // no source view loaded — skip silently

  const result = sourcesPreflight(ctx.topic, ctx.sourceView, ctx.config);

  if (!result.pass) {
    return {
      pass: false,
      reason: result.reason,
      reasonCode: result.reasonCode,
    };
  }

  return {
    pass: true,
    reason: result.reason,
    reasonCode: result.reasonCode,
    candidates: result.candidates,
  };
}

/**
 * afterPublishDraft hook for sources extension.
 * Runs match() to verify post-generation source alignment.
 */
async function runSourcesMatchHook(
  ctx: AfterPublishDraftContext
): Promise<SourceMatchDecision | void> {
  if (!ctx.sourceView || !ctx.preflightCandidates) return;

  const result = await sourcesMatch({
    topic: ctx.topic,
    postText: ctx.postText,
    postTags: ctx.postTags,
    candidates: ctx.preflightCandidates,
    sourceView: ctx.sourceView,
    llm: ctx.llm,
    prefetchedResponses: ctx.prefetchedResponses,
  });

  return {
    pass: result.pass,
    reason: result.reason,
    reasonCode: result.reasonCode,
    best: result.best,
    considered: result.considered,
  };
}

// ── Registry ──────────────────────────────────────

/**
 * Compile-time registry of all known extensions.
 *
 * Each extension maps to its hook implementations. Extensions that operate
 * inline (like observe) have empty hook objects — they're invoked directly
 * by the code that emits observations, not through the dispatcher.
 */
const EXTENSION_REGISTRY: Record<KnownExtension, LoopExtensionHooks> = {
  calibrate: {
    // beforeSense registered at runtime by session-runner via registerHook()
    // because it needs runToolAndParse() which lives in session-runner scope
  },
  sources: {
    beforePublishDraft: runSourcesPreflightHook,
    afterPublishDraft: runSourcesMatchHook,
  },
  observe: {
    // Observe is inline (appendFileSync calls), not hook-driven.
    // Included in registry for validation only.
  },
  signals: {
    // beforeSense registered at runtime by session-runner via registerHook()
    // because it needs auth token from the session context
  },
  predictions: {
    // beforeSense (resolution) + afterConfirm (registration) registered at runtime
    // because they need auth token and agent config from session context
  },
  tips: {
    // beforeSense (mention polling) + afterAct (tip execution) registered at runtime
    // because they need auth token, wallet access, and session context
  },
  lifecycle: {
    // beforeSense registered at runtime by session-runner via registerHook()
    // because it needs catalog path, agent config, and write access
  },
};

// ── Dispatcher ────────────────────────────────────

/** Per-hook timeout budgets (ms). Lifecycle tests 10 sources sequentially, needs more time. */
const HOOK_TIMEOUT_MS: Partial<Record<KnownExtension, number>> = {
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
  enabledExtensions: string[],
  ctx: BeforeSenseContext
): Promise<void> {
  for (const ext of enabledExtensions) {
    const hooks = EXTENSION_REGISTRY[ext as KnownExtension];
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
    } catch (e: any) {
      // Log hook failure/timeout but continue to next hook
      const elapsed = Date.now() - startMs;
      const isTimeout = e.message?.includes("timed out");
      ctx.hookErrors = ctx.hookErrors || [];
      ctx.hookErrors.push({ hook: ext, error: e.message, elapsed, isTimeout });
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
  enabledExtensions: string[],
  ctx: BeforePublishDraftContext
): Promise<PublishGateDecision | void> {
  let lastDecision: PublishGateDecision | undefined;
  for (const ext of enabledExtensions) {
    const hooks = EXTENSION_REGISTRY[ext as KnownExtension];
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
  enabledExtensions: string[],
  ctx: AfterPublishDraftContext
): Promise<SourceMatchDecision | void> {
  let lastDecision: SourceMatchDecision | undefined;
  for (const ext of enabledExtensions) {
    const hooks = EXTENSION_REGISTRY[ext as KnownExtension];
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
  enabledExtensions: string[],
  ctx: AfterActContext
): Promise<void> {
  for (const ext of enabledExtensions) {
    const hooks = EXTENSION_REGISTRY[ext as KnownExtension];
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
  enabledExtensions: string[],
  ctx: AfterConfirmContext
): Promise<void> {
  for (const ext of enabledExtensions) {
    const hooks = EXTENSION_REGISTRY[ext as KnownExtension];
    if (hooks?.afterConfirm) {
      await hooks.afterConfirm(ctx);
    }
  }
}

/**
 * Register a hook implementation for an extension at runtime.
 *
 * Used when the hook implementation depends on functions from the caller's
 * module (e.g., calibrate's beforeSense needs runToolAndParse from session-runner).
 * This avoids circular imports while keeping the dispatcher pattern.
 *
 * Must be called before the v2 loop starts (typically in main() init).
 */
export function registerHook<K extends keyof LoopExtensionHooks>(
  ext: KnownExtension,
  hookName: K,
  fn: NonNullable<LoopExtensionHooks[K]>
): void {
  (EXTENSION_REGISTRY[ext] as any)[hookName] = fn;
}
