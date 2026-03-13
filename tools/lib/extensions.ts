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
 */

import type { KNOWN_EXTENSIONS } from "./state.js";
import type { AgentConfig } from "./agent-config.js";
import type { AnySessionState, V2SessionState } from "./state.js";
import type { AttestationType } from "./attestation-policy.js";
import type { AgentSourceView, SourceRecordV2 } from "./sources/catalog.js";

// ── Context Types ─────────────────────────────────

export interface BeforeSenseContext {
  state: V2SessionState;
  config: AgentConfig;
  flags: {
    agent: string;
    env: string;
    log: string;
    dryRun: boolean;
    pretty: boolean;
  };
}

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
  /** Candidates from preflight (beforePublishDraft) */
  preflightCandidates?: SourceRecordV2[];
  /** Source view for the current agent */
  sourceView?: AgentSourceView;
}

// ── Decision Types ────────────────────────────────

export interface PublishGateDecision {
  pass: boolean;
  reason: string;
  reasonCode: string;
  /** Pre-selected candidates for downstream match() */
  candidates?: SourceRecordV2[];
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
}

// ── Extension Type ────────────────────────────────

export type KnownExtension = (typeof KNOWN_EXTENSIONS)[number];

// ── Registry ──────────────────────────────────────

/**
 * Compile-time registry of all known extensions.
 *
 * Each extension maps to its hook implementations. Extensions that operate
 * inline (like observe) have empty hook objects — they're invoked directly
 * by the code that emits observations, not through the dispatcher.
 *
 * Hook implementations are wired here as stubs initially. Phase 3 Step 3
 * will fill in the sources hooks with real preflight/match logic.
 */
const EXTENSION_REGISTRY: Record<KnownExtension, LoopExtensionHooks> = {
  calibrate: {
    // beforeSense registered at runtime by session-runner via registerHook()
    // because it needs runToolAndParse() which lives in session-runner scope
  },
  sources: {
    // Phase 3 Step 3 will wire these to real implementations:
    // beforePublishDraft: runSourcesPreflightHook,
    // afterPublishDraft: runSourcesMatchHook,
  },
  observe: {
    // Observe is inline (appendFileSync calls), not hook-driven.
    // Included in registry for validation only.
  },
};

// ── Dispatcher ────────────────────────────────────

/**
 * Run all beforeSense hooks for the agent's enabled extensions.
 * Hooks run sequentially in extension declaration order.
 */
export async function runBeforeSense(
  enabledExtensions: string[],
  ctx: BeforeSenseContext
): Promise<void> {
  for (const ext of enabledExtensions) {
    const hooks = EXTENSION_REGISTRY[ext as KnownExtension];
    if (hooks?.beforeSense) {
      await hooks.beforeSense(ctx);
    }
  }
}

/**
 * Run all beforePublishDraft hooks for the agent's enabled extensions.
 * Returns the first non-void decision (short-circuits on gate rejection).
 */
export async function runBeforePublishDraft(
  enabledExtensions: string[],
  ctx: BeforePublishDraftContext
): Promise<PublishGateDecision | void> {
  for (const ext of enabledExtensions) {
    const hooks = EXTENSION_REGISTRY[ext as KnownExtension];
    if (hooks?.beforePublishDraft) {
      const decision = await hooks.beforePublishDraft(ctx);
      if (decision) return decision;
    }
  }
}

/**
 * Run all afterPublishDraft hooks for the agent's enabled extensions.
 * Returns the first non-void decision.
 */
export async function runAfterPublishDraft(
  enabledExtensions: string[],
  ctx: AfterPublishDraftContext
): Promise<SourceMatchDecision | void> {
  for (const ext of enabledExtensions) {
    const hooks = EXTENSION_REGISTRY[ext as KnownExtension];
    if (hooks?.afterPublishDraft) {
      const decision = await hooks.afterPublishDraft(ctx);
      if (decision) return decision;
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
