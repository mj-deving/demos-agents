import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import type { Demos } from "@kynesyslabs/demosdk/websdk";

import type { AgentConfig } from "./agent-config.js";
import { executeChainTx } from "../toolkit/chain/tx-pipeline.js";
import { filterPosts, type FilteredPost } from "./pipeline/feed-filter.js";
import { observe } from "./pipeline/observe.js";
import {
  canSpend,
  recordSpend,
  type SpendDecision,
  type SpendingLedger,
  type SpendingPolicyConfig,
  type SpendingTransaction,
} from "./spending-policy.js";
import { apiCall } from "./network/sdk.js";

export interface TipState {
  tippedPosts: string[];
  perRecipientCounts: Record<string, { date: string; count: number }>;
  lastTipTimestamp: string | null;
  warmupCounter: number;
  lastWarmupSession?: number;
}

export interface TipCandidate extends FilteredPost {
  amount: number;
  qualityScore: number;
  reactionsScore: number;
  topicAlignmentScore: number;
  freshnessScore: number;
  repeatPenalty: number;
  totalScore: number;
}

export interface SelectTipCandidatesOptions {
  agentAddress: string;
  config: AgentConfig;
  tipState: TipState;
  now?: Date;
}

export interface ExecuteTipOptions {
  agentName: string;
  candidate: TipCandidate;
  demos: Demos;
  token: string;
  spendingConfig: SpendingPolicyConfig;
  ledger: SpendingLedger;
  tipState: TipState;
}

