import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────

const { apiCallMock } = vi.hoisted(() => ({
  apiCallMock: vi.fn(),
}));

vi.mock("../src/lib/sdk.js", () => ({
  apiCall: apiCallMock,
  info: vi.fn(),
}));

vi.mock("../src/lib/observe.js", () => ({
  observe: vi.fn(),
}));

import {
  filterPosts,
  combinedTopicSearch,
  buildTopicIndex,
  buildAgentIndex,
  type QualityFilter,
  type FilteredPost,
} from "../src/lib/feed-filter.js";

// ── Helpers ──────────────────────────────────────

function makeRawPost(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    txHash: "0xabc123",
    author: "0xAgent1",
    timestamp: 1710000000000,
    score: 85,
    reactions: { agree: 5, disagree: 1 },
    payload: {
      text: "Bitcoin ETF inflows reached $1.2B this week with significant institutional participation across multiple venues.",
      tags: ["bitcoin", "etf"],
      assets: ["BTC"],
      cat: "ANALYSIS",
      sourceAttestations: [{ source: "coingecko" }],
    },
    ...overrides,
  };
}

function makeFilter(overrides: Partial<QualityFilter> = {}): QualityFilter {
  return {
    minScore: 70,
    requireAttestation: false,
    ...overrides,
  };
}

function makeFilteredPost(overrides: Partial<FilteredPost> = {}): FilteredPost {
  return {
    txHash: "0xabc123",
    author: "0xagent1",
    timestamp: 1710000000000,
    score: 85,
    category: "ANALYSIS",
    tags: ["bitcoin", "etf"],
    assets: ["BTC"],
    hasAttestation: true,
    reactions: { agree: 5, disagree: 1 },
    textPreview: "Bitcoin ETF inflows reached $1.2B this week with significant institutional participation across multiple venues.",
    ...overrides,
  };
}

// ── filterPosts ──────────────────────────────────

describe("filterPosts", () => {
  it("filters posts meeting quality threshold", () => {
    const posts = [makeRawPost({ score: 85 }), makeRawPost({ txHash: "0xdef456", score: 50 })];
    const result = filterPosts(posts, makeFilter({ minScore: 70 }));

    expect(result).toHaveLength(1);
    expect(result[0].txHash).toBe("0xabc123");
  });

  it("skips posts without txHash", () => {
    const posts = [makeRawPost({ txHash: "" }), makeRawPost({ txHash: undefined })];
    const result = filterPosts(posts, makeFilter());

    expect(result).toHaveLength(0);
  });

  it("skips posts without author", () => {
    const post = makeRawPost({ author: "", address: undefined, agent: undefined });
    const result = filterPosts([post], makeFilter());

    expect(result).toHaveLength(0);
  });

  it("excludes posts from excluded authors (case-insensitive)", () => {
    const posts = [
      makeRawPost({ author: "0xAgent1" }),
      makeRawPost({ txHash: "0xdef456", author: "0xAgent2" }),
    ];
    const result = filterPosts(posts, makeFilter({ excludeAuthors: ["0xagent1"] }));

    expect(result).toHaveLength(1);
    expect(result[0].author).toBe("0xagent2");
  });

  it("filters by attestation when requireAttestation is true", () => {
    const attested = makeRawPost();
    const unattested = makeRawPost({
      txHash: "0xdef456",
      author: "0xAgent2",
      payload: { text: "No attestation here", tags: [], assets: [], cat: "OPINION" },
    });

    const result = filterPosts([attested, unattested], makeFilter({ requireAttestation: true }));

    expect(result).toHaveLength(1);
    expect(result[0].hasAttestation).toBe(true);
  });

  it("reads author from agent.address fallback", () => {
    const post = makeRawPost({
      author: undefined,
      address: undefined,
      agent: { address: "0xNestedAgent" },
    });
    const result = filterPosts([post], makeFilter());

    expect(result).toHaveLength(1);
    expect(result[0].author).toBe("0xnestedagent");
  });

  it("reads score from qualityScore fallback", () => {
    const post = makeRawPost({ score: undefined, qualityScore: 90 });
    const result = filterPosts([post], makeFilter({ minScore: 85 }));

    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(90);
  });

  it("TLSN attestations do NOT count for scoring (only DAHR does)", () => {
    const post = makeRawPost({
      payload: {
        text: "TLSN attested post content here for testing purposes, must be long enough for preview field.",
        tags: ["test"],
        assets: [],
        cat: "ANALYSIS",
        sourceAttestations: [],
        tlsnAttestations: [{ proof: "abc" }],
      },
    });
    const result = filterPosts([post], makeFilter());

    expect(result).toHaveLength(1);
    expect(result[0].hasAttestation).toBe(false);
  });

  it("handles null/undefined rawPosts gracefully", () => {
    expect(filterPosts(null as any, makeFilter())).toEqual([]);
    expect(filterPosts(undefined as any, makeFilter())).toEqual([]);
  });

  it("lowercases author for consistency", () => {
    const post = makeRawPost({ author: "0xMiXeDcAsE" });
    const result = filterPosts([post], makeFilter());

    expect(result[0].author).toBe("0xmixedcase");
  });
});

