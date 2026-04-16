import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockApiClient, mockOk } from "./_helpers.js";
import { createScoresPrimitives } from "../../../src/toolkit/primitives/scores.js";

describe("scores.getLeaderboard", () => {
  it("delegates to apiClient.getAgentLeaderboard", async () => {
    const data = { agents: [], count: 0, globalAvg: 50, confidenceThreshold: 10 };
    const client = createMockApiClient({ getAgentLeaderboard: vi.fn().mockResolvedValue(mockOk(data)) });
    const scores = createScoresPrimitives({ apiClient: client });
    const result = await scores.getLeaderboard({ limit: 20 });

    expect(result).toEqual(mockOk(data));
    expect(client.getAgentLeaderboard).toHaveBeenCalledWith({ limit: 20 });
  });

  it("returns null when API unreachable", async () => {
    const scores = createScoresPrimitives({ apiClient: createMockApiClient() });
    expect(await scores.getLeaderboard()).toBeNull();
  });
});

describe("scores.getTopPosts", () => {
  it("delegates to apiClient.getTopPosts", async () => {
    const data = {
      posts: [{
        txHash: "0xabc",
        author: "0xagent",
        category: "ANALYSIS",
        text: "High-signal post",
        score: 91,
        timestamp: 1700000000000,
        blockNumber: 10,
      }],
      count: 1,
    };
    const client = createMockApiClient({ getTopPosts: vi.fn().mockResolvedValue(mockOk(data)) });
    const scores = createScoresPrimitives({ apiClient: client });
    const result = await scores.getTopPosts({ category: "ANALYSIS", limit: 5 });

    expect(result).toEqual(mockOk(data));
    expect(client.getTopPosts).toHaveBeenCalledWith({ category: "ANALYSIS", limit: 5 });
  });

  it("returns null when API unreachable", async () => {
    const scores = createScoresPrimitives({ apiClient: createMockApiClient() });
    expect(await scores.getTopPosts()).toBeNull();
  });
});

describe("scores.getPredictionLeaderboard", () => {
  it("delegates to apiClient.getPredictionLeaderboard", async () => {
    const data = {
      agents: [{
        address: "0xabc",
        composite: 82,
        betting: 80,
        calibration: 85,
        polymarket: 79,
        predictionCount: 14,
      }],
    };
    const client = createMockApiClient({ getPredictionLeaderboard: vi.fn().mockResolvedValue(mockOk(data)) });
    const scores = createScoresPrimitives({ apiClient: client });
    const result = await scores.getPredictionLeaderboard({ limit: 10 });

    expect(result).toEqual(mockOk(data));
    expect(client.getPredictionLeaderboard).toHaveBeenCalledWith({ limit: 10 });
  });
});

describe("scores.getPredictionScore", () => {
  it("delegates to apiClient.getPredictionScore", async () => {
    const data = {
      composite: 81,
      breakdown: { betting: 78, calibration: 84, polymarket: null },
      recentPredictions: [],
    };
    const client = createMockApiClient({ getPredictionScore: vi.fn().mockResolvedValue(mockOk(data)) });
    const scores = createScoresPrimitives({ apiClient: client });
    const result = await scores.getPredictionScore("0xabc");

    expect(result).toEqual(mockOk(data));
    expect(client.getPredictionScore).toHaveBeenCalledWith("0xabc");
  });
});
