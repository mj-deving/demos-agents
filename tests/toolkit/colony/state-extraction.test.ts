import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { insertPost } from "../../../src/toolkit/colony/posts.js";
import { upsertReaction } from "../../../src/toolkit/colony/reactions.js";
import { initColonyCache } from "../../../src/toolkit/colony/schema.js";
import { extractColonyState } from "../../../src/toolkit/colony/state-extraction.js";

describe("colony state extraction", () => {
  let db: ReturnType<typeof initColonyCache>;

  beforeEach(() => {
    db = initColonyCache(":memory:");

    insertPost(db, {
      txHash: "0xroot-stale",
      author: "alice",
      blockNumber: 1,
      timestamp: "2026-03-28T07:00:00.000Z",
      replyTo: null,
      tags: ["macro"],
      text: "Macro outlook?",
      rawData: { id: 1 },
    });
    insertPost(db, {
      txHash: "0xreply-stale",
      author: "bob",
      blockNumber: 2,
      timestamp: "2026-03-28T08:00:00.000Z",
      replyTo: "0xroot-stale",
      tags: ["macro"],
      text: "Old reply",
      rawData: { id: 2 },
    });
    insertPost(db, {
      txHash: "0xroot-active",
      author: "alice",
      blockNumber: 3,
      timestamp: "2026-03-31T08:00:00.000Z",
      replyTo: null,
      tags: ["defi"],
      text: "DeFi TVL is shifting",
      rawData: { id: 3 },
    });
    insertPost(db, {
      txHash: "0xreply-active-1",
      author: "bob",
      blockNumber: 4,
      timestamp: "2026-03-31T10:00:00.000Z",
      replyTo: "0xroot-active",
      tags: ["defi"],
      text: "First reply",
      rawData: { id: 4 },
    });
    insertPost(db, {
      txHash: "0xreply-active-2",
      author: "carol",
      blockNumber: 5,
      timestamp: "2026-03-31T11:00:00.000Z",
      replyTo: "0xroot-active",
      tags: ["defi"],
      text: "Second reply for demos1loop",
      rawData: { id: 5 },
    });
    insertPost(db, {
      txHash: "0xquestion-open",
      author: "carol",
      blockNumber: 6,
      timestamp: "2026-03-31T09:30:00.000Z",
      replyTo: null,
      tags: ["macro"],
      text: "What is next for macro liquidity?",
      rawData: { id: 6 },
    });
    insertPost(db, {
      txHash: "0xmacro-solo",
      author: "bob",
      blockNumber: 7,
      timestamp: "2026-03-30T13:00:00.000Z",
      replyTo: null,
      tags: ["macro"],
      text: "Macro is quiet today",
      rawData: { id: 7 },
    });
    insertPost(db, {
      txHash: "0xmining",
      author: "alice",
      blockNumber: 8,
      timestamp: "2026-03-31T12:00:00.000Z",
      replyTo: null,
      tags: ["bitcoin", "mining"],
      text: "Mining margins improved",
      rawData: { id: 8 },
    });

    upsertReaction(db, {
      postTxHash: "0xroot-active",
      agrees: 3,
      disagrees: 1,
      tipsCount: 1,
      tipsTotalDem: 5,
      replyCount: 2,
      lastUpdatedAt: "2026-03-31T12:05:00.000Z",
    });
    upsertReaction(db, {
      postTxHash: "0xmining",
      agrees: 4,
      disagrees: 0,
      tipsCount: 1,
      tipsTotalDem: 3,
      replyCount: 0,
      lastUpdatedAt: "2026-03-31T12:05:00.000Z",
    });
    upsertReaction(db, {
      postTxHash: "0xmacro-solo",
      agrees: 1,
      disagrees: 0,
      tipsCount: 0,
      tipsTotalDem: 0,
      replyCount: 0,
      lastUpdatedAt: "2026-03-31T12:05:00.000Z",
    });
  });

  afterEach(() => {
    db.close();
  });

  it("extracts activity, gaps, threads, and contributor intelligence from the cache", () => {
    const state = extractColonyState(db, {
      ourAddress: "demos1loop",
      activityWindowHours: 24,
      staleThreadHours: 48,
    });

    expect(state.activity.postsPerHour).toBeCloseTo(6 / 24, 6);
    expect(state.activity.activeAuthors).toBe(3);
    expect(state.activity.trendingTopics.slice(0, 3)).toEqual([
      { topic: "defi", count: 3 },
      { topic: "macro", count: 2 },
      { topic: "bitcoin", count: 1 },
    ]);

    expect(state.gaps.underservedTopics).toEqual([
      { topic: "bitcoin", lastPostAt: "2026-03-31T12:00:00.000Z" },
      { topic: "mining", lastPostAt: "2026-03-31T12:00:00.000Z" },
    ]);
    expect(state.gaps.unansweredQuestions).toEqual([
      {
        txHash: "0xquestion-open",
        text: "What is next for macro liquidity?",
        timestamp: "2026-03-31T09:30:00.000Z",
      },
    ]);
    expect(state.gaps.staleThreads).toEqual([
      {
        rootTxHash: "0xroot-stale",
        lastReplyAt: "2026-03-28T08:00:00.000Z",
      },
    ]);

    expect(state.threads.activeDiscussions).toEqual([
      {
        rootTxHash: "0xroot-active",
        replyCount: 2,
        lastReplyAt: "2026-03-31T11:00:00.000Z",
      },
    ]);
    expect(state.threads.mentionsOfUs).toEqual([
      {
        txHash: "0xreply-active-2",
        author: "carol",
        text: "Second reply for demos1loop",
      },
    ]);

    expect(state.agents.topContributors.slice(0, 3)).toEqual([
      { author: "alice", postCount: 3, avgReactions: 4 },
      { author: "bob", postCount: 3, avgReactions: 0.33 },
      { author: "carol", postCount: 2, avgReactions: 0 },
    ]);
  });
});
