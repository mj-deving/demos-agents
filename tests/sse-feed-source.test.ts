/**
 * Tests for SSE feed event source.
 *
 * The SSE source adapts a persistent SSE stream into the poll/diff/extractWatermark
 * pattern used by event-loop.ts. It buffers posts from the stream and drains them
 * on each poll() call.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createSSEFeedSource,
  type SSEPost,
  type SSESnapshot,
  type SSEFeedSourceConfig,
} from "../src/reactive/event-sources/sse-feed.js";

// ── Mock helpers ──

function makeSSEPost(overrides: Partial<SSEPost> = {}): SSEPost {
  return {
    txHash: "tx-sse-1",
    author: "0xAUTHOR",
    timestamp: 1000,
    text: "SSE post content",
    category: "ANALYSIS",
    ...overrides,
  };
}

/**
 * Create a mock fetch Response whose body is a ReadableStream of SSE-formatted data.
 */
function createMockSSEStream(
  events: Array<{ event: string; data: string; id?: string }>,
): { ok: boolean; status: number; body: ReadableStream<Uint8Array>; headers: Headers } {
  const encoder = new TextEncoder();
  let content = "";
  for (const e of events) {
    if (e.id) content += `id: ${e.id}\n`;
    content += `event: ${e.event}\ndata: ${e.data}\n\n`;
  }
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(content));
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    body: readable,
    headers: new Headers(),
  };
}

/**
 * Create a mock fetch that returns an SSE stream with given posts.
 */
function createMockFetchForPosts(posts: SSEPost[], ids?: string[]) {
  const events = posts.map((p, i) => ({
    event: "post",
    data: JSON.stringify(p),
    id: ids?.[i] ?? String(i + 1),
  }));
  return vi.fn().mockResolvedValue(createMockSSEStream(events));
}

