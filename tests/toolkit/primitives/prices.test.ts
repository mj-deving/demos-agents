import { describe, it, expect, vi } from "vitest";
import { createMockApiClient, mockOk } from "./_helpers.js";
import { createPricesPrimitives } from "../../../src/toolkit/primitives/prices.js";

describe("prices.get", () => {
  it("delegates to apiClient.getPrices", async () => {
    const data = [{ asset: "BTC", price: 65000, timestamp: 1700000000000, source: "binance" }];
    const client = createMockApiClient({ getPrices: vi.fn().mockResolvedValue(mockOk(data)) });
    const prices = createPricesPrimitives({ apiClient: client });
    const result = await prices.get(["BTC", "ETH"]);

    expect(result).toEqual(mockOk(data));
    expect(client.getPrices).toHaveBeenCalledWith(["BTC", "ETH"]);
  });

  it("returns null when API unreachable", async () => {
    const prices = createPricesPrimitives({ apiClient: createMockApiClient() });
    expect(await prices.get(["BTC"])).toBeNull();
  });
});
