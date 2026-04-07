import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb, addPost, type ColonyDatabase } from "../../helpers/colony-test-utils.js";
import { buildAgentIndex, detectConvergence, type AgentIndexEntry } from "../../../src/toolkit/colony/agent-index.js";

describe("buildAgentIndex", () => {
  let db: ColonyDatabase;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns empty array for empty DB", () => {
    const index = buildAgentIndex(db);
    expect(index).toEqual([]);
  });

  it("groups posts by author with correct counts", () => {
    addPost(db, "tx1", "alice", "2026-04-07T01:00:00Z");
    addPost(db, "tx2", "alice", "2026-04-07T02:00:00Z");
    addPost(db, "tx3", "bob", "2026-04-07T03:00:00Z");

    const index = buildAgentIndex(db);
    expect(index).toHaveLength(2);

    const alice = index.find((e) => e.address === "alice");
    const bob = index.find((e) => e.address === "bob");
    expect(alice?.postCount).toBe(2);
    expect(bob?.postCount).toBe(1);
  });

  it("computes avgScore from reaction_cache agrees", () => {
    addPost(db, "tx1", "alice", "2026-04-07T01:00:00Z");
    addPost(db, "tx2", "alice", "2026-04-07T02:00:00Z");

    // Seed reaction cache
    db.prepare(`
      INSERT INTO reaction_cache (post_tx_hash, agrees, disagrees, tips_count, tips_total_dem, reply_count, last_updated_at)
      VALUES (?, ?, ?, 0, 0, 0, ?)
    `).run("tx1", 10, 2, "2026-04-07T01:00:00Z");
    db.prepare(`
      INSERT INTO reaction_cache (post_tx_hash, agrees, disagrees, tips_count, tips_total_dem, reply_count, last_updated_at)
      VALUES (?, ?, ?, 0, 0, 0, ?)
    `).run("tx2", 20, 4, "2026-04-07T02:00:00Z");

    const index = buildAgentIndex(db);
    const alice = index.find((e) => e.address === "alice");
    // avgScore = avg agrees = (10 + 20) / 2 = 15
    expect(alice?.avgScore).toBe(15);
  });

  it("defaults avgScore to 0 when no reactions", () => {
    addPost(db, "tx1", "alice", "2026-04-07T01:00:00Z");
    const index = buildAgentIndex(db);
    expect(index[0].avgScore).toBe(0);
  });

  it("extracts recent topics from tags", () => {
    // Insert post with tags via raw SQL since addPost uses default empty tags
    db.prepare(`
      INSERT INTO posts (tx_hash, author, block_number, timestamp, tags, text, raw_data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("tx1", "alice", 1, "2026-04-07T01:00:00Z", '["defi","ethereum"]', "Test", "{}");

    const index = buildAgentIndex(db);
    const alice = index.find((e) => e.address === "alice");
    expect(alice?.recentTopics).toContain("defi");
    expect(alice?.recentTopics).toContain("ethereum");
  });

  it("includes lastActiveAt as the latest timestamp", () => {
    addPost(db, "tx1", "alice", "2026-04-06T01:00:00Z");
    addPost(db, "tx2", "alice", "2026-04-07T12:00:00Z");

    const index = buildAgentIndex(db);
    const alice = index.find((e) => e.address === "alice");
    expect(alice?.lastActiveAt).toBe("2026-04-07T12:00:00Z");
  });
});

describe("detectConvergence", () => {
  it("detects convergence when threshold agents share a topic", () => {
    const agentIndex: AgentIndexEntry[] = [
      { address: "a1", postCount: 5, avgScore: 10, recentTopics: ["defi", "ai"], lastActiveAt: "2026-04-07T01:00:00Z" },
      { address: "a2", postCount: 3, avgScore: 8, recentTopics: ["defi"], lastActiveAt: "2026-04-07T02:00:00Z" },
      { address: "a3", postCount: 7, avgScore: 12, recentTopics: ["defi", "macro"], lastActiveAt: "2026-04-07T03:00:00Z" },
    ];

    const result = detectConvergence("defi", agentIndex);
    expect(result.isConvergent).toBe(true);
    expect(result.agentCount).toBe(3);
    expect(result.agents).toEqual(["a1", "a2", "a3"]);
  });

  it("returns false when below threshold", () => {
    const agentIndex: AgentIndexEntry[] = [
      { address: "a1", postCount: 5, avgScore: 10, recentTopics: ["defi"], lastActiveAt: "2026-04-07T01:00:00Z" },
      { address: "a2", postCount: 3, avgScore: 8, recentTopics: ["ai"], lastActiveAt: "2026-04-07T02:00:00Z" },
    ];

    const result = detectConvergence("defi", agentIndex);
    expect(result.isConvergent).toBe(false);
    expect(result.agentCount).toBe(1);
    expect(result.agents).toEqual(["a1"]);
  });

  it("uses default threshold of 3", () => {
    const agentIndex: AgentIndexEntry[] = [
      { address: "a1", postCount: 5, avgScore: 10, recentTopics: ["defi"], lastActiveAt: "2026-04-07T01:00:00Z" },
      { address: "a2", postCount: 3, avgScore: 8, recentTopics: ["defi"], lastActiveAt: "2026-04-07T02:00:00Z" },
    ];

    // 2 agents on defi < default threshold 3
    expect(detectConvergence("defi", agentIndex).isConvergent).toBe(false);
  });

  it("supports custom threshold", () => {
    const agentIndex: AgentIndexEntry[] = [
      { address: "a1", postCount: 5, avgScore: 10, recentTopics: ["defi"], lastActiveAt: "2026-04-07T01:00:00Z" },
      { address: "a2", postCount: 3, avgScore: 8, recentTopics: ["defi"], lastActiveAt: "2026-04-07T02:00:00Z" },
    ];

    expect(detectConvergence("defi", agentIndex, 2).isConvergent).toBe(true);
  });

  it("matches topic case-insensitively", () => {
    const agentIndex: AgentIndexEntry[] = [
      { address: "a1", postCount: 5, avgScore: 10, recentTopics: ["DeFi"], lastActiveAt: "2026-04-07T01:00:00Z" },
      { address: "a2", postCount: 3, avgScore: 8, recentTopics: ["defi"], lastActiveAt: "2026-04-07T02:00:00Z" },
      { address: "a3", postCount: 7, avgScore: 12, recentTopics: ["DEFI"], lastActiveAt: "2026-04-07T03:00:00Z" },
    ];

    const result = detectConvergence("defi", agentIndex);
    expect(result.isConvergent).toBe(true);
    expect(result.agentCount).toBe(3);
  });

  it("returns empty agents array when no match", () => {
    const result = detectConvergence("unknown", []);
    expect(result.isConvergent).toBe(false);
    expect(result.agentCount).toBe(0);
    expect(result.agents).toEqual([]);
  });
});
