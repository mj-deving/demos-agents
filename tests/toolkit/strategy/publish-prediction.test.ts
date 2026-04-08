import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadStrategyConfig } from "../../../src/toolkit/strategy/config-loader.js";
import { buildEvidenceIndex } from "../../../src/toolkit/strategy/engine-helpers.js";
import { evaluateEnrichmentRules } from "../../../src/toolkit/strategy/engine-enrichment.js";
import type { DecisionContext, DecisionLog, StrategyConfig } from "../../../src/toolkit/strategy/types.js";
import { makeBettingPool, makePriceData } from "../primitives/_helpers.js";

function createConfig(enabled = true): StrategyConfig {
  return {
    rules: [
      {
        name: "publish_prediction",
        type: "PUBLISH",
        priority: 45,
        conditions: [
          "Active betting pool for configured asset",
          "Pool has at least 3 bets",
          "Price data available",
        ],
        enabled,
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

function createContext(apiEnrichment?: DecisionContext["apiEnrichment"]): DecisionContext {
  return {
    ourAddress: "demos1loop",
    sessionReactionsUsed: 0,
    postsToday: 0,
    postsThisHour: 0,
    now: new Date("2026-03-31T12:00:00.000Z"),
    apiEnrichment,
  };
}

function evaluatePredictionRule(
  apiEnrichment?: DecisionContext["apiEnrichment"],
  config = createConfig(),
): { candidates: Array<{ action: { metadata?: Record<string, unknown>; reason: string; type: string; priority: number } ; rule: string }>; considered: DecisionLog["considered"] } {
  const candidates: Array<{ action: { metadata?: Record<string, unknown>; reason: string; type: string; priority: number }; rule: string }> = [];
  const considered: DecisionLog["considered"] = [];

  evaluateEnrichmentRules(
    config,
    createContext(apiEnrichment),
    buildEvidenceIndex([]),
    candidates,
    considered,
  );

  return { candidates, considered };
}

describe("publish_prediction rule", () => {
  const roundEnd = 1_775_648_400_000;
  const validEnrichment = {
    bettingPool: makeBettingPool({
      asset: "BTC",
      totalBets: 3,
      totalDem: 15,
      roundEnd,
      bets: [
        {
          txHash: "0xtx1",
          bettor: "0xagent-a",
          predictedPrice: 70_000,
          amount: 5,
          roundEnd,
          horizon: "1h",
        },
      ],
    }),
    prices: [
      makePriceData({ ticker: "BTC", priceUsd: 66_000, fetchedAt: roundEnd - 60_000 }),
      makePriceData({ ticker: "ETH", priceUsd: 3_200, fetchedAt: roundEnd - 60_000 }),
    ],
  } satisfies NonNullable<DecisionContext["apiEnrichment"]>;

  it("fires when the rule is enabled, the pool has at least 3 bets, and prices are present", () => {
    const { candidates, considered } = evaluatePredictionRule(validEnrichment);

    expect(candidates).toHaveLength(1);
    expect(considered).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      rule: "publish_prediction",
      action: {
        type: "PUBLISH",
        priority: 45,
        reason: "Publish prediction — BTC pool active (3 bets, 15 DEM)",
        metadata: {
          poolAsset: "BTC",
          totalBets: 3,
          totalDem: 15,
          roundEnd,
          availableAssets: ["BTC", "ETH"],
        },
      },
    });
  });

  it.each([
    ["the rule is disabled", validEnrichment, createConfig(false)],
    ["bettingPool is missing", { prices: validEnrichment.prices }, createConfig()],
    ["the pool has fewer than 3 bets", { ...validEnrichment, bettingPool: makeBettingPool({ totalBets: 2, roundEnd }) }, createConfig()],
    ["prices is missing", { bettingPool: validEnrichment.bettingPool }, createConfig()],
    ["prices is empty", { bettingPool: validEnrichment.bettingPool, prices: [] }, createConfig()],
  ])("does not fire when %s", (_label, apiEnrichment, config) => {
    const { candidates, considered } = evaluatePredictionRule(apiEnrichment, config);

    expect(candidates).toEqual([]);
    expect(considered).toEqual([]);
  });

  it("documents the minimal apiEnrichment shape and shows deprecated ballotAccuracy is ignored", () => {
    const minimalRequiredShape = {
      bettingPool: validEnrichment.bettingPool,
      prices: [validEnrichment.prices[0]],
    } satisfies Required<Pick<NonNullable<DecisionContext["apiEnrichment"]>, "bettingPool" | "prices">>;

    const deprecatedBallotOnly = {
      ballotAccuracy: {
        address: "0xagent-a",
        totalVotes: 10,
        correctVotes: 7,
        accuracy: 0.7,
        streak: 2,
      },
    } satisfies NonNullable<DecisionContext["apiEnrichment"]>;

    expect(evaluatePredictionRule(minimalRequiredShape).candidates).toHaveLength(1);
    expect(evaluatePredictionRule(deprecatedBallotOnly).candidates).toEqual([]);
  });
});

describe("sentinel publish_prediction config", () => {
  it("is enabled in agents/sentinel/strategy.yaml with conditions aligned to runtime behavior", () => {
    const config = loadStrategyConfig(
      readFileSync(resolve(process.cwd(), "agents/sentinel/strategy.yaml"), "utf-8"),
    );
    const rule = config.rules.find((candidate) => candidate.name === "publish_prediction");

    expect(rule).toMatchObject({
      name: "publish_prediction",
      type: "PUBLISH",
      priority: 45,
      enabled: true,
      conditions: [
        "Active betting pool for configured asset",
        "Pool has at least 3 bets",
        "Price data available",
      ],
    });
  });
});
