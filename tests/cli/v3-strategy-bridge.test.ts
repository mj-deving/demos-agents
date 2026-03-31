import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

import { initColonyCache, type ColonyDatabase } from "../../src/toolkit/colony/schema.js";
import { insertPost } from "../../src/toolkit/colony/posts.js";
import { upsertReaction } from "../../src/toolkit/colony/reactions.js";
import { upsertSourceResponse } from "../../src/toolkit/colony/source-cache.js";
import { loadStrategyConfig } from "../../src/toolkit/strategy/config-loader.js";
import {
  sense,
  plan,
  computePerformance,
  filterActions,
  summarizeActions,
  type StrategyBridgeContext,
} from "../../cli/v3-strategy-bridge.js";
import { FileStateStore } from "../../src/toolkit/state-store.js";

const STRATEGY_YAML = `
apiVersion: strategy/v3
rules:
  - name: reply_to_mentions
    type: REPLY
    priority: 100
    conditions: ["trusted mentions"]
    enabled: true
  - name: engage_verified
    type: ENGAGE
    priority: 65
    conditions: ["verified topic"]
    enabled: true
  - name: reply_with_evidence
    type: REPLY
    priority: 80
    conditions: ["matching evidence"]
    enabled: true
  - name: publish_to_gaps
    type: PUBLISH
    priority: 50
    conditions: ["fresh evidence"]
    enabled: true
  - name: tip_valuable
    type: TIP
    priority: 30
    conditions: ["above median"]
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
  defi: 1.0
`;

function createBridgeContext(db: ColonyDatabase): StrategyBridgeContext {
  const config = loadStrategyConfig(STRATEGY_YAML);
  const stateDir = resolve(tmpdir(), `bridge-test-${Date.now()}`);
  mkdirSync(stateDir, { recursive: true });
  const store = new FileStateStore(stateDir);

  return {
    db,
    config,
    walletAddress: "demos1sentinel",
    store,
  };
}

function seedColony(db: ColonyDatabase): void {
  // Our posts
  insertPost(db, {
    txHash: "0xours-1",
    author: "demos1sentinel",
    blockNumber: 100,
    timestamp: "2026-03-31T10:00:00.000Z",
    replyTo: null,
    tags: ["defi"],
    text: "Our analysis post about DeFi trends",
    rawData: { id: 1 },
  });

  // Other agent posts
  insertPost(db, {
    txHash: "0xalice-1",
    author: "alice",
    blockNumber: 101,
    timestamp: "2026-03-31T10:30:00.000Z",
    replyTo: null,
    tags: ["defi"],
    text: "Alice's post about DeFi",
    rawData: { id: 2 },
  });
  insertPost(db, {
    txHash: "0xbob-1",
    author: "bob",
    blockNumber: 102,
    timestamp: "2026-03-31T11:00:00.000Z",
    replyTo: null,
    tags: ["governance"],
    text: "Bob's governance analysis @demos1sentinel check this",
    rawData: { id: 3 },
  });
  insertPost(db, {
    txHash: "0xbob-reply",
    author: "bob",
    blockNumber: 103,
    timestamp: "2026-03-31T11:15:00.000Z",
    replyTo: "0xours-1",
    tags: ["defi"],
    text: "Reply to our post",
    rawData: { id: 4 },
  });

  // Reactions
  upsertReaction(db, {
    postTxHash: "0xours-1",
    agrees: 5,
    disagrees: 1,
    tipsCount: 1,
    tipsTotalDem: 3,
    replyCount: 1,
    lastUpdatedAt: "2026-03-31T12:00:00.000Z",
  });
  upsertReaction(db, {
    postTxHash: "0xalice-1",
    agrees: 3,
    disagrees: 0,
    tipsCount: 0,
    tipsTotalDem: 0,
    replyCount: 0,
    lastUpdatedAt: "2026-03-31T12:00:00.000Z",
  });
  upsertReaction(db, {
    postTxHash: "0xbob-1",
    agrees: 8,
    disagrees: 2,
    tipsCount: 1,
    tipsTotalDem: 5,
    replyCount: 0,
    lastUpdatedAt: "2026-03-31T12:00:00.000Z",
  });
}

