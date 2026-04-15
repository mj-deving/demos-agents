import { describe, it, expect, vi } from "vitest";
import { createMockApiClient, mockOk, makeBettingPool, makeHigherLowerPool, makeBinaryPool } from "./_helpers.js";
import { createBallotPrimitives } from "../../../src/toolkit/primitives/ballot.js";

describe("ballot.getPool", () => {
  it("delegates to apiClient.getBettingPool with asset and horizon", async () => {
    const data = makeBettingPool({
      totalBets: 5,
      totalDem: 25,
      bets: [{ txHash: "0xtx1", bettor: "0xa1", predictedPrice: 70000, amount: 5, roundEnd: 1712444400, horizon: "1h" }],
    });
    const client = createMockApiClient({ getBettingPool: vi.fn().mockResolvedValue(mockOk(data)) });
    const ballot = createBallotPrimitives({ apiClient: client });
    const result = await ballot.getPool({ asset: "BTC", horizon: "1h" });

    expect(result).toEqual(mockOk(data));
    expect(client.getBettingPool).toHaveBeenCalledWith("BTC", "1h");
  });

  it("passes undefined when no opts provided", async () => {
    const data = makeBettingPool({ totalBets: 0, totalDem: 0, poolAddress: "0x", roundEnd: 0 });
    const client = createMockApiClient({ getBettingPool: vi.fn().mockResolvedValue(mockOk(data)) });
    const ballot = createBallotPrimitives({ apiClient: client });
    await ballot.getPool();

    expect(client.getBettingPool).toHaveBeenCalledWith("BTC", undefined);
  });
});

describe("ballot.getHigherLowerPool", () => {
  it("delegates to apiClient.getHigherLowerPool with asset and horizon", async () => {
    const data = makeHigherLowerPool({ asset: "ETH", horizon: "4h" });
    const client = createMockApiClient({ getHigherLowerPool: vi.fn().mockResolvedValue(mockOk(data)) });
    const ballot = createBallotPrimitives({ apiClient: client });
    const result = await ballot.getHigherLowerPool({ asset: "ETH", horizon: "4h" });

    expect(result).toEqual(mockOk(data));
    expect(client.getHigherLowerPool).toHaveBeenCalledWith("ETH", "4h");
  });

  it("defaults asset to BTC when no opts provided", async () => {
    const data = makeHigherLowerPool();
    const client = createMockApiClient({ getHigherLowerPool: vi.fn().mockResolvedValue(mockOk(data)) });
    const ballot = createBallotPrimitives({ apiClient: client });
    await ballot.getHigherLowerPool();

    expect(client.getHigherLowerPool).toHaveBeenCalledWith("BTC", undefined);
  });
});

describe("ballot.getBinaryPools", () => {
  it("delegates to apiClient.getBinaryPools with filters", async () => {
    const data = { "market-1": makeBinaryPool() };
    const client = createMockApiClient({ getBinaryPools: vi.fn().mockResolvedValue(mockOk(data)) });
    const ballot = createBallotPrimitives({ apiClient: client });
    const result = await ballot.getBinaryPools({ category: "crypto", limit: 5 });

    expect(result).toEqual(mockOk(data));
    expect(client.getBinaryPools).toHaveBeenCalledWith({ category: "crypto", limit: 5 });
  });

  it("passes undefined when no filters are provided", async () => {
    const data = { "market-1": makeBinaryPool() };
    const client = createMockApiClient({ getBinaryPools: vi.fn().mockResolvedValue(mockOk(data)) });
    const ballot = createBallotPrimitives({ apiClient: client });
    await ballot.getBinaryPools();

    expect(client.getBinaryPools).toHaveBeenCalledWith(undefined);
  });
});
