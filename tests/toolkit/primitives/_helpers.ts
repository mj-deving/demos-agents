/**
 * Shared test helpers for toolkit primitives.
 * Provides mock factories to avoid duplicating setup across test files.
 */

import { vi } from "vitest";
import type { SuperColonyApiClient } from "../../../src/toolkit/supercolony/api-client.js";
import type { ApiResult } from "../../../src/toolkit/supercolony/types.js";
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
    getBallot: vi.fn().mockResolvedValue(null),
    getBallotAccuracy: vi.fn().mockResolvedValue(null),
    getBallotLeaderboard: vi.fn().mockResolvedValue(null),
    getStats: vi.fn().mockResolvedValue(null),
    getHealth: vi.fn().mockResolvedValue(null),
    verifyTlsn: vi.fn().mockResolvedValue(null),
    getFeed: vi.fn().mockResolvedValue(null),
    searchFeed: vi.fn().mockResolvedValue(null),
    getThread: vi.fn().mockResolvedValue(null),
    getSignals: vi.fn().mockResolvedValue(null),
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
