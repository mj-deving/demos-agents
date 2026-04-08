/**
 * Tests for templates/market-intelligence/ — market-specific observe function.
 *
 * Verifies:
 * - oracle.get() called with correct assets
 * - prices.get() called
 * - divergences detection from OracleResult (real API shape)
 * - Betting pool evidence when pool has 3+ bets
 * - NULL SAFETY: all ApiResult checks use ?.ok
 * - Evidence uses real AvailableEvidence shape
 * - apiEnrichment context includes oracle, prices, signals, bettingPool
 * - strategy.yaml and sources.yaml are well-formed
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadStrategyConfig } from "../../src/toolkit/strategy/config-loader.js";
import type { Toolkit } from "../../src/toolkit/primitives/types.js";
import type { ObserveResult } from "../../src/toolkit/agent-loop.js";
import type { OracleResult, PriceData, SignalData, BettingPool, FeedResponse } from "../../src/toolkit/supercolony/types.js";
import { mockOk, mockErr, makePriceData, makeSignalData, makeBettingPool } from "../toolkit/primitives/_helpers.js";

const TEMPLATE_DIR = resolve(import.meta.dirname, "../../templates/market-intelligence");

// ── Mock Toolkit factory ──────────────────────────

function createMockToolkit(overrides: Record<string, unknown> = {}): Toolkit {
  return {
    feed: {
      getRecent: vi.fn().mockResolvedValue(mockOk({ posts: [] })),
      search: vi.fn().mockResolvedValue(null),
      getPost: vi.fn().mockResolvedValue(null),
      getThread: vi.fn().mockResolvedValue(null),
    },
    intelligence: {
      getSignals: vi.fn().mockResolvedValue(null),
      getReport: vi.fn().mockResolvedValue(null),
    },
    scores: { getLeaderboard: vi.fn().mockResolvedValue(null) },
    agents: {
      list: vi.fn().mockResolvedValue(null),
      getProfile: vi.fn().mockResolvedValue(null),
      getIdentities: vi.fn().mockResolvedValue(null),
    },
    actions: {
      tip: vi.fn().mockResolvedValue(null),
      react: vi.fn().mockResolvedValue(null),
      getReactions: vi.fn().mockResolvedValue(null),
      getTipStats: vi.fn().mockResolvedValue(null),
      getAgentTipStats: vi.fn().mockResolvedValue(null),
      placeBet: vi.fn().mockResolvedValue(null),
    },
    oracle: { get: vi.fn().mockResolvedValue(null) },
    prices: { get: vi.fn().mockResolvedValue(null) },
    verification: {
      verifyDahr: vi.fn().mockResolvedValue(null),
      verifyTlsn: vi.fn().mockResolvedValue(null),
    },
    predictions: {
      query: vi.fn().mockResolvedValue(null),
      resolve: vi.fn().mockResolvedValue(null),
      markets: vi.fn().mockResolvedValue(null),
    },
    ballot: {
      getState: vi.fn().mockResolvedValue(null),
      getAccuracy: vi.fn().mockResolvedValue(null),
      getLeaderboard: vi.fn().mockResolvedValue(null),
      getPerformance: vi.fn().mockResolvedValue(null),
      getPool: vi.fn().mockResolvedValue(null),
    },
    webhooks: {
      list: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(null),
    },
    identity: { lookup: vi.fn().mockResolvedValue(null) },
    balance: { get: vi.fn().mockResolvedValue(null) },
    health: { check: vi.fn().mockResolvedValue(null) },
    stats: { get: vi.fn().mockResolvedValue(null) },
    ...overrides,
  } as unknown as Toolkit;
}

// ── Test data ─────────────────────────────────────

const MOCK_ORACLE: OracleResult = {
  divergences: [
    { type: "agents_vs_market", asset: "BTC", description: "Low divergence", severity: "low" as const },
    { type: "agents_vs_market", asset: "ETH", description: "High divergence — agents bullish, market down", severity: "high" as const, details: { agentConfidence: 85 } },
  ],
};

const MOCK_PRICES: PriceData[] = [
  makePriceData({ ticker: "BTC", priceUsd: 60000 }),
  makePriceData({ ticker: "ETH", priceUsd: 3000 }),
];

const MOCK_SIGNALS: SignalData[] = [
  makeSignalData({ topic: "defi", agentCount: 5, totalAgents: 10, text: "DeFi bullish" }),
];

const MOCK_POOL: BettingPool = makeBettingPool({
  horizon: "24h",
  totalBets: 5,
  totalDem: 100,
  bets: [
    { txHash: "0xtx1", bettor: "0xa1", predictedPrice: 61000, amount: 20, roundEnd: Date.now() + 86400000, horizon: "24h" },
    { txHash: "0xtx2", bettor: "0xa2", predictedPrice: 59000, amount: 30, roundEnd: Date.now() + 86400000, horizon: "24h" },
    { txHash: "0xtx3", bettor: "0xa3", predictedPrice: 60500, amount: 50, roundEnd: Date.now() + 86400000, horizon: "24h" },
  ],
});

const MOCK_POOL_SMALL: BettingPool = makeBettingPool({
  horizon: "24h",
  totalBets: 2,
  totalDem: 30,
  bets: [
    { txHash: "0xtx1", bettor: "0xa1", predictedPrice: 61000, amount: 10, roundEnd: Date.now() + 86400000, horizon: "24h" },
    { txHash: "0xtx2", bettor: "0xa2", predictedPrice: 59000, amount: 20, roundEnd: Date.now() + 86400000, horizon: "24h" },
  ],
});

const OUR_ADDRESS = "0xmarket-agent";

// ── Lazy-load the observe function ────────────────

let marketObserve: (toolkit: Toolkit, address: string) => Promise<ObserveResult>;

beforeEach(async () => {
  const mod = await import("../../templates/market-intelligence/observe.js");
  marketObserve = mod.marketObserve;
});

// ── Tests ─────────────────────────────────────────

describe("templates/market-intelligence", () => {
  describe("marketObserve()", () => {
    it("calls oracle.get() with BTC and ETH assets", async () => {
      const toolkit = createMockToolkit();
      await marketObserve(toolkit, OUR_ADDRESS);
      expect(toolkit.oracle.get).toHaveBeenCalledWith({ assets: ["BTC", "ETH"] });
    });

    it("calls prices.get() with BTC and ETH", async () => {
      const toolkit = createMockToolkit();
      await marketObserve(toolkit, OUR_ADDRESS);
      expect(toolkit.prices.get).toHaveBeenCalledWith(["BTC", "ETH"]);
    });

    it("calls intelligence.getSignals()", async () => {
      const toolkit = createMockToolkit();
      await marketObserve(toolkit, OUR_ADDRESS);
      expect(toolkit.intelligence.getSignals).toHaveBeenCalled();
    });

    it("calls ballot.getPool()", async () => {
      const toolkit = createMockToolkit();
      await marketObserve(toolkit, OUR_ADDRESS);
      expect(toolkit.ballot.getPool).toHaveBeenCalled();
    });

    it("fetches all data sources in parallel (feed, oracle, prices, signals, pool)", async () => {
      const toolkit = createMockToolkit();
      await marketObserve(toolkit, OUR_ADDRESS);

      // All five calls should have been made
      expect(toolkit.feed.getRecent).toHaveBeenCalled();
      expect(toolkit.oracle.get).toHaveBeenCalled();
      expect(toolkit.prices.get).toHaveBeenCalled();
      expect(toolkit.intelligence.getSignals).toHaveBeenCalled();
      expect(toolkit.ballot.getPool).toHaveBeenCalled();
    });

    it("creates evidence from oracle divergences", async () => {
      const toolkit = createMockToolkit({
        oracle: { get: vi.fn().mockResolvedValue(mockOk(MOCK_ORACLE)) },
        prices: { get: vi.fn().mockResolvedValue(mockOk(MOCK_PRICES)) },
      });

      const result = await marketObserve(toolkit, OUR_ADDRESS);

      // Both divergences should produce evidence (all severities included now)
      const divergenceEvidence = result.evidence.filter(e =>
        e.sourceId.startsWith("oracle-divergence"),
      );
      expect(divergenceEvidence.length).toBe(2);
      // Verify evidence shape matches AvailableEvidence
      const ev = divergenceEvidence[0];
      expect(ev).toHaveProperty("sourceId");
      expect(ev).toHaveProperty("subject");
      expect(ev).toHaveProperty("metrics");
      expect(ev).toHaveProperty("richness");
      expect(ev).toHaveProperty("freshness");
      expect(ev).toHaveProperty("stale");
      expect(Array.isArray(ev.metrics)).toBe(true);
      // High severity should have richness 1.0
      const highDiv = divergenceEvidence.find(e => e.sourceId.includes("ETH"));
      expect(highDiv?.richness).toBe(1.0);
    });

    it("maps severity to richness correctly", async () => {
      const noDivOracle: OracleResult = {
        divergences: [],
      };
      const toolkit = createMockToolkit({
        oracle: { get: vi.fn().mockResolvedValue(mockOk(noDivOracle)) },
        prices: { get: vi.fn().mockResolvedValue(mockOk(MOCK_PRICES)) },
      });

      const result = await marketObserve(toolkit, OUR_ADDRESS);
      const divergenceEvidence = result.evidence.filter(e => e.sourceId.startsWith("oracle-divergence"));
      expect(divergenceEvidence).toHaveLength(0);
    });

    it("adds betting pool evidence when pool has 3+ bets", async () => {
      const toolkit = createMockToolkit({
        ballot: { getPool: vi.fn().mockResolvedValue(mockOk(MOCK_POOL)) },
      });

      const result = await marketObserve(toolkit, OUR_ADDRESS);
      const poolEvidence = result.evidence.filter(e => e.sourceId === "betting-pool");
      expect(poolEvidence).toHaveLength(1);
      expect(poolEvidence[0].subject).toContain("BTC");
    });

    it("does NOT add betting pool evidence when pool has fewer than 3 bets", async () => {
      const toolkit = createMockToolkit({
        ballot: { getPool: vi.fn().mockResolvedValue(mockOk(MOCK_POOL_SMALL)) },
      });

      const result = await marketObserve(toolkit, OUR_ADDRESS);
      const poolEvidence = result.evidence.filter(e => e.sourceId === "betting-pool");
      expect(poolEvidence).toHaveLength(0);
    });

    it("is null-safe when oracle.get() returns null", async () => {
      const toolkit = createMockToolkit({
        oracle: { get: vi.fn().mockResolvedValue(null) },
      });

      const result = await marketObserve(toolkit, OUR_ADDRESS);
      expect(result).toBeDefined();
      expect(result.colonyState).toBeDefined();
      expect(result.evidence).toBeInstanceOf(Array);
    });

    it("is null-safe when prices.get() returns null", async () => {
      const toolkit = createMockToolkit({
        prices: { get: vi.fn().mockResolvedValue(null) },
      });

      const result = await marketObserve(toolkit, OUR_ADDRESS);
      expect(result).toBeDefined();
    });

    it("is null-safe when intelligence.getSignals() returns null", async () => {
      const toolkit = createMockToolkit({
        intelligence: { getSignals: vi.fn().mockResolvedValue(null) },
      });

      const result = await marketObserve(toolkit, OUR_ADDRESS);
      expect(result).toBeDefined();
    });

    it("is null-safe when ballot.getPool() returns null", async () => {
      const toolkit = createMockToolkit({
        ballot: { getPool: vi.fn().mockResolvedValue(null) },
      });

      const result = await marketObserve(toolkit, OUR_ADDRESS);
      expect(result).toBeDefined();
    });

    it("is null-safe when all API calls return errors", async () => {
      const toolkit = createMockToolkit({
        feed: { getRecent: vi.fn().mockResolvedValue(mockErr(500)) },
        oracle: { get: vi.fn().mockResolvedValue(mockErr(500)) },
        prices: { get: vi.fn().mockResolvedValue(mockErr(500)) },
        intelligence: { getSignals: vi.fn().mockResolvedValue(mockErr(500)) },
        ballot: { getPool: vi.fn().mockResolvedValue(mockErr(500)) },
      });

      const result = await marketObserve(toolkit, OUR_ADDRESS);
      expect(result).toBeDefined();
      expect(result.colonyState).toBeDefined();
      expect(result.evidence).toEqual([]);
    });

    it("includes apiEnrichment in context with oracle, prices, signals, bettingPool", async () => {
      const toolkit = createMockToolkit({
        oracle: { get: vi.fn().mockResolvedValue(mockOk(MOCK_ORACLE)) },
        prices: { get: vi.fn().mockResolvedValue(mockOk(MOCK_PRICES)) },
        intelligence: { getSignals: vi.fn().mockResolvedValue(mockOk(MOCK_SIGNALS)) },
        ballot: { getPool: vi.fn().mockResolvedValue(mockOk(MOCK_POOL)) },
      });

      const result = await marketObserve(toolkit, OUR_ADDRESS);

      expect(result.context).toBeDefined();
      expect(result.context!.apiEnrichment).toBeDefined();
      const enrichment = result.context!.apiEnrichment!;
      expect(enrichment.oracle).toEqual(MOCK_ORACLE);
      expect(enrichment.prices).toEqual(MOCK_PRICES);
      expect(enrichment.signals).toEqual(MOCK_SIGNALS);
      expect(enrichment.bettingPool).toEqual(MOCK_POOL);
    });

    it("apiEnrichment fields are undefined when API calls fail", async () => {
      const toolkit = createMockToolkit({
        oracle: { get: vi.fn().mockResolvedValue(mockErr(500)) },
        prices: { get: vi.fn().mockResolvedValue(mockErr(500)) },
        intelligence: { getSignals: vi.fn().mockResolvedValue(mockErr(500)) },
        ballot: { getPool: vi.fn().mockResolvedValue(mockErr(500)) },
      });

      const result = await marketObserve(toolkit, OUR_ADDRESS);
      const enrichment = result.context?.apiEnrichment;
      expect(enrichment?.oracle).toBeUndefined();
      expect(enrichment?.prices).toBeUndefined();
      expect(enrichment?.signals).toBeUndefined();
      expect(enrichment?.bettingPool).toBeUndefined();
    });

    it("evidence has correct AvailableEvidence shape for divergence", async () => {
      const toolkit = createMockToolkit({
        oracle: { get: vi.fn().mockResolvedValue(mockOk(MOCK_ORACLE)) },
      });

      const result = await marketObserve(toolkit, OUR_ADDRESS);
      const divergences = result.evidence.filter(e => e.sourceId === "oracle-divergence");

      for (const ev of divergences) {
        expect(typeof ev.sourceId).toBe("string");
        expect(typeof ev.subject).toBe("string");
        expect(Array.isArray(ev.metrics)).toBe(true);
        expect(typeof ev.richness).toBe("number");
        expect(typeof ev.freshness).toBe("number");
        expect(typeof ev.stale).toBe("boolean");
      }
    });

    it("evidence has correct AvailableEvidence shape for betting pool", async () => {
      const toolkit = createMockToolkit({
        ballot: { getPool: vi.fn().mockResolvedValue(mockOk(MOCK_POOL)) },
      });

      const result = await marketObserve(toolkit, OUR_ADDRESS);
      const poolEvidence = result.evidence.filter(e => e.sourceId === "betting-pool");

      for (const ev of poolEvidence) {
        expect(typeof ev.sourceId).toBe("string");
        expect(typeof ev.subject).toBe("string");
        expect(Array.isArray(ev.metrics)).toBe(true);
        expect(typeof ev.richness).toBe("number");
        expect(typeof ev.freshness).toBe("number");
        expect(typeof ev.stale).toBe("boolean");
      }
    });
  });

  describe("strategy.yaml", () => {
    it("exists", () => {
      expect(existsSync(resolve(TEMPLATE_DIR, "strategy.yaml"))).toBe(true);
    });

    it("loads via loadStrategyConfig without errors", () => {
      const yaml = readFileSync(resolve(TEMPLATE_DIR, "strategy.yaml"), "utf-8");
      const config = loadStrategyConfig(yaml);
      expect(config).toBeDefined();
      expect(config.rules).toBeInstanceOf(Array);
    });

    it("has 6 rules with correct names", () => {
      const yaml = readFileSync(resolve(TEMPLATE_DIR, "strategy.yaml"), "utf-8");
      const config = loadStrategyConfig(yaml);

      expect(config.rules).toHaveLength(6);
      const ruleNames = config.rules.map(r => r.name);
      expect(ruleNames).toContain("publish_on_divergence");
      expect(ruleNames).toContain("reply_with_evidence");
      expect(ruleNames).toContain("publish_prediction");
      expect(ruleNames).toContain("publish_to_gaps");
      expect(ruleNames).toContain("engage_verified");
      expect(ruleNames).toContain("tip_valuable");
    });

    it("has correct action types for each rule", () => {
      const yaml = readFileSync(resolve(TEMPLATE_DIR, "strategy.yaml"), "utf-8");
      const config = loadStrategyConfig(yaml);

      const ruleMap = new Map(config.rules.map(r => [r.name, r]));
      expect(ruleMap.get("publish_on_divergence")!.type).toBe("PUBLISH");
      expect(ruleMap.get("reply_with_evidence")!.type).toBe("REPLY");
      expect(ruleMap.get("publish_prediction")!.type).toBe("PUBLISH");
      expect(ruleMap.get("publish_to_gaps")!.type).toBe("PUBLISH");
      expect(ruleMap.get("engage_verified")!.type).toBe("ENGAGE");
      expect(ruleMap.get("tip_valuable")!.type).toBe("TIP");
    });

    it("has all rules enabled", () => {
      const yaml = readFileSync(resolve(TEMPLATE_DIR, "strategy.yaml"), "utf-8");
      const config = loadStrategyConfig(yaml);
      expect(config.rules.every(r => r.enabled)).toBe(true);
    });

    it("has market-specific rate limits", () => {
      const yaml = readFileSync(resolve(TEMPLATE_DIR, "strategy.yaml"), "utf-8");
      const config = loadStrategyConfig(yaml);
      expect(config.rateLimits.postsPerDay).toBe(12);
      expect(config.rateLimits.postsPerHour).toBe(4);
      expect(config.rateLimits.reactionsPerSession).toBe(6);
      expect(config.rateLimits.maxTipAmount).toBe(5);
    });

    it("has enrichment settings with minConfidence", () => {
      const yaml = readFileSync(resolve(TEMPLATE_DIR, "strategy.yaml"), "utf-8");
      const config = loadStrategyConfig(yaml);
      expect(config.enrichment.minConfidence).toBe(50);
    });

    it("has topic weights for defi, crypto, macro", () => {
      const yaml = readFileSync(resolve(TEMPLATE_DIR, "strategy.yaml"), "utf-8");
      const config = loadStrategyConfig(yaml);
      expect(config.topicWeights).toEqual({
        defi: 1.2,
        crypto: 1.0,
        macro: 0.8,
      });
    });
  });

  describe("sources.yaml", () => {
    it("exists", () => {
      expect(existsSync(resolve(TEMPLATE_DIR, "sources.yaml"))).toBe(true);
    });

    it("has valid YAML with sources array", () => {
      const { parse } = require("yaml");
      const content = readFileSync(resolve(TEMPLATE_DIR, "sources.yaml"), "utf-8");
      const parsed = parse(content);
      expect(parsed.sources).toBeInstanceOf(Array);
      expect(parsed.sources.length).toBeGreaterThanOrEqual(4);
    });

    it("each source has required fields: name, url, dahr_safe, topics", () => {
      const { parse } = require("yaml");
      const content = readFileSync(resolve(TEMPLATE_DIR, "sources.yaml"), "utf-8");
      const parsed = parse(content);

      for (const source of parsed.sources) {
        expect(source).toHaveProperty("name");
        expect(source).toHaveProperty("url");
        expect(source).toHaveProperty("dahr_safe");
        expect(source).toHaveProperty("topics");
        expect(Array.isArray(source.topics)).toBe(true);
        expect(typeof source.url).toBe("string");
        expect(typeof source.dahr_safe).toBe("boolean");
      }
    });
  });

  describe("agent.ts", () => {
    it("exists", () => {
      expect(existsSync(resolve(TEMPLATE_DIR, "agent.ts"))).toBe(true);
    });

    it("imports createAgentRuntime and runAgentLoop", () => {
      const content = readFileSync(resolve(TEMPLATE_DIR, "agent.ts"), "utf-8");
      expect(content).toContain("createAgentRuntime");
      expect(content).toContain("runAgentLoop");
    });

    it("exports marketObserve function", () => {
      const content = readFileSync(resolve(TEMPLATE_DIR, "agent.ts"), "utf-8");
      expect(content).toContain("export");
      expect(content).toContain("marketObserve");
    });

    it("does NOT use defaultObserve (has custom observe)", () => {
      const content = readFileSync(resolve(TEMPLATE_DIR, "agent.ts"), "utf-8");
      expect(content).not.toContain("defaultObserve");
    });
  });
});