describe("v3-strategy-bridge", () => {
  let db: ColonyDatabase;

  beforeEach(() => {
    db = initColonyCache(":memory:");
    seedColony(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("sense()", () => {
    it("extracts colony state and available evidence from the cache", () => {
      const ctx = createBridgeContext(db);

      // Seed a source response in the cache
      upsertSourceResponse(db, {
        sourceId: "coingecko-defi",
        url: "https://api.coingecko.com/api/v3/global/defi",
        responseBody: '{"tvl": 45000000000}',
        responseStatus: 200,
        responseSize: 23,
        lastFetchedAt: new Date().toISOString(),
        ttlSeconds: 3600,
        consecutiveFailures: 0,
      });

      const sourceView = {
        agent: "sentinel" as any,
        catalogVersion: 2 as const,
        sources: [{
          id: "coingecko-defi",
          topics: ["defi"],
          domainTags: ["tvl", "market-cap"],
          // Minimal fields to satisfy the map
        }] as any,
        index: {} as any,
      };

      const result = sense(ctx, sourceView);

      expect(result.colonyState).toBeDefined();
      expect(result.colonyState.activity.postsPerHour).toBeGreaterThan(0);
      expect(result.colonyState.agents.topContributors.length).toBeGreaterThan(0);
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0].sourceId).toBe("coingecko-defi");
      expect(result.evidence[0].subject).toBe("defi");
    });

    it("returns empty evidence when no source responses are cached", () => {
      const ctx = createBridgeContext(db);
      const sourceView = {
        agent: "sentinel" as any,
        catalogVersion: 2 as const,
        sources: [] as any,
        index: {} as any,
      };

      const result = sense(ctx, sourceView);

      expect(result.colonyState).toBeDefined();
      expect(result.evidence).toEqual([]);
    });
  });

  describe("plan()", () => {
    it("produces strategy actions from colony state and evidence", async () => {
      const ctx = createBridgeContext(db);

      upsertSourceResponse(db, {
        sourceId: "defi-llama",
        url: "https://api.llama.fi/protocols",
        responseBody: '{"protocols": []}',
        responseStatus: 200,
        responseSize: 200,
        lastFetchedAt: new Date().toISOString(),
        ttlSeconds: 3600,
        consecutiveFailures: 0,
      });

      const sourceView = {
        agent: "sentinel" as any,
        catalogVersion: 2 as const,
        sources: [{
          id: "defi-llama",
          topics: ["defi"],
          domainTags: ["tvl"],
        }] as any,
        index: {} as any,
      };

      const senseResult = sense(ctx, sourceView);
      const result = await plan(ctx, senseResult, 0);

      expect(result.actions).toBeDefined();
      expect(result.log).toBeDefined();
      expect(result.log.timestamp).toBeDefined();
      expect(result.log.considered).toBeDefined();
      expect(result.log.selected).toBeDefined();
      expect(result.log.rejected).toBeDefined();
      expect(result.log.rateLimitState.dailyRemaining).toBeLessThanOrEqual(14);
    });

    it("passes sessionReactionsUsed through to context", async () => {
      const ctx = createBridgeContext(db);
      const senseResult = sense(ctx, {
        agent: "sentinel" as any,
        catalogVersion: 2 as const,
        sources: [] as any,
        index: {} as any,
      });

      const result = await plan(ctx, senseResult, 7);

      // With 7 reactions used and limit 8, only 1 remaining
      expect(result.log.rateLimitState.reactionsRemaining).toBe(1);
    });
  });

  describe("computePerformance()", () => {
    it("returns performance scores for our posts", () => {
      const ctx = createBridgeContext(db);
      const scores = computePerformance(ctx);

      expect(scores).toHaveLength(1);
      expect(scores[0].txHash).toBe("0xours-1");
      expect(scores[0].rawScore).toBeGreaterThan(0);
      expect(scores[0].decayedScore).toBeGreaterThan(0);
      expect(scores[0].breakdown.engagement).toBeGreaterThan(0);
    });

    it("returns empty array when agent has no posts", () => {
      const emptyDb = initColonyCache(":memory:");
      const ctx = createBridgeContext(emptyDb);
      const scores = computePerformance(ctx);

      expect(scores).toEqual([]);
      emptyDb.close();
    });
  });

  describe("filterActions()", () => {
    it("filters actions by type", () => {
      const actions = [
        { type: "ENGAGE" as const, priority: 65, reason: "test", target: "alice" },
        { type: "REPLY" as const, priority: 100, reason: "test", target: "0xtx" },
        { type: "TIP" as const, priority: 30, reason: "test", target: "bob" },
        { type: "REPLY" as const, priority: 80, reason: "test", target: "0xtx2" },
      ];

      expect(filterActions(actions, "REPLY")).toHaveLength(2);
      expect(filterActions(actions, "ENGAGE")).toHaveLength(1);
      expect(filterActions(actions, "PUBLISH")).toHaveLength(0);
    });
  });

  describe("summarizeActions()", () => {
    it("counts actions by type", () => {
      const actions = [
        { type: "ENGAGE" as const, priority: 65, reason: "test" },
        { type: "REPLY" as const, priority: 100, reason: "test" },
        { type: "REPLY" as const, priority: 80, reason: "test" },
        { type: "TIP" as const, priority: 30, reason: "test" },
      ];

      expect(summarizeActions(actions)).toEqual({
        ENGAGE: 1,
        REPLY: 2,
        TIP: 1,
      });
    });

    it("returns empty object for no actions", () => {
      expect(summarizeActions([])).toEqual({});
    });
  });
});
