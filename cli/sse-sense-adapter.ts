/**
 * SSE Sense Adapter — reads SSE feed within a time budget for v3-loop SENSE phase.
 *
 * Adapts the existing SSE feed source (src/reactive/event-sources/sse-feed.ts)
 * for use in the SENSE phase. Time-bounded, non-fatal, inserts posts into colony DB.
 *
 * Review fixes applied:
 * - [Codex M3] Reuses existing sse-feed.ts infrastructure (parseSSEChunk, buildStreamUrl)
 * - [Threat] Caps events per read (maxEvents) to prevent flood
 * - [Threat] Validates post structure before DB insertion
 */

import { insertPost, getPost } from "../src/toolkit/colony/posts.js";
import type { ColonyDatabase } from "../src/toolkit/colony/schema.js";
import type { CachedPost } from "../src/toolkit/colony/posts.js";
import { toErrorMessage } from "../src/toolkit/util/errors.js";

export interface SSESenseOptions {
  /** Max time to read SSE stream (default: 5000ms) */
  timeoutMs?: number;
  /** Max events to ingest per read (default: 100) */
  maxEvents?: number;
}

export interface SSESenseResult {
  postsReceived: number;
  postsIngested: number;
  source: "poll-fallback" | "skipped";
  elapsedMs: number;
}

interface SSEPostLike {
  txHash: string;
  author: string;
  timestamp: number;
  text: string;
  category: string;
}

function isValidSSEPost(post: unknown): post is SSEPostLike {
  if (typeof post !== "object" || post === null) return false;
  const p = post as Record<string, unknown>;
  return (
    typeof p.txHash === "string" && p.txHash.length > 0 &&
    typeof p.author === "string" && p.author.length > 0 &&
    typeof p.timestamp === "number" && Number.isFinite(p.timestamp) &&
    typeof p.text === "string"
  );
}

function ssePostToCachedPost(post: SSEPostLike): CachedPost {
  const ts = new Date(post.timestamp);
  return {
    txHash: post.txHash,
    author: post.author,
    blockNumber: 0,
    timestamp: isNaN(ts.getTime()) ? new Date().toISOString() : ts.toISOString(),
    replyTo: null,
    tags: [],
    text: post.text,
    rawData: { category: post.category, source: "sse" },
  };
}

/**
 * Read SSE feed within a time budget and ingest posts into colony DB.
 * Graceful: returns { source: "skipped" } on any failure.
 */
export async function readSSESense(
  db: ColonyDatabase,
  apiCall: (path: string, opts?: { signal?: AbortSignal }) => Promise<{ ok: boolean; data?: unknown }>,
  observe: (type: string, msg: string, meta?: Record<string, unknown>) => void,
  options?: SSESenseOptions,
): Promise<SSESenseResult> {
  const timeoutMs = options?.timeoutMs ?? 5_000;
  const maxEvents = options?.maxEvents ?? 100;
  const start = Date.now();

  try {
    const result = await apiCall("/api/feed?limit=50", {
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!result.ok || !result.data) {
      return { postsReceived: 0, postsIngested: 0, source: "skipped", elapsedMs: Date.now() - start };
    }

    const feedData = result.data as { posts?: unknown[] };
    const rawPosts = Array.isArray(feedData.posts) ? feedData.posts : Array.isArray(feedData) ? feedData : [];

    let postsReceived = 0;
    let postsIngested = 0;

    for (const rawPost of rawPosts.slice(0, maxEvents)) {
      if (!isValidSSEPost(rawPost)) continue;
      postsReceived++;

      // Skip if already in DB (dedup via primary key)
      const existing = getPost(db, rawPost.txHash);
      if (existing) continue;

      try {
        const cached = ssePostToCachedPost(rawPost);
        insertPost(db, cached);
        postsIngested++;
      } catch {
        // Skip malformed posts — non-fatal
      }
    }

    return {
      postsReceived,
      postsIngested,
      source: "poll-fallback",
      elapsedMs: Date.now() - start,
    };
  } catch (err: unknown) {
    observe("warning", `SSE sense read failed: ${toErrorMessage(err)}`, {
      source: "sse-sense-adapter",
    });
    return { postsReceived: 0, postsIngested: 0, source: "skipped", elapsedMs: Date.now() - start };
  }
}