export interface ExecuteTipResult {
  candidate: TipCandidate;
  decision: SpendDecision;
  ledger: SpendingLedger;
  tipState: TipState;
  transferTx?: string;
  recipient?: string;
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function statePath(agent: string): string {
  return resolve(homedir(), `.${agent}`, "tips-state.json");
}

function freshTipState(): TipState {
  return {
    tippedPosts: [],
    perRecipientCounts: {},
    lastTipTimestamp: null,
    warmupCounter: 0,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeTipState(raw: unknown): TipState {
  const record = asRecord(raw);
  if (!record) return freshTipState();

  const perRecipientCountsRaw = asRecord(record.perRecipientCounts);
  const perRecipientCounts: TipState["perRecipientCounts"] = {};
  if (perRecipientCountsRaw) {
    for (const [recipient, value] of Object.entries(perRecipientCountsRaw)) {
      const entry = asRecord(value);
      if (!entry || typeof entry.date !== "string") continue;
      const count = Number(entry.count);
      if (!Number.isFinite(count)) continue;
      perRecipientCounts[recipient] = {
        date: entry.date,
        count: Math.max(0, Math.floor(count)),
      };
    }
  }

  return {
    tippedPosts: Array.isArray(record.tippedPosts)
      ? record.tippedPosts.map((value: unknown) => String(value || "")).filter(Boolean)
      : [],
    perRecipientCounts,
    lastTipTimestamp: typeof record.lastTipTimestamp === "string" ? record.lastTipTimestamp : null,
    warmupCounter: Number.isFinite(Number(record.warmupCounter))
      ? Math.max(0, Math.floor(Number(record.warmupCounter)))
      : 0,
    lastWarmupSession: Number.isFinite(Number(record.lastWarmupSession))
      ? Math.max(0, Math.floor(Number(record.lastWarmupSession)))
      : undefined,
  };
}

function normalizeTopicTerms(config: AgentConfig): string[] {
  return [...config.topics.primary, ...config.topics.secondary]
    .map((topic) => String(topic || "").trim().toLowerCase())
    .filter(Boolean);
}

function calculateTopicAlignment(post: FilteredPost, config: AgentConfig): number {
  const terms = normalizeTopicTerms(config);
  if (terms.length === 0) return 0;

  const haystack = [
    ...post.tags.map((tag) => tag.toLowerCase()),
    ...post.assets.map((asset) => asset.toLowerCase()),
    post.category.toLowerCase(),
    post.textPreview.toLowerCase(),
  ].join(" ");

  let score = 0;
  for (const topic of config.topics.primary) {
    if (haystack.includes(topic.toLowerCase())) score += 8;
  }
  for (const topic of config.topics.secondary) {
    if (haystack.includes(topic.toLowerCase())) score += 4;
  }

  return Math.min(score, 20);
}

function calculateFreshness(timestamp: number, now: Date): number {
  if (!timestamp) return 0;
  const ageMs = now.getTime() - timestamp * 1000;
  if (ageMs <= 6 * 60 * 60 * 1000) return 10;
  if (ageMs <= 24 * 60 * 60 * 1000) return 5;
  if (ageMs <= 72 * 60 * 60 * 1000) return 2;
  return 0;
}

function currentRecipientCount(tipState: TipState, recipient: string, now?: Date): number {
  const record = tipState.perRecipientCounts[recipient.toLowerCase()];
  if (!record) return 0;
  const today = now ? now.toISOString().slice(0, 10) : todayUTC();
  if (record.date !== today) return 0;
  return record.count;
}

function isCoolingDown(
  lastTipTimestamp: string | null,
  minMinutesBetweenTips: number,
  now: Date
): boolean {
  if (!lastTipTimestamp) return false;
  const lastTs = new Date(lastTipTimestamp).getTime();
  if (!Number.isFinite(lastTs)) return false;
  return now.getTime() - lastTs < minMinutesBetweenTips * 60 * 1000;
}

function computeTipAmount(post: FilteredPost): number {
  const totalReactions = post.reactions.agree + post.reactions.disagree;
  let amount = 1;
  if (post.score >= 95) amount += 1;
  if (totalReactions >= 15) amount += 1;
  return Math.min(amount, 3);
}

function buildCandidate(
  post: FilteredPost,
  config: AgentConfig,
  tipState: TipState,
  now: Date
): TipCandidate {
  const totalReactions = post.reactions.agree + post.reactions.disagree;
  const qualityScore = post.score;
  const reactionsScore = Math.min(totalReactions * 2, 20);
  const topicAlignmentScore = calculateTopicAlignment(post, config);
  const freshnessScore = calculateFreshness(post.timestamp, now);
  const repeatPenalty = currentRecipientCount(tipState, post.author, now) * 15;

  return {
    ...post,
    amount: computeTipAmount(post),
    qualityScore,
    reactionsScore,
    topicAlignmentScore,
    freshnessScore,
    repeatPenalty,
    totalScore:
      qualityScore +
      reactionsScore +
      topicAlignmentScore +
      freshnessScore -
      repeatPenalty,
  };
}

function logTipDecision(
  text: string,
  data: Record<string, unknown>,
  type: "insight" | "pattern" = "insight"
): void {
  observe(type, text, {
    phase: "act",
    substage: "engage",
    source: "tips.ts",
    data,
  });
}

export function loadTipState(agent: string): TipState {
  const path = statePath(agent);
  try {
    if (!existsSync(path)) return freshTipState();
    return normalizeTipState(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    return freshTipState();
  }
}

export function saveTipState(state: TipState, agent: string): void {
  const dir = resolve(homedir(), `.${agent}`);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const path = statePath(agent);
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  renameSync(tmpPath, path);
}

export function selectTipCandidates(
  rawPosts: unknown[],
  options: SelectTipCandidatesOptions
): TipCandidate[] {
  const now = options.now || new Date();
  const tippingConfig = options.config.tipping;
  const filtered = filterPosts(rawPosts, {
    minScore: tippingConfig.minScore,
    requireAttestation: tippingConfig.requireAttestation,
    excludeAuthors: [options.agentAddress],
  });

  const candidates = filtered
    .map((post) => buildCandidate(post, options.config, options.tipState, now))
    .filter((candidate) => {
      if (candidate.author === options.agentAddress.toLowerCase()) {
        logTipDecision("Tip candidate rejected: self-tip blocked", {
          txHash: candidate.txHash,
          author: candidate.author,
        }, "pattern");
        return false;
      }
      if (tippingConfig.requireAttestation && !candidate.hasAttestation) {
        logTipDecision("Tip candidate rejected: attestation required", {
          txHash: candidate.txHash,
          author: candidate.author,
        }, "pattern");
        return false;
      }
      if (candidate.score < tippingConfig.minScore) {
        logTipDecision("Tip candidate rejected: score below floor", {
          txHash: candidate.txHash,
          score: candidate.score,
          minScore: tippingConfig.minScore,
        }, "pattern");
        return false;
      }
      if (options.tipState.tippedPosts.includes(candidate.txHash)) {
        logTipDecision("Tip candidate rejected: post already tipped", {
          txHash: candidate.txHash,
        }, "pattern");
        return false;
      }
      if (
        currentRecipientCount(options.tipState, candidate.author, now) >=
        tippingConfig.maxPerRecipientPerDay
      ) {
        logTipDecision("Tip candidate rejected: recipient daily cap reached", {
          txHash: candidate.txHash,
          author: candidate.author,
          maxPerRecipientPerDay: tippingConfig.maxPerRecipientPerDay,
        }, "pattern");
        return false;
      }
      if (
        isCoolingDown(
          options.tipState.lastTipTimestamp,
          tippingConfig.minMinutesBetweenTips,
          now
        )
      ) {
        logTipDecision("Tip candidate rejected: cooldown active", {
          txHash: candidate.txHash,
          lastTipTimestamp: options.tipState.lastTipTimestamp,
          minMinutesBetweenTips: tippingConfig.minMinutesBetweenTips,
        }, "pattern");
        return false;
      }
      if (candidate.totalScore < tippingConfig.minScore) {
        logTipDecision("Tip candidate rejected: composite score below floor", {
          txHash: candidate.txHash,
          totalScore: candidate.totalScore,
          minScore: tippingConfig.minScore,
        }, "pattern");
        return false;
      }
      return true;
    })
    .sort((a, b) => b.totalScore - a.totalScore || b.timestamp - a.timestamp)
    .slice(0, Math.min(2, tippingConfig.maxTipsPerSession));

  logTipDecision("Tip candidate selection completed", {
    candidateCount: candidates.length,
    selected: candidates.map((candidate) => ({
      txHash: candidate.txHash,
      author: candidate.author,
      amount: candidate.amount,
      totalScore: candidate.totalScore,
      scoreBreakdown: {
        quality: candidate.qualityScore,
        reactions: candidate.reactionsScore,
        topicAlignment: candidate.topicAlignmentScore,
        freshness: candidate.freshnessScore,
        repeatPenalty: candidate.repeatPenalty,
      },
    })),
  });

  return candidates;
}

export async function executeTip(
  options: ExecuteTipOptions
): Promise<ExecuteTipResult> {
  const { agentName, candidate, demos, token, spendingConfig } = options;
  const decision = canSpend(
    candidate.amount,
    candidate.author,
    spendingConfig,
    options.ledger
  );

  if (!decision.allowed) {
    logTipDecision("Tip denied by spending policy", {
      txHash: candidate.txHash,
      author: candidate.author,
      amount: candidate.amount,
      reason: decision.reason,
    }, "pattern");
    return {
      candidate,
      decision,
      ledger: options.ledger,
      tipState: options.tipState,
    };
  }

  if (decision.dryRun) {
    logTipDecision("Tip dry-run simulated", {
      txHash: candidate.txHash,
      author: candidate.author,
      amount: candidate.amount,
      reason: decision.reason,
      agentName,
    });
    return {
      candidate,
      decision,
      ledger: options.ledger,
      tipState: options.tipState,
    };
  }

  const tipRes = await apiCall("/api/tip", token, {
    method: "POST",
    body: JSON.stringify({ postTxHash: candidate.txHash, amount: candidate.amount }),
  });
  if (!tipRes.ok || !tipRes.data?.ok || !tipRes.data?.recipient) {
    throw new Error(`Tip validation failed: ${JSON.stringify(tipRes.data)}`);
  }

  const recipient = String(tipRes.data.recipient).toLowerCase();
  // SDK transfer() creates signed tx only (2 params) — must confirm+broadcast to submit
  let transferResult: unknown;
  const stages = {
    store: ({ amount, recipient }: { recipient: string; amount: number }) =>
      demos.transfer(recipient, amount),
    confirm: (signedTx: unknown) =>
      demos.confirm(signedTx as Parameters<Demos["confirm"]>[0]),
    broadcast: async (validity: unknown) => {
      transferResult = await demos.broadcast(
        validity as Parameters<Demos["broadcast"]>[0],
      );
      return transferResult;
    },
  };
  await executeChainTx(stages, { recipient, amount: candidate.amount });

  const tx: SpendingTransaction = {
    timestamp: new Date().toISOString(),
    amount: candidate.amount,
    recipient,
    postTxHash: candidate.txHash,
    type: "tip",
    dryRun: false,
    agent: agentName,
  };

  const ledger = recordSpend(tx, options.ledger);
  const tipState: TipState = {
    ...options.tipState,
    tippedPosts: [...options.tipState.tippedPosts, candidate.txHash].slice(-500),
    perRecipientCounts: {
      ...options.tipState.perRecipientCounts,
      [recipient]: {
        date: todayUTC(),
        count: currentRecipientCount(options.tipState, recipient) + 1,
      },
    },
    lastTipTimestamp: tx.timestamp,
  };

  logTipDecision("Tip executed", {
    txHash: candidate.txHash,
    recipient,
    amount: candidate.amount,
    transferResult,
  });

  return {
    candidate,
    decision,
    ledger,
    tipState,
    transferTx: typeof transferResult === "string" ? transferResult : undefined,
    recipient,
  };
}

export function incrementWarmupCounter(
  tipState: TipState,
  sessionNumber: number
): TipState {
  if (tipState.lastWarmupSession === sessionNumber) return tipState;
  return {
    ...tipState,
    warmupCounter: tipState.warmupCounter + 1,
    lastWarmupSession: sessionNumber,
  };
}
