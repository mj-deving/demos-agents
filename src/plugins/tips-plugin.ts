/**
 * Tips plugin — autonomous tipping based on post quality scoring.
 *
 * Evaluates posts in the feed and tips high-quality ones (score >= 80,
 * attestation required). Guardrails: max 2/recipient/day, 3-session
 * warmup, 5-min cooldown, 1-10 DEM per tip.
 *
 * beforeSense hook: polls mentions and queues them into state.
 * afterAct hook: evaluates tip candidates and executes tips.
 *
 * State file: ~/.{agent}/tips-state.json
 * Delegates to: src/lib/tips.ts, src/lib/mentions.ts, src/lib/spending-policy.ts
 */

import type { FrameworkPlugin } from "../types.js";
import type { BeforeSenseContext, AfterActContext } from "../lib/util/extensions.js";

/**
 * beforeSense hook — poll mentions and queue into state.
 * Uses dynamic imports to avoid pulling SDK deps into the module graph.
 */
export async function tipsBeforeSense(ctx: BeforeSenseContext): Promise<void> {
  ctx.logger?.info("Extension: tips (polling mentions)...");
  const { loadMentionState, saveMentionState, fetchMentions } = await import("../lib/mentions.js");
  const { connectWallet } = await import("../lib/network/sdk.js");
  const { ensureAuth } = await import("../lib/auth/auth.js");
  const { saveState } = await import("../lib/state.js");

  const mentionState = loadMentionState(ctx.config.name);
  saveMentionState(mentionState, ctx.config.name);

  const { demos, address } = await connectWallet(ctx.flags.env);
  const token = await ensureAuth(demos, address);
  if (!token) {
    ctx.logger?.result("API unavailable — skipping mention fetch (chain-only mode)");
    return;
  }
  const mentions = await fetchMentions(address, token, {
    cursor: mentionState.lastProcessedMention,
    limit: 100,
  });

  if ("loopVersion" in ctx.state && ctx.state.loopVersion >= 2) {
    ctx.state.pendingMentions = mentions.slice(-20);
    saveState(ctx.state, ctx.config.paths.sessionDir);
  }

  ctx.logger?.result(`Mentions queued: ${mentions.length}`);
}

/**
 * afterAct hook — evaluate tip candidates and execute tips.
 * Uses dynamic imports to avoid pulling SDK deps into the module graph.
 */
export async function tipsAfterAct(ctx: AfterActContext): Promise<void> {
  ctx.logger?.info("Extension: tips (evaluating tip candidates)...");
  const { connectWallet, apiCall } = await import("../lib/network/sdk.js");
  const { ensureAuth } = await import("../lib/auth/auth.js");
  const { executeTip, incrementWarmupCounter, loadTipState, saveTipState, selectTipCandidates } = await import("../lib/tips.js");
  const { defaultSpendingPolicy, loadSpendingLedger, saveSpendingLedger } = await import("../lib/spending-policy.js");
  const { observe } = await import("../lib/pipeline/observe.js");

  const { demos, address } = await connectWallet(ctx.flags.env);
  const token = await ensureAuth(demos, address);

  if (!token) {
    ctx.logger?.result("API unavailable — skipping tips evaluation (chain-only mode)");
    return;
  }

  const feedRes = await apiCall("/api/feed?limit=50", token);
  if (!feedRes.ok) {
    throw new Error(`Tip feed fetch failed (${feedRes.status})`);
  }

  const rawPosts = Array.isArray(feedRes.data?.posts)
    ? feedRes.data.posts
    : Array.isArray(feedRes.data)
      ? feedRes.data
      : [];

  let tipState = loadTipState(ctx.config.name);
  const completedWarmupSessions = tipState.warmupCounter;
  tipState = incrementWarmupCounter(tipState, ctx.state.sessionNumber);

  const candidates = selectTipCandidates(rawPosts, {
    agentAddress: address,
    config: ctx.config,
    tipState,
  });

  let ledger = loadSpendingLedger(address, ctx.config.name);
  const spendingConfig = defaultSpendingPolicy();
  const liveTippingEnabled =
    ctx.config.tipping.enabled &&
    !ctx.flags.dryRun &&
    completedWarmupSessions >= ctx.config.tipping.minSessionsBeforeLive;
  spendingConfig.dryRun = !liveTippingEnabled;

  observe("insight", "Tips afterAct policy resolved", {
    phase: "act",
    source: "tips-plugin.ts:afterAct",
    data: {
      tippingEnabled: ctx.config.tipping.enabled,
      runnerDryRun: ctx.flags.dryRun,
      completedWarmupSessions,
      minSessionsBeforeLive: ctx.config.tipping.minSessionsBeforeLive,
      liveTippingEnabled,
      candidateCount: candidates.length,
    },
  });

  for (const candidate of candidates) {
    const result = await executeTip({
      agentName: ctx.config.name,
      candidate,
      demos,
      token,
      spendingConfig,
      ledger,
      tipState,
    });
    ledger = result.ledger;
    tipState = result.tipState;
  }

  saveSpendingLedger(ledger, ctx.config.name);
  saveTipState(tipState, ctx.config.name);
  ctx.logger?.result(`Tips evaluated: ${candidates.length}${liveTippingEnabled ? "" : " (dry-run)"}`);
}

export function createTipsPlugin(): FrameworkPlugin {
  return {
    name: "tips",
    version: "1.0.0",
    description: "Autonomous tipping based on post quality scoring",
    hooks: {},
  };
}
