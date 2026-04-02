import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initColonyCache } from "../../../src/toolkit/colony/schema.js";
import { insertPost } from "../../../src/toolkit/colony/posts.js";
import { searchPosts } from "../../../src/toolkit/colony/search.js";

describe("colony FTS5 search", () => {
  let db: ReturnType<typeof initColonyCache>;

  beforeEach(() => {
    db = initColonyCache(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("searchPosts returns matching posts by text content", () => {
    insertPost(db, {
      txHash: "0xaaa",
      author: "alice",
      blockNumber: 100,
      timestamp: "2026-01-01T00:00:00Z",
      replyTo: null,
      tags: [],
      text: "Bitcoin is reaching new highs today",
      rawData: {},
    });
    insertPost(db, {
      txHash: "0xbbb",
      author: "bob",
      blockNumber: 101,
      timestamp: "2026-01-01T01:00:00Z",
      replyTo: null,
      tags: [],
      text: "Ethereum staking yields are improving",
      rawData: {},
    });
    insertPost(db, {
      txHash: "0xccc",
      author: "carol",
      blockNumber: 102,
      timestamp: "2026-01-01T02:00:00Z",
      replyTo: null,
      tags: [],
      text: "The weather is nice today",
      rawData: {},
    });

    const results = searchPosts(db, "Bitcoin");
    expect(results).toHaveLength(1);
    expect(results[0].txHash).toBe("0xaaa");
    expect(results[0].author).toBe("alice");
  });

  it("searchPosts filters by author when provided", () => {
    insertPost(db, {
      txHash: "0xd01",
      author: "alice",
      blockNumber: 200,
      timestamp: "2026-02-01T00:00:00Z",
      replyTo: null,
      tags: [],
      text: "Market analysis shows strong growth",
      rawData: {},
    });
    insertPost(db, {
      txHash: "0xd02",
      author: "bob",
      blockNumber: 201,
      timestamp: "2026-02-01T01:00:00Z",
      replyTo: null,
      tags: [],
      text: "Market trends indicate strong recovery",
      rawData: {},
    });

    const allMarket = searchPosts(db, "strong");
    expect(allMarket).toHaveLength(2);

    const aliceOnly = searchPosts(db, "strong", { author: "alice" });
    expect(aliceOnly).toHaveLength(1);
    expect(aliceOnly[0].txHash).toBe("0xd01");
    expect(aliceOnly[0].author).toBe("alice");
  });

  it("searchPosts respects limit", () => {
    for (let i = 0; i < 5; i++) {
      insertPost(db, {
        txHash: `0xlimit${i}`,
        author: "dave",
        blockNumber: 300 + i,
        timestamp: `2026-03-01T0${i}:00:00Z`,
        replyTo: null,
        tags: [],
        text: `DeFi protocol update number ${i}`,
        rawData: {},
      });
    }

    const results = searchPosts(db, "DeFi", { limit: 2 });
    expect(results).toHaveLength(2);
  });

  it("searchPosts returns empty array for no matches", () => {
    insertPost(db, {
      txHash: "0xno1",
      author: "eve",
      blockNumber: 400,
      timestamp: "2026-04-01T00:00:00Z",
      replyTo: null,
      tags: [],
      text: "Nothing relevant here",
      rawData: {},
    });

    const results = searchPosts(db, "xyznonexistent");
    expect(results).toHaveLength(0);
    expect(results).toEqual([]);
  });

  it("searchPosts matches on tags field", () => {
    insertPost(db, {
      txHash: "0xtag1",
      author: "frank",
      blockNumber: 500,
      timestamp: "2026-05-01T00:00:00Z",
      replyTo: null,
      tags: ["cryptocurrency", "defi", "staking"],
      text: "A simple post about returns",
      rawData: {},
    });
    insertPost(db, {
      txHash: "0xtag2",
      author: "grace",
      blockNumber: 501,
      timestamp: "2026-05-01T01:00:00Z",
      replyTo: null,
      tags: ["weather", "forecast"],
      text: "A simple post about climate",
      rawData: {},
    });

    const results = searchPosts(db, "cryptocurrency");
    expect(results).toHaveLength(1);
    expect(results[0].txHash).toBe("0xtag1");
    expect(results[0].tags).toContain("cryptocurrency");
  });

  it("FTS5 triggers sync correctly on insert", () => {
    // Insert a post and immediately verify FTS finds it (trigger fired)
    insertPost(db, {
      txHash: "0xsync1",
      author: "hank",
      blockNumber: 600,
      timestamp: "2026-06-01T00:00:00Z",
      replyTo: null,
      tags: [],
      text: "Synchronization verification test content",
      rawData: {},
    });

    const results = searchPosts(db, "Synchronization");
    expect(results).toHaveLength(1);
    expect(results[0].txHash).toBe("0xsync1");
    expect(results[0].text).toContain("Synchronization");
  });
});
