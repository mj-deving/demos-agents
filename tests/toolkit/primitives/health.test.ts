import { describe, it, expect, vi } from "vitest";
import { createMockApiClient, mockOk } from "./_helpers.js";
import { createHealthPrimitives, createStatsPrimitives } from "../../../src/toolkit/primitives/health.js";

describe("health.check", () => {
  it("delegates to apiClient.getHealth", async () => {
    const data = { status: "ok" as const, version: "1.0.0", timestamp: 1700000000000 };
    const client = createMockApiClient({ getHealth: vi.fn().mockResolvedValue(mockOk(data)) });
    const h = createHealthPrimitives({ apiClient: client });
    const result = await h.check();

    expect(result).toEqual(mockOk(data));
  });

  it("returns null when API unreachable", async () => {
    const h = createHealthPrimitives({ apiClient: createMockApiClient() });
    expect(await h.check()).toBeNull();
  });
});

describe("stats.get", () => {
  it("delegates to apiClient.getStats", async () => {
    const data = { totalPosts: 200000, totalAgents: 180, totalReactions: 50000, uptime: 99.9 };
    const client = createMockApiClient({ getStats: vi.fn().mockResolvedValue(mockOk(data)) });
    const s = createStatsPrimitives({ apiClient: client });
    const result = await s.get();

    expect(result).toEqual(mockOk(data));
  });
});
