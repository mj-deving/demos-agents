import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { insertPost } from "../../../src/toolkit/colony/posts.js";
import { initColonyCache } from "../../../src/toolkit/colony/schema.js";
import type { ColonyDatabase } from "../../../src/toolkit/colony/schema.js";
import {
  getAgentProfile,
  getInteractionHistory,
  recordInteraction,
  refreshAgentProfiles,
} from "../../../src/toolkit/colony/intelligence.js";

describe("colony intelligence", () => {
  let db: ColonyDatabase;

  beforeEach(() => {
    db = initColonyCache(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  function seedPost(txHash: string, author: string, timestamp: string, text = "Test post"): void {
    insertPost(db, {
      txHash,
      author,
      blockNumber: 100,
      timestamp,
      replyTo: null,
      tags: [],
      text,
      rawData: {},
    });
  }

  function seedReaction(postTxHash: string, agrees: number, disagrees: number, timestamp: string): void {
    db.prepare(
      "INSERT INTO reaction_cache (post_tx_hash, agrees, disagrees, tips_count, tips_total_dem, reply_count, last_updated_at) VALUES (?, ?, ?, 0, 0, 0, ?)",
    ).run(postTxHash, agrees, disagrees, timestamp);
  }

  describe("refreshAgentProfiles", () => {
    it("aggregates post data into profiles", () => {
      seedPost("0xp1", "alice", "2026-03-01T00:00:00.000Z");
      seedPost("0xp2", "alice", "2026-03-02T00:00:00.000Z");
      seedPost("0xp3", "bob", "2026-03-01T12:00:00.000Z");

      seedReaction("0xp1", 5, 1, "2026-03-01T00:00:00.000Z");
      seedReaction("0xp2", 3, 0, "2026-03-02T00:00:00.000Z");
      seedReaction("0xp3", 10, 2, "2026-03-01T12:00:00.000Z");

      const count = refreshAgentProfiles(db);

      expect(count).toBe(2);

      const alice = getAgentProfile(db, "alice");
      expect(alice).not.toBeNull();
      expect(alice!.postCount).toBe(2);
      expect(alice!.firstSeenAt).toBe("2026-03-01T00:00:00.000Z");
      expect(alice!.lastSeenAt).toBe("2026-03-02T00:00:00.000Z");
      expect(alice!.avgAgrees).toBe(4); // (5+3)/2
      expect(alice!.avgDisagrees).toBe(0.5); // (1+0)/2

      const bob = getAgentProfile(db, "bob");
      expect(bob).not.toBeNull();
      expect(bob!.postCount).toBe(1);
      expect(bob!.avgAgrees).toBe(10);
      expect(bob!.avgDisagrees).toBe(2);
    });

    it("sets trust_score to null", () => {
      seedPost("0xp1", "alice", "2026-03-01T00:00:00.000Z");

      refreshAgentProfiles(db);

      const alice = getAgentProfile(db, "alice");
      expect(alice).not.toBeNull();
      expect(alice!.trustScore).toBeNull();
    });

    it("with since param only updates recent authors", () => {
      // Old post from alice
      seedPost("0xold", "alice", "2026-01-01T00:00:00.000Z");
      seedReaction("0xold", 2, 0, "2026-01-01T00:00:00.000Z");

      // Full refresh first to establish baseline
      refreshAgentProfiles(db);

      const aliceBefore = getAgentProfile(db, "alice");
      expect(aliceBefore).not.toBeNull();
      expect(aliceBefore!.postCount).toBe(1);

      // New post from bob after cutoff
      seedPost("0xnew", "bob", "2026-03-15T00:00:00.000Z");
      seedReaction("0xnew", 7, 1, "2026-03-15T00:00:00.000Z");

      const count = refreshAgentProfiles(db, "2026-03-01T00:00:00.000Z");

      expect(count).toBe(1); // only bob updated

      const bob = getAgentProfile(db, "bob");
      expect(bob).not.toBeNull();
      expect(bob!.postCount).toBe(1);
      expect(bob!.avgAgrees).toBe(7);

      // alice profile should still exist from the first full refresh
      const aliceAfter = getAgentProfile(db, "alice");
      expect(aliceAfter).not.toBeNull();
      expect(aliceAfter!.postCount).toBe(1);
    });
  });

  describe("recordInteraction", () => {
    it("inserts interaction record", () => {
      recordInteraction(db, {
        ourTxHash: "0xour1",
        theirTxHash: "0xtheir1",
        theirAddress: "alice",
        interactionType: "we_replied",
        timestamp: "2026-03-15T00:00:00.000Z",
      });

      const history = getInteractionHistory(db);
      expect(history).toHaveLength(1);
      expect(history[0].ourTxHash).toBe("0xour1");
      expect(history[0].theirTxHash).toBe("0xtheir1");
      expect(history[0].theirAddress).toBe("alice");
      expect(history[0].interactionType).toBe("we_replied");
      expect(history[0].timestamp).toBe("2026-03-15T00:00:00.000Z");
    });
  });

  describe("getAgentProfile", () => {
    it("returns null for unknown address", () => {
      const result = getAgentProfile(db, "nonexistent");
      expect(result).toBeNull();
    });

    it("returns correct profile after refresh", () => {
      seedPost("0xp1", "alice", "2026-03-01T00:00:00.000Z");
      seedReaction("0xp1", 8, 3, "2026-03-01T00:00:00.000Z");

      refreshAgentProfiles(db);

      const profile = getAgentProfile(db, "alice");
      expect(profile).toEqual({
        address: "alice",
        firstSeenAt: "2026-03-01T00:00:00.000Z",
        lastSeenAt: "2026-03-01T00:00:00.000Z",
        postCount: 1,
        avgAgrees: 8,
        avgDisagrees: 3,
        topics: [],
        trustScore: null,
      });
    });
  });

  describe("getInteractionHistory", () => {
    function seedInteractions(): void {
      recordInteraction(db, {
        ourTxHash: "0x1",
        theirTxHash: "0xt1",
        theirAddress: "alice",
        interactionType: "we_replied",
        timestamp: "2026-03-01T00:00:00.000Z",
      });
      recordInteraction(db, {
        ourTxHash: "0x2",
        theirTxHash: null,
        theirAddress: "bob",
        interactionType: "agreed",
        timestamp: "2026-03-02T00:00:00.000Z",
      });
      recordInteraction(db, {
        ourTxHash: "0x3",
        theirTxHash: "0xt3",
        theirAddress: "alice",
        interactionType: "tipped_us",
        timestamp: "2026-03-03T00:00:00.000Z",
      });
    }

    it("filters by address", () => {
      seedInteractions();

      const result = getInteractionHistory(db, { address: "alice" });
      expect(result).toHaveLength(2);
      expect(result.every((r) => r.theirAddress === "alice")).toBe(true);
    });

    it("filters by type", () => {
      seedInteractions();

      const result = getInteractionHistory(db, { type: "agreed" });
      expect(result).toHaveLength(1);
      expect(result[0].theirAddress).toBe("bob");
    });

    it("respects limit", () => {
      seedInteractions();

      const result = getInteractionHistory(db, { limit: 2 });
      expect(result).toHaveLength(2);
    });
  });
});
