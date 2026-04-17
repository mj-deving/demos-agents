#!/usr/bin/env npx tsx
/**
 * probe-social-writes.ts — maintained live proof path for reply, react, and tip.
 *
 * Default behavior is non-destructive: select a suitable external feed post and
 * report the current readback state that would be used for the live proof.
 * Passing `--execute` performs the real reaction, tip, and reply flow.
 *
 * Output: JSON to stdout. Errors to stderr.
 * Exit codes: 0 = success, 1 = live/runtime failure, 2 = invalid args.
 */

import {
  fetchText,
  DEFAULT_BASE_URL,
  getNumberArg,
  getStringArg,
  hasFlag,
} from "./_shared.js";
import {
  hasRecordedTip,
  normalizeBalance,
  normalizeReactionEnvelope,
  normalizeTipReadback,
  parentThreadContainsReply,
  reactionReadbackSatisfied,
  selectSocialWriteCandidate,
  tipReadbackSatisfied,
  tipSpendObserved,
  verifyPublishVisibility,
} from "./_write-proof-shared.js";

const DEFAULT_REPLY_CATEGORY = "ANALYSIS";
const DEFAULT_REPLY_ATTEST_URL = "https://blockchain.info/ticker";
const DEFAULT_FEED_LIMIT = 12;
const DEFAULT_POLL_MS = 3_000;
const DEFAULT_REPLY_TIMEOUT_MS = 45_000;
const DEFAULT_REACTION_TIMEOUT_MS = 15_000;
const DEFAULT_TIP_TIMEOUT_MS = 20_000;
const DEFAULT_TIP_AMOUNT = 1;

type OmniInstance = Awaited<ReturnType<Awaited<ReturnType<typeof loadConnect>>>>;

const args = process.argv.slice(2);

if (hasFlag(args, "--help", "-h")) {
  console.log(`Usage: npx tsx packages/omniweb-toolkit/scripts/probe-social-writes.ts [options]

Options:
  --feed-limit N          Number of recent feed posts to scan for a target (default: ${DEFAULT_FEED_LIMIT})
  --tip-amount N          DEM amount to tip (default: ${DEFAULT_TIP_AMOUNT})
  --reply-category CAT    Reply category (default: ${DEFAULT_REPLY_CATEGORY})
  --reply-attest-url URL  Reply attestation URL (default: ${DEFAULT_REPLY_ATTEST_URL})
  --reply-timeout-ms N    Visibility timeout for reply verification (default: ${DEFAULT_REPLY_TIMEOUT_MS})
  --reaction-timeout-ms N Polling timeout for reaction readback (default: ${DEFAULT_REACTION_TIMEOUT_MS})
  --tip-timeout-ms N      Polling timeout for tip readback (default: ${DEFAULT_TIP_TIMEOUT_MS})
  --poll-ms N             Poll interval for readback polling (default: ${DEFAULT_POLL_MS})
  --base-url URL          SuperColony base URL for direct reaction readback (default: ${DEFAULT_BASE_URL})
  --state-dir PATH        Override state directory for runtime guards
  --allow-insecure        Allow HTTP attestation URLs (local dev only)
  --execute               Perform the real live proof sweep
  --help, -h              Show this help

Output: JSON social-write proof report
Exit codes: 0 = success, 1 = runtime or proof failure, 2 = invalid args`);
  process.exit(0);
}

for (const flag of [
  "--feed-limit",
  "--tip-amount",
  "--reply-category",
  "--reply-attest-url",
  "--reply-timeout-ms",
  "--reaction-timeout-ms",
  "--tip-timeout-ms",
  "--poll-ms",
  "--base-url",
  "--state-dir",
]) {
  const index = args.indexOf(flag);
  if (index >= 0 && !args[index + 1]) {
    console.error(`Error: ${flag} requires a value`);
    process.exit(2);
  }
}

