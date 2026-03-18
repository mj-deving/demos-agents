/**
 * Feed filtering + indexing utilities.
 *
 * Mostly lightweight data transforms, plus a small reusable topic-search helper
 * for SuperColony feed limitations around tag search.
 */

import { apiCall } from "./sdk.js";
import { observe } from "./observe.js";
import { toErrorMessage } from "./errors.js";

export interface QualityFilter {
  minScore: number;
  requireAttestation: boolean;
  excludeAuthors?: string[];
}

export interface FilteredPost {
  txHash: string;
  author: string;
  timestamp: number;
  score: number;
  category: string;
  tags: string[];
  assets: string[];
  hasAttestation: boolean;
  reactions: { agree: number; disagree: number };
  textPreview: string;
}

export interface TopicStats {
  count: number;
  totalReactions: number;
  attestedCount: number;
  uniqueAuthors: Set<string>;
  avgScore: number;
  newestTimestamp: number;
}

export interface AgentStats {
  address: string;
  displayName?: string;
  postCount: number;
  avgScore: number;
  attestationRate: number;
}

export type TopicSearchSource = "asset" | "text";

export interface CombinedTopicSearchOptions {
  searchLimit?: number;
  fetchFeed?: (path: string, label: string) => Promise<any[]>;
  onRawResults?: (source: TopicSearchSource, rawPosts: any[]) => void;
  onFallbackFiltered?: (filteredPosts: FilteredPost[]) => void;
}

export const NUMERIC_CLAIM_PATTERN = /\d+(\.\d+)?%|\$\d+|\d+\.\d+\s*(bbl|usd|btc|eth)/i;

function toArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((v) => String(v || "").trim())
    .filter(Boolean);
}

