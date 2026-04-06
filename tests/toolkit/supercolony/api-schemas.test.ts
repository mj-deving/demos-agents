/**
 * Tests for Zod schemas — validate against live API response shapes.
 *
 * These fixtures come from section 13b of supercolony-api-reference.md
 * (live API audit 2026-04-06). They ensure our schemas accept real responses.
 */

import { describe, it, expect } from "vitest";
import {
  PriceDataSchema,
  SignalDataSchema,
  LeaderboardAgentSchema,
  LeaderboardResultSchema,
  OracleResultSchema,
  NetworkStatsSchema,
  HealthStatusSchema,
} from "../../../src/toolkit/supercolony/api-schemas.js";

describe("PriceDataSchema", () => {
  it("validates real /api/prices item shape", () => {
    const liveItem = {
      ticker: "BTC", symbol: "BTCUSD", priceUsd: 69620, change24h: 3.30,
      high24h: 70243, low24h: 67279, volume24h: 46985980740, marketCap: 1395138973105,
      fetchedAt: 1775502680806, dahrTxHash: null, source: "coingecko",
    };
    const result = PriceDataSchema.safeParse(liveItem);
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    expect(PriceDataSchema.safeParse({ ticker: "BTC" }).success).toBe(false);
  });
});

describe("SignalDataSchema", () => {
  it("validates real /api/signals consensusAnalysis item", () => {
    const liveItem = {
      topic: "btc", consensus: true, direction: "bearish",
      agentCount: 26, totalAgents: 42, confidence: 76,
      text: "Strong bearish consensus among agents", trending: true,
    };
    const result = SignalDataSchema.safeParse(liveItem);
    expect(result.success).toBe(true);
  });

  it("accepts consensus as boolean (not number)", () => {
    const item = {
      topic: "eth", consensus: false, direction: "neutral",
      agentCount: 3, totalAgents: 42, confidence: 30,
      text: "No consensus", trending: false,
    };
    expect(SignalDataSchema.safeParse(item).success).toBe(true);
    expect(SignalDataSchema.safeParse({ ...item, consensus: 0.5 }).success).toBe(false);
  });
});

describe("LeaderboardResultSchema", () => {
  it("validates real /api/scores/agents shape", () => {
    const live = {
      agents: [{
        address: "0xabc", name: "Sentinel", postCount: 1292,
        avgScore: 72.5, bayesianScore: 68.3, topScore: 95, lowScore: 30,
        lastActiveAt: 1775502680806,
      }],
      count: 42, globalAvg: 55.2, confidenceThreshold: 3,
    };
    expect(LeaderboardResultSchema.safeParse(live).success).toBe(true);
  });

  it("agent uses postCount not totalPosts", () => {
    const agent = {
      address: "0x1", name: "test", totalPosts: 10,
      avgScore: 50, bayesianScore: 50, topScore: 50, lowScore: 50,
      lastActiveAt: 0,
    };
    expect(LeaderboardAgentSchema.safeParse(agent).success).toBe(false);
  });
});

describe("OracleResultSchema", () => {
  it("validates real /api/oracle shape", () => {
    const live = {
      overallSentiment: { direction: "bearish", score: -24, agentCount: 26, topAssets: ["BTC"] },
      assets: [{ ticker: "BTC", postCount: 1292, price: { usd: 69778, change24h: 3.57, high24h: 70243, low24h: 67279 } }],
      divergences: [{ type: "agents_vs_market", asset: "BTC", description: "Low divergence", severity: "low" }],
      polymarket: {}, meta: {},
    };
    expect(OracleResultSchema.safeParse(live).success).toBe(true);
  });
});

describe("NetworkStatsSchema", () => {
  it("validates real /api/stats nested shape", () => {
    const live = {
      network: { totalPosts: 201000, totalAgents: 202, totalTransactions: 500000 },
      activity: { postsLast24h: 2400, activeAgentsLast24h: 38, reactionsLast24h: 1200 },
      quality: { avgScore: 55.2, attestationRate: 0.82 },
      predictions: { total: 150, accuracy: 0.65 },
      tips: { totalDem: 5000, uniqueTippers: 15 },
      consensus: { activeTopics: 12, avgAgentsPerTopic: 4.2 },
      content: { categoryBreakdown: { ANALYSIS: 50000, OBSERVATION: 80000 } },
      computedAt: "2026-04-06T12:00:00Z",
    };
    expect(NetworkStatsSchema.safeParse(live).success).toBe(true);
  });

  it("rejects flat legacy shape", () => {
    const flat = { totalPosts: 100, totalAgents: 50, totalReactions: 200, uptime: 99.9 };
    expect(NetworkStatsSchema.safeParse(flat).success).toBe(false);
  });
});

describe("HealthStatusSchema", () => {
  it("validates real /api/health shape", () => {
    const live = {
      status: "ok", uptime: 1234567, timestamp: 1775502680806,
      memory: { heapUsed: 150000000, rss: 250000000 },
    };
    expect(HealthStatusSchema.safeParse(live).success).toBe(true);
  });

  it("accepts health without optional memory", () => {
    const minimal = { status: "ok", uptime: 100, timestamp: 1700000000000 };
    expect(HealthStatusSchema.safeParse(minimal).success).toBe(true);
  });
});
