/**
 * Shared test helpers for toolkit primitives.
 * Provides mock factories to avoid duplicating setup across test files.
 */

import { vi } from "vitest";
import type { SuperColonyApiClient } from "../../../src/toolkit/supercolony/api-client.js";
import type {
  ApiResult,
  PriceData,
  SignalData,
  BettingPool,
  AgentProfile,
  HigherLowerPool,
  BinaryPool,
  EthBettingPool,
  EthWinner,
  EthHigherLowerPool,
  EthBinaryPool,
  SportsMarketsResponse,
  SportsPool,
  SportsWinnersResponse,
  CommodityPool,
  PredictionIntelligenceResponse,
  PredictionRecommendationsResponse,
} from "../../../src/toolkit/supercolony/types.js";
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
    getConvergence: vi.fn().mockResolvedValue(null),
    getPredictionIntelligence: vi.fn().mockResolvedValue(null),
    getPredictionRecommendations: vi.fn().mockResolvedValue(null),
    react: vi.fn().mockResolvedValue(null),
    getReactionCounts: vi.fn().mockResolvedValue(null),
    getTlsnProof: vi.fn().mockResolvedValue(null),
    initiateTip: vi.fn().mockResolvedValue(null),
    getAgentBalance: vi.fn().mockResolvedValue(null),
    getReport: vi.fn().mockResolvedValue(null),
    getPredictionMarkets: vi.fn().mockResolvedValue(null),
    getHigherLowerPool: vi.fn().mockResolvedValue(null),
    getBinaryPools: vi.fn().mockResolvedValue(null),
    getEthBettingPool: vi.fn().mockResolvedValue(null),
    getEthWinners: vi.fn().mockResolvedValue(null),
    getEthHigherLowerPool: vi.fn().mockResolvedValue(null),
    getEthBinaryPools: vi.fn().mockResolvedValue(null),
    getSportsMarkets: vi.fn().mockResolvedValue(null),
    getSportsPool: vi.fn().mockResolvedValue(null),
    getSportsWinners: vi.fn().mockResolvedValue(null),
    getCommodityPool: vi.fn().mockResolvedValue(null),
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

export function makeHigherLowerPool(overrides: Partial<HigherLowerPool> = {}): HigherLowerPool {
  return {
    asset: "BTC",
    horizon: "30m",
    totalHigher: 3,
    totalLower: 2,
    totalDem: 25,
    higherCount: 3,
    lowerCount: 2,
    roundEnd: 1700000000000 + 1800_000,
    referencePrice: 65000,
    poolAddress: "0xhlpool",
    currentPrice: 65100,
    ...overrides,
  };
}

export function makeBinaryPool(overrides: Partial<BinaryPool> = {}): BinaryPool {
  return {
    marketId: "market-1",
    totalYes: 15,
    totalNo: 10,
    totalDem: 25,
    yesBetsCount: 3,
    noBetsCount: 2,
    yesMultiplier: 1.7,
    noMultiplier: 2.1,
    polymarketYes: 0.58,
    polymarketNo: 0.42,
    endDate: "2026-04-30T00:00:00.000Z",
    poolAddress: "0xbinarypool",
    status: "active",
    ...overrides,
  };
}

export function makeEthBettingPool(overrides: Partial<EthBettingPool> = {}): EthBettingPool {
  return {
    asset: "BTC",
    horizon: "30m",
    totalBets: 0,
    totalEth: 0,
    totalEthWei: "0",
    contractAddress: "0xethpool",
    roundEnd: 1700000000000 + 1800_000,
    bets: [],
    ...overrides,
  };
}

export function makeEthWinner(overrides: Partial<EthWinner> = {}): EthWinner {
  return {
    txHash: "0xethwin",
    asset: "BTC",
    bettor: "",
    evmAddress: "0x64511E62431A1Aac49aA068f7806C0A2AC34350A",
    predictedPrice: 74500,
    actualPrice: 74581,
    amount: "100000000000000",
    amountEth: 0.0001,
    payout: "100000000000000",
    payoutEth: 0.0001,
    roundEnd: 1700000000000,
    horizon: "10m",
    timestamp: 1700000000000,
    ...overrides,
  };
}

export function makeEthHigherLowerPool(overrides: Partial<EthHigherLowerPool> = {}): EthHigherLowerPool {
  return {
    asset: "BTC",
    horizon: "30m",
    totalEth: 0,
    totalEthWei: "0",
    totalHigher: 0,
    totalHigherWei: "0",
    totalLower: 0,
    totalLowerWei: "0",
    higherCount: 0,
    lowerCount: 0,
    roundEnd: 1700000000000 + 1800_000,
    referencePrice: null,
    contractAddress: "0xethhlpool",
    currentPrice: 74766,
    ...overrides,
  };
}

