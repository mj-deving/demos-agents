import { describe, it, expect, beforeEach } from "vitest";
import { initColonyCache, type ColonyDatabase } from "../../../src/toolkit/colony/schema.js";
import { insertHiveReaction, getReactionsByPost, countHiveReactions, recomputeReactionCache } from "../../../src/toolkit/colony/hive-reactions.js";
import { getReaction } from "../../../src/toolkit/colony/reactions.js";
import { insertPost } from "../../../src/toolkit/colony/posts.js";

describe("hive-reactions", () => {
  let db: ColonyDatabase;

  beforeEach(() => {
    db = initColonyCache(":memory:");
  });

  it("inserts and retrieves individual reactions", () => {
    insertHiveReaction(db, {
      txHash: "rx1",
      txId: 1000,
      targetTxHash: "post1",
      reactionType: "agree",
      author: "0xreactor1",
      blockNumber: 100,
      timestamp: "2026-04-01T00:00:00.000Z",
      rawData: { v: 1, action: "react", target: "post1", type: "agree" },
    });

    insertHiveReaction(db, {
      txHash: "rx2",
      txId: 1001,
      targetTxHash: "post1",
      reactionType: "disagree",
      author: "0xreactor2",
      blockNumber: 101,
      timestamp: "2026-04-01T00:01:00.000Z",
      rawData: { v: 1, action: "react", target: "post1", type: "disagree" },
    });

    const reactions = getReactionsByPost(db, "post1");
    expect(reactions).toHaveLength(2);
    expect(reactions[0].reactionType).toBe("agree");
    expect(reactions[1].reactionType).toBe("disagree");
    expect(countHiveReactions(db)).toBe(2);
  });

  it("upserts on conflict without overwriting existing metadata", () => {
    insertHiveReaction(db, {
      txHash: "rx1",
      txId: 500,
      targetTxHash: "post1",
      reactionType: "agree",
      author: "0xreactor",
      fromEd25519: "ed25519addr",
      blockNumber: 100,
      timestamp: "2026-04-01T00:00:00.000Z",
      nonce: 5,
      rawData: {},
    });

    // Re-insert without ed25519 or nonce — should preserve existing values
    insertHiveReaction(db, {
      txHash: "rx1",
      targetTxHash: "post1",
      reactionType: "agree",
      author: "0xreactor",
      blockNumber: 100,
      timestamp: "2026-04-01T00:00:00.000Z",
      rawData: {},
    });

    const reactions = getReactionsByPost(db, "post1");
    expect(reactions).toHaveLength(1);
    expect(reactions[0].fromEd25519).toBe("ed25519addr");
    expect(reactions[0].nonce).toBe(5);
    expect(reactions[0].txId).toBe(500);
  });

  it("recomputes reaction_cache aggregates from individual records", () => {
    // Insert a post so FK is satisfied (though we have FK off during backfill)
    insertPost(db, {
      txHash: "post1",
      author: "0xauthor",
      blockNumber: 50,
      timestamp: "2026-04-01T00:00:00.000Z",
      replyTo: null,
      tags: [],
      text: "test",
      rawData: {},
    });

    // Insert 3 agrees, 1 disagree for post1
    for (let i = 0; i < 3; i++) {
      insertHiveReaction(db, {
        txHash: `rx-agree-${i}`,
        targetTxHash: "post1",
        reactionType: "agree",
        author: `0xreactor${i}`,
        blockNumber: 100 + i,
        timestamp: `2026-04-01T00:0${i}:00.000Z`,
        rawData: {},
      });
    }
    insertHiveReaction(db, {
      txHash: "rx-disagree-0",
      targetTxHash: "post1",
      reactionType: "disagree",
      author: "0xcritic",
      blockNumber: 103,
      timestamp: "2026-04-01T00:03:00.000Z",
      rawData: {},
    });

    const updated = recomputeReactionCache(db);
    expect(updated).toBe(1); // 1 unique target post

    const cached = getReaction(db, "post1");
    expect(cached).not.toBeNull();
    expect(cached!.agrees).toBe(3);
    expect(cached!.disagrees).toBe(1);
  });

  it("recomputeReactionCache preserves tips and reply counts", () => {
    // Pre-populate reaction_cache with tip data
    db.prepare(`
      INSERT INTO reaction_cache (post_tx_hash, agrees, disagrees, tips_count, tips_total_dem, reply_count, last_updated_at)
      VALUES ('post1', 0, 0, 5, 25.0, 3, '2026-04-01T00:00:00.000Z')
    `).run();

    // Add individual reactions
    insertHiveReaction(db, {
      txHash: "rx1",
      targetTxHash: "post1",
      reactionType: "agree",
      author: "0xa",
      blockNumber: 100,
      timestamp: "2026-04-01T01:00:00.000Z",
      rawData: {},
    });

    recomputeReactionCache(db);

    const cached = getReaction(db, "post1");
    expect(cached!.agrees).toBe(1);
    expect(cached!.tipsCount).toBe(5); // preserved
    expect(cached!.tipsTotalDem).toBe(25.0); // preserved
    expect(cached!.replyCount).toBe(3); // preserved
  });

  it("stores full tx metadata when provided", () => {
    insertHiveReaction(db, {
      txHash: "rx-full",
      txId: 12345,
      targetTxHash: "post1",
      reactionType: "agree",
      author: "0xreactor",
      fromEd25519: "ed25519fulladdr",
      blockNumber: 500,
      timestamp: "2026-04-01T12:00:00.000Z",
      nonce: 42,
      amount: 0,
      networkFee: 0.001,
      rpcFee: 0.002,
      additionalFee: 0,
      rawData: { v: 1, action: "react", target: "post1", type: "agree" },
    });

    const reactions = getReactionsByPost(db, "post1");
    expect(reactions).toHaveLength(1);
    expect(reactions[0].txId).toBe(12345);
    expect(reactions[0].fromEd25519).toBe("ed25519fulladdr");
    expect(reactions[0].nonce).toBe(42);
    expect(reactions[0].networkFee).toBe(0.001);
  });
});
