import { describe, it, expect, vi } from "vitest";
import { createMockApiClient, mockOk } from "./_helpers.js";
import { createOraclePrimitives } from "../../../src/toolkit/primitives/oracle.js";

describe("oracle.get", () => {
  it("delegates to apiClient.getOracle", async () => {
    const data = { sentiment: { BTC: 0.7 }, priceDivergences: [], polymarketOdds: [], timestamp: 1700000000000 };
    const client = createMockApiClient({ getOracle: vi.fn().mockResolvedValue(mockOk(data)) });
    const oracle = createOraclePrimitives({ apiClient: client });
    const result = await oracle.get({ assets: ["BTC"] });

    expect(result).toEqual(mockOk(data));
    expect(client.getOracle).toHaveBeenCalledWith({ assets: ["BTC"] });
  });

  it("returns null when API unreachable", async () => {
    const oracle = createOraclePrimitives({ apiClient: createMockApiClient() });
    expect(await oracle.get()).toBeNull();
  });
});
