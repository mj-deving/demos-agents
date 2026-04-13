/**
 * Shared test helpers for toolkit primitives.
 * Provides mock factories to avoid duplicating setup across test files.
 */

import { vi } from "vitest";
import type { SuperColonyApiClient } from "../../../src/toolkit/supercolony/api-client.js";
import type { ApiResult, PriceData, SignalData, BettingPool, AgentProfile } from "../../../src/toolkit/supercolony/types.js";
import type { DataSource } from "../../../src/toolkit/data-source.js";
import type { ScanPost } from "../../../src/toolkit/types.js";

/** Create a fully-mocked SuperColonyApiClient where every method returns null by default. */
export function createMockApiClient(overrides: Partial<SuperColonyApiClient> = {}): SuperColonyApiClient {
  return {
    registerAgent: vi.fn().mockResolvedValue(null),
    listAgents: vi.fn().mockResolvedValue(null),
    getAgentProfile: vi.fn().mockResolvedValue(null),
    getAgentIdentities: vi.fn().mockResolvedValue(null),
    lookupByPlatform: vi.fn().mockResolvedValue(null),
    searchIdentity: vi.fn().mockResolvedValue(null),
    lookupByChainAddress: vi.fn().mockResolvedValue(null),
    queryPredictions: vi.fn().mockResolvedValue(null),
    resolvePrediction: vi.fn().mockResolvedValue(null),
    getTipStats: vi.fn().mockResolvedValue(null),
    getAgentTipStats: vi.fn().mockResolvedValue(null),
    getAgentLeaderboard: vi.fn().mockResolvedValue(null),
    getTopPosts: vi.fn().mockResolvedValue(null),
    verifyDahr: vi.fn().mockResolvedValue(null),
    listWebhooks: vi.fn().mockResolvedValue(null),
    createWebhook: vi.fn().mockResolvedValue(null),
    deleteWebhook: vi.fn().mockResolvedValue(null),
    getPostDetail: vi.fn().mockResolvedValue(null),
    getRssFeed: vi.fn().mockResolvedValue(null),
    getBettingPool: vi.fn().mockResolvedValue(null),
    getOracle: vi.fn().mockResolvedValue(null),
    getPrices: vi.fn().mockResolvedValue(null),
    getPriceHistory: vi.fn().mockResolvedValue(null),
    getStats: vi.fn().mockResolvedValue(null),
    getHealth: vi.fn().mockResolvedValue(null),
    verifyTlsn: vi.fn().mockResolvedValue(null),
    getFeed: vi.fn().mockResolvedValue(null),
    searchFeed: vi.fn().mockResolvedValue(null),
    getThread: vi.fn().mockResolvedValue(null),
    getSignals: vi.fn().mockResolvedValue(null),
    react: vi.fn().mockResolvedValue(null),
    getReactionCounts: vi.fn().mockResolvedValue(null),
    getTlsnProof: vi.fn().mockResolvedValue(null),
    initiateTip: vi.fn().mockResolvedValue(null),
    getAgentBalance: vi.fn().mockResolvedValue(null),
    getReport: vi.fn().mockResolvedValue(null),
    getPredictionMarkets: vi.fn().mockResolvedValue(null),
    getBallotPerformance: vi.fn().mockResolvedValue(null),
    getFeeds: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as SuperColonyApiClient;
}

/** Create a mock DataSource. */
export function createMockDataSource(overrides: Partial<DataSource> = {}): DataSource {
  return {
    name: "auto",
    getRecentPosts: vi.fn().mockResolvedValue([]),
    getPostByHash: vi.fn().mockResolvedValue(null),
    getThread: vi.fn().mockResolvedValue(null),
    getRepliesTo: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as DataSource;
}

/** Wrap data in a successful ApiResult. */
export function mockOk<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

/** Create a failed ApiResult. */
export function mockErr<T>(status = 500, error = "Internal Server Error"): ApiResult<T> {
  return { ok: false, status, error };
}

/** Create a standard ScanPost for testing. */
export function makeScanPost(overrides: Partial<ScanPost> = {}): ScanPost {
  return {
    txHash: "0xtest123",
    text: "Test post content",
    category: "ANALYSIS",
    author: "0xauthor1",
    timestamp: 1700000000000,
    reactions: { agree: 5, disagree: 1 },
    reactionsKnown: true,
    tags: ["test"],
    blockNumber: 100,
    ...overrides,
  };
}

// ── API Type Mock Factories ──────────────────

/** Create a PriceData mock matching live /api/prices shape. */
export function makePriceData(overrides: Partial<PriceData> = {}): PriceData {
  return {
    ticker: "BTC",
    priceUsd: 65000,
    fetchedAt: 1700000000000,
    source: "coingecko",
    ...overrides,
  };
}

/** Create a SignalData mock matching live /api/signals consensusAnalysis shape. */
export function makeSignalData(overrides: Partial<SignalData> = {}): SignalData {
  return {
    topic: "btc",
    consensus: true,
    direction: "bullish",
    agentCount: 10,
    totalAgents: 42,
    confidence: 75,
    text: "Bullish consensus",
    trending: true,
    ...overrides,
  };
}

/** Create a BettingPool mock matching live /api/bets/pool shape. */
export function makeBettingPool(overrides: Partial<BettingPool> = {}): BettingPool {
  return {
    asset: "BTC",
    horizon: "1h",
    totalBets: 3,
    totalDem: 15,
    poolAddress: "0xpool",
    roundEnd: 1700000000000 + 3600_000,
    bets: [],
    ...overrides,
  };
}

/** Create a leaderboard agent entry matching live /api/scores/agents shape. */
export function makeLeaderboardAgent(overrides: Partial<{
  address: string; name: string; totalPosts: number; avgScore: number;
  bayesianScore: number; topScore: number; lowScore: number; lastActiveAt: number;
}> = {}) {
  return {
    address: "0xagent1",
    name: "agent",
    totalPosts: 50,
    avgScore: 70,
    bayesianScore: 68,
    topScore: 90,
    lowScore: 40,
    lastActiveAt: Date.now(),
    ...overrides,
  };
}

/** Create an AgentProfile mock matching live /api/agent/:address shape. */
export function makeAgentProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    address: "0xagent1",
    name: "agent",
    description: "Test agent",
    specialties: ["crypto"],
    postCount: 50,
    lastActiveAt: Date.now(),
    ...overrides,
  };
}
