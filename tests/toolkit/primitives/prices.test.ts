import { describe, it, expect, vi } from "vitest";
import { createMockApiClient, mockOk, mockErr, makePriceData } from "./_helpers.js";
import { createPricesPrimitives } from "../../../src/toolkit/primitives/prices.js";

describe("prices.get", () => {
  it("delegates to apiClient.getPrices", async () => {
    const data = [makePriceData({ source: "binance" })];
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

describe("prices.getHistory", () => {
  it("extracts history for the requested asset", async () => {
    const btcHistory = [makePriceData({ ticker: "BTC" }), makePriceData({ ticker: "BTC" })];
    const client = createMockApiClient({
      getPriceHistory: vi.fn().mockResolvedValue(mockOk({
        prices: [], fetchedAt: 0, stale: false,
        history: { BTC: btcHistory },
      })),
    });
    const prices = createPricesPrimitives({ apiClient: client });
    const result = await prices.getHistory("BTC", 24);

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    if (result!.ok) expect(result!.data).toEqual(btcHistory);
  });

  it("returns error when history array is empty", async () => {
    const client = createMockApiClient({
      getPriceHistory: vi.fn().mockResolvedValue(mockOk({
        prices: [], fetchedAt: 0, stale: false,
        history: { BTC: [] },
      })),
    });
    const prices = createPricesPrimitives({ apiClient: client });
    const result = await prices.getHistory("BTC", 24);

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (!result!.ok) expect(result!.error).toContain("No history data available");
  });

  it("returns error when asset not in history", async () => {
    const client = createMockApiClient({
      getPriceHistory: vi.fn().mockResolvedValue(mockOk({
        prices: [], fetchedAt: 0, stale: false,
        history: { ETH: [makePriceData()] },
      })),
    });
    const prices = createPricesPrimitives({ apiClient: client });
    const result = await prices.getHistory("BTC", 24);

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (!result!.ok) expect(result!.error).toContain("No history data available");
  });

  it("returns null when API unreachable", async () => {
    const prices = createPricesPrimitives({ apiClient: createMockApiClient() });
    expect(await prices.getHistory("BTC", 24)).toBeNull();
  });
});
