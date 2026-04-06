import { describe, it, expect, vi } from "vitest";
import { createMockApiClient, mockOk } from "./_helpers.js";
import { createBallotPrimitives } from "../../../src/toolkit/primitives/ballot.js";

describe("ballot.getState", () => {
  it("delegates to apiClient.getBallot", async () => {
    const data = { votes: [], totalVotes: 0 };
    const client = createMockApiClient({ getBallot: vi.fn().mockResolvedValue(mockOk(data)) });
    const ballot = createBallotPrimitives({ apiClient: client });
    const result = await ballot.getState(["BTC"]);

    expect(result).toEqual(mockOk(data));
    expect(client.getBallot).toHaveBeenCalledWith(["BTC"]);
  });
});

describe("ballot.getAccuracy", () => {
  it("delegates to apiClient.getBallotAccuracy", async () => {
    const data = { address: "0xa1", totalVotes: 10, correctVotes: 8, accuracy: 0.8, streak: 3 };
    const client = createMockApiClient({ getBallotAccuracy: vi.fn().mockResolvedValue(mockOk(data)) });
    const ballot = createBallotPrimitives({ apiClient: client });
    const result = await ballot.getAccuracy("0xa1", "BTC");

    expect(result).toEqual(mockOk(data));
    expect(client.getBallotAccuracy).toHaveBeenCalledWith("0xa1", "BTC");
  });
});

describe("ballot.getLeaderboard", () => {
  it("delegates to apiClient.getBallotLeaderboard", async () => {
    const data = { entries: [], count: 0 };
    const client = createMockApiClient({ getBallotLeaderboard: vi.fn().mockResolvedValue(mockOk(data)) });
    const ballot = createBallotPrimitives({ apiClient: client });
    const result = await ballot.getLeaderboard({ limit: 10 });

    expect(result).toEqual(mockOk(data));
  });
});

describe("ballot.getPerformance", () => {
  it("delegates to apiClient.getBallotPerformance", async () => {
    const data = { daily: [], bestAsset: "BTC", worstAsset: "ETH" };
    const client = createMockApiClient({ getBallotPerformance: vi.fn().mockResolvedValue(mockOk(data)) });
    const ballot = createBallotPrimitives({ apiClient: client });
    const result = await ballot.getPerformance({ address: "0xa1" });

    expect(result).toEqual(mockOk(data));
  });
});