// ── combinedTopicSearch ──────────────────────────

describe("combinedTopicSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("merges results from asset and text search endpoints", async () => {
    const fetchFeed = vi.fn()
      .mockResolvedValueOnce([makeRawPost({ txHash: "0x1" })])
      .mockResolvedValueOnce([makeRawPost({ txHash: "0x2", author: "0xAgent2" })]);

    const result = await combinedTopicSearch(
      "bitcoin",
      "token123",
      makeFilter(),
      undefined,
      { fetchFeed }
    );

    expect(result).toHaveLength(2);
    expect(fetchFeed).toHaveBeenCalledTimes(2);
    expect(fetchFeed.mock.calls[0][0]).toContain("asset=bitcoin");
    expect(fetchFeed.mock.calls[1][0]).toContain("text=bitcoin");
  });

  it("deduplicates posts by txHash across endpoints", async () => {
    const post = makeRawPost({ txHash: "0xSame" });
    const fetchFeed = vi.fn()
      .mockResolvedValueOnce([post])
      .mockResolvedValueOnce([post]);

    const result = await combinedTopicSearch(
      "bitcoin",
      "token123",
      makeFilter(),
      undefined,
      { fetchFeed }
    );

    expect(result).toHaveLength(1);
    expect(result[0].txHash).toBe("0xSame");
  });

  it("falls back to broad pool when both searches return empty", async () => {
    const fetchFeed = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const broadPool = [
      makeRawPost({
        txHash: "0xBroad1",
        payload: {
          text: "Bitcoin analysis content for matching",
          tags: ["bitcoin"],
          assets: ["BTC"],
          cat: "ANALYSIS",
          sourceAttestations: [{ source: "test" }],
        },
      }),
    ];

    const result = await combinedTopicSearch(
      "bitcoin",
      "token123",
      makeFilter(),
      broadPool,
      { fetchFeed }
    );

    expect(result).toHaveLength(1);
    expect(result[0].txHash).toBe("0xBroad1");
  });

  it("returns empty array when topic is empty string", async () => {
    const result = await combinedTopicSearch("", "token123", makeFilter());

    expect(result).toEqual([]);
  });

  it("returns empty when both searches fail and no broad pool", async () => {
    const fetchFeed = vi.fn().mockRejectedValue(new Error("network error"));

    const result = await combinedTopicSearch(
      "bitcoin",
      "token123",
      makeFilter(),
      undefined,
      { fetchFeed }
    );

    expect(result).toEqual([]);
  });

  it("accepts broad pool as async function", async () => {
    const fetchFeed = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const broadPoolFn = vi.fn().mockResolvedValue([
      makeRawPost({
        txHash: "0xFromFn",
        payload: {
          text: "Ethereum content",
          tags: ["ethereum"],
          assets: ["ETH"],
          cat: "ANALYSIS",
          sourceAttestations: [{ source: "test" }],
        },
      }),
    ]);

    const result = await combinedTopicSearch(
      "ethereum",
      "token123",
      makeFilter(),
      broadPoolFn,
      { fetchFeed }
    );

    expect(broadPoolFn).toHaveBeenCalledOnce();
    expect(result).toHaveLength(1);
    expect(result[0].txHash).toBe("0xFromFn");
  });

  it("calls onRawResults callback for each search source", async () => {
    const assetResults = [makeRawPost({ txHash: "0x1" })];
    const textResults = [makeRawPost({ txHash: "0x2", author: "0xAgent2" })];
    const fetchFeed = vi.fn()
      .mockResolvedValueOnce(assetResults)
      .mockResolvedValueOnce(textResults);

    const onRawResults = vi.fn();

    await combinedTopicSearch(
      "bitcoin",
      "token123",
      makeFilter(),
      undefined,
      { fetchFeed, onRawResults }
    );

    expect(onRawResults).toHaveBeenCalledTimes(2);
    expect(onRawResults).toHaveBeenCalledWith("asset", assetResults);
    expect(onRawResults).toHaveBeenCalledWith("text", textResults);
  });
});

// ── buildTopicIndex ──────────────────────────────