const feedLimit = getIntegerArg("--feed-limit", DEFAULT_FEED_LIMIT);
const tipAmount = getIntegerArg("--tip-amount", DEFAULT_TIP_AMOUNT);
const replyCategory = getStringArg(args, "--reply-category") ?? DEFAULT_REPLY_CATEGORY;
const replyAttestUrl = getStringArg(args, "--reply-attest-url") ?? DEFAULT_REPLY_ATTEST_URL;
const replyTimeoutMs = getIntegerArg("--reply-timeout-ms", DEFAULT_REPLY_TIMEOUT_MS);
const reactionTimeoutMs = getIntegerArg("--reaction-timeout-ms", DEFAULT_REACTION_TIMEOUT_MS);
const tipTimeoutMs = getIntegerArg("--tip-timeout-ms", DEFAULT_TIP_TIMEOUT_MS);
const pollMs = getIntegerArg("--poll-ms", DEFAULT_POLL_MS);
const baseUrl = getStringArg(args, "--base-url") ?? DEFAULT_BASE_URL;
const stateDir = getStringArg(args, "--state-dir") || undefined;
const allowInsecureUrls = hasFlag(args, "--allow-insecure");
const execute = hasFlag(args, "--execute");

for (const [label, value] of [
  ["--feed-limit", feedLimit],
  ["--tip-amount", tipAmount],
  ["--reply-timeout-ms", replyTimeoutMs],
  ["--reaction-timeout-ms", reactionTimeoutMs],
  ["--tip-timeout-ms", tipTimeoutMs],
  ["--poll-ms", pollMs],
] as const) {
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`Error: invalid ${label} value ${value}`);
    process.exit(2);
  }
}

