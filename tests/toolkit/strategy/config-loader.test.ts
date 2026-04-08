import { describe, expect, it } from "vitest";

import { loadStrategyConfig } from "../../../src/toolkit/strategy/config-loader.js";

describe("strategy config loader", () => {
  it("loads valid YAML into a strategy config", () => {
    const config = loadStrategyConfig(`
apiVersion: strategy/v3
rules:
  - name: reply_to_mentions
    type: REPLY
    priority: 100
    conditions:
      - trusted mentions
    enabled: true
rateLimits:
  postsPerDay: 14
  postsPerHour: 5
  reactionsPerSession: 8
  maxTipAmount: 10
performance:
  engagement: 40
  discussion: 25
  replyBase: 10
  replyDeep: 10
  threadDepth: 5
  economic: 20
  tipBase: 10
  tipCap: 10
  tipMultiplier: 2
  controversy: 5
  ageHalfLife: 48
topicWeights:
  governance: 1.2
`);

    expect(config.rules).toHaveLength(1);
    expect(config.rules[0].name).toBe("reply_to_mentions");
    expect(config.topicWeights.governance).toBe(1.2);
  });

  it("applies defaults for missing optional fields", () => {
    const config = loadStrategyConfig(`
apiVersion: strategy/v3
rules:
  - name: publish_to_gaps
    type: PUBLISH
    priority: 50
    conditions:
      - fresh evidence
    enabled: true
rateLimits:
  postsPerDay: 10
performance:
  engagement: 12
`);

    expect(config.rateLimits.postsPerDay).toBe(10);
    expect(config.rateLimits.postsPerHour).toBe(5);
    expect(config.rateLimits.reactionsPerSession).toBe(8);
    expect(config.rateLimits.maxTipAmount).toBe(10);
    expect(config.performance.engagement).toBe(12);
    expect(config.performance.discussion).toBe(25);
  });

  it("clamps rate limits to toolkit ceilings", () => {
    const config = loadStrategyConfig(`
apiVersion: strategy/v3
rules:
  - name: tip_valuable
    type: TIP
    priority: 30
    conditions:
      - above median
    enabled: true
rateLimits:
  postsPerDay: 20
  postsPerHour: 10
  reactionsPerSession: 8
  maxTipAmount: 25
performance:
  engagement: 40
`);

    expect(config.rateLimits).toEqual({
      postsPerDay: 14,
      postsPerHour: 5,
      reactionsPerSession: 8,
      maxTipAmount: 10,
      betsPerDay: 3,
    });
  });

  it("throws on invalid YAML", () => {
    expect(() => loadStrategyConfig("rules: [")).toThrow(/yaml|parse/i);
  });

  it("throws when required fields are missing", () => {
    expect(() => loadStrategyConfig(`
apiVersion: strategy/v3
rateLimits:
  postsPerDay: 14
`)).toThrow(/rules/i);
  });

  it("applies defaults for missing limits section", () => {
    const config = loadStrategyConfig(`
apiVersion: strategy/v3
rules:
  - name: publish_to_gaps
    type: PUBLISH
    priority: 50
    conditions:
      - fresh evidence
    enabled: true
rateLimits:
  postsPerDay: 14
performance:
  engagement: 40
`);

    expect(config.limits).toBeDefined();
    expect(config.limits!.recentPostsFetchLimit).toBe(500);
    expect(config.limits!.proofIngestionConcurrency).toBe(5);
    expect(config.limits!.proofIngestionLimit).toBe(20);
    expect(config.limits!.sourcesPerIntent).toBe(5);
    expect(config.limits!.sourceFetchConcurrency).toBe(3);
    expect(config.limits!.sourceFetchBudgetMs).toBe(15_000);
    expect(config.limits!.sseTimeoutMs).toBe(5_000);
    expect(config.limits!.sseMaxEvents).toBe(100);
    expect(config.limits!.leaderboardLimit).toBe(20);
    expect(config.limits!.subprocessTimeoutMs).toBe(180_000);
    expect(config.limits!.phaseBudgets).toEqual({
      senseMs: 120_000,
      actMs: 120_000,
      confirmMs: 60_000,
    });
  });

  it("accepts custom limits from YAML", () => {
    const config = loadStrategyConfig(`
apiVersion: strategy/v3
rules:
  - name: publish_to_gaps
    type: PUBLISH
    priority: 50
    conditions:
      - fresh evidence
    enabled: true
rateLimits:
  postsPerDay: 14
performance:
  engagement: 40
limits:
  recentPostsFetchLimit: 1000
  proofIngestionConcurrency: 3
  sseTimeoutMs: 10000
  phaseBudgets:
    senseMs: 180000
    actMs: 90000
    confirmMs: 30000
`);

    expect(config.limits!.recentPostsFetchLimit).toBe(1000);
    expect(config.limits!.proofIngestionConcurrency).toBe(3);
    expect(config.limits!.sseTimeoutMs).toBe(10_000);
    // Non-specified limits keep defaults
    expect(config.limits!.proofIngestionLimit).toBe(20);
    expect(config.limits!.sourcesPerIntent).toBe(5);
    expect(config.limits!.phaseBudgets.senseMs).toBe(180_000);
    expect(config.limits!.phaseBudgets.actMs).toBe(90_000);
  });

  it("defaults topicWeights to an empty object", () => {
    const config = loadStrategyConfig(`
apiVersion: strategy/v3
rules:
  - name: reply_to_mentions
    type: REPLY
    priority: 100
    conditions:
      - trusted mentions
    enabled: true
rateLimits:
  postsPerDay: 14
performance:
  engagement: 40
`);

    expect(config.topicWeights).toEqual({});
  });
});
