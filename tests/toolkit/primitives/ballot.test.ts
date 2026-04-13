import { describe, it, expect, vi } from "vitest";
import { createMockApiClient, mockOk, makeBettingPool } from "./_helpers.js";
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