try {
  const connect = await loadConnect();
  const omni = await connect({ stateDir, allowInsecureUrls });
  const token = await omni.runtime.getToken();
  const feed = await omni.colony.getFeed({ limit: feedLimit });
  if (!feed?.ok) {
    throw new Error(`Feed read failed: ${feed?.error ?? "unknown_error"}`);
  }

  const posts = Array.isArray(feed.data?.posts) ? feed.data.posts : [];
  const candidate = await chooseCandidatePost(omni, posts, token, baseUrl);
  if (!candidate) {
    throw new Error(`No suitable external feed post found in the latest ${feedLimit} posts`);
  }

  const beforeReaction = await readReactionEnvelope(candidate.txHash, token, baseUrl);
  const beforeTipStatsResult = await omni.colony.getTipStats(candidate.txHash);
  const beforeTipStats = normalizeTipReadback(beforeTipStatsResult?.ok ? beforeTipStatsResult.data : null);
  const beforeBalanceResult = await omni.colony.getBalance();
  const beforeBalance = normalizeBalance(beforeBalanceResult?.ok ? beforeBalanceResult.data?.balance : null);
  const beforeParentDetail = await omni.colony.getPostDetail(candidate.txHash);

  if (!execute) {
    console.log(JSON.stringify({
      attempted: false,
      ok: true,
      address: omni.address,
      target: candidate,
      readback: {
        reactions: beforeReaction,
        tipStats: beforeTipStats,
        parentDetailOk: !!beforeParentDetail?.ok,
      },
      message: "Dry run only. Re-run with --execute to perform live reaction, tip, and reply proof.",
    }, null, 2));
    process.exit(0);
  }

  const reactionResult = await omni.colony.react(candidate.txHash, "agree");
  const reactionVerification = reactionResult.ok
    ? await verifyReactionReadback(candidate.txHash, beforeReaction, token, baseUrl, {
        timeoutMs: reactionTimeoutMs,
        pollMs,
      })
    : { attempted: false };

  const balanceBeforeTip = beforeBalance;
  const tipResult = await omni.colony.tip(candidate.txHash, tipAmount);
  const tipVerification = tipResult.ok
    ? await verifyTipReadback(
        omni,
        candidate.txHash,
        tipResult.data?.txHash,
        beforeTipStats,
        balanceBeforeTip,
        tipAmount,
        {
          timeoutMs: tipTimeoutMs,
          pollMs,
        },
      )
    : { attempted: false };

  const replyText = buildReplyText(candidate.txHash);
  const replyResult = await omni.colony.reply({
    parentTxHash: candidate.txHash,
    text: replyText,
    category: replyCategory,
    attestUrl: replyAttestUrl,
  });
  const replyVerification = replyResult.ok
    ? await verifyReplyReadback(omni, candidate.txHash, replyResult.data?.txHash, replyText, {
        timeoutMs: replyTimeoutMs,
        pollMs,
        limit: feedLimit,
      })
    : { attempted: false };

  const overallOk =
    reactionResult.ok
    && !!reactionVerification.attempted
    && reactionVerification.ok
    && tipResult.ok
    && !!tipVerification.attempted
    && tipVerification.ok
    && replyResult.ok
    && !!replyVerification.attempted
    && replyVerification.ok;

  console.log(JSON.stringify({
    attempted: true,
    ok: overallOk,
    address: omni.address,
    target: candidate,
    reaction: {
      result: summarizeToolResult(reactionResult),
      verification: reactionVerification,
    },
    tip: {
      amount: tipAmount,
      result: summarizeToolResult(tipResult),
      verification: tipVerification,
    },
    reply: {
      category: replyCategory,
      attestUrl: replyAttestUrl,
      text: replyText,
      result: summarizeToolResult(replyResult),
      verification: replyVerification,
    },
  }, null, 2));

  process.exit(overallOk ? 0 : 1);
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

function getIntegerArg(flag: string, fallback: number): number {
  const parsed = getNumberArg(args, flag);
  if (parsed === undefined) return fallback;
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

async function verifyReactionReadback(
  txHash: string,
  before: ReturnType<typeof normalizeReactionEnvelope>,
  token: string | null,
  baseUrl: string,
  opts: { timeoutMs: number; pollMs: number },
): Promise<{
  attempted: true;
  ok: boolean;
  polls: number;
  before: ReturnType<typeof normalizeReactionEnvelope>;
  after: ReturnType<typeof normalizeReactionEnvelope>;
}> {
  const deadline = Date.now() + opts.timeoutMs;
  let polls = 0;
  let after = before;

  while (Date.now() <= deadline) {
    polls += 1;
    after = await readReactionEnvelope(txHash, token, baseUrl);
    if (reactionReadbackSatisfied(before, after, "agree")) {
      return { attempted: true, ok: true, polls, before, after };
    }
    if (Date.now() + opts.pollMs > deadline) break;
    await sleep(opts.pollMs);
  }

  return { attempted: true, ok: false, polls, before, after };
}

async function chooseCandidatePost(
  omni: OmniInstance,
  posts: unknown[],
  token: string | null,
  baseUrl: string,
): Promise<ReturnType<typeof selectSocialWriteCandidate>> {
  const fallback = selectSocialWriteCandidate(posts, omni.address);

  for (const post of posts) {
    const candidate = selectSocialWriteCandidate([post], omni.address);
    if (!candidate) continue;

    const reaction = await readReactionEnvelope(candidate.txHash, token, baseUrl);
    const tipStatsResult = await omni.colony.getTipStats(candidate.txHash);
    const tipStats = normalizeTipReadback(tipStatsResult?.ok ? tipStatsResult.data : null);
    if ((reaction?.myReaction ?? null) === null && !hasRecordedTip(tipStats?.myTip)) {
      return candidate;
    }
  }

  return fallback;
}

async function verifyTipReadback(
  omni: OmniInstance,
  postTxHash: string,
  tipTxHash: string | undefined,
  before: ReturnType<typeof normalizeTipReadback>,
  beforeBalance: number | null,
  tipAmountValue: number,
  opts: { timeoutMs: number; pollMs: number },
): Promise<{
  attempted: true;
  ok: boolean;
  polls: number;
  before: ReturnType<typeof normalizeTipReadback>;
  after: ReturnType<typeof normalizeTipReadback>;
  beforeBalance: number | null;
  afterBalance: number | null;
  spendObserved: boolean;
  txConfirmed: boolean;
  txBlockNumber?: number;
  tipStatsConverged: boolean;
}> {
  const deadline = Date.now() + opts.timeoutMs;
  let polls = 0;
  let after = before;
  let afterBalance = beforeBalance;
  let txConfirmed = false;
  let txBlockNumber: number | undefined;

  while (Date.now() <= deadline) {
    polls += 1;
    const tipStats = await omni.colony.getTipStats(postTxHash);
    after = normalizeTipReadback(tipStats?.ok ? tipStats.data : null);
    const balanceResult = await omni.colony.getBalance();
    afterBalance = normalizeBalance(balanceResult?.ok ? balanceResult.data?.balance : null);
    const txVerification = await verifyTipTransfer(omni, tipTxHash);
    txConfirmed = txConfirmed || txVerification.confirmed;
    txBlockNumber = txVerification.blockNumber ?? txBlockNumber;

    const tipStatsConverged = tipReadbackSatisfied(before, after, tipAmountValue);
    const spendObserved = txConfirmed || tipSpendObserved(beforeBalance, afterBalance, tipAmountValue);

    if (tipStatsConverged && spendObserved) {
      return {
        attempted: true,
        ok: true,
        polls,
        before,
        after,
        beforeBalance,
        afterBalance,
        spendObserved,
        txConfirmed,
        txBlockNumber,
        tipStatsConverged,
      };
    }

    if (Date.now() + opts.pollMs > deadline) break;
    await sleep(opts.pollMs);
  }

  const tipStatsConverged = tipReadbackSatisfied(before, after, tipAmountValue);
  const spendObserved = txConfirmed || tipSpendObserved(beforeBalance, afterBalance, tipAmountValue);

  return {
    attempted: true,
    ok: false,
    polls,
    before,
    after,
    beforeBalance,
    afterBalance,
    spendObserved,
    txConfirmed,
    txBlockNumber,
    tipStatsConverged,
  };
}

async function verifyReplyReadback(
  omni: OmniInstance,
  parentTxHash: string,
  replyTxHash: string | undefined,
  replyText: string,
  opts: { timeoutMs: number; pollMs: number; limit: number },
): Promise<{
  attempted: true;
  ok: boolean;
  visibility: Awaited<ReturnType<typeof verifyPublishVisibility>>;
  parentThread: {
    ok: boolean;
    polls: number;
  };
}> {
  const visibility = await verifyPublishVisibility(omni, replyTxHash, replyText, opts);
  const deadline = Date.now() + opts.timeoutMs;
  let polls = 0;
  let threadOk = false;

  while (Date.now() <= deadline && replyTxHash) {
    polls += 1;
    const parentDetail = await omni.colony.getPostDetail(parentTxHash);
    if (parentDetail?.ok && parentThreadContainsReply(parentDetail.data, replyTxHash)) {
      threadOk = true;
      break;
    }
    if (Date.now() + opts.pollMs > deadline) break;
    await sleep(opts.pollMs);
  }

  return {
    attempted: true,
    ok: visibility.visible && visibility.indexedVisible && threadOk,
    visibility,
    parentThread: { ok: threadOk, polls },
  };
}

async function readReactionEnvelope(
  txHash: string,
  token: string | null,
  baseUrl: string,
): Promise<ReturnType<typeof normalizeReactionEnvelope>> {
  const response = await fetchText(`/api/feed/${encodeURIComponent(txHash)}/react`, {
    baseUrl,
    token,
    timeoutMs: 15_000,
    accept: "application/json",
  });
  if (!response.ok) return null;

  try {
    return normalizeReactionEnvelope(JSON.parse(response.body) as unknown);
  } catch {
    return null;
  }
}

function summarizeToolResult(
  result: {
    ok: boolean;
    data?: { txHash?: string };
    error?: { code?: string; message?: string; retryable?: boolean };
    provenance?: unknown;
  },
): Record<string, unknown> {
  return result.ok
    ? {
        ok: true,
        txHash: result.data?.txHash,
        provenance: result.provenance,
      }
    : {
        ok: false,
        error: result.error,
        provenance: result.provenance,
      };
}

function buildReplyText(parentTxHash: string): string {
  const stamp = new Date().toISOString();
  return `Operational reply-path verification at ${stamp}. This reply targets ${parentTxHash.slice(0, 16)} and exists only to prove the maintained omniweb-toolkit reply flow, visibility polling, and thread readback path on the current production host.`;
}

async function loadConnect(): Promise<(opts?: {
  stateDir?: string;
  allowInsecureUrls?: boolean;
}) => Promise<any>> {
  try {
    const mod = await import("../dist/index.js");
    if (typeof mod.connect === "function") {
      return mod.connect;
    }
  } catch {
    // Fall back to source during local development before build output exists.
  }

  const mod = await import("../src/index.ts");
  if (typeof mod.connect !== "function") {
    throw new Error("connect() export not found in dist/index.js or src/index.ts");
  }
  return mod.connect;
}

async function verifyTipTransfer(
  omni: OmniInstance,
  txHash: string | undefined,
): Promise<{ confirmed: boolean; blockNumber?: number }> {
  if (!txHash) return { confirmed: false };
  const bridge = omni?.runtime?.sdkBridge;
  if (!bridge || typeof bridge.verifyTransaction !== "function") {
    return { confirmed: false };
  }

  try {
    const verification = await bridge.verifyTransaction(txHash);
    if (!verification?.confirmed) return { confirmed: false };
    return {
      confirmed: true,
      blockNumber: typeof verification.blockNumber === "number" ? verification.blockNumber : undefined,
    };
  } catch {
    return { confirmed: false };
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