export function makeEthBinaryPool(overrides: Partial<EthBinaryPool> = {}): EthBinaryPool {
  return {
    poolAddress: "0xethbinarypool",
    polymarketYes: 0.58,
    polymarketNo: 0.42,
    endDate: "2026-04-30T00:00:00.000Z",
    status: "active",
    ...overrides,
  };
}

export function makeSportsPool(overrides: Partial<SportsPool> = {}): SportsPool {
  return {
    fixtureId: "nba_espn_401866757",
    fixture: {
      id: "nba_espn_401866757",
      sport: "nba",
      league: "NBA",
      homeTeam: "Philadelphia 76ers",
      awayTeam: "Orlando Magic",
      homeScore: null,
      awayScore: null,
      status: "scheduled",
      startTime: 1776295800000,
      endTime: null,
      metadata: "{\"source\":\"espn\"}",
    },
    winnerPool: {
      home: 0,
      draw: 0,
      away: 0,
      totalDem: 0,
      totalBets: 0,
      homeBets: 0,
      drawBets: 0,
      awayBets: 0,
    },
    scorePool: {
      totalDem: 0,
      totalBets: 0,
      predictions: [],
    },
    poolAddress: "0xsportspool",
    ...overrides,
  };
}

export function makeSportsMarketsResponse(overrides: Partial<SportsMarketsResponse> = {}): SportsMarketsResponse {
  return {
    markets: [makeSportsPool()],
    poolAddress: "0xsportspoolroot",
    ...overrides,
  };
}

export function makeSportsWinnersResponse(overrides: Partial<SportsWinnersResponse> = {}): SportsWinnersResponse {
  return {
    winners: [],
    count: 0,
    ...overrides,
  };
}

export function makeCommodityPool(overrides: Partial<CommodityPool> = {}): CommodityPool {
  return {
    totalDem: 0,
    totalBets: 0,
    asset: "XAU",
    name: "Gold",
    category: "Precious Metals",
    unit: "troy oz",
    horizon: "30m",
    poolAddress: "0xcommoditypool",
    roundEnd: 1776285000000,
    currentPrice: 4817,
    bets: [],
    ...overrides,
  };
}

export function makePredictionIntelligenceResponse(
  overrides: Partial<PredictionIntelligenceResponse> = {},
): PredictionIntelligenceResponse {
  return {
    scores: [{
      marketId: "1747257",
      question: "Will Trump say Alien Dot Gov in April?",
      category: "crypto",
      currentPrice: 0.08,
      eloProb: 0,
      gbsProb: null,
      mirofishProb: 0,
      ensembleProb: 0,
      edge: 0.08,
      edgeSide: "NO",
      ev: 0.0869,
      kellyFraction: 1,
      kellySize: 200,
      strategies: ["S06"],
      scoredAt: 1776285510379,
    }],
    total: 1,
    lastScoredAt: 1776285510379,
    engineVersion: "1.0.0",
    stats: {
      totalMarketsScored: 2324,
      marketsWithEdge: 601,
      recommendationsGenerated: 0,
      resolvedMarkets: 0,
      weights: {
        elo: { brierScore: 0.25, weight: 0.5, samples: 0 },
        gbs: { brierScore: 0.25, weight: 0, samples: 0 },
        mirofish: { brierScore: 0.25, weight: 0.5, samples: 0 },
        warmup: true,
        updatedAt: 1776285510378,
      },
      lastScoredAt: 1776285510383,
      engineVersion: "1.0.0",
      pipelineDurationMs: 26157,
    },
    ...overrides,
  };
}

export function makePredictionRecommendationsResponse(
  overrides: Partial<PredictionRecommendationsResponse> = {},
): PredictionRecommendationsResponse {
  return {
    recommendations: [{
      marketId: "1651775",
      question: "Red Wings vs. Panthers: O/U 6.5",
      category: "sports",
      side: "NO",
      ensembleProb: 0.2426,
      marketPrice: 0.515,
      edge: 0.2424,
      ev: 0.4706,
      kellyFraction: 0.4997,
      suggestedBet: 99.95,
      confidenceTier: "moderate",
      strategies: ["S06", "S16"],
      betPayload: {
        marketId: "1651775",
        direction: "NO",
        amount: 99.95,
      },
    }],
    total: 1,
    bankroll: 1000,
    openExposure: 0,
    varHeadroom: 1000,
    lastScoredAt: 1776285510379,
    engineVersion: "1.0.0",
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
