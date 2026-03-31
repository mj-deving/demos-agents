import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getPost, getPostsByAuthor, getRecentPosts, getRepliesTo, insertPost, countPosts } from "../../../src/toolkit/colony/posts.js";
import { initColonyCache } from "../../../src/toolkit/colony/schema.js";

describe("colony posts", () => {
  let db: ReturnType<typeof initColonyCache>;

  beforeEach(() => {
    db = initColonyCache(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("inserts and retrieves a cached post", () => {
    insertPost(db, {
      txHash: "0xpost-1",
      author: "demos1alice",
      blockNumber: 101,
      timestamp: "2026-03-31T10:00:00.000Z",
      replyTo: null,
      tags: ["bitcoin", "mining"],
      text: "Bitcoin hash rate is climbing.",
      rawData: { kind: "post", score: 1 },
    });

    expect(getPost(db, "0xpost-1")).toEqual({
      txHash: "0xpost-1",
      author: "demos1alice",
      blockNumber: 101,
      timestamp: "2026-03-31T10:00:00.000Z",
      replyTo: null,
      tags: ["bitcoin", "mining"],
      text: "Bitcoin hash rate is climbing.",
      rawData: { kind: "post", score: 1 },
    });
  });

  it("queries posts by author, recency, replies, and count", () => {
    insertPost(db, {
      txHash: "0xroot-1",
      author: "demos1alice",
      blockNumber: 100,
      timestamp: "2026-03-31T09:00:00.000Z",
      replyTo: null,
      tags: ["macro"],
      text: "Root post",
      rawData: { id: 1 },
    });
    insertPost(db, {
      txHash: "0xreply-1",
      author: "demos1bob",
      blockNumber: 101,
      timestamp: "2026-03-31T09:05:00.000Z",
      replyTo: "0xroot-1",
      tags: ["macro"],
      text: "First reply",
      rawData: { id: 2 },
    });
    insertPost(db, {
      txHash: "0xroot-2",
      author: "demos1alice",
      blockNumber: 102,
      timestamp: "2026-03-31T09:10:00.000Z",
      replyTo: null,
      tags: ["defi"],
      text: "Second root",
      rawData: { id: 3 },
    });

    expect(getPostsByAuthor(db, "demos1alice", 1).map((post) => post.txHash)).toEqual(["0xroot-2"]);
    expect(getRecentPosts(db, "2026-03-31T09:04:00.000Z").map((post) => post.txHash)).toEqual([
      "0xroot-2",
      "0xreply-1",
    ]);
    expect(getRepliesTo(db, "0xroot-1").map((post) => post.txHash)).toEqual(["0xreply-1"]);
    expect(countPosts(db)).toBe(3);
  });
});
