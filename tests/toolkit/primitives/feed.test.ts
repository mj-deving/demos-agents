/**
 * Tests for feed domain primitives.
 * TDD: tests written before implementation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockApiClient, createMockDataSource, mockOk, makeScanPost } from "./_helpers.js";

let createFeedPrimitives: typeof import("../../../src/toolkit/primitives/feed.js").createFeedPrimitives;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import("../../../src/toolkit/primitives/feed.js");
  createFeedPrimitives = mod.createFeedPrimitives;
});

describe("feed.getRecent", () => {
  it("delegates to apiClient.getFeed and returns result", async () => {
    const feedData = { posts: [], hasMore: false };
    const client = createMockApiClient({
      getFeed: vi.fn().mockResolvedValue(mockOk(feedData)),
    });
    const feed = createFeedPrimitives({ apiClient: client, dataSource: createMockDataSource() });
    const result = await feed.getRecent({ limit: 10 });

    expect(result).toEqual(mockOk(feedData));
    expect(client.getFeed).toHaveBeenCalledWith({ limit: 10 });
  });

  it("passes category and cursor", async () => {
    const client = createMockApiClient({
      getFeed: vi.fn().mockResolvedValue(mockOk({ posts: [], hasMore: false })),
    });
    const feed = createFeedPrimitives({ apiClient: client, dataSource: createMockDataSource() });
    await feed.getRecent({ limit: 50, category: "SIGNAL", cursor: "abc" });

    expect(client.getFeed).toHaveBeenCalledWith({ limit: 50, category: "SIGNAL", cursor: "abc" });
  });

  it("returns null when API is unreachable", async () => {
    const feed = createFeedPrimitives({ apiClient: createMockApiClient(), dataSource: createMockDataSource() });
    const result = await feed.getRecent();
    expect(result).toBeNull();
  });
});

describe("feed.search", () => {
  it("delegates to apiClient.searchFeed", async () => {
    const feedData = { posts: [], hasMore: false };
    const client = createMockApiClient({
      searchFeed: vi.fn().mockResolvedValue(mockOk(feedData)),
    });
    const feed = createFeedPrimitives({ apiClient: client, dataSource: createMockDataSource() });
    const result = await feed.search({ text: "bitcoin", category: "ANALYSIS" });

    expect(result).toEqual(mockOk(feedData));
    expect(client.searchFeed).toHaveBeenCalledWith({ text: "bitcoin", category: "ANALYSIS" });
  });
});

describe("feed.getPost", () => {
  it("delegates to dataSource.getPostByHash", async () => {
    const post = makeScanPost({ txHash: "0xfeed1" });
    const ds = createMockDataSource({
      getPostByHash: vi.fn().mockResolvedValue(post),
    });
    const feed = createFeedPrimitives({ apiClient: createMockApiClient(), dataSource: ds });
    const result = await feed.getPost("0xfeed1");

    expect(result).not.toBeNull();
    expect(result!.txHash).toBe("0xfeed1");
  });

  it("returns null when post not found", async () => {
    const feed = createFeedPrimitives({ apiClient: createMockApiClient(), dataSource: createMockDataSource() });
    const result = await feed.getPost("0xmissing");
    expect(result).toBeNull();
  });
});

describe("feed.getThread", () => {
  it("delegates to dataSource.getThread", async () => {
    const root = makeScanPost({ txHash: "0xroot" });
    const reply = makeScanPost({ txHash: "0xreply1", replyTo: "0xroot" });
    const ds = createMockDataSource({
      getThread: vi.fn().mockResolvedValue({ root, replies: [reply] }),
    });
    const feed = createFeedPrimitives({ apiClient: createMockApiClient(), dataSource: ds });
    const result = await feed.getThread("0xroot");

    expect(result).not.toBeNull();
    expect(result!.root.txHash).toBe("0xroot");
    expect(result!.replies).toHaveLength(1);
  });

  it("returns null when thread not found", async () => {
    const feed = createFeedPrimitives({ apiClient: createMockApiClient(), dataSource: createMockDataSource() });
    const result = await feed.getThread("0xmissing");
    expect(result).toBeNull();
  });
});

describe("feed.getRss", () => {
  it("delegates to apiClient.getRssFeed", async () => {
    const client = createMockApiClient({
      getRssFeed: vi.fn().mockResolvedValue(mockOk("<feed />")),
    });
    const feed = createFeedPrimitives({ apiClient: client, dataSource: createMockDataSource() });
    const result = await feed.getRss();

    expect(result).toEqual(mockOk("<feed />"));
    expect(client.getRssFeed).toHaveBeenCalled();
  });
});
