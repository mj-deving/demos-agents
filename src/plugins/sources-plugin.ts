/**
 * Sources plugin — source preflight verification and post-generation match scoring.
 *
 * This is the most complete plugin because it has actual inline hook implementations.
 * The beforePublishDraft hook runs preflight checks against the source catalog,
 * and the afterPublishDraft hook scores how well the generated post matches
 * its claimed sources.
 *
 * Delegates to:
 * - tools/lib/sources/policy.ts  (preflight)
 * - tools/lib/sources/matcher.ts (match)
 */

import type { FrameworkPlugin } from "../types.js";
import type {
  BeforePublishDraftContext,
  AfterPublishDraftContext,
  PublishGateDecision,
  SourceMatchDecision,
} from "../lib/util/extensions.js";
import { preflight } from "../lib/sources/policy.js";
import { match } from "../lib/sources/matcher.js";
import type { PreflightResult } from "../lib/sources/policy.js";
import type { MatchResult } from "../lib/sources/matcher.js";

interface SourcesBeforePublishDraftHookContext extends BeforePublishDraftContext {
  preflightResult?: PreflightResult;
}

interface SourcesAfterPublishDraftHookContext extends AfterPublishDraftContext {
  matchResult?: MatchResult;
}

// ── Typed hook functions for the extension dispatcher ──

/**
 * beforePublishDraft hook for sources extension.
 * Runs preflight check using the catalog index.
 */
export async function sourcesBeforePublishDraft(
  ctx: BeforePublishDraftContext
): Promise<PublishGateDecision | void> {
  if (!ctx.sourceView) return;

  const result = preflight(ctx.topic, ctx.sourceView, ctx.config);

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
export async function sourcesAfterPublishDraft(
  ctx: AfterPublishDraftContext
): Promise<SourceMatchDecision | void> {
  if (!ctx.sourceView || !ctx.preflightCandidates) return;

  const result = await match({
    topic: ctx.topic,
    postText: ctx.postText,
    postTags: ctx.postTags,
    candidates: ctx.preflightCandidates,
    sourceView: ctx.sourceView,
    llm: ctx.llm,
    prefetchedResponses: ctx.prefetchedResponses,
    transcript: ctx.transcript,
  });

  return {
    pass: result.pass,
    reason: result.reason,
    reasonCode: result.reasonCode,
    best: result.best,
    considered: result.considered,
  };
}

export function createSourcesPlugin(): FrameworkPlugin {
  return {
    name: "sources",
    version: "1.0.0",
    description:
      "Source preflight verification and post-generation match scoring",

    hooks: {
      /** Run preflight checks against the source catalog before publishing. */
      beforePublishDraft: async (ctx: unknown): Promise<void> => {
        const hookCtx = ctx as SourcesBeforePublishDraftHookContext;
        if (!hookCtx.sourceView) return;
        const result = await preflight(hookCtx.topic, hookCtx.sourceView, hookCtx.config);
        hookCtx.preflightResult = result;
      },

      /** Score how well the generated post matches its claimed sources. */
      afterPublishDraft: async (ctx: unknown): Promise<void> => {
        const hookCtx = ctx as SourcesAfterPublishDraftHookContext;
        if (!hookCtx.sourceView || !hookCtx.preflightCandidates) return;
        const result = await match({
          topic: hookCtx.topic,
          postText: hookCtx.postText,
          postTags: hookCtx.postTags,
          candidates: hookCtx.preflightCandidates,
          sourceView: hookCtx.sourceView,
          llm: hookCtx.llm,
          prefetchedResponses: hookCtx.prefetchedResponses,
          transcript: hookCtx.transcript,
        });
        hookCtx.matchResult = result;
      },
    },

    async init(_config) {
      // Sources plugin is stateless — no initialization needed.
      // The dynamic imports above handle lazy loading of heavy modules.
    },

    async destroy() {
      // Nothing to clean up.
    },
  };
}
