import { describe, expect, it } from "vitest";

import type { AvailableEvidence } from "../../../src/toolkit/colony/available-evidence.js";
import type { ColonyState } from "../../../src/toolkit/colony/state-extraction.js";
import { decideActions } from "../../../src/toolkit/strategy/engine.js";
import type { DecisionContext, StrategyConfig } from "../../../src/toolkit/strategy/types.js";

function createEmptyState(): ColonyState {
  return {
    activity: {
      postsPerHour: 0,
      activeAuthors: 0,
      trendingTopics: [],
    },
    gaps: {
      underservedTopics: [],
      unansweredQuestions: [],
      staleThreads: [],
    },
    threads: {
      activeDiscussions: [],
      mentionsOfUs: [],
    },
    agents: {
      topContributors: [],
    },
  };
}

function createConfig(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
  return {
    rules: [
      {
        name: "reply_to_mentions",
        type: "REPLY",
        priority: 100,
        conditions: ["trusted mentions"],
        enabled: true,
      },
      {
        name: "engage_verified",
        type: "ENGAGE",
        priority: 65,
        conditions: ["verified topic"],
        enabled: true,
      },
      {
        name: "reply_with_evidence",
        type: "REPLY",
        priority: 80,
        conditions: ["matching evidence"],
        enabled: true,
      },
      {
        name: "publish_to_gaps",
        type: "PUBLISH",
        priority: 50,
        conditions: ["fresh rich evidence"],
        enabled: true,
      },
      {
        name: "tip_valuable",
        type: "TIP",
        priority: 30,
        conditions: ["above median"],
        enabled: true,
      },
    ],
    rateLimits: {
      postsPerDay: 14,
      postsPerHour: 5,
      reactionsPerSession: 8,
      maxTipAmount: 10,
    },
    performance: {
      engagement: 40,
      discussion: 25,
      replyBase: 10,
      replyDeep: 10,
      threadDepth: 5,
      economic: 20,
      tipBase: 10,
      tipCap: 10,
      tipMultiplier: 2,
      controversy: 5,
      ageHalfLife: 48,
    },
    topicWeights: {},
    ...overrides,
  };
}

function createContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    ourAddress: "demos1loop",
    sessionReactionsUsed: 0,
    postsToday: 0,
    postsThisHour: 0,
    now: new Date("2026-03-31T12:00:00.000Z"),
    ...overrides,
  };
}

function createEvidence(subject: string, overrides: Partial<AvailableEvidence> = {}): AvailableEvidence {
  return {
    sourceId: `${subject}-source`,
    subject,
    metrics: [subject],
    richness: 200,
    freshness: 300,
    stale: false,
    ...overrides,
  };
}

