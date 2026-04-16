/**
 * SSEFeedSource — adapts an SSE stream into the poll/diff/extractWatermark pattern.
 *
 * The event loop calls poll() at intervals. This source opens an SSE connection
 * to /api/feed/stream, parses the stream, and returns buffered posts on each poll().
 * Falls back to HTTP feed fetch when SSE is unavailable.
 */

import { z } from "zod";
import type { AgentEvent, EventSource } from "../../types.js";
import { extractLatestWatermark } from "./watermark-utils.js";

const SSEPostSchema = z.object({
  txHash: z.string(),
  author: z.string(),
  timestamp: z.number(),
  text: z.string(),
  category: z.string().optional(),
  cat: z.string().optional(),
  assets: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
}).superRefine((post, ctx) => {
  if (!post.category && !post.cat) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["category"],
      message: "category or cat is required",
    });
  }
}).transform((post) => ({
  txHash: post.txHash,
  author: post.author,
  timestamp: post.timestamp,
  text: post.text,
  category: post.category ?? post.cat ?? "UNKNOWN",
  assets: post.assets ?? [],
  tags: post.tags ?? [],
}));

export type SSEPost = z.infer<typeof SSEPostSchema>;

export interface SSESnapshot {
  timestamp: number;
  posts: SSEPost[];
  source: "sse" | "poll-fallback";
}

export interface SSEFeedSourceConfig {
  /** SSE stream URL (e.g., https://supercolony.ai/api/feed/stream) */
  streamUrl: string;
  /** Auth token provider (called on connect and on auth_expired) */
  getToken: () => Promise<string>;
  /** Fallback: fetch feed via HTTP when SSE is unavailable */
  fetchFeedFallback: () => Promise<SSEPost[]>;
  /** Optional: SSE query params for filtering */
  categories?: string[];
  assets?: string[];
  mentions?: string[];
  /** Optional reconnect backoff tuning for consecutive SSE failures */
  reconnectBackoff?: {
    initialMs?: number;
    maxMs?: number;
    factor?: number;
  };
  /** Maximum consecutive SSE failures before staying on poll fallback */
  maxReconnectAttempts?: number;
}

/**
 * Parse an SSE text chunk into structured events.
 * Each SSE event is separated by a blank line (\n\n).
 * Lines starting with : are comments (keepalives).
 * Per RFC 8895, normalizes \r\n and lone \r to \n before parsing.
 */
function parseSSEChunk(text: string): Array<{ event: string; data: string; id: string }> {
  const results: Array<{ event: string; data: string; id: string }> = [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split("\n\n");

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.startsWith(":")) continue;

    let event = "";
    let id = "";
    const dataParts: string[] = [];

    for (const line of trimmed.split("\n")) {
      if (line.startsWith(":")) continue; // comment line within block
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("id: ")) id = line.slice(4);
      else if (line.startsWith("data: ")) dataParts.push(line.slice(6));
      else if (line.startsWith("data:")) dataParts.push(line.slice(5));
    }

    if (event || dataParts.length > 0) {
      results.push({ event, data: dataParts.join("\n"), id });
    }
  }

  return results;
}

/**
 * Build the SSE stream URL with optional query parameters.
 */
function buildStreamUrl(config: SSEFeedSourceConfig): string {
  const url = new URL(config.streamUrl);
  if (config.categories?.length) {
    url.searchParams.set("categories", config.categories.join(","));
  }
  if (config.assets?.length) {
    url.searchParams.set("assets", config.assets.join(","));
  }
  if (config.mentions?.length) {
    url.searchParams.set("mentions", config.mentions.join(","));
  }
  return url.toString();
}

/** Default read timeout — SSE streams are long-lived, so poll() must not block forever */
const SSE_READ_TIMEOUT_MS = 5_000;
const DEFAULT_RECONNECT_BACKOFF = {
  initialMs: 1_000,
  maxMs: 30_000,
  factor: 2,
} as const;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;

function getReconnectDelayMs(config: SSEFeedSourceConfig, failureCount: number): number {
  const initialMs = Math.max(0, config.reconnectBackoff?.initialMs ?? DEFAULT_RECONNECT_BACKOFF.initialMs);
  const maxMs = Math.max(initialMs, config.reconnectBackoff?.maxMs ?? DEFAULT_RECONNECT_BACKOFF.maxMs);
  const factor = Math.max(1, config.reconnectBackoff?.factor ?? DEFAULT_RECONNECT_BACKOFF.factor);

  return Math.min(initialMs * factor ** Math.max(0, failureCount - 1), maxMs);
}


/**
 * Read SSE response body with a timeout. SSE streams are long-lived (server
 * sends keepalives every 30s, never closes). This reads for up to timeoutMs,
 * then cancels the reader and returns whatever events arrived.
 */
