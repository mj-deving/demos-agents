/**
 * Tests for buildColonyStateFromFeed() — builds ColonyState from API feed data.
 *
 * Validates the shape matches the real ColonyState interface from state-extraction.ts:
 * { activity: { postsPerHour, activeAuthors, trendingTopics[] },
 *   gaps: { underservedTopics[], unansweredQuestions[], staleThreads[] },
 *   threads: { activeDiscussions[], mentionsOfUs[] },
 *   agents: { topContributors[] } }
 *
 * Timestamps are MILLISECONDS (not seconds).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildColonyStateFromFeed } from "../../src/toolkit/agent-loop.js";

const OUR_ADDRESS = "0xouraddress";
const NOW = 1700000000000; // fixed timestamp in ms

describe("buildColonyStateFromFeed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns correct ColonyState shape with all required fields", () => {
    const state = buildColonyStateFromFeed([], OUR_ADDRESS);

    expect(state).toHaveProperty("activity");
    expect(state).toHaveProperty("gaps");
    expect(state).toHaveProperty("threads");
    expect(state).toHaveProperty("agents");

    expect(state.activity).toHaveProperty("postsPerHour");
    expect(state.activity).toHaveProperty("activeAuthors");
    expect(state.activity).toHaveProperty("trendingTopics");

    expect(state.gaps).toHaveProperty("underservedTopics");
    expect(state.gaps).toHaveProperty("unansweredQuestions");
    expect(state.gaps).toHaveProperty("staleThreads");

    expect(state.threads).toHaveProperty("activeDiscussions");
    expect(state.threads).toHaveProperty("mentionsOfUs");

    expect(state.agents).toHaveProperty("topContributors");
  });

  it("returns empty state for empty posts array", () => {
    const state = buildColonyStateFromFeed([], OUR_ADDRESS);

    expect(state.activity.postsPerHour).toBe(0);
    expect(state.activity.activeAuthors).toBe(0);
    expect(state.activity.trendingTopics).toEqual([]);
    expect(state.gaps.underservedTopics).toEqual([]);
    expect(state.threads.mentionsOfUs).toEqual([]);
    expect(state.agents.topContributors).toEqual([]);
  });

  it("counts posts from the last hour for postsPerHour", () => {
    const posts = [
      // Recent (within last hour) — timestamps in MILLISECONDS
      { author: "0xA", timestamp: NOW - 1000, text: "recent", category: "ANALYSIS", txHash: "0x1" },
      { author: "0xB", timestamp: NOW - 60_000, text: "recent2", category: "SIGNAL", txHash: "0x2" },
      // Old (more than 1 hour ago)
      { author: "0xC", timestamp: NOW - 4_000_000, text: "old", category: "ANALYSIS", txHash: "0x3" },
    ];

    const state = buildColonyStateFromFeed(posts, OUR_ADDRESS);
    expect(state.activity.postsPerHour).toBe(2);
  });

  it("counts unique active authors from recent posts", () => {
    const posts = [
      { author: "0xA", timestamp: NOW - 1000, text: "a1", category: "ANALYSIS", txHash: "0x1" },
      { author: "0xA", timestamp: NOW - 2000, text: "a2", category: "SIGNAL", txHash: "0x2" },
      { author: "0xB", timestamp: NOW - 3000, text: "b1", category: "ANALYSIS", txHash: "0x3" },
    ];

    const state = buildColonyStateFromFeed(posts, OUR_ADDRESS);
    expect(state.activity.activeAuthors).toBe(2);
  });

  it("builds trending topics from TAGS, sorted by count", () => {
    const posts = [
      { author: "0xA", timestamp: NOW - 1000, text: "a", category: "ANALYSIS", txHash: "0x1", tags: ["defi", "eth"] },
      { author: "0xB", timestamp: NOW - 2000, text: "b", category: "SIGNAL", txHash: "0x2", tags: ["defi", "btc"] },
      { author: "0xC", timestamp: NOW - 3000, text: "c", category: "ANALYSIS", txHash: "0x3", tags: ["eth"] },
    ];

    const state = buildColonyStateFromFeed(posts, OUR_ADDRESS);
    // defi: 2, eth: 2, btc: 1
    expect(state.activity.trendingTopics.length).toBeGreaterThanOrEqual(2);
    expect(state.activity.trendingTopics[0].count).toBeGreaterThanOrEqual(state.activity.trendingTopics[1].count);
  });

  it("limits trending topics to 10 entries", () => {
    const posts = Array.from({ length: 15 }, (_, i) => ({
      author: `0x${i}`,
      timestamp: NOW - 1000,
      text: `post ${i}`,
      category: `CAT_${i}`,
      txHash: `0x${i}`,
      tags: [`unique_tag_${i}`],
    }));

    const state = buildColonyStateFromFeed(posts, OUR_ADDRESS);
    expect(state.activity.trendingTopics.length).toBeLessThanOrEqual(10);
  });

  it("detects mentions of our address in post text", () => {
    const posts = [
      { author: "0xA", timestamp: NOW - 1000, text: `Hey ${OUR_ADDRESS}, check this`, category: "ANALYSIS", txHash: "0x1" },
      { author: "0xB", timestamp: NOW - 2000, text: "no mention here", category: "SIGNAL", txHash: "0x2" },
    ];

    const state = buildColonyStateFromFeed(posts, OUR_ADDRESS);
    expect(state.threads.mentionsOfUs).toHaveLength(1);
    expect(state.threads.mentionsOfUs[0].txHash).toBe("0x1");
    expect(state.threads.mentionsOfUs[0].author).toBe("0xA");
  });

  it("builds top contributors sorted by post count", () => {
    const posts = [
      { author: "0xA", timestamp: NOW - 1000, text: "a1", category: "ANALYSIS", txHash: "0x1", reactions: { agree: 10, disagree: 2 } },
      { author: "0xA", timestamp: NOW - 2000, text: "a2", category: "ANALYSIS", txHash: "0x2", reactions: { agree: 5, disagree: 1 } },
      { author: "0xB", timestamp: NOW - 3000, text: "b1", category: "SIGNAL", txHash: "0x3", reactions: { agree: 3, disagree: 0 } },
    ];

    const state = buildColonyStateFromFeed(posts, OUR_ADDRESS);
    expect(state.agents.topContributors).toHaveLength(2);
    expect(state.agents.topContributors[0].author).toBe("0xA");
    expect(state.agents.topContributors[0].postCount).toBe(2);
    // avgReactions = total / count = (10+2+5+1) / 2 = 9
    expect(state.agents.topContributors[0].avgReactions).toBe(9);
  });

  it("limits top contributors to 10 entries", () => {
    const posts = Array.from({ length: 15 }, (_, i) => ({
      author: `0xauthor${i}`,
      timestamp: NOW - 1000,
      text: `post ${i}`,
      category: "ANALYSIS",
      txHash: `0x${i}`,
    }));

    const state = buildColonyStateFromFeed(posts, OUR_ADDRESS);
    expect(state.agents.topContributors.length).toBeLessThanOrEqual(10);
  });

  it("handles posts without reactions gracefully", () => {
    const posts = [
      { author: "0xA", timestamp: NOW - 1000, text: "no reactions", category: "ANALYSIS", txHash: "0x1" },
    ];

    const state = buildColonyStateFromFeed(posts, OUR_ADDRESS);
    expect(state.agents.topContributors[0].avgReactions).toBe(0);
  });

  it("gaps fields are empty (no DB available)", () => {
    const posts = [
      { author: "0xA", timestamp: NOW - 1000, text: "post", category: "ANALYSIS", txHash: "0x1" },
    ];

    const state = buildColonyStateFromFeed(posts, OUR_ADDRESS);
    expect(state.gaps.underservedTopics).toEqual([]);
    expect(state.gaps.unansweredQuestions).toEqual([]);
    expect(state.gaps.staleThreads).toEqual([]);
  });
});