describe("strategy engine", () => {
  it("creates reply actions for trusted mentions", () => {
    const state = createEmptyState();
    state.threads.mentionsOfUs = [
      { txHash: "0xmention-trusted", author: "alice", text: "@loop check this claim" },
      { txHash: "0xmention-untrusted", author: "eve", text: "@loop quick question" },
    ];
    state.agents.topContributors = [
      { author: "alice", postCount: 4, avgReactions: 6 },
      { author: "eve", postCount: 2, avgReactions: 9 },
    ];

    const result = decideActions(state, [], createConfig({
      rules: createConfig().rules.map((rule) => ({
        ...rule,
        enabled: rule.name === "reply_to_mentions",
      })),
    }), createContext());

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      type: "REPLY",
      priority: 100,
      target: "0xmention-trusted",
    });
  });

  it("creates engage actions for verified trending topics from top contributors", () => {
    const state = createEmptyState();
    state.activity.trendingTopics = [{ topic: "defi", count: 3 }];
    state.agents.topContributors = [
      { author: "alice", postCount: 5, avgReactions: 8 },
    ];

    const result = decideActions(state, [createEvidence("defi")], createConfig({
      rules: createConfig().rules.map((rule) => ({
        ...rule,
        enabled: rule.name === "engage_verified",
      })),
    }), createContext());

    expect(result.actions).toEqual([
      expect.objectContaining({
        type: "ENGAGE",
        priority: 65,
        target: "alice",
        evidence: ["defi-source"],
      }),
    ]);
  });

  it("creates reply actions for active discussions when matching evidence exists", () => {
    const state = createEmptyState();
    state.activity.trendingTopics = [{ topic: "governance", count: 4 }];
    state.threads.activeDiscussions = [
      { rootTxHash: "0xthread", replyCount: 5, lastReplyAt: "2026-03-31T11:30:00.000Z" },
    ];

    const result = decideActions(state, [createEvidence("governance")], createConfig({
      rules: createConfig().rules.map((rule) => ({
        ...rule,
        enabled: rule.name === "reply_with_evidence",
      })),
    }), createContext());

    expect(result.actions).toEqual([
      expect.objectContaining({
        type: "REPLY",
        priority: 80,
        target: "0xthread",
        evidence: ["governance-source"],
      }),
    ]);
  });

  it("creates publish actions for underserved topics with fresh rich evidence", () => {
    const state = createEmptyState();
    state.gaps.underservedTopics = [
      { topic: "security", lastPostAt: "2026-03-31T09:00:00.000Z" },
    ];

    const result = decideActions(state, [createEvidence("security")], createConfig({
      rules: createConfig().rules.map((rule) => ({
        ...rule,
        enabled: rule.name === "publish_to_gaps",
      })),
    }), createContext());

    expect(result.actions).toEqual([
      expect.objectContaining({
        type: "PUBLISH",
        priority: 50,
        target: "security",
        evidence: ["security-source"],
      }),
    ]);
  });

  it("creates tip actions for contributors above the colony median", () => {
    const state = createEmptyState();
    state.agents.topContributors = [
      { author: "alice", postCount: 4, avgReactions: 9 },
      { author: "bob", postCount: 4, avgReactions: 5 },
      { author: "carol", postCount: 4, avgReactions: 1 },
    ];

    const result = decideActions(state, [], createConfig({
      rules: createConfig().rules.map((rule) => ({
        ...rule,
        enabled: rule.name === "tip_valuable",
      })),
    }), createContext());

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      type: "TIP",
      target: "alice",
      priority: 30,
    });
    expect(Number(result.actions[0].metadata?.amount)).toBeLessThanOrEqual(10);
  });

  it("enforces absolute 10 DEM tip ceiling even with unclamped config", () => {
    const state = createEmptyState();
    state.agents.topContributors = [
      { author: "alice", postCount: 4, avgReactions: 100 },
      { author: "bob", postCount: 4, avgReactions: 1 },
    ];

    const result = decideActions(state, [], createConfig({
      rateLimits: { postsPerDay: 14, postsPerHour: 5, reactionsPerSession: 8, maxTipAmount: 50 },
      rules: createConfig().rules.map((rule) => ({
        ...rule,
        enabled: rule.name === "tip_valuable",
      })),
    }), createContext());

    expect(result.actions).toHaveLength(1);
    expect(Number(result.actions[0].metadata?.amount)).toBeLessThanOrEqual(10);
  });

  it("sorts actions by priority descending", () => {
    const state = createEmptyState();
    state.activity.trendingTopics = [{ topic: "governance", count: 4 }];
    state.gaps.underservedTopics = [{ topic: "security", lastPostAt: "2026-03-31T09:00:00.000Z" }];
    state.threads.activeDiscussions = [
      { rootTxHash: "0xthread", replyCount: 2, lastReplyAt: "2026-03-31T11:30:00.000Z" },
    ];
    state.threads.mentionsOfUs = [
      { txHash: "0xmention", author: "alice", text: "@loop data point" },
    ];
    state.agents.topContributors = [
      { author: "alice", postCount: 4, avgReactions: 9 },
      { author: "bob", postCount: 4, avgReactions: 2 },
      { author: "carol", postCount: 4, avgReactions: 1 },
    ];

    const result = decideActions(state, [
      createEvidence("governance"),
      createEvidence("security"),
    ], createConfig({
      rules: createConfig().rules.map((rule) => ({
        ...rule,
        enabled: rule.name !== "engage_verified",
      })),
    }), createContext());

    expect(result.actions.map((action) => action.priority)).toEqual([100, 80, 50, 30]);
  });

  it("applies reaction and post rate limits using actual counts", () => {
    const state = createEmptyState();
    state.activity.trendingTopics = [{ topic: "defi", count: 4 }];
    state.gaps.underservedTopics = [{ topic: "defi", lastPostAt: "2026-03-31T09:00:00.000Z" }];
    state.agents.topContributors = [
      { author: "alice", postCount: 4, avgReactions: 9 },
      { author: "bob", postCount: 4, avgReactions: 8 },
      { author: "carol", postCount: 4, avgReactions: 1 },
    ];

    // postsToday=1 with limit=1 means daily is exhausted; reactionsPerSession=1 allows 1 engage
    const result = decideActions(state, [createEvidence("defi")], createConfig({
      rateLimits: {
        postsPerDay: 1,
        postsPerHour: 5,
        reactionsPerSession: 1,
        maxTipAmount: 10,
      },
      rules: createConfig().rules.filter((rule) =>
        rule.name === "engage_verified" || rule.name === "publish_to_gaps"
      ),
    }), createContext({ postsToday: 1, postsThisHour: 0 }));

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe("ENGAGE");
    expect(result.log.considered).toHaveLength(3);
    expect(result.log.selected).toHaveLength(1);
    expect(result.log.rejected).toHaveLength(2);
    expect(result.log.rejected.map((entry) => entry.reason)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/reaction/i),
        expect.stringMatching(/daily/i),
      ]),
    );
  });

  it("rejects posts when postsToday exceeds daily limit", () => {
    const state = createEmptyState();
    state.gaps.underservedTopics = [
      { topic: "security", lastPostAt: "2026-03-31T09:00:00.000Z" },
    ];

    const result = decideActions(state, [createEvidence("security")], createConfig({
      rules: createConfig().rules.map((rule) => ({
        ...rule,
        enabled: rule.name === "publish_to_gaps",
      })),
    }), createContext({ postsToday: 14 }));

    expect(result.actions).toEqual([]);
    expect(result.log.rejected).toHaveLength(1);
    expect(result.log.rejected[0].reason).toMatch(/daily/i);
  });

  it("logs low-trust mentions as rejected and selects nothing", () => {
    const state = createEmptyState();
    state.threads.mentionsOfUs = [
      { txHash: "0xmention", author: "eve", text: "@loop are you there?" },
    ];
    state.agents.topContributors = [
      { author: "eve", postCount: 2, avgReactions: 10 },
    ];

    const result = decideActions(state, [], createConfig({
      rules: createConfig().rules.map((rule) => ({
        ...rule,
        enabled: rule.name === "reply_to_mentions",
      })),
    }), createContext());

    expect(result.actions).toEqual([]);
    expect(result.log.rejected).toHaveLength(1);
    expect(result.log.rejected[0].reason).toMatch(/trusted/i);
  });

  it("rejects bait mentions without attestation data", () => {
    const state = createEmptyState();
    state.threads.mentionsOfUs = [
      { txHash: "0xbait", author: "alice", text: "@loop this scam is pathetic and fraudulent" },
    ];
    state.agents.topContributors = [
      { author: "alice", postCount: 5, avgReactions: 7 },
    ];

    const result = decideActions(state, [], createConfig({
      rules: createConfig().rules.map((rule) => ({
        ...rule,
        enabled: rule.name === "reply_to_mentions",
      })),
    }), createContext());

    expect(result.actions).toEqual([]);
    expect(result.log.rejected).toHaveLength(1);
    expect(result.log.rejected[0].reason).toMatch(/bait/i);
  });

  it("skips disabled rules", () => {
    const state = createEmptyState();
    state.threads.mentionsOfUs = [
      { txHash: "0xmention", author: "alice", text: "@loop useful context" },
    ];
    state.agents.topContributors = [
      { author: "alice", postCount: 4, avgReactions: 6 },
    ];

    const result = decideActions(state, [], createConfig({
      rules: createConfig().rules.map((rule) => ({
        ...rule,
        enabled: false,
      })),
    }), createContext());

    expect(result.actions).toEqual([]);
    expect(result.log.considered).toEqual([]);
    expect(result.log.rejected).toEqual([]);
  });

  it("returns no actions for an empty colony state", () => {
    const result = decideActions(createEmptyState(), [], createConfig(), createContext());

    expect(result.actions).toEqual([]);
    expect(result.log.selected).toEqual([]);
  });

  it("does not publish when all matching evidence is stale", () => {
    const state = createEmptyState();
    state.gaps.underservedTopics = [
      { topic: "security", lastPostAt: "2026-03-31T09:00:00.000Z" },
    ];

    const result = decideActions(state, [
      createEvidence("security", { freshness: 7200, stale: true }),
    ], createConfig({
      rules: createConfig().rules.map((rule) => ({
        ...rule,
        enabled: rule.name === "publish_to_gaps",
      })),
    }), createContext());

    expect(result.actions).toEqual([]);
    expect(result.log.selected).toEqual([]);
  });

  it("uses injected now for deterministic timestamps", () => {
    const fixedNow = new Date("2026-03-31T12:00:00.000Z");
    const result = decideActions(createEmptyState(), [], createConfig(), createContext({ now: fixedNow }));

    expect(result.log.timestamp).toBe("2026-03-31T12:00:00.000Z");
  });
});