describe("buildTopicIndex", () => {
  it("builds stats from tags and assets", () => {
    const posts: FilteredPost[] = [
      makeFilteredPost({ tags: ["bitcoin"], assets: ["BTC"], score: 80, reactions: { agree: 5, disagree: 2 } }),
      makeFilteredPost({ txHash: "0xdef456", author: "0xagent2", tags: ["bitcoin"], assets: [], score: 90, reactions: { agree: 10, disagree: 0 } }),
    ];

    const index = buildTopicIndex(posts);
    const btcStats = index.get("bitcoin");

    expect(btcStats).toBeDefined();
    expect(btcStats!.count).toBe(2);
    expect(btcStats!.totalReactions).toBe(17); // 5+2 + 10+0
    expect(btcStats!.uniqueAuthors.size).toBe(2);
    expect(btcStats!.avgScore).toBe(85); // (80+90)/2
  });

  it("uses category as fallback when no tags or assets", () => {
    const posts: FilteredPost[] = [
      makeFilteredPost({ tags: [], assets: [], category: "ANALYSIS", score: 75 }),
    ];

    const index = buildTopicIndex(posts);

    expect(index.has("analysis")).toBe(true);
    expect(index.get("analysis")!.count).toBe(1);
  });

  it("tracks attested count correctly", () => {
    const posts: FilteredPost[] = [
      makeFilteredPost({ tags: ["defi"], hasAttestation: true }),
      makeFilteredPost({ txHash: "0x2", author: "0xa2", tags: ["defi"], hasAttestation: false }),
      makeFilteredPost({ txHash: "0x3", author: "0xa3", tags: ["defi"], hasAttestation: true }),
    ];

    const index = buildTopicIndex(posts);

    expect(index.get("defi")!.attestedCount).toBe(2);
  });

  it("tracks newest timestamp", () => {
    const posts: FilteredPost[] = [
      makeFilteredPost({ tags: ["nft"], timestamp: 1000 }),
      makeFilteredPost({ txHash: "0x2", author: "0xa2", tags: ["nft"], timestamp: 3000 }),
      makeFilteredPost({ txHash: "0x3", author: "0xa3", tags: ["nft"], timestamp: 2000 }),
    ];

    const index = buildTopicIndex(posts);

    expect(index.get("nft")!.newestTimestamp).toBe(3000);
  });

  it("returns empty map for empty input", () => {
    const index = buildTopicIndex([]);
    expect(index.size).toBe(0);
  });
});

// ── buildAgentIndex ──────────────────────────────

describe("buildAgentIndex", () => {
  it("aggregates per-agent stats", () => {
    const posts: FilteredPost[] = [
      makeFilteredPost({ author: "0xagent1", score: 80, hasAttestation: true }),
      makeFilteredPost({ txHash: "0x2", author: "0xagent1", score: 90, hasAttestation: true }),
      makeFilteredPost({ txHash: "0x3", author: "0xagent2", score: 70, hasAttestation: false }),
    ];

    const index = buildAgentIndex(posts);

    expect(index.size).toBe(2);

    const agent1 = index.get("0xagent1")!;
    expect(agent1.postCount).toBe(2);
    expect(agent1.avgScore).toBe(85); // (80+90)/2
    expect(agent1.attestationRate).toBe(1); // 2/2

    const agent2 = index.get("0xagent2")!;
    expect(agent2.postCount).toBe(1);
    expect(agent2.avgScore).toBe(70);
    expect(agent2.attestationRate).toBe(0); // 0/1
  });

  it("lowercases agent addresses as keys", () => {
    const posts: FilteredPost[] = [
      makeFilteredPost({ author: "0xMiXeD" }),
    ];

    const index = buildAgentIndex(posts);

    expect(index.has("0xmixed")).toBe(true);
  });

  it("returns empty map for empty input", () => {
    const index = buildAgentIndex([]);
    expect(index.size).toBe(0);
  });

  it("calculates attestation rate as fraction", () => {
    const posts: FilteredPost[] = [
      makeFilteredPost({ author: "0xa", hasAttestation: true }),
      makeFilteredPost({ txHash: "0x2", author: "0xa", hasAttestation: false }),
      makeFilteredPost({ txHash: "0x3", author: "0xa", hasAttestation: true }),
    ];

    const index = buildAgentIndex(posts);
    const agent = index.get("0xa")!;

    expect(agent.attestationRate).toBeCloseTo(0.667, 2);
  });

  it("includes address field in each AgentStats entry", () => {
    const posts: FilteredPost[] = [makeFilteredPost({ author: "0xtest" })];
    const index = buildAgentIndex(posts);

    expect(index.get("0xtest")!.address).toBe("0xtest");
  });
});
