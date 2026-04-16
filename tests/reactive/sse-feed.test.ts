import { afterEach, describe, expect, it, vi } from "vitest";

import { createSSEFeedSource } from "../../src/reactive/event-sources/sse-feed.js";
import { makeSSEPost, makeTextStream } from "./test-helpers.js";

describe("createSSEFeedSource", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads SSE posts, refreshes auth on auth_expired, and carries Last-Event-ID forward", async () => {
    vi.spyOn(Date, "now").mockReturnValue(7_777);
    const firstPost = makeSSEPost({ txHash: "tx-1", timestamp: 100 });
    const secondPost = makeSSEPost({ txHash: "tx-2", timestamp: 200 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          makeTextStream(
            ": keepalive\n\n",
            `event: post\nid: 11\ndata: ${JSON.stringify(firstPost)}\n\n`,
            "event: auth_expired\ndata: {}\n\n",
            "event: post\ndata: not-json\n\n",
          ),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          makeTextStream(`event: post\nid: 12\ndata: ${JSON.stringify(secondPost)}\n\n`),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const getToken = vi.fn().mockResolvedValue("token-1");
    const fetchFeedFallback = vi.fn();
    const source = createSSEFeedSource({
      streamUrl: "https://example.com/feed/stream",
      getToken,
      fetchFeedFallback,
      categories: ["news"],
      assets: ["dem"],
      mentions: ["0xagent"],
    });

    await expect(source.poll()).resolves.toEqual({
      timestamp: 7_777,
      posts: [firstPost],
      source: "sse",
    });
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://example.com/feed/stream?categories=news&assets=dem&mentions=0xagent", {
      headers: {
        Authorization: "Bearer token-1",
        Accept: "text/event-stream",
      },
    });

    await source.poll();
    expect(fetchMock.mock.calls[1]?.[1]).toEqual({
      headers: {
        Authorization: "Bearer token-1",
        Accept: "text/event-stream",
        "Last-Event-ID": "11",
      },
    });
  });

  it("falls back to polling when the SSE fetch fails and still emits new posts only", async () => {
    vi.spyOn(Date, "now").mockReturnValue(8_888);
    const fallbackPost = makeSSEPost({ txHash: "fallback-1", timestamp: 300 });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("stream down")));

    const source = createSSEFeedSource({
      streamUrl: "https://example.com/feed/stream",
      getToken: vi.fn().mockResolvedValue("token-1"),
      fetchFeedFallback: vi.fn().mockResolvedValue([fallbackPost]),
    });

    await expect(source.poll()).resolves.toEqual({
      timestamp: 8_888,
      posts: [fallbackPost],
      source: "poll-fallback",
    });

    expect(source.diff(null, { timestamp: 1, posts: [fallbackPost], source: "poll-fallback" })).toEqual([]);
    expect(
      source.diff(
        { timestamp: 1, posts: [fallbackPost], source: "poll-fallback" },
        {
          timestamp: 2,
          posts: [fallbackPost, makeSSEPost({ txHash: "fallback-2", timestamp: 400 })],
          source: "poll-fallback",
        },
      ),
    ).toEqual([
      {
        id: "sse:feed:400:fallback-2",
        sourceId: "sse:feed",
        type: "feed_post",
        detectedAt: 8_888,
        payload: makeSSEPost({ txHash: "fallback-2", timestamp: 400 }),
        watermark: { txHash: "fallback-2", timestamp: 400 },
      },
    ]);
    expect(
      source.extractWatermark({
        timestamp: 2,
        posts: [fallbackPost, makeSSEPost({ txHash: "fallback-2", timestamp: 400 })],
        source: "poll-fallback",
      }),
    ).toEqual({
      latestTxHash: "fallback-2",
      timestamp: 400,
    });
  });

  it("accepts upstream SSE payloads that use cat instead of category", async () => {
    vi.spyOn(Date, "now").mockReturnValue(9_001);
    const upstreamPost = {
      txHash: "tx-cat-shape",
      author: "0xposter",
      timestamp: 321,
      text: "opinion payload",
      cat: "OPINION",
      assets: ["ETH"],
      tags: ["opinion-response"],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          makeTextStream(`event: post\ndata: ${JSON.stringify(upstreamPost)}\n\n`),
          { status: 200 },
        ),
      ),
    );

    const source = createSSEFeedSource({
      streamUrl: "https://example.com/feed/stream",
      getToken: vi.fn().mockResolvedValue("token-1"),
      fetchFeedFallback: vi.fn(),
    });

    const snapshot = await source.poll();

    expect(snapshot).toEqual({
      timestamp: 9_001,
      posts: [
        {
          txHash: "tx-cat-shape",
          author: "0xposter",
          timestamp: 321,
          text: "opinion payload",
          category: "OPINION",
          assets: ["ETH"],
          tags: ["opinion-response"],
        },
      ],
      source: "sse",
    });
    expect(snapshot.posts[0]?.category).toBe("OPINION");
  });

  it("appends mentions filters to the SSE stream URL", async () => {
    vi.spyOn(Date, "now").mockReturnValue(9_500);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(makeTextStream("event: connected\ndata: {}\n\n"), { status: 200 }),
      ),
    );

    const source = createSSEFeedSource({
      streamUrl: "https://example.com/feed/stream",
      getToken: vi.fn().mockResolvedValue("token-1"),
      fetchFeedFallback: vi.fn().mockResolvedValue([]),
      mentions: ["0xabc", "0xdef"],
    });

    await source.poll();

    const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0];
    expect(fetchUrl).toBe("https://example.com/feed/stream?mentions=0xabc%2C0xdef");
  });

  it("rejects when both SSE and fallback retrieval fail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("stream down")));
    const source = createSSEFeedSource({
      streamUrl: "https://example.com/feed/stream",
      getToken: vi.fn().mockResolvedValue("token-1"),
      fetchFeedFallback: vi.fn().mockRejectedValue(new Error("fallback down")),
    });

    await expect(source.poll()).rejects.toThrow("fallback down");
  });

  it("returns fallback immediately on SSE failure and skips SSE during backoff window", async () => {
    vi.useFakeTimers({ now: 10_000 });

    const fetchMock = vi.fn().mockRejectedValue(new Error("stream down"));
    vi.stubGlobal("fetch", fetchMock);

    const fetchFeedFallback = vi.fn().mockResolvedValue([]);
    const source = createSSEFeedSource({
      streamUrl: "https://example.com/feed/stream",
      getToken: vi.fn().mockResolvedValue("token-1"),
      fetchFeedFallback,
      reconnectBackoff: { initialMs: 1_000, maxMs: 8_000, factor: 2 },
    });

    // First failure: fallback returns immediately, SSE disabled for 1s
    await expect(source.poll()).resolves.toMatchObject({ source: "poll-fallback" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchFeedFallback).toHaveBeenCalledTimes(1);

    // Poll within backoff window: SSE not attempted, fallback only
    fetchMock.mockClear();
    fetchFeedFallback.mockClear();
    await expect(source.poll()).resolves.toMatchObject({ source: "poll-fallback" });
    expect(fetchMock).not.toHaveBeenCalled(); // SSE skipped
    expect(fetchFeedFallback).toHaveBeenCalledTimes(1);

    // Advance past backoff window (1s)
    vi.advanceTimersByTime(1_001);
    fetchMock.mockClear();
    fetchFeedFallback.mockClear();

    // SSE attempted again (still fails), backoff now 2s
    await expect(source.poll()).resolves.toMatchObject({ source: "poll-fallback" });
    expect(fetchMock).toHaveBeenCalledTimes(1); // SSE retried
  });

  it("resets reconnect backoff after a successful SSE read", async () => {
    vi.useFakeTimers({ now: 10_000 });

    const successPost = makeSSEPost({ txHash: "tx-success", timestamp: 500 });
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("stream down"))
      .mockResolvedValueOnce(
        new Response(
          makeTextStream(`event: post\nid: 12\ndata: ${JSON.stringify(successPost)}\n\n`),
          { status: 200 },
        ),
      )
      .mockRejectedValueOnce(new Error("stream down again"));
    vi.stubGlobal("fetch", fetchMock);

    const fetchFeedFallback = vi.fn().mockResolvedValue([]);
    const source = createSSEFeedSource({
      streamUrl: "https://example.com/feed/stream",
      getToken: vi.fn().mockResolvedValue("token-1"),
      fetchFeedFallback,
      reconnectBackoff: { initialMs: 1_000, maxMs: 8_000, factor: 2 },
    });

    // First failure: fallback immediate, SSE disabled for 1s
    await expect(source.poll()).resolves.toMatchObject({ source: "poll-fallback" });
    expect(fetchFeedFallback).toHaveBeenCalledTimes(1);

    // Advance past 1s backoff
    vi.advanceTimersByTime(1_001);

    // Second poll: SSE succeeds — resets backoff
    await expect(source.poll()).resolves.toEqual({
      timestamp: expect.any(Number),
      posts: [successPost],
      source: "sse",
    });

    // Third poll: SSE fails again — backoff should be 1s (reset), not 2s
    fetchFeedFallback.mockClear();
    await expect(source.poll()).resolves.toMatchObject({ source: "poll-fallback" });
    expect(fetchFeedFallback).toHaveBeenCalledTimes(1);

    // Verify SSE is skipped within 1s window but retried after
    fetchMock.mockClear();
    await source.poll(); // within window — SSE skipped
    expect(fetchMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_001);
    fetchMock.mockRejectedValueOnce(new Error("still down"));
    await source.poll(); // past window — SSE retried
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
