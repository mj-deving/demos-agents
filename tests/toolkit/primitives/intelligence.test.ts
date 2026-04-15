/**
 * Tests for intelligence domain primitives.
 * TDD: tests written before implementation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockApiClient,
  mockOk,
  makeSignalData,
  makePredictionIntelligenceResponse,
  makePredictionRecommendationsResponse,
} from "./_helpers.js";

let createIntelligencePrimitives: typeof import("../../../src/toolkit/primitives/intelligence.js").createIntelligencePrimitives;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import("../../../src/toolkit/primitives/intelligence.js");
  createIntelligencePrimitives = mod.createIntelligencePrimitives;
});

describe("intelligence.getSignals", () => {
  it("delegates to apiClient.getSignals", async () => {
    const signals = [makeSignalData({ topic: "BTC" })];
    const client = createMockApiClient({
      getSignals: vi.fn().mockResolvedValue(mockOk(signals)),
    });
    const intel = createIntelligencePrimitives({ apiClient: client });
    const result = await intel.getSignals();

    expect(result).toEqual(mockOk(signals));
    expect(client.getSignals).toHaveBeenCalled();
  });

  it("returns null when API unreachable", async () => {
    const intel = createIntelligencePrimitives({ apiClient: createMockApiClient() });
    const result = await intel.getSignals();
    expect(result).toBeNull();
  });
});

describe("intelligence.getReport", () => {
  it("delegates to apiClient.getReport", async () => {
    const report = { id: "r1", title: "Daily Brief", summary: "Summary...", script: "Full text...", status: "published", createdAt: "2026-04-06T00:00:00Z" };
    const client = createMockApiClient({
      getReport: vi.fn().mockResolvedValue(mockOk(report)),
    });
    const intel = createIntelligencePrimitives({ apiClient: client });
    const result = await intel.getReport({ id: "r1" });

    expect(result).toEqual(mockOk(report));
    expect(client.getReport).toHaveBeenCalledWith({ id: "r1" });
  });

  it("returns null when API unreachable", async () => {
    const intel = createIntelligencePrimitives({ apiClient: createMockApiClient() });
    const result = await intel.getReport();
    expect(result).toBeNull();
  });
});

describe("intelligence.getConvergence", () => {
  it("delegates to apiClient.getConvergence", async () => {
    const convergence = {
      pulse: {
        activeSignals: 8,
        agentsOnline: 19,
        postsPerHour: 12,
        dataSources: 4,
        signalAgentRunning: true,
        lastSynthesisAt: 1700000000000,
      },
      mindshare: {
        buckets: [1700000000000],
        series: [{
          topic: "BTC momentum",
          shortTopic: "BTC",
          direction: "bullish",
          agentCount: 5,
          totalAgents: 19,
          totalPosts: 11,
          agrees: 7,
          disagrees: 1,
          counts: [11],
          sourceTxHashes: ["0xabc"],
          assets: ["BTC"],
          confidence: 72,
        }],
      },
      stats: { totalPosts: 11, totalAgents: 19, totalAssets: 2 },
      cached: false,
    };
    const client = createMockApiClient({
      getConvergence: vi.fn().mockResolvedValue(mockOk(convergence)),
    });
    const intel = createIntelligencePrimitives({ apiClient: client });
    const result = await intel.getConvergence();

    expect(result).toEqual(mockOk(convergence));
    expect(client.getConvergence).toHaveBeenCalled();
  });

  it("returns null when API unreachable", async () => {
    const intel = createIntelligencePrimitives({ apiClient: createMockApiClient() });
    const result = await intel.getConvergence();
    expect(result).toBeNull();
  });
});

describe("intelligence.getPredictionIntelligence", () => {
  it("delegates to apiClient.getPredictionIntelligence", async () => {
    const response = makePredictionIntelligenceResponse();
    const client = createMockApiClient({
      getPredictionIntelligence: vi.fn().mockResolvedValue(mockOk(response)),
    });
    const intel = createIntelligencePrimitives({ apiClient: client });
    const result = await intel.getPredictionIntelligence({ limit: 5, stats: true });

    expect(result).toEqual(mockOk(response));
    expect(client.getPredictionIntelligence).toHaveBeenCalledWith({ limit: 5, stats: true });
  });
});

describe("intelligence.getPredictionRecommendations", () => {
  it("delegates to apiClient.getPredictionRecommendations", async () => {
    const response = makePredictionRecommendationsResponse();
    const client = createMockApiClient({
      getPredictionRecommendations: vi.fn().mockResolvedValue(mockOk(response)),
    });
    const intel = createIntelligencePrimitives({ apiClient: client });
    const result = await intel.getPredictionRecommendations("demo");

    expect(result).toEqual(mockOk(response));
    expect(client.getPredictionRecommendations).toHaveBeenCalledWith("demo");
  });
});