function clampScore(raw: unknown): number {
  const parsed = Number(raw ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function normalizeTimestamp(raw: unknown): number {
  const parsed = Number(raw ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

function getAuthor(raw: any): string {
  return String(raw?.author || raw?.address || raw?.agent?.address || "")
    .trim()
    .toLowerCase();
}

function hasAttestation(raw: any): boolean {
  return Boolean(
    (Array.isArray(raw?.payload?.sourceAttestations) && raw.payload.sourceAttestations.length > 0) ||
    (Array.isArray(raw?.payload?.tlsnAttestations) && raw.payload.tlsnAttestations.length > 0)
  );
}

function getText(raw: any): string {
  const text = String(raw?.payload?.text || raw?.text || "");
  return text.slice(0, 200);
}

function getCategory(raw: any): string {
  return String(raw?.payload?.cat || raw?.cat || "UNKNOWN").toUpperCase();
}

function normalizeFeedPosts(payload: any): any[] {
  const posts =
    payload?.posts ??
    payload?.results ??
    payload?.items ??
    payload?.data?.posts ??
    payload?.data ??
    payload ??
    [];
  if (!Array.isArray(posts)) return [];
  return posts;
}

function dedupeFilteredPosts(posts: FilteredPost[]): FilteredPost[] {
  const byTxHash = new Map<string, FilteredPost>();
  for (const post of posts) {
    const existing = byTxHash.get(post.txHash);
    if (!existing || post.timestamp > existing.timestamp) {
      byTxHash.set(post.txHash, post);
    }
  }
  return [...byTxHash.values()];
}

function matchesTopicTagOrAsset(raw: any, topicLower: string): boolean {
  const tags = toArray(raw?.payload?.tags).map((tag) => tag.toLowerCase());
  const assets = toArray(raw?.payload?.assets).map((asset) => asset.toLowerCase());
  return tags.some((tag) => tag.includes(topicLower) || topicLower.includes(tag)) ||
    assets.some((asset) => asset.includes(topicLower) || topicLower.includes(asset));
}

async function defaultFeedFetch(path: string, token: string): Promise<any[]> {
  const res = await apiCall(path, token);
  if (!res.ok) {
    throw new Error(`${path} failed (${res.status}): ${JSON.stringify(res.data)}`);
  }
  return normalizeFeedPosts(res.data);
}

/**
 * Filter raw feed posts and extract lightweight fields.
 */
export function filterPosts(rawPosts: any[], filter: QualityFilter): FilteredPost[] {
  const exclude = new Set((filter.excludeAuthors || []).map((a) => String(a).toLowerCase()));
  const minScore = Number.isFinite(filter.minScore) ? filter.minScore : 70;

  const out: FilteredPost[] = [];
  for (const raw of rawPosts || []) {
    const txHash = String(raw?.txHash || "").trim();
    if (!txHash) continue;

    const author = getAuthor(raw);
    if (!author) continue;
    if (exclude.has(author)) continue;

    const score = clampScore(raw?.score ?? raw?.qualityScore);
    if (score < minScore) continue;

    const attested = hasAttestation(raw);
    if (filter.requireAttestation && !attested) continue;

    const filtered: FilteredPost = {
      txHash,
      author,
      timestamp: normalizeTimestamp(raw?.timestamp),
      score,
      category: getCategory(raw),
      tags: toArray(raw?.payload?.tags),
      assets: toArray(raw?.payload?.assets),
      hasAttestation: attested,
      reactions: {
        agree: Number(raw?.reactions?.agree || 0),
        disagree: Number(raw?.reactions?.disagree || 0),
      },
      textPreview: getText(raw),
    };

    out.push(filtered);
  }

  return out;
}

/**
 * Combined topic search for SuperColony feed quirks.
 *
 * The search endpoint only indexes post body text for `text=` lookups, so
 * topic discovery needs:
 * 1. asset search
 * 2. text search
 * 3. local tag/asset matching against a caller-provided broad pool if both are empty
 *
 * The helper accepts an optional broad-pool getter so callers can memoize the
 * broad feed fetch once and reuse it across multiple topic queries.
 */
export async function combinedTopicSearch(
  topic: string,
  authToken: string,
  qualityFilter: QualityFilter,
  broadPool?: any[] | (() => Promise<any[]>),
  options: CombinedTopicSearchOptions = {}
): Promise<FilteredPost[]> {
  const searchLimit = Number.isFinite(options.searchLimit) ? Number(options.searchLimit) : 30;
  const fetchFeed = options.fetchFeed || ((path: string) => defaultFeedFetch(path, authToken));
  const normalizedTopic = String(topic || "").trim();

  if (!normalizedTopic) return [];

  const searchResults = await Promise.allSettled([
    fetchFeed(
      `/api/feed/search?asset=${encodeURIComponent(normalizedTopic)}&limit=${searchLimit}`,
      `topic-search asset="${normalizedTopic}"`
    ),
    fetchFeed(
      `/api/feed/search?text=${encodeURIComponent(normalizedTopic)}&limit=${searchLimit}`,
      `topic-search text="${normalizedTopic}"`
    ),
  ]);

  const filteredMatches: FilteredPost[] = [];
  for (const [index, result] of searchResults.entries()) {
    const source: TopicSearchSource = index === 0 ? "asset" : "text";
    if (result.status === "fulfilled") {
      options.onRawResults?.(source, result.value);
      filteredMatches.push(...filterPosts(result.value, qualityFilter));
      continue;
    }

    observe("inefficiency", `topic-search ${source}="${normalizedTopic}" failed`, {
      phase: "scan",
      source: "feed-filter.ts:combinedTopicSearch",
      data: {
        topic: normalizedTopic,
        source,
        error: toErrorMessage(result.reason),
      },
    });
  }

  if (filteredMatches.length > 0) {
    return dedupeFilteredPosts(filteredMatches);
  }

  if (!broadPool) {
    return [];
  }

  try {
    const pool = typeof broadPool === "function" ? await broadPool() : broadPool;
    const topicLower = normalizedTopic.toLowerCase();
    const tagMatches = (pool || []).filter((post: any) => matchesTopicTagOrAsset(post, topicLower));
    const filteredFallback = filterPosts(tagMatches, qualityFilter);
    options.onFallbackFiltered?.(filteredFallback);
    return dedupeFilteredPosts(filteredFallback);
  } catch (err) {
    observe("inefficiency", `topic-search broad feed failed for "${normalizedTopic}"`, {
      phase: "scan",
      source: "feed-filter.ts:combinedTopicSearch",
      data: {
        topic: normalizedTopic,
        error: toErrorMessage(err),
      },
    });
    return [];
  }
}

/**
 * Build topic index from filtered posts.
 */
export function buildTopicIndex(posts: FilteredPost[]): Map<string, TopicStats> {
  const topicIndex = new Map<string, TopicStats>();

  for (const post of posts) {
    const topics = new Set<string>();
    for (const tag of post.tags) topics.add(tag.toLowerCase());
    for (const asset of post.assets) topics.add(asset.toLowerCase());
    if (topics.size === 0) topics.add(post.category.toLowerCase());

    const reactionCount = post.reactions.agree + post.reactions.disagree;

    for (const topic of topics) {
      const current = topicIndex.get(topic) || {
        count: 0,
        totalReactions: 0,
        attestedCount: 0,
        uniqueAuthors: new Set<string>(),
        avgScore: 0,
        newestTimestamp: 0,
      };
      current.count += 1;
      current.totalReactions += reactionCount;
      current.attestedCount += post.hasAttestation ? 1 : 0;
      current.uniqueAuthors.add(post.author);
      current.avgScore += post.score;
      current.newestTimestamp = Math.max(current.newestTimestamp, post.timestamp || 0);
      topicIndex.set(topic, current);
    }
  }

  for (const [topic, stats] of topicIndex.entries()) {
    stats.avgScore = stats.count > 0 ? +(stats.avgScore / stats.count).toFixed(1) : 0;
    topicIndex.set(topic, stats);
  }

  return topicIndex;
}

/**
 * Build agent quality index from filtered posts.
 */
export function buildAgentIndex(posts: FilteredPost[]): Map<string, AgentStats> {
  const acc = new Map<string, { totalScore: number; postCount: number; attestedCount: number }>();

  for (const post of posts) {
    const key = post.author.toLowerCase();
    const current = acc.get(key) || { totalScore: 0, postCount: 0, attestedCount: 0 };
    current.totalScore += post.score;
    current.postCount += 1;
    current.attestedCount += post.hasAttestation ? 1 : 0;
    acc.set(key, current);
  }

  const out = new Map<string, AgentStats>();
  for (const [address, stats] of acc.entries()) {
    const avgScore = stats.postCount > 0 ? +(stats.totalScore / stats.postCount).toFixed(1) : 0;
    const attestationRate = stats.postCount > 0 ? +(stats.attestedCount / stats.postCount).toFixed(3) : 0;
    out.set(address, {
      address,
      postCount: stats.postCount,
      avgScore,
      attestationRate,
    });
  }
  return out;
}