function makeConfig(overrides: Partial<SSEFeedSourceConfig> = {}): SSEFeedSourceConfig {
  return {
    streamUrl: "https://www.supercolony.ai/api/feed/stream",
    getToken: vi.fn().mockResolvedValue("test-token"),
    fetchFeedFallback: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

// ── Tests ──

describe("SSEFeedSource", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("has correct id and eventTypes", () => {
    const source = createSSEFeedSource(makeConfig());
    expect(source.id).toBe("sse:feed");
    expect(source.eventTypes).toEqual(["feed_post"]);
  });

  it("has description", () => {
    const source = createSSEFeedSource(makeConfig());
    expect(source.description).toBeTruthy();
    expect(typeof source.description).toBe("string");
  });

  it("poll() returns SSESnapshot with posts from SSE stream", async () => {
    const posts = [
      makeSSEPost({ txHash: "tx-1", timestamp: 1000 }),
      makeSSEPost({ txHash: "tx-2", timestamp: 2000 }),
    ];
    const mockFetch = createMockFetchForPosts(posts);
    vi.stubGlobal("fetch", mockFetch);

    const source = createSSEFeedSource(makeConfig());
    const snapshot = await source.poll();

    expect(snapshot.posts).toHaveLength(2);
    expect(snapshot.posts[0].txHash).toBe("tx-1");
    expect(snapshot.posts[1].txHash).toBe("tx-2");
    expect(snapshot.source).toBe("sse");
    expect(snapshot.timestamp).toBeGreaterThan(0);
  });

  it("poll() passes auth token to fetch", async () => {
    const mockFetch = createMockFetchForPosts([]);
    vi.stubGlobal("fetch", mockFetch);

    const getToken = vi.fn().mockResolvedValue("my-auth-token");
    const source = createSSEFeedSource(makeConfig({ getToken }));
    await source.poll();

    expect(getToken).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer my-auth-token",
        }),
      }),
    );
  });

  it("poll() includes categories and assets in URL params", async () => {
    const mockFetch = createMockFetchForPosts([]);
    vi.stubGlobal("fetch", mockFetch);

    const source = createSSEFeedSource(
      makeConfig({
        categories: ["ANALYSIS", "SIGNAL"],
        assets: ["ETH", "BTC"],
      }),
    );
    await source.poll();

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("categories=ANALYSIS%2CSIGNAL");
    expect(calledUrl).toContain("assets=ETH%2CBTC");
  });

  it("poll() falls back to fetchFeedFallback when SSE fetch fails", async () => {
    const fallbackPosts = [makeSSEPost({ txHash: "tx-fallback" })];
    const fetchFeedFallback = vi.fn().mockResolvedValue(fallbackPosts);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    const source = createSSEFeedSource(makeConfig({ fetchFeedFallback }));
    const snapshot = await source.poll();

    expect(fetchFeedFallback).toHaveBeenCalled();
    expect(snapshot.source).toBe("poll-fallback");
    expect(snapshot.posts).toHaveLength(1);
    expect(snapshot.posts[0].txHash).toBe("tx-fallback");
  });

  it("poll() falls back when fetch returns non-ok response", async () => {
    const fallbackPosts = [makeSSEPost({ txHash: "tx-fallback-2" })];
    const fetchFeedFallback = vi.fn().mockResolvedValue(fallbackPosts);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        body: null,
        headers: new Headers(),
      }),
    );

    const source = createSSEFeedSource(makeConfig({ fetchFeedFallback }));
    const snapshot = await source.poll();

    expect(snapshot.source).toBe("poll-fallback");
    expect(snapshot.posts[0].txHash).toBe("tx-fallback-2");
  });

  it("poll() falls back when response body is null", async () => {
    const fallbackPosts = [makeSSEPost({ txHash: "tx-no-body" })];
    const fetchFeedFallback = vi.fn().mockResolvedValue(fallbackPosts);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: null,
        headers: new Headers(),
      }),
    );

    const source = createSSEFeedSource(makeConfig({ fetchFeedFallback }));
    const snapshot = await source.poll();

    expect(snapshot.source).toBe("poll-fallback");
  });

  // ── diff() tests ──

  it("diff() returns empty array on first poll (warm-up, prev is null)", () => {
    const source = createSSEFeedSource(makeConfig());
    const curr: SSESnapshot = {
      timestamp: 1000,
      posts: [makeSSEPost({ txHash: "tx-1" }), makeSSEPost({ txHash: "tx-2" })],
      source: "sse",
    };
    const events = source.diff(null, curr);
    expect(events).toHaveLength(0);
  });

  it("diff() returns new posts not in previous snapshot", () => {
    const source = createSSEFeedSource(makeConfig());
    const prev: SSESnapshot = {
      timestamp: 1000,
      posts: [makeSSEPost({ txHash: "tx-1", timestamp: 1000 })],
      source: "sse",
    };
    const curr: SSESnapshot = {
      timestamp: 2000,
      posts: [
        makeSSEPost({ txHash: "tx-1", timestamp: 1000 }),
        makeSSEPost({ txHash: "tx-2", timestamp: 2000 }),
        makeSSEPost({ txHash: "tx-3", timestamp: 3000 }),
      ],
      source: "sse",
    };
    const events = source.diff(prev, curr);
    expect(events).toHaveLength(2);
    expect(events[0].payload.txHash).toBe("tx-2");
    expect(events[1].payload.txHash).toBe("tx-3");
  });

  it("diff() skips posts already seen in previous snapshot", () => {
    const source = createSSEFeedSource(makeConfig());
    const prev: SSESnapshot = {
      timestamp: 1000,
      posts: [
        makeSSEPost({ txHash: "tx-1" }),
        makeSSEPost({ txHash: "tx-2" }),
      ],
      source: "sse",
    };
    const curr: SSESnapshot = {
      timestamp: 2000,
      posts: [
        makeSSEPost({ txHash: "tx-1" }),
        makeSSEPost({ txHash: "tx-2" }),
      ],
      source: "sse",
    };
    const events = source.diff(prev, curr);
    expect(events).toHaveLength(0);
  });

  it("diff() emits events with correct structure", () => {
    const source = createSSEFeedSource(makeConfig());
    const prev: SSESnapshot = {
      timestamp: 1000,
      posts: [],
      source: "sse",
    };
    const post = makeSSEPost({ txHash: "tx-new", timestamp: 5000 });
    const curr: SSESnapshot = {
      timestamp: 5000,
      posts: [post],
      source: "sse",
    };
    const events = source.diff(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      id: expect.stringContaining("sse:feed"),
      sourceId: "sse:feed",
      type: "feed_post",
      detectedAt: expect.any(Number),
      payload: post,
      watermark: { txHash: "tx-new", timestamp: 5000 },
    });
  });

  // ── extractWatermark() tests ──

  it("extractWatermark() returns null for empty snapshot", () => {
    const source = createSSEFeedSource(makeConfig());
    const wm = source.extractWatermark({ timestamp: 0, posts: [], source: "sse" });
    expect(wm).toBeNull();
  });

  it("extractWatermark() returns latest event ID and post info", () => {
    const source = createSSEFeedSource(makeConfig());
    const snapshot: SSESnapshot = {
      timestamp: 5000,
      posts: [
        makeSSEPost({ txHash: "tx-1", timestamp: 100 }),
        makeSSEPost({ txHash: "tx-3", timestamp: 500 }),
        makeSSEPost({ txHash: "tx-2", timestamp: 300 }),
      ],
      source: "sse",
    };
    const wm = source.extractWatermark(snapshot) as {
      latestTxHash: string;
      timestamp: number;
    };
    expect(wm.latestTxHash).toBe("tx-3");
    expect(wm.timestamp).toBe(500);
  });

  // ── auth_expired handling ──

  it("handles auth_expired event by calling getToken()", async () => {
    const getToken = vi.fn()
      .mockResolvedValueOnce("first-token")
      .mockResolvedValueOnce("refreshed-token");

    // First call: stream with auth_expired event
    const encoder = new TextEncoder();
    const authExpiredStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: auth_expired\ndata: {"reason":"token_expired"}\n\n',
          ),
        );
        controller.close();
      },
    });

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: authExpiredStream,
        headers: new Headers(),
      })
      .mockResolvedValueOnce(
        createMockSSEStream([
          { event: "post", data: JSON.stringify(makeSSEPost({ txHash: "tx-after-reauth" })), id: "1" },
        ]),
      );
    vi.stubGlobal("fetch", mockFetch);

    const source = createSSEFeedSource(makeConfig({ getToken }));

    // First poll triggers auth_expired, should reconnect
    const snapshot = await source.poll();

    // getToken called at least twice: initial connect + refresh after auth_expired
    expect(getToken.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  // ── Last-Event-ID reconnection ──

  it("reconnection passes Last-Event-ID header from previous SSE ids", async () => {
    const posts = [makeSSEPost({ txHash: "tx-1" })];
    const mockFetch = createMockFetchForPosts(posts, ["42"]);
    vi.stubGlobal("fetch", mockFetch);

    const source = createSSEFeedSource(makeConfig());

    // First poll — establishes connection, gets event with id: 42
    await source.poll();

    // Second poll — should pass Last-Event-ID: 42
    const posts2 = [makeSSEPost({ txHash: "tx-2" })];
    const mockFetch2 = createMockFetchForPosts(posts2, ["43"]);
    vi.stubGlobal("fetch", mockFetch2);

    await source.poll();

    expect(mockFetch2).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "Last-Event-ID": "42",
        }),
      }),
    );
  });

  // ── SSE parsing edge cases ──

  it("ignores keepalive comments in SSE stream", async () => {
    const encoder = new TextEncoder();
    const streamWithComments = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `: keepalive\n\nevent: post\ndata: ${JSON.stringify(makeSSEPost({ txHash: "tx-real" }))}\nid: 1\n\n: another comment\n\n`,
          ),
        );
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: streamWithComments,
        headers: new Headers(),
      }),
    );

    const source = createSSEFeedSource(makeConfig());
    const snapshot = await source.poll();

    expect(snapshot.posts).toHaveLength(1);
    expect(snapshot.posts[0].txHash).toBe("tx-real");
  });

  it("ignores non-post SSE events (connected, reaction, signal)", async () => {
    const encoder = new TextEncoder();
    const mixedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'event: connected\ndata: {"ts":1234}\n\n',
              `event: post\ndata: ${JSON.stringify(makeSSEPost({ txHash: "tx-keep" }))}\nid: 1\n\n`,
              'event: reaction\ndata: {"postTxHash":"tx-1","type":"agree"}\n\n',
              'event: signal\ndata: [{"type":"bullish"}]\n\n',
            ].join(""),
          ),
        );
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: mixedStream,
        headers: new Headers(),
      }),
    );

    const source = createSSEFeedSource(makeConfig());
    const snapshot = await source.poll();

    // Only post events are collected
    expect(snapshot.posts).toHaveLength(1);
    expect(snapshot.posts[0].txHash).toBe("tx-keep");
  });
});
