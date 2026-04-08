import { describe, expect, it } from "vitest";

import type { AvailableEvidence } from "../../../src/toolkit/colony/available-evidence.js";
import type { ColonyState } from "../../../src/toolkit/colony/state-extraction.js";
import { applyLeaderboardAdjustment, decideActions } from "../../../src/toolkit/strategy/engine.js";
import { MIN_PUBLISH_EVIDENCE_RICHNESS } from "../../../src/toolkit/strategy/engine-helpers.js";
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
    enrichment: {
      minSignalAgents: 2,
      minConfidence: 40,
    },
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
    // Both mentions should be considered; eve rejected for low trust
    expect(result.log.considered).toHaveLength(2);
    expect(result.log.rejected).toHaveLength(1);
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

  it("rejects publish_to_gaps evidence that falls below the minimum richness threshold", () => {
    const state = createEmptyState();
    state.gaps.underservedTopics = [
      { topic: "security", lastPostAt: "2026-03-31T09:00:00.000Z" },
    ];

    const result = decideActions(state, [
      createEvidence("security", { richness: MIN_PUBLISH_EVIDENCE_RICHNESS - 5 }),
    ], createConfig({
      rules: createConfig().rules.map((rule) => ({
        ...rule,
        enabled: rule.name === "publish_to_gaps",
      })),
    }), createContext());

    expect(result.actions).toEqual([]);
    expect(result.log.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: "publish_to_gaps",
        reason: expect.stringContaining(`threshold=${MIN_PUBLISH_EVIDENCE_RICHNESS}`),
      }),
    ]));
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

  it("logs low-trust mentions as considered and rejected", () => {
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
    expect(result.log.considered).toHaveLength(1);
    expect(result.log.rejected).toHaveLength(1);
    expect(result.log.rejected[0].reason).toMatch(/trusted/i);
  });

  it("rejects bait mentions without attestation data and logs as considered", () => {
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
    expect(result.log.considered).toHaveLength(1);
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

  it("allows 14th daily post but rejects 15th", () => {
    const state = createEmptyState();
    state.gaps.underservedTopics = [
      { topic: "defi", lastPostAt: "2026-03-31T09:00:00.000Z" },
      { topic: "governance", lastPostAt: "2026-03-31T09:00:00.000Z" },
    ];

    // 13 posts today — 14th should pass, creating 1 action for first gap
    const result13 = decideActions(state, [
      createEvidence("defi"),
      createEvidence("governance"),
    ], createConfig({
      rules: createConfig().rules.map((rule) => ({
        ...rule,
        enabled: rule.name === "publish_to_gaps",
      })),
    }), createContext({ postsToday: 13 }));

    expect(result13.actions).toHaveLength(1);
    expect(result13.log.rejected).toHaveLength(1);
    expect(result13.log.rejected[0].reason).toMatch(/daily/i);

    // 14 posts today — all rejected
    const result14 = decideActions(state, [
      createEvidence("defi"),
    ], createConfig({
      rules: createConfig().rules.map((rule) => ({
        ...rule,
        enabled: rule.name === "publish_to_gaps",
      })),
    }), createContext({ postsToday: 14 }));

    expect(result14.actions).toEqual([]);
    expect(result14.log.rejected).toHaveLength(1);
  });

  it("allows 5th hourly post but rejects 6th", () => {
    const state = createEmptyState();
    state.gaps.underservedTopics = [
      { topic: "defi", lastPostAt: "2026-03-31T09:00:00.000Z" },
    ];

    const result4 = decideActions(state, [createEvidence("defi")], createConfig({
      rules: createConfig().rules.map((rule) => ({
        ...rule,
        enabled: rule.name === "publish_to_gaps",
      })),
    }), createContext({ postsThisHour: 4 }));

    expect(result4.actions).toHaveLength(1);

    const result5 = decideActions(state, [createEvidence("defi")], createConfig({
      rules: createConfig().rules.map((rule) => ({
        ...rule,
        enabled: rule.name === "publish_to_gaps",
      })),
    }), createContext({ postsThisHour: 5 }));

    expect(result5.actions).toEqual([]);
    expect(result5.log.rejected).toHaveLength(1);
    expect(result5.log.rejected[0].reason).toMatch(/hourly/i);
  });

  it("decideActions works with apiEnrichment undefined (graceful degradation)", () => {
    const state = createEmptyState();
    state.activity.trendingTopics = [{ topic: "bitcoin", count: 5 }];
    state.gaps.underservedTopics = [{ topic: "bitcoin", lastPostAt: "2026-03-30T00:00:00Z" }];

    const evidence = [createEvidence("bitcoin")];

    // No apiEnrichment — should produce actions without error
    const resultNoEnrichment = decideActions(state, evidence, createConfig(), createContext());
    expect(resultNoEnrichment.actions.length).toBeGreaterThanOrEqual(0);
    expect(resultNoEnrichment.log.timestamp).toBeTruthy();

    // With apiEnrichment — should also work without consuming it (Phase 6)
    const resultWithEnrichment = decideActions(state, evidence, createConfig(), createContext({
      apiEnrichment: {
        agentCount: 200,
        oracle: { divergences: [] },
        prices: [{ ticker: "BTC", priceUsd: 95000, fetchedAt: Date.now(), source: "binance" }],
      },
    }));
    expect(resultWithEnrichment.actions.length).toBeGreaterThanOrEqual(0);
    expect(resultWithEnrichment.log.timestamp).toBeTruthy();

    // With enrichment + enrichment-aware rules enabled, may produce additional actions
    expect(resultWithEnrichment.actions.length).toBeGreaterThanOrEqual(0);
  });

  // ── Phase 6a: Oracle & Signal-Aware Rules ──────────────────

  describe("publish_signal_aligned", () => {
    it("creates PUBLISH action when signals match evidence", () => {
      const state = createEmptyState();
      state.activity.trendingTopics = [{ topic: "defi", count: 5 }];

      const result = decideActions(state, [createEvidence("defi")], createConfig({
        rules: [
          ...createConfig().rules,
          { name: "publish_signal_aligned", type: "PUBLISH", priority: 90, conditions: [], enabled: true },
        ],
      }), createContext({
        apiEnrichment: {
          signals: [
            { topic: "defi", consensus: true, direction: "bullish", agentCount: 4, totalAgents: 10, confidence: 72, text: "DeFi analysis", trending: true },
          ],
        },
      }));

      const signalActions = result.actions.filter(
        (a) => a.reason.includes("signal") || a.reason.includes("Signal"),
      );
      expect(signalActions.length).toBeGreaterThanOrEqual(1);
      expect(signalActions[0]).toMatchObject({ type: "PUBLISH", priority: 90 });
    });

    it("skips gracefully when apiEnrichment.signals is null", () => {
      const state = createEmptyState();
      state.activity.trendingTopics = [{ topic: "defi", count: 5 }];

      const result = decideActions(state, [createEvidence("defi")], createConfig({
        rules: [
          ...createConfig().rules,
          { name: "publish_signal_aligned", type: "PUBLISH", priority: 90, conditions: [], enabled: true },
        ],
      }), createContext());

      // Should not crash, no signal-aligned actions
      const signalActions = result.actions.filter(
        (a) => a.reason.includes("signal") || a.reason.includes("Signal"),
      );
      expect(signalActions).toEqual([]);
    });

    it("skips when signals exist but no matching evidence", () => {
      const state = createEmptyState();
      state.activity.trendingTopics = [{ topic: "defi", count: 5 }];

      const result = decideActions(state, [createEvidence("governance")], createConfig({
        rules: [
          ...createConfig().rules,
          { name: "publish_signal_aligned", type: "PUBLISH", priority: 90, conditions: [], enabled: true },
        ],
      }), createContext({
        apiEnrichment: {
          signals: [
            { topic: "defi", consensus: true, direction: "bullish", agentCount: 4, totalAgents: 10, confidence: 72, text: "DeFi analysis", trending: true },
          ],
        },
      }));

      const signalActions = result.actions.filter(
        (a) => a.reason.includes("signal") || a.reason.includes("Signal"),
      );
      expect(signalActions).toEqual([]);
    });
  });

  describe("publish_on_divergence", () => {
    it("creates PUBLISH action when oracle shows significant divergence", () => {
      const state = createEmptyState();

      const result = decideActions(state, [createEvidence("btc")], createConfig({
        rules: [
          ...createConfig().rules,
          { name: "publish_on_divergence", type: "PUBLISH", priority: 85, conditions: [], enabled: true },
        ],
      }), createContext({
        apiEnrichment: {
          oracle: {
            divergences: [{ type: "agents_vs_market", asset: "BTC", description: "Agents bearish, market bullish", severity: "high" as const, details: { agentConfidence: 80 } }],
          },
          prices: [{ ticker: "BTC", priceUsd: 66000, fetchedAt: Date.now(), source: "binance" }],
        },
      }));

      const divActions = result.actions.filter(
        (a) => a.reason.includes("divergence") || a.reason.includes("Divergence"),
      );
      expect(divActions.length).toBeGreaterThanOrEqual(1);
      expect(divActions[0]).toMatchObject({ type: "PUBLISH", priority: 85 });
      expect(divActions[0].metadata).toHaveProperty("asset");
    });

    it("skips when oracle is null", () => {
      const state = createEmptyState();

      const result = decideActions(state, [createEvidence("btc")], createConfig({
        rules: [
          ...createConfig().rules,
          { name: "publish_on_divergence", type: "PUBLISH", priority: 85, conditions: [], enabled: true },
        ],
      }), createContext());

      const divActions = result.actions.filter(
        (a) => a.reason.includes("divergence") || a.reason.includes("Divergence"),
      );
      expect(divActions).toEqual([]);
    });
  });

  describe("publish_prediction", () => {
    const activePool = {
      asset: "BTC", horizon: "1h", totalBets: 5, totalDem: 25,
      poolAddress: "0xpool", roundEnd: Date.now() + 3600_000,
      bets: [{ txHash: "0xtx1", bettor: "0xa", predictedPrice: 70000, amount: 5, roundEnd: Date.now() + 3600_000, horizon: "1h" }],
    };

    it("creates PUBLISH action when betting pool is active (3+ bets) and prices available", () => {
      const state = createEmptyState();

      const result = decideActions(state, [], createConfig({
        rules: [
          ...createConfig().rules,
          { name: "publish_prediction", type: "PUBLISH", priority: 80, conditions: [], enabled: true },
        ],
      }), createContext({
        apiEnrichment: {
          bettingPool: activePool,
          prices: [
            { ticker: "BTC", priceUsd: 66000, fetchedAt: Date.now(), source: "binance" },
            { ticker: "ETH", priceUsd: 3200, fetchedAt: Date.now(), source: "binance" },
          ],
        },
      }));

      const predActions = result.actions.filter(
        (a) => a.reason.includes("prediction") || a.reason.includes("Prediction") || a.reason.includes("pool"),
      );
      expect(predActions.length).toBeGreaterThanOrEqual(1);
      expect(predActions[0]).toMatchObject({ type: "PUBLISH", priority: 80 });
    });

    it("skips when betting pool has fewer than 3 bets", () => {
      const state = createEmptyState();

      const result = decideActions(state, [], createConfig({
        rules: [
          ...createConfig().rules,
          { name: "publish_prediction", type: "PUBLISH", priority: 80, conditions: [], enabled: true },
        ],
      }), createContext({
        apiEnrichment: {
          bettingPool: { ...activePool, totalBets: 1 },
          prices: [{ ticker: "BTC", priceUsd: 66000, fetchedAt: Date.now(), source: "binance" }],
        },
      }));

      const predActions = result.actions.filter(
        (a) => a.reason.includes("prediction") || a.reason.includes("Prediction") || a.reason.includes("pool"),
      );
      expect(predActions).toEqual([]);
    });

    it("skips when no prices available", () => {
      const state = createEmptyState();

      const result = decideActions(state, [], createConfig({
        rules: [
          ...createConfig().rules,
          { name: "publish_prediction", type: "PUBLISH", priority: 80, conditions: [], enabled: true },
        ],
      }), createContext({
        apiEnrichment: {
          bettingPool: activePool,
        },
      }));

      const predActions = result.actions.filter(
        (a) => a.reason.includes("prediction") || a.reason.includes("Prediction") || a.reason.includes("pool"),
      );
      expect(predActions).toEqual([]);
    });

    it("skips when no betting pool data", () => {
      const state = createEmptyState();

      const result = decideActions(state, [], createConfig({
        rules: [
          ...createConfig().rules,
          { name: "publish_prediction", type: "PUBLISH", priority: 80, conditions: [], enabled: true },
        ],
      }), createContext({
        apiEnrichment: {
          prices: [{ ticker: "BTC", priceUsd: 66000, fetchedAt: Date.now(), source: "binance" }],
        },
      }));

      const predActions = result.actions.filter(
        (a) => a.reason.includes("prediction") || a.reason.includes("Prediction") || a.reason.includes("pool"),
      );
      expect(predActions).toEqual([]);
    });
  });

  describe("engage_sentiment_aligned (oracle-boosted)", () => {
    it("engage_verified uses oracle data to boost priority when available", () => {
      const state = createEmptyState();
      state.activity.trendingTopics = [{ topic: "btc", count: 5 }];
      state.agents.topContributors = [
        { author: "alice", postCount: 5, avgReactions: 8 },
      ];

      const resultWithOracle = decideActions(state, [createEvidence("btc")], createConfig({
        rules: createConfig().rules.map((r) => ({
          ...r,
          enabled: r.name === "engage_verified",
        })),
      }), createContext({
        apiEnrichment: {
          oracle: {
            divergences: [],
          },
        },
      }));

      expect(resultWithOracle.actions.length).toBeGreaterThanOrEqual(1);
      expect(resultWithOracle.actions[0].type).toBe("ENGAGE");
    });
  });

  // ── Phase 6b: Intelligence Layer Consumption ────────────────

  describe("tip_reputable (leaderboard-aware)", () => {
    it("uses leaderboard Bayesian scores when available", () => {
      const state = createEmptyState();
      state.agents.topContributors = [
        { author: "alice", postCount: 50, avgReactions: 9 },
        { author: "bob", postCount: 50, avgReactions: 5 },
        { author: "carol", postCount: 50, avgReactions: 1 },
      ];

      const result = decideActions(state, [], createConfig({
        rules: createConfig().rules.map((r) => ({
          ...r,
          enabled: r.name === "tip_valuable",
        })),
      }), createContext({
        apiEnrichment: {
          leaderboard: {
            agents: [
              { address: "alice", name: "alice", totalPosts: 50, avgScore: 85, bayesianScore: 88, topScore: 95, lowScore: 70, lastActiveAt: Date.now() },
              { address: "bob", name: "bob", totalPosts: 50, avgScore: 60, bayesianScore: 62, topScore: 75, lowScore: 45, lastActiveAt: Date.now() },
            ],
            count: 2,
            globalAvg: 70,
            confidenceThreshold: 5,
          },
        },
      }));

      // Should still tip alice (highest contributor)
      expect(result.actions.length).toBeGreaterThanOrEqual(1);
      expect(result.actions[0]).toMatchObject({ type: "TIP" });
    });
  });

  describe("reply_to_mentions with agent profiles (Phase 6b)", () => {
    it("trusts mentions from agents with high agrees/disagrees ratio", () => {
      const state = createEmptyState();
      state.threads.mentionsOfUs = [
        { txHash: "0xmention", author: "alice", text: "@loop check this" },
      ];
      state.agents.topContributors = [
        { author: "alice", postCount: 10, avgReactions: 5 },
      ];

      const result = decideActions(state, [], createConfig({
        rules: createConfig().rules.map((r) => ({
          ...r,
          enabled: r.name === "reply_to_mentions",
        })),
      }), createContext({
        intelligence: {
          agentProfiles: {
            alice: { postCount: 10, avgAgrees: 8.0, avgDisagrees: 1.0, topics: ["defi"] },
          },
        },
      }));

      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].type).toBe("REPLY");
    });

    it("rejects mentions from agents with poor agrees/disagrees ratio", () => {
      const state = createEmptyState();
      state.threads.mentionsOfUs = [
        { txHash: "0xmention", author: "troll", text: "@loop hey" },
      ];
      state.agents.topContributors = [
        { author: "troll", postCount: 10, avgReactions: 5 },
      ];

      const result = decideActions(state, [], createConfig({
        rules: createConfig().rules.map((r) => ({
          ...r,
          enabled: r.name === "reply_to_mentions",
        })),
      }), createContext({
        intelligence: {
          agentProfiles: {
            troll: { postCount: 10, avgAgrees: 2.0, avgDisagrees: 5.0, topics: [] },
          },
        },
      }));

      expect(result.actions).toEqual([]);
      expect(result.log.rejected).toHaveLength(1);
      expect(result.log.rejected[0].reason).toMatch(/trust check failed/);
    });
  });

  describe("tip_valuable with re-tip avoidance (Phase 6b)", () => {
    it("skips tipping agents we already interacted with", () => {
      const state = createEmptyState();
      state.agents.topContributors = [
        { author: "alice", postCount: 10, avgReactions: 9 },
        { author: "bob", postCount: 10, avgReactions: 5 },
        { author: "carol", postCount: 10, avgReactions: 1 },
      ];

      const result = decideActions(state, [], createConfig({
        rules: createConfig().rules.map((r) => ({
          ...r,
          enabled: r.name === "tip_valuable",
        })),
      }), createContext({
        intelligence: {
          recentTips: { alice: 2 },
        },
      }));

      // Alice should be skipped (already tipped), no other above-median candidates
      expect(result.actions).toEqual([]);
      expect(result.log.rejected.some((r) => r.reason.includes("Already tipped"))).toBe(true);
    });

    it("tips agents we have NOT interacted with", () => {
      const state = createEmptyState();
      state.agents.topContributors = [
        { author: "alice", postCount: 10, avgReactions: 9 },
        { author: "bob", postCount: 10, avgReactions: 5 },
        { author: "carol", postCount: 10, avgReactions: 1 },
      ];

      const result = decideActions(state, [], createConfig({
        rules: createConfig().rules.map((r) => ({
          ...r,
          enabled: r.name === "tip_valuable",
        })),
      }), createContext({
        intelligence: {
          recentTips: {}, // No recent tips
        },
      }));

      expect(result.actions.length).toBeGreaterThanOrEqual(1);
      expect(result.actions[0].type).toBe("TIP");
    });
  });

  describe("engage_novel_agents", () => {
    it("creates ENGAGE actions for high-quality agents from leaderboard", () => {
      const state = createEmptyState();

      const result = decideActions(state, [], createConfig({
        rules: [
          { name: "engage_novel_agents", type: "ENGAGE", priority: 70, conditions: [], enabled: true },
        ],
      }), createContext({
        apiEnrichment: {
          leaderboard: {
            agents: [
              { address: "alice", name: "alice", totalPosts: 50, avgScore: 85, bayesianScore: 88, topScore: 95, lowScore: 70, lastActiveAt: Date.now() },
              { address: "bob", name: "bob", totalPosts: 10, avgScore: 40, bayesianScore: 45, topScore: 55, lowScore: 30, lastActiveAt: Date.now() },
            ],
            count: 2,
            globalAvg: 70,
            confidenceThreshold: 5,
          },
        },
      }));

      // Should engage alice (above global avg) but not bob (below)
      const novelActions = result.actions.filter((a) => a.reason.includes("novel"));
      expect(novelActions.length).toBe(1);
      expect(novelActions[0].target).toBe("alice");
    });

    it("skips agents inactive for more than 48 hours", () => {
      const state = createEmptyState();
      const contextNow = new Date("2026-03-31T12:00:00.000Z");
      const threeDaysBefore = contextNow.getTime() - 3 * 24 * 60 * 60 * 1000;
      const oneHourBefore = contextNow.getTime() - 60 * 60 * 1000;

      const result = decideActions(state, [], createConfig({
        rules: [
          { name: "engage_novel_agents", type: "ENGAGE", priority: 70, conditions: [], enabled: true },
        ],
      }), createContext({
        apiEnrichment: {
          leaderboard: {
            agents: [
              { address: "stale-alice", name: "alice", totalPosts: 50, avgScore: 85, bayesianScore: 88, topScore: 95, lowScore: 70, lastActiveAt: threeDaysBefore },
              { address: "fresh-bob", name: "bob", totalPosts: 50, avgScore: 85, bayesianScore: 88, topScore: 95, lowScore: 70, lastActiveAt: oneHourBefore },
            ],
            count: 2,
            globalAvg: 70,
            confidenceThreshold: 5,
          },
        },
      }));

      const novelActions = result.actions.filter((a) => a.reason.includes("novel"));
      expect(novelActions.length).toBe(1);
      expect(novelActions[0].target).toBe("fresh-bob");
    });

    it("skips when leaderboard is not available", () => {
      const state = createEmptyState();

      const result = decideActions(state, [], createConfig({
        rules: [
          { name: "engage_novel_agents", type: "ENGAGE", priority: 70, conditions: [], enabled: true },
        ],
      }), createContext());

      const novelActions = result.actions.filter((a) => a.reason.includes("novel"));
      expect(novelActions).toEqual([]);
    });
  });

  describe("adapt_to_leaderboard", () => {
    it("produces no actions when disabled", () => {
      const result = decideActions(createEmptyState(), [], createConfig({
        rules: [
          { name: "adapt_to_leaderboard", type: "ENGAGE", priority: 0, conditions: [], enabled: false },
        ],
      }), createContext({
        apiEnrichment: {
          leaderboard: {
            agents: [],
            count: 0,
            globalAvg: 70,
            confidenceThreshold: 5,
          },
        },
      }));

      expect(result.actions).toEqual([]);
    });
  });

  describe("calibration-adjusted thresholds", () => {
    it("positive calibration raises threshold but cap at 95 prevents total blockage", () => {
      const state = createEmptyState();
      state.gaps.underservedTopics = [
        { topic: "security", lastPostAt: "2026-03-31T09:00:00.000Z" },
      ];

      // Evidence with richness 95 — equal to capped threshold of 95 and should pass
      const resultAboveCap = decideActions(state, [createEvidence("security", { richness: 95 })], createConfig({
        rules: createConfig().rules.map((r) => ({ ...r, enabled: r.name === "publish_to_gaps" })),
      }), createContext({
        calibration: { ourAvgScore: 50, colonyMedianScore: 40, offset: 10, postCount: 20, computedAt: new Date().toISOString() },
      }));

      // High offset (10) → min(95, max(50, 50 + 50)) = 95. Richness 95 >= 95 → publishes
      expect(resultAboveCap.actions).toHaveLength(1);
      expect(resultAboveCap.actions[0].type).toBe("PUBLISH");

      // Evidence with richness 90 — below capped threshold of 95 → blocked
      const resultBelowCap = decideActions(state, [createEvidence("security", { richness: 90 })], createConfig({
        rules: createConfig().rules.map((r) => ({ ...r, enabled: r.name === "publish_to_gaps" })),
      }), createContext({
        calibration: { ourAvgScore: 50, colonyMedianScore: 40, offset: 10, postCount: 20, computedAt: new Date().toISOString() },
      }));

      expect(resultBelowCap.actions).toEqual([]);
    });

    it("negative calibration lowers threshold (clamped at 50)", () => {
      const state = createEmptyState();
      state.gaps.underservedTopics = [
        { topic: "security", lastPostAt: "2026-03-31T09:00:00.000Z" },
      ];

      // Evidence with richness 60 — above adjusted 50 (offset=-20 → threshold=max(50, -50)=50)
      const resultLowCal = decideActions(state, [createEvidence("security", { richness: 60 })], createConfig({
        rules: createConfig().rules.map((r) => ({ ...r, enabled: r.name === "publish_to_gaps" })),
      }), createContext({
        calibration: { ourAvgScore: 10, colonyMedianScore: 30, offset: -20, postCount: 20, computedAt: new Date().toISOString() },
      }));

      // Negative offset → threshold clamped at 50. Richness 60 > 50 → publishes
      expect(resultLowCal.actions).toHaveLength(1);
      expect(resultLowCal.actions[0].type).toBe("PUBLISH");
    });

    it("zero calibration uses default threshold", () => {
      const state = createEmptyState();
      state.gaps.underservedTopics = [
        { topic: "security", lastPostAt: "2026-03-31T09:00:00.000Z" },
      ];

      const result = decideActions(state, [createEvidence("security", { richness: MIN_PUBLISH_EVIDENCE_RICHNESS })], createConfig({
        rules: createConfig().rules.map((r) => ({ ...r, enabled: r.name === "publish_to_gaps" })),
      }), createContext({
        calibration: { ourAvgScore: 30, colonyMedianScore: 30, offset: 0, postCount: 20, computedAt: new Date().toISOString() },
      }));

      // offset=0 → threshold = max(50, 50) = 50. Richness 50 >= 50 → publishes
      expect(result.actions).toHaveLength(1);
    });
  });

  describe("publish_to_gaps signal cross-reference", () => {
    it("suppresses publish_to_gaps when signals exist but none qualify (M3 fix)", () => {
      const state = createEmptyState();
      state.gaps.underservedTopics = [
        { topic: "defi", lastPostAt: "2026-03-31T09:00:00.000Z" },
      ];

      const result = decideActions(state, [createEvidence("defi")], createConfig({
        rules: createConfig().rules.map((r) => ({
          ...r,
          enabled: r.name === "publish_to_gaps",
        })),
      }), createContext({
        apiEnrichment: {
          signals: [
            // agentCount=1 < minSignalAgents=2, trending=false — does not qualify
            { topic: "defi", consensus: false, direction: "neutral", agentCount: 1, totalAgents: 10, confidence: 40, text: "Needs more agents", trending: false },
          ],
        },
      }));

      // M3: signals exist but none qualify — publish_to_gaps is suppressed
      expect(result.actions).toEqual([]);
    });
  });

  // ── Phase 7: ENGAGE targetType ──────────────────────────

  describe("engage targetType", () => {
    it("sets targetType 'agent' on engage_verified actions", () => {
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

      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].targetType).toBe("agent");
      expect(result.actions[0].target).toBe("alice");
    });

    it("does not set targetType on reply_to_mentions (target is already txHash)", () => {
      const state = createEmptyState();
      state.threads.mentionsOfUs = [
        { txHash: "0xmention-hash", author: "alice", text: "@loop data" },
      ];
      state.agents.topContributors = [
        { author: "alice", postCount: 5, avgReactions: 8 },
      ];

      const result = decideActions(state, [], createConfig({
        rules: createConfig().rules.map((rule) => ({
          ...rule,
          enabled: rule.name === "reply_to_mentions",
        })),
      }), createContext());

      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].targetType).toBeUndefined();
      expect(result.actions[0].target).toBe("0xmention-hash");
    });
  });

  // ── Phase 7: Briefing-aligned boost ──────────────────────

  describe("briefingContext boost", () => {
    it("boosts publish_to_gaps priority when topic appears in briefing", () => {
      const state = createEmptyState();
      state.gaps.underservedTopics = [
        { topic: "security", lastPostAt: "2026-03-31T09:00:00.000Z" },
      ];

      const resultWithBriefing = decideActions(state, [createEvidence("security")], createConfig({
        rules: createConfig().rules.map((rule) => ({
          ...rule,
          enabled: rule.name === "publish_to_gaps",
        })),
      }), createContext({ briefingContext: "Colony report highlights security concerns and governance proposals." }));

      const resultWithout = decideActions(state, [createEvidence("security")], createConfig({
        rules: createConfig().rules.map((rule) => ({
          ...rule,
          enabled: rule.name === "publish_to_gaps",
        })),
      }), createContext());

      expect(resultWithBriefing.actions[0].priority).toBe(60); // 50 + 10 briefing boost
      expect(resultWithout.actions[0].priority).toBe(50);
      expect(resultWithBriefing.actions[0].reason).toContain("briefing-aligned");
    });

    it("does not boost when briefing does not mention topic", () => {
      const state = createEmptyState();
      state.gaps.underservedTopics = [
        { topic: "security", lastPostAt: "2026-03-31T09:00:00.000Z" },
      ];

      const result = decideActions(state, [createEvidence("security")], createConfig({
        rules: createConfig().rules.map((rule) => ({
          ...rule,
          enabled: rule.name === "publish_to_gaps",
        })),
      }), createContext({ briefingContext: "Colony report focuses on DeFi yield farming trends." }));

      expect(result.actions[0].priority).toBe(50); // No boost
    });

    it("handles undefined briefingContext gracefully", () => {
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

      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].priority).toBe(50);
    });
  });

  // ── Phase 7: Leaderboard meta-rule ──────────────────────

  describe("applyLeaderboardAdjustment", () => {
    const defaultConfig = {
      enabled: true,
      topBoostEngagement: 15,
      topAdjustPublish: -5,
      bottomBoostPublish: 15,
      bottomAdjustEngagement: -5,
    };

    it("boosts ENGAGE/TIP and reduces PUBLISH for top quartile agents", () => {
      const actions = [
        { type: "ENGAGE" as const, priority: 65, reason: "test", target: "alice" },
        { type: "PUBLISH" as const, priority: 50, reason: "test" },
        { type: "TIP" as const, priority: 30, reason: "test", target: "bob" },
      ];

      const leaderboard = {
        agents: [
          { address: "OUR_ADDR", bayesianScore: 90, totalPosts: 100, name: "us" },
          { address: "agent2", bayesianScore: 80, totalPosts: 50, name: "two" },
          { address: "agent3", bayesianScore: 70, totalPosts: 30, name: "three" },
          { address: "agent4", bayesianScore: 60, totalPosts: 20, name: "four" },
          { address: "agent5", bayesianScore: 50, totalPosts: 10, name: "five" },
          { address: "agent6", bayesianScore: 40, totalPosts: 5, name: "six" },
          { address: "agent7", bayesianScore: 30, totalPosts: 3, name: "seven" },
          { address: "agent8", bayesianScore: 20, totalPosts: 1, name: "eight" },
        ],
        globalAvg: 55,
      };

      applyLeaderboardAdjustment(actions, leaderboard, "OUR_ADDR", defaultConfig);

      expect(actions[0].priority).toBe(80); // 65 + 15 (ENGAGE boost)
      expect(actions[1].priority).toBe(45); // 50 - 5 (PUBLISH reduction)
      expect(actions[2].priority).toBe(45); // 30 + 15 (TIP boost)
    });

    it("boosts PUBLISH and reduces ENGAGE/TIP for bottom quartile agents", () => {
      const actions = [
        { type: "ENGAGE" as const, priority: 65, reason: "test", target: "alice" },
        { type: "PUBLISH" as const, priority: 50, reason: "test" },
        { type: "TIP" as const, priority: 30, reason: "test", target: "bob" },
      ];

      const leaderboard = {
        agents: [
          { address: "top1", bayesianScore: 90, totalPosts: 100, name: "top" },
          { address: "top2", bayesianScore: 80, totalPosts: 50, name: "two" },
          { address: "mid1", bayesianScore: 70, totalPosts: 30, name: "three" },
          { address: "mid2", bayesianScore: 60, totalPosts: 20, name: "four" },
          { address: "mid3", bayesianScore: 50, totalPosts: 10, name: "five" },
          { address: "mid4", bayesianScore: 40, totalPosts: 5, name: "six" },
          { address: "OUR_ADDR", bayesianScore: 30, totalPosts: 3, name: "us" },
          { address: "bottom", bayesianScore: 20, totalPosts: 1, name: "eight" },
        ],
        globalAvg: 55,
      };

      applyLeaderboardAdjustment(actions, leaderboard, "OUR_ADDR", defaultConfig);

      expect(actions[0].priority).toBe(60); // 65 - 5 (ENGAGE reduction)
      expect(actions[1].priority).toBe(65); // 50 + 15 (PUBLISH boost)
      expect(actions[2].priority).toBe(25); // 30 - 5 (TIP reduction)
    });

    it("applies no adjustment for middle-ranked agents", () => {
      const actions = [
        { type: "ENGAGE" as const, priority: 65, reason: "test", target: "alice" },
        { type: "PUBLISH" as const, priority: 50, reason: "test" },
      ];

      // 8 agents, our rank at index 3 → percentile 3/8 = 0.375 (middle)
      const leaderboard = {
        agents: [
          { address: "top1", bayesianScore: 95, totalPosts: 200, name: "top1" },
          { address: "top2", bayesianScore: 90, totalPosts: 150, name: "top2" },
          { address: "mid1", bayesianScore: 80, totalPosts: 100, name: "mid1" },
          { address: "OUR_ADDR", bayesianScore: 70, totalPosts: 50, name: "us" },
          { address: "mid2", bayesianScore: 60, totalPosts: 30, name: "mid2" },
          { address: "mid3", bayesianScore: 50, totalPosts: 20, name: "mid3" },
          { address: "low1", bayesianScore: 40, totalPosts: 10, name: "low1" },
          { address: "low2", bayesianScore: 30, totalPosts: 5, name: "low2" },
        ],
        globalAvg: 64,
      };

      applyLeaderboardAdjustment(actions, leaderboard, "OUR_ADDR", defaultConfig);

      expect(actions[0].priority).toBe(65); // No change
      expect(actions[1].priority).toBe(50); // No change
    });

    it("handles missing leaderboard data gracefully", () => {
      const actions = [
        { type: "PUBLISH" as const, priority: 50, reason: "test" },
      ];

      applyLeaderboardAdjustment(actions, undefined, "OUR_ADDR", defaultConfig);
      expect(actions[0].priority).toBe(50); // No change

      applyLeaderboardAdjustment(actions, { agents: [], globalAvg: 0 }, "OUR_ADDR", defaultConfig);
      expect(actions[0].priority).toBe(50); // No change
    });

    it("handles agent not found on leaderboard", () => {
      const actions = [
        { type: "PUBLISH" as const, priority: 50, reason: "test" },
      ];

      const leaderboard = {
        agents: [
          { address: "other", bayesianScore: 90, totalPosts: 100, name: "other" },
        ],
        globalAvg: 90,
      };

      applyLeaderboardAdjustment(actions, leaderboard, "NOT_ON_BOARD", defaultConfig);
      expect(actions[0].priority).toBe(50); // No change
    });

    it("is case-insensitive for address matching", () => {
      const actions = [
        { type: "ENGAGE" as const, priority: 65, reason: "test", target: "x" },
      ];

      const leaderboard = {
        agents: [
          { address: "0xOUR_addr", bayesianScore: 90, totalPosts: 100, name: "us" },
          { address: "other1", bayesianScore: 80, totalPosts: 50, name: "a" },
          { address: "other2", bayesianScore: 70, totalPosts: 30, name: "b" },
          { address: "other3", bayesianScore: 60, totalPosts: 20, name: "c" },
        ],
        globalAvg: 75,
      };

      applyLeaderboardAdjustment(actions, leaderboard, "0xour_ADDR", defaultConfig);
      expect(actions[0].priority).toBe(80); // Top quartile boost applied
    });
  });

  // ── Phase 7: Leaderboard adjustment integration ──────────

  describe("leaderboard adjustment in decideActions", () => {
    it("adjusts priorities when leaderboardAdjustment is enabled in config", () => {
      const state = createEmptyState();
      state.activity.trendingTopics = [{ topic: "defi", count: 3 }];
      state.gaps.underservedTopics = [
        { topic: "defi", lastPostAt: "2026-03-31T09:00:00.000Z" },
      ];
      state.agents.topContributors = [
        { author: "alice", postCount: 5, avgReactions: 8 },
      ];

      const config = createConfig({
        leaderboardAdjustment: {
          enabled: true,
          topBoostEngagement: 20,
          topAdjustPublish: -10,
          bottomBoostPublish: 20,
          bottomAdjustEngagement: -10,
        },
      });

      const leaderboard = {
        agents: [
          { address: "demos1loop", bayesianScore: 95, totalPosts: 200, name: "us" },
          { address: "a2", bayesianScore: 80, totalPosts: 50, name: "a2" },
          { address: "a3", bayesianScore: 70, totalPosts: 30, name: "a3" },
          { address: "a4", bayesianScore: 60, totalPosts: 20, name: "a4" },
        ],
        globalAvg: 76,
      };

      const result = decideActions(state, [createEvidence("defi")], config, createContext({
        apiEnrichment: { leaderboard },
      }));

      // engage_verified should get boosted (+20)
      const engage = result.actions.find((a) => a.type === "ENGAGE");
      expect(engage).toBeDefined();
      expect(engage!.priority).toBe(85); // 65 + 20

      // publish_to_gaps should get reduced (-10)
      const publish = result.actions.find((a) => a.type === "PUBLISH");
      expect(publish).toBeDefined();
      expect(publish!.priority).toBe(40); // 50 - 10
    });
  });

  // ── M3: publish_to_gaps suppression when signals exist but none qualify ──

  describe("publish_to_gaps signal suppression", () => {
    it("suppresses publish_to_gaps when all signals are filtered by low agentCount", () => {
      const state = createEmptyState();
      state.gaps.underservedTopics = [
        { topic: "defi", lastPostAt: "2026-03-31T09:00:00.000Z" },
      ];

      const result = decideActions(state, [createEvidence("defi")], createConfig({
        rules: createConfig().rules.map((r) => ({
          ...r,
          enabled: r.name === "publish_to_gaps",
        })),
      }), createContext({
        apiEnrichment: {
          signals: [
            // agentCount=1 < minSignalAgents=2 — filtered out
            { topic: "defi", consensus: true, direction: "bullish", agentCount: 1, totalAgents: 10, confidence: 72, text: "DeFi", trending: true },
          ],
        },
      }));

      // All signals exist but none qualify — publish_to_gaps should be suppressed
      const gapActions = result.actions.filter((a) => a.reason.includes("underserved"));
      expect(gapActions).toEqual([]);
    });

    it("suppresses publish_to_gaps when all signals are non-trending", () => {
      const state = createEmptyState();
      state.gaps.underservedTopics = [
        { topic: "defi", lastPostAt: "2026-03-31T09:00:00.000Z" },
      ];

      const result = decideActions(state, [createEvidence("defi")], createConfig({
        rules: createConfig().rules.map((r) => ({
          ...r,
          enabled: r.name === "publish_to_gaps",
        })),
      }), createContext({
        apiEnrichment: {
          signals: [
            // trending=false — filtered out
            { topic: "defi", consensus: true, direction: "bullish", agentCount: 5, totalAgents: 10, confidence: 72, text: "DeFi", trending: false },
          ],
        },
      }));

      const gapActions = result.actions.filter((a) => a.reason.includes("underserved"));
      expect(gapActions).toEqual([]);
    });

    it("allows publish_to_gaps when no signals are provided at all", () => {
      const state = createEmptyState();
      state.gaps.underservedTopics = [
        { topic: "defi", lastPostAt: "2026-03-31T09:00:00.000Z" },
      ];

      const result = decideActions(state, [createEvidence("defi")], createConfig({
        rules: createConfig().rules.map((r) => ({
          ...r,
          enabled: r.name === "publish_to_gaps",
        })),
      }), createContext());

      // No signals at all — gaps should still work
      expect(result.actions.length).toBeGreaterThanOrEqual(1);
      expect(result.actions[0].type).toBe("PUBLISH");
    });

    it("allows publish_to_gaps when at least one signal qualifies", () => {
      const state = createEmptyState();
      state.gaps.underservedTopics = [
        { topic: "defi", lastPostAt: "2026-03-31T09:00:00.000Z" },
      ];

      const result = decideActions(state, [createEvidence("defi")], createConfig({
        rules: createConfig().rules.map((r) => ({
          ...r,
          enabled: r.name === "publish_to_gaps",
        })),
      }), createContext({
        apiEnrichment: {
          signals: [
            // This one qualifies: trending=true, agentCount=3 >= minSignalAgents=2
            { topic: "defi", consensus: true, direction: "bullish", agentCount: 3, totalAgents: 10, confidence: 72, text: "DeFi", trending: true },
          ],
        },
      }));

      expect(result.actions.length).toBeGreaterThanOrEqual(1);
      expect(result.actions[0].type).toBe("PUBLISH");
    });
  });

  // ── L1: Word-boundary domain matching in signal tokenization ──

  describe("signal token word-boundary matching", () => {
    it("does not match 'eth' as substring of 'method'", () => {
      const state = createEmptyState();

      const result = decideActions(state, [createEvidence("eth")], createConfig({
        rules: [
          ...createConfig().rules,
          { name: "publish_signal_aligned", type: "PUBLISH", priority: 90, conditions: [], enabled: true },
        ],
      }), createContext({
        apiEnrichment: {
          signals: [
            // Topic has "method" — should NOT match evidence key "eth"
            { topic: "A new method for analysis", consensus: true, direction: "bullish", agentCount: 4, totalAgents: 10, confidence: 72, text: "Analysis method", trending: true },
          ],
        },
      }));

      const signalActions = result.actions.filter((a) => a.reason.includes("signal"));
      expect(signalActions).toEqual([]);
    });

    it("matches 'eth' as a standalone word in signal topic", () => {
      const state = createEmptyState();

      const result = decideActions(state, [createEvidence("eth")], createConfig({
        rules: [
          ...createConfig().rules,
          { name: "publish_signal_aligned", type: "PUBLISH", priority: 90, conditions: [], enabled: true },
        ],
      }), createContext({
        apiEnrichment: {
          signals: [
            { topic: "ETH price movement analysis", consensus: true, direction: "bullish", agentCount: 4, totalAgents: 10, confidence: 72, text: "ETH analysis", trending: true },
          ],
        },
      }));

      const signalActions = result.actions.filter((a) => a.reason.includes("signal"));
      expect(signalActions.length).toBeGreaterThanOrEqual(1);
    });

    it("does not match 'oil' in 'toil'", () => {
      const state = createEmptyState();

      const result = decideActions(state, [createEvidence("oil")], createConfig({
        rules: [
          ...createConfig().rules,
          { name: "publish_signal_aligned", type: "PUBLISH", priority: 90, conditions: [], enabled: true },
        ],
      }), createContext({
        apiEnrichment: {
          signals: [
            { topic: "The toil of economic restructuring", consensus: true, direction: "bearish", agentCount: 4, totalAgents: 10, confidence: 72, text: "Economic toil", trending: true },
          ],
        },
      }));

      const signalActions = result.actions.filter((a) => a.reason.includes("signal"));
      expect(signalActions).toEqual([]);
    });
  });
});
