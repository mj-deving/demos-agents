/**
 * Tests for intelligence domain primitives.
 * TDD: tests written before implementation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockApiClient, mockOk, makeSignalData } from "./_helpers.js";

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
