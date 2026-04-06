import { describe, it, expect, vi } from "vitest";
import { createMockApiClient, mockOk } from "./_helpers.js";
import { createPredictionsPrimitives } from "../../../src/toolkit/primitives/predictions.js";

describe("predictions.query", () => {
  it("delegates to apiClient.queryPredictions", async () => {
    const data = [{ txHash: "0xp1", author: "0xa1", text: "BTC 100k", confidence: 0.8, assets: ["BTC"], deadline: "2026-12-31", status: "pending" as const }];
    const client = createMockApiClient({ queryPredictions: vi.fn().mockResolvedValue(mockOk(data)) });
    const pred = createPredictionsPrimitives({ apiClient: client });
    const result = await pred.query({ status: "pending" });

    expect(result).toEqual(mockOk(data));
  });
});

describe("predictions.resolve", () => {
  it("delegates to apiClient.resolvePrediction", async () => {
    const client = createMockApiClient({ resolvePrediction: vi.fn().mockResolvedValue(mockOk(undefined)) });
    const pred = createPredictionsPrimitives({ apiClient: client });
    await pred.resolve("0xp1", "correct", "price hit 100k");

    expect(client.resolvePrediction).toHaveBeenCalledWith("0xp1", "correct", "price hit 100k");
  });
});

describe("predictions.markets", () => {
  it("delegates to apiClient.getPredictionMarkets", async () => {
    const data = [{ market: "m1", question: "BTC?", outcomes: [], category: "crypto", volume: 100 }];
    const client = createMockApiClient({ getPredictionMarkets: vi.fn().mockResolvedValue(mockOk(data)) });
    const pred = createPredictionsPrimitives({ apiClient: client });
    const result = await pred.markets({ category: "crypto" });

    expect(result).toEqual(mockOk(data));
  });
});
