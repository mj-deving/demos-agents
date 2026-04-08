import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { computeAvailableEvidence, type AvailableEvidence } from "../../../src/toolkit/colony/available-evidence.js";
import { initColonyCache } from "../../../src/toolkit/colony/schema.js";
import { upsertSourceResponse } from "../../../src/toolkit/colony/source-cache.js";
import type { ColonyState } from "../../../src/toolkit/colony/state-extraction.js";
import { buildEvidenceIndex, findTopicEvidenceMatches, tokenizeTopic } from "../../../src/toolkit/strategy/engine-helpers.js";
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

function createPublishOnlyConfig(): StrategyConfig {
  return {
    rules: [
      {
        name: "reply_to_mentions",
        type: "REPLY",
        priority: 100,
        conditions: ["trusted mentions"],
        enabled: false,
      },
      {
        name: "engage_verified",
        type: "ENGAGE",
        priority: 65,
        conditions: ["verified topic"],
        enabled: false,
      },
      {
        name: "reply_with_evidence",
        type: "REPLY",
        priority: 80,
        conditions: ["matching evidence"],
        enabled: false,
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
        enabled: false,
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

function explainMatchFailure(
  topic: string,
  availableEvidence: AvailableEvidence[],
  match: ReturnType<typeof findTopicEvidenceMatches>,
  evidenceIndex: Map<string, AvailableEvidence[]>,
): string {
  if (match.topicTokens.length === 0) {
    return `tokenization mismatch: gap topic "${topic}" produced no searchable tokens after normalization`;
  }

  const subjectTokens = new Set(availableEvidence.flatMap((item) => tokenizeTopic(item.subject)));
  const sharedSubjectTokens = match.topicTokens.filter((token) => subjectTokens.has(token));

  if (sharedSubjectTokens.length === 0) {
    return `key format mismatch: gap tokens ${JSON.stringify(match.topicTokens)} do not appear in evidence subjects; evidence key sample=${JSON.stringify(Array.from(evidenceIndex.keys()).slice(0, 10))}; case sensitivity is unlikely because evidence keys are normalized to lowercase`;
  }

  return `key format mismatch: shared tokens ${JSON.stringify(sharedSubjectTokens)} exist between the gap topic and evidence subjects, but no evidence index entries were surfaced; evidence key sample=${JSON.stringify(Array.from(evidenceIndex.keys()).slice(0, 10))}; case sensitivity is unlikely because evidence keys are normalized to lowercase`;
}

describe("publish_to_gaps debug matching", () => {
  let db: ReturnType<typeof initColonyCache>;
  let originalDebugFlag: string | undefined;

  beforeEach(() => {
    db = initColonyCache(":memory:");
    originalDebugFlag = process.env.DEMOS_DEBUG_PUBLISH_TO_GAPS;
  });

  afterEach(() => {
    if (originalDebugFlag === undefined) {
      delete process.env.DEMOS_DEBUG_PUBLISH_TO_GAPS;
    } else {
      process.env.DEMOS_DEBUG_PUBLISH_TO_GAPS = originalDebugFlag;
    }
    db.close();
    vi.restoreAllMocks();
  });

  it("finds phrase-based evidence intersections for realistic crypto, defi, and macro gaps and emits debug diagnostics", () => {
    upsertSourceResponse(db, {
      sourceId: "btc-etf-desk",
      url: "https://example.com/btc-etf",
      lastFetchedAt: "2026-03-31T11:55:00.000Z",
      responseStatus: 200,
      responseSize: 600,
      responseBody: "{\"flows\":\"up\"}",
      ttlSeconds: 900,
      consecutiveFailures: 0,
    });
    upsertSourceResponse(db, {
      sourceId: "aave-gho-desk",
      url: "https://example.com/aave-gho",
      lastFetchedAt: "2026-03-31T11:56:00.000Z",
      responseStatus: 200,
      responseSize: 600,
      responseBody: "{\"gho\":\"growth\"}",
      ttlSeconds: 900,
      consecutiveFailures: 0,
    });
    upsertSourceResponse(db, {
      sourceId: "fed-runoff-desk",
      url: "https://example.com/fed-runoff",
      lastFetchedAt: "2026-03-31T11:57:00.000Z",
      responseStatus: 200,
      responseSize: 600,
      responseBody: "{\"qt\":\"continuing\"}",
      ttlSeconds: 900,
      consecutiveFailures: 0,
    });

    const availableEvidence = computeAvailableEvidence(db, [
      {
        id: "btc-etf-desk",
        topics: ["Bitcoin ETF institutional flows"],
        domainTags: ["Treasury desk demand"],
      },
      {
        id: "aave-gho-desk",
        topics: ["Aave GHO stablecoin growth"],
        domainTags: ["Borrow market utilization"],
      },
      {
        id: "fed-runoff-desk",
        topics: ["Federal Reserve balance sheet runoff"],
        domainTags: ["Dollar liquidity tightening"],
      },
    ], new Date("2026-03-31T12:00:00.000Z"));

    const evidenceIndex = buildEvidenceIndex(availableEvidence);
    const gaps = [
      { topic: "Bitcoin ETF custody demand", expectedSourceId: "btc-etf-desk" },
      { topic: "Aave GHO peg expansion", expectedSourceId: "aave-gho-desk" },
      { topic: "Federal Reserve QT pressure", expectedSourceId: "fed-runoff-desk" },
    ];

    for (const gap of gaps) {
      const match = findTopicEvidenceMatches(gap.topic, evidenceIndex);
      if (match.evidence.length === 0) {
        throw new Error(explainMatchFailure(gap.topic, availableEvidence, match, evidenceIndex));
      }

      expect(match.matchedKeys.length).toBeGreaterThan(0);
      expect(match.evidence.map((item) => item.sourceId)).toContain(gap.expectedSourceId);
    }

    const state = createEmptyState();
    state.gaps.underservedTopics = gaps.map((gap, index) => ({
      topic: gap.topic,
      lastPostAt: `2026-03-31T0${index}:00:00.000Z`,
    }));

    process.env.DEMOS_DEBUG_PUBLISH_TO_GAPS = "1";
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    const result = decideActions(state, availableEvidence, createPublishOnlyConfig(), createContext());

    expect(result.actions).toHaveLength(3);
    expect(result.actions.map((action) => action.target)).toEqual(expect.arrayContaining(gaps.map((gap) => gap.topic)));
    const evidenceByTarget = new Map(result.actions.map((action) => [action.target, action.evidence ?? []]));
    expect(evidenceByTarget.get("Bitcoin ETF custody demand")).toContain("btc-etf-desk");
    expect(evidenceByTarget.get("Aave GHO peg expansion")).toContain("aave-gho-desk");
    expect(evidenceByTarget.get("Federal Reserve QT pressure")).toContain("fed-runoff-desk");

    expect(debugSpy).toHaveBeenCalledWith("[strategy:publish_to_gaps] evidence index", expect.objectContaining({
      keyCount: evidenceIndex.size,
      keySample: expect.arrayContaining(["bitcoin etf institutional flows"]),
    }));

    const gapDebugCalls = debugSpy.mock.calls.filter(([message]) => message === "[strategy:publish_to_gaps] gap topic");
    expect(gapDebugCalls).toHaveLength(3);
    expect(gapDebugCalls.map(([, payload]) => payload)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        topic: "Bitcoin ETF custody demand",
        matched: true,
        tokens: expect.arrayContaining(["bitcoin", "etf", "custody", "demand"]),
      }),
      expect.objectContaining({
        topic: "Aave GHO peg expansion",
        matched: true,
        tokens: expect.arrayContaining(["aave", "gho", "peg", "expansion"]),
      }),
      expect.objectContaining({
        topic: "Federal Reserve QT pressure",
        matched: true,
        tokens: expect.arrayContaining(["federal", "reserve", "pressure"]),
      }),
    ]));

    for (const [, payload] of gapDebugCalls) {
      expect(payload).toEqual(expect.objectContaining({
        firstMatches: expect.any(Array),
      }));
      expect(payload.firstMatches.length).toBeGreaterThan(0);
      expect(payload.firstMatches.length).toBeLessThanOrEqual(3);
    }
  });
});
