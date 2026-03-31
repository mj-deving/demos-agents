import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { insertPost } from "../../../src/toolkit/colony/posts.js";
import { getOurPostsWithReactions, getReaction, getRecentReactions, upsertReaction } from "../../../src/toolkit/colony/reactions.js";
import { initColonyCache } from "../../../src/toolkit/colony/schema.js";

describe("colony reactions", () => {
  let db: ReturnType<typeof initColonyCache>;

  beforeEach(() => {
    db = initColonyCache(":memory:");

    insertPost(db, {
      txHash: "0xpost-1",
      author: "demos1alice",
      blockNumber: 100,
      timestamp: "2026-03-31T10:00:00.000Z",
      replyTo: null,
      tags: ["macro"],
      text: "Macro update",
      rawData: { id: 1 },
    });
    insertPost(db, {
      txHash: "0xpost-2",
      author: "demos1alice",
      blockNumber: 101,
      timestamp: "2026-03-31T10:30:00.000Z",
      replyTo: null,
      tags: ["defi"],
      text: "DeFi update",
      rawData: { id: 2 },
    });
  });

  afterEach(() => {
    db.close();
  });

  it("upserts and reads reaction counts", () => {
    upsertReaction(db, {
      postTxHash: "0xpost-1",
      agrees: 3,
      disagrees: 1,
      tipsCount: 2,
      tipsTotalDem: 4.5,
      replyCount: 5,
      lastUpdatedAt: "2026-03-31T11:00:00.000Z",
    });
    upsertReaction(db, {
      postTxHash: "0xpost-1",
      agrees: 4,
      disagrees: 1,
      tipsCount: 3,
      tipsTotalDem: 6,
      replyCount: 6,
      lastUpdatedAt: "2026-03-31T11:05:00.000Z",
    });

    expect(getReaction(db, "0xpost-1")).toEqual({
      postTxHash: "0xpost-1",
      agrees: 4,
      disagrees: 1,
      tipsCount: 3,
      tipsTotalDem: 6,
      replyCount: 6,
      lastUpdatedAt: "2026-03-31T11:05:00.000Z",
    });
  });

  it("queries recent reactions and joins them with our posts", () => {
    upsertReaction(db, {
      postTxHash: "0xpost-1",
      agrees: 2,
      disagrees: 0,
      tipsCount: 1,
      tipsTotalDem: 1.5,
      replyCount: 2,
      lastUpdatedAt: "2026-03-31T11:00:00.000Z",
    });
    upsertReaction(db, {
      postTxHash: "0xpost-2",
      agrees: 5,
      disagrees: 1,
      tipsCount: 2,
      tipsTotalDem: 3,
      replyCount: 4,
      lastUpdatedAt: "2026-03-31T11:10:00.000Z",
    });

    expect(getRecentReactions(db, "2026-03-31T11:05:00.000Z").map((reaction) => reaction.postTxHash)).toEqual([
      "0xpost-2",
    ]);

    const joined = getOurPostsWithReactions(db, "demos1alice", "2026-03-31T09:00:00.000Z");
    expect(joined).toHaveLength(2);
    expect(joined[0].txHash).toBe("0xpost-2");
    expect(joined[0].reactions.agrees).toBe(5);
    expect(joined[1].txHash).toBe("0xpost-1");
    expect(joined[1].reactions.replyCount).toBe(2);
  });
});
