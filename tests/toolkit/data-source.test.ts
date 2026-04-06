/**
 * Tests for DataSource abstraction — API/chain routing with fallback.
 * TDD: tests written before implementation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScanPost } from "../../src/toolkit/types.js";
import type { ApiResult, FeedResponse, PostDetail, ThreadResponse } from "../../src/toolkit/supercolony/types.js";
import type { SuperColonyApiClient } from "../../src/toolkit/supercolony/api-client.js";
import type { ChainReaderRpc } from "../../src/toolkit/chain-reader.js";

// ── Helpers ─────────────────────────────────────

function makeFeedPost(overrides: Record<string, unknown> = {}): FeedResponse["posts"][0] {
  return {
    txHash: "0xabc123",
    author: "0xauthor1",
    timestamp: 1700000000000,
    payload: {
      cat: "ANALYSIS",
      text: "Test post content",
      tags: ["test"],
      confidence: 0.8,
    },
    replyDepth: 0,
    score: 75,
    reactions: { agree: 10, disagree: 2, flag: 0 },
    ...overrides,
  } as FeedResponse["posts"][0];
}

function makeChainPost(overrides: Partial<ScanPost> = {}): ScanPost {
  return {
    txHash: "0xchain1",
    text: "Chain post",
    category: "ANALYSIS",
    author: "0xauthor1",
    timestamp: 1700000000000,
    reactions: { agree: 0, disagree: 0 },
    reactionsKnown: false,
    tags: ["test"],
    blockNumber: 100,
    ...overrides,
  };
}

function mockApiClient(overrides: Partial<SuperColonyApiClient> = {}): SuperColonyApiClient {
  return {
    getFeed: vi.fn().mockResolvedValue(null),
    getPostDetail: vi.fn().mockResolvedValue(null),
    getThread: vi.fn().mockResolvedValue(null),
    searchFeed: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as SuperColonyApiClient;
}

function mockChainRpc(overrides: Partial<ChainReaderRpc> = {}): ChainReaderRpc {
  return {
    getTransactions: vi.fn().mockResolvedValue([]),
    getTxByHash: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────

// Import will be from implementation file
let ApiDataSource: typeof import("../../src/toolkit/data-source.js").ApiDataSource;
let ChainDataSource: typeof import("../../src/toolkit/data-source.js").ChainDataSource;
let AutoDataSource: typeof import("../../src/toolkit/data-source.js").AutoDataSource;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import("../../src/toolkit/data-source.js");
  ApiDataSource = mod.ApiDataSource;
  ChainDataSource = mod.ChainDataSource;
  AutoDataSource = mod.AutoDataSource;
});

// ── ApiDataSource ───────────────────────────────

describe("ApiDataSource", () => {
  it("has name 'api'", () => {
    const ds = new ApiDataSource(mockApiClient());
    expect(ds.name).toBe("api");
  });

  it("normalizes FeedResponse posts into ScanPost shape", async () => {
    const feedPost = makeFeedPost();
    const client = mockApiClient({
      getFeed: vi.fn().mockResolvedValue({
        ok: true,
        data: { posts: [feedPost], hasMore: false },
      } satisfies ApiResult<FeedResponse>),
    });
    const ds = new ApiDataSource(client);
    const posts = await ds.getRecentPosts(10);

    expect(posts).toHaveLength(1);
    expect(posts[0].txHash).toBe("0xabc123");
    expect(posts[0].author).toBe("0xauthor1");
    expect(posts[0].text).toBe("Test post content");
    expect(posts[0].category).toBe("ANALYSIS");
    expect(posts[0].reactions).toEqual({ agree: 10, disagree: 2 });
    expect(posts[0].reactionsKnown).toBe(true);
    expect(posts[0].tags).toEqual(["test"]);
  });

  it("passes category filter to getFeed", async () => {
    const client = mockApiClient({
      getFeed: vi.fn().mockResolvedValue({
        ok: true,
        data: { posts: [], hasMore: false },
      }),
    });
    const ds = new ApiDataSource(client);
    await ds.getRecentPosts(10, { category: "SIGNAL" });

    expect(client.getFeed).toHaveBeenCalledWith(
      expect.objectContaining({ category: "SIGNAL", limit: 10 }),
    );
  });

  it("returns empty array when API returns null", async () => {
    const ds = new ApiDataSource(mockApiClient());
    const posts = await ds.getRecentPosts(10);
    expect(posts).toEqual([]);
  });

  it("returns empty array when API returns error", async () => {
    const client = mockApiClient({
      getFeed: vi.fn().mockResolvedValue({ ok: false, status: 500, error: "fail" }),
    });
    const ds = new ApiDataSource(client);
    const posts = await ds.getRecentPosts(10);
    expect(posts).toEqual([]);
  });

  it("normalizes PostDetail into ScanPost", async () => {
    const client = mockApiClient({
      getPostDetail: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          post: {
            txHash: "0xdetail1",
            author: "0xauthor2",
            timestamp: 1700000000000,
            payload: { cat: "OBSERVATION", text: "Detail post" },
          },
          replies: [],
        } satisfies PostDetail,
      }),
    });
    const ds = new ApiDataSource(client);
    const post = await ds.getPostByHash("0xdetail1");

    expect(post).not.toBeNull();
    expect(post!.txHash).toBe("0xdetail1");
    expect(post!.text).toBe("Detail post");
    expect(post!.category).toBe("OBSERVATION");
  });

  it("returns null when getPostDetail fails", async () => {
    const ds = new ApiDataSource(mockApiClient());
    const post = await ds.getPostByHash("0xmissing");
    expect(post).toBeNull();
  });

  it("normalizes ThreadResponse into root + replies", async () => {
    const client = mockApiClient({
      getThread: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          root: { txHash: "0xroot1", author: "0xa1", timestamp: 1700000000000, payload: { cat: "QUESTION", text: "Root question" } },
          replies: [
            { txHash: "0xreply1", author: "0xa2", timestamp: 1700000001000, payload: { cat: "ANALYSIS", text: "Reply" } },
          ],
        },
      }),
    });
    const ds = new ApiDataSource(client);
    const thread = await ds.getThread("0xroot1");

    expect(thread).not.toBeNull();
    expect(thread!.root.txHash).toBe("0xroot1");
    expect(thread!.root.text).toBe("Root question");
    expect(thread!.replies).toHaveLength(1);
    expect(thread!.replies[0].txHash).toBe("0xreply1");
  });

  it("returns null when getThread fails", async () => {
    const ds = new ApiDataSource(mockApiClient());
    const thread = await ds.getThread("0xmissing");
    expect(thread).toBeNull();
  });
});

// ── ChainDataSource ─────────────────────────────

describe("ChainDataSource", () => {
  it("has name 'chain'", async () => {
    // ChainDataSource wraps chain-reader functions — we mock the module
    const ds = new ChainDataSource(mockChainRpc());
    expect(ds.name).toBe("chain");
  });

  it("delegates getRecentPosts to chain-reader getHivePosts", async () => {
    const chainPost = makeChainPost();
    // We need to mock chain-reader at module level
    const rpc = mockChainRpc({
      getTransactions: vi.fn().mockResolvedValue([]),
    });
    const ds = new ChainDataSource(rpc, {
      getHivePosts: vi.fn().mockResolvedValue([chainPost]),
    });
    const posts = await ds.getRecentPosts(10);

    expect(posts).toHaveLength(1);
    expect(posts[0].txHash).toBe("0xchain1");
    expect(posts[0].reactionsKnown).toBe(false);
  });

  it("returns empty array when chain returns nothing", async () => {
    const ds = new ChainDataSource(mockChainRpc(), {
      getHivePosts: vi.fn().mockResolvedValue([]),
    });
    const posts = await ds.getRecentPosts(10);
    expect(posts).toEqual([]);
  });
});

// ── AutoDataSource ──────────────────────────────

describe("AutoDataSource", () => {
  it("has name 'auto'", () => {
    const ds = new AutoDataSource(
      new ApiDataSource(mockApiClient()),
      new ChainDataSource(mockChainRpc(), { getHivePosts: vi.fn().mockResolvedValue([]) }),
    );
    expect(ds.name).toBe("auto");
  });

  it("uses API when available, does not call chain", async () => {
    const apiPost = makeFeedPost({ txHash: "0xapi1" });
    const apiClient = mockApiClient({
      getFeed: vi.fn().mockResolvedValue({
        ok: true,
        data: { posts: [apiPost], hasMore: false },
      }),
    });

    const chainFn = vi.fn().mockResolvedValue([makeChainPost()]);
    const ds = new AutoDataSource(
      new ApiDataSource(apiClient),
      new ChainDataSource(mockChainRpc(), { getHivePosts: chainFn }),
    );

    const posts = await ds.getRecentPosts(10);

    expect(posts).toHaveLength(1);
    expect(posts[0].txHash).toBe("0xapi1");
    expect(chainFn).not.toHaveBeenCalled();
  });

  it("falls back to chain when API returns empty", async () => {
    const apiClient = mockApiClient({
      getFeed: vi.fn().mockResolvedValue(null),
    });

    const chainPost = makeChainPost({ txHash: "0xfallback1" });
    const chainFn = vi.fn().mockResolvedValue([chainPost]);
    const ds = new AutoDataSource(
      new ApiDataSource(apiClient),
      new ChainDataSource(mockChainRpc(), { getHivePosts: chainFn }),
    );

    const posts = await ds.getRecentPosts(10);

    expect(posts).toHaveLength(1);
    expect(posts[0].txHash).toBe("0xfallback1");
    expect(chainFn).toHaveBeenCalled();
  });

  it("falls back to chain when API returns error", async () => {
    const apiClient = mockApiClient({
      getFeed: vi.fn().mockResolvedValue({ ok: false, status: 500, error: "fail" }),
    });

    const chainPost = makeChainPost({ txHash: "0xfallback2" });
    const chainFn = vi.fn().mockResolvedValue([chainPost]);
    const ds = new AutoDataSource(
      new ApiDataSource(apiClient),
      new ChainDataSource(mockChainRpc(), { getHivePosts: chainFn }),
    );

    const posts = await ds.getRecentPosts(10);

    expect(posts).toHaveLength(1);
    expect(posts[0].txHash).toBe("0xfallback2");
  });

  it("falls back for getPostByHash when API fails", async () => {
    const apiClient = mockApiClient();
    const chainPost = makeChainPost({ txHash: "0xdetail-chain" });
    const ds = new AutoDataSource(
      new ApiDataSource(apiClient),
      new ChainDataSource(mockChainRpc(), {
        getHivePosts: vi.fn().mockResolvedValue([]),
        getPostByHash: vi.fn().mockResolvedValue(chainPost),
      }),
    );

    const post = await ds.getPostByHash("0xdetail-chain");
    expect(post).not.toBeNull();
    expect(post!.txHash).toBe("0xdetail-chain");
  });

  it("falls back for getThread when API fails", async () => {
    const apiClient = mockApiClient();
    const root = makeChainPost({ txHash: "0xthread-root" });
    const reply = makeChainPost({ txHash: "0xthread-reply", replyTo: "0xthread-root" });
    const ds = new AutoDataSource(
      new ApiDataSource(apiClient),
      new ChainDataSource(mockChainRpc(), {
        getHivePosts: vi.fn().mockResolvedValue([]),
        getThread: vi.fn().mockResolvedValue({ root, replies: [reply] }),
      }),
    );

    const thread = await ds.getThread("0xthread-root");
    expect(thread).not.toBeNull();
    expect(thread!.root.txHash).toBe("0xthread-root");
    expect(thread!.replies).toHaveLength(1);
  });

  it("returns null when both API and chain fail for getPostByHash", async () => {
    const ds = new AutoDataSource(
      new ApiDataSource(mockApiClient()),
      new ChainDataSource(mockChainRpc(), {
        getHivePosts: vi.fn().mockResolvedValue([]),
        getPostByHash: vi.fn().mockResolvedValue(null),
      }),
    );

    const post = await ds.getPostByHash("0xghost");
    expect(post).toBeNull();
  });
});