async function readSSEStream(
  body: ReadableStream<Uint8Array>,
  onAuthExpired: () => Promise<void>,
  timeoutMs: number = SSE_READ_TIMEOUT_MS,
): Promise<{ posts: SSEPost[]; lastEventId: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const posts: SSEPost[] = [];
  let lastEventId = "";
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    reader.cancel().catch(() => {}); // Cancel triggers done:true
  }, timeoutMs);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    buffer += decoder.decode();
  } catch {
    // Reader cancelled by timeout — expected
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }

  const sseEvents = parseSSEChunk(buffer);
  for (const evt of sseEvents) {
    if (evt.id) lastEventId = evt.id;

    if (evt.event === "auth_expired") {
      await onAuthExpired();
      continue;
    }

    if (evt.event === "post" && evt.data) {
      try {
        const parsed = SSEPostSchema.safeParse(JSON.parse(evt.data));
        if (parsed.success) posts.push(parsed.data);
      } catch {
        // Skip malformed post data
      }
    }
    // Ignore connected, reaction, signal, and other event types
  }

  return { posts, lastEventId };
}

/**
 * Create an SSE feed event source.
 *
 * Adapts SSE streaming into the poll/diff pattern:
 * - poll(): Opens an SSE fetch, reads the stream, returns posts as SSESnapshot.
 * - diff(): Compares snapshots by txHash, emits AgentEvent for new posts.
 * - extractWatermark(): Returns the latest post's txHash and timestamp.
 */
export function createSSEFeedSource(config: SSEFeedSourceConfig): EventSource<SSESnapshot> {
  let lastEventId = "";
  let consecutiveFailures = 0;
  const maxReconnectAttempts = Math.max(
    0,
    config.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS,
  );
  let usePermanentFallback = maxReconnectAttempts === 0;
  /** Timestamp until which SSE reconnects are suppressed (backoff window). */
  let sseDisabledUntil = 0;

  async function fetchSSE(): Promise<SSESnapshot> {
    const token = await config.getToken();
    const url = buildStreamUrl(config);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
    };
    if (lastEventId) {
      headers["Last-Event-ID"] = lastEventId;
    }

    const response = await fetch(url, { headers });

    if (!response.ok || !response.body) {
      throw new Error(`SSE fetch failed: ${response.status}`);
    }

    let authExpired = false;
    const result = await readSSEStream(response.body, async () => {
      authExpired = true;
    });

    if (result.lastEventId) {
      lastEventId = result.lastEventId;
    }

    // If auth expired during stream read, refresh token for next poll cycle.
    // Actual reconnection happens on the next poll() call — no recursion here.
    if (authExpired) {
      await config.getToken();
    }

    return {
      timestamp: Date.now(),
      posts: result.posts,
      source: "sse",
    };
  }

  async function fetchFallback(): Promise<SSESnapshot> {
    const posts = await config.fetchFeedFallback();
    return {
      timestamp: Date.now(),
      posts,
      source: "poll-fallback",
    };
  }

  return {
    id: "sse:feed",
    description: "Real-time SSE feed from SuperColony with HTTP poll fallback",
    eventTypes: ["feed_post"],

    async poll(): Promise<SSESnapshot> {
      if (usePermanentFallback) {
        return await fetchFallback();
      }

      // Skip SSE while inside a backoff window — fall back immediately.
      if (Date.now() < sseDisabledUntil) {
        return await fetchFallback();
      }

      try {
        const snapshot = await fetchSSE();
        consecutiveFailures = 0;
        sseDisabledUntil = 0;
        return snapshot;
      } catch {
        consecutiveFailures += 1;

        if (consecutiveFailures >= maxReconnectAttempts) {
          usePermanentFallback = true;
        } else {
          // Suppress SSE for the backoff duration — next poll skips SSE, returns fallback instantly.
          sseDisabledUntil = Date.now() + getReconnectDelayMs(config, consecutiveFailures);
        }

        return await fetchFallback();
      }
    },

    diff(prev: SSESnapshot | null, curr: SSESnapshot): AgentEvent<SSEPost>[] {
      // Warm-up: first poll establishes baseline, no events emitted
      if (prev === null) return [];

      const prevHashes = new Set(prev.posts.map(p => p.txHash));
      return curr.posts
        .filter(p => !prevHashes.has(p.txHash))
        .map(p => ({
          id: `sse:feed:${p.timestamp}:${p.txHash}`,
          sourceId: "sse:feed",
          type: "feed_post",
          detectedAt: Date.now(),
          payload: p,
          watermark: { txHash: p.txHash, timestamp: p.timestamp },
        }));
    },

    extractWatermark(snapshot: SSESnapshot): unknown {
      return extractLatestWatermark(snapshot.posts, p => ({
        latestTxHash: p.txHash,
        timestamp: p.timestamp,
      }));
    },
  };
}
