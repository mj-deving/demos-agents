import type { MarketOpportunity, MarketPostInput, MarketSignalInput } from "./market-opportunities.js";

export interface MarketColonySignalSummary {
  asset: string;
  primaryTopic: string | null;
  primaryDirection: string | null;
  primaryConfidence: number | null;
  relatedSignalCount: number;
}

export interface MarketColonySignalTake {
  topic: string | null;
  direction: string | null;
  confidence: number | null;
}

export interface MarketRecentContextPost {
  txHash: string | null;
  author: string | null;
  category: string | null;
  textSnippet: string;
}

export interface MarketColonySubstrate {
  signalSummary: MarketColonySignalSummary;
  supportingSignals: MarketColonySignalTake[];
  conflictingSignals: MarketColonySignalTake[];
  recentRelatedPosts: MarketRecentContextPost[];
}

export interface BuildMarketColonySubstrateOptions {
  opportunity: MarketOpportunity;
  maxSignals?: number;
  maxRecentRelatedPosts?: number;
}

const DEFAULT_MAX_SIGNALS = 3;
const DEFAULT_MAX_RECENT_RELATED_POSTS = 3;

export function buildMarketColonySubstrate(
  opts: BuildMarketColonySubstrateOptions,
): MarketColonySubstrate {
  const primaryDirection = normalizeDirection(opts.opportunity.matchedSignal?.direction);
  const relatedSignals = opts.opportunity.relatedSignals.slice(0, opts.maxSignals ?? DEFAULT_MAX_SIGNALS);
  const supportingSignals = relatedSignals
    .filter((signal) => normalizeDirection(signal.direction) === primaryDirection)
    .slice(0, opts.maxSignals ?? DEFAULT_MAX_SIGNALS)
    .map(toSignalTake);
  const conflictingSignals = relatedSignals
    .filter((signal) => primaryDirection != null && normalizeDirection(signal.direction) != null)
    .filter((signal) => normalizeDirection(signal.direction) !== primaryDirection)
    .slice(0, opts.maxSignals ?? DEFAULT_MAX_SIGNALS)
    .map(toSignalTake);

  return {
    signalSummary: {
      asset: opts.opportunity.asset,
      primaryTopic: opts.opportunity.matchedSignal?.topic ?? null,
      primaryDirection: opts.opportunity.matchedSignal?.direction ?? null,
      primaryConfidence: opts.opportunity.matchedSignal?.confidence ?? null,
      relatedSignalCount: opts.opportunity.relatedSignals.length,
    },
    supportingSignals,
    conflictingSignals,
    recentRelatedPosts: opts.opportunity.matchingFeedPosts
      .slice(0, opts.maxRecentRelatedPosts ?? DEFAULT_MAX_RECENT_RELATED_POSTS)
      .map(toRecentContextPost),
  };
}

function toSignalTake(signal: MarketSignalInput): MarketColonySignalTake {
  return {
    topic: signal.topic,
    direction: signal.direction,
    confidence: signal.confidence,
  };
}

function toRecentContextPost(post: MarketPostInput): MarketRecentContextPost {
  return {
    txHash: post.txHash,
    author: post.author,
    category: post.category,
    textSnippet: snippet(post.text),
  };
}

function normalizeDirection(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function snippet(text: string, maxLength: number = 180): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}
