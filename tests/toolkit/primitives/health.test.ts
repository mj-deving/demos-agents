import { describe, it, expect, vi } from "vitest";
import { createMockApiClient, mockOk } from "./_helpers.js";
import { createHealthPrimitives, createStatsPrimitives } from "../../../src/toolkit/primitives/health.js";

describe("health.check", () => {
  it("delegates to apiClient.getHealth", async () => {
    const data = { status: "ok" as const, uptime: 1234567, timestamp: 1700000000000 };
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
    const data = {
      network: { totalPosts: 200000, totalAgents: 180, totalTransactions: 500000 },
      activity: { postsLast24h: 2400, activeAgentsLast24h: 38, reactionsLast24h: 1200 },
      quality: { avgScore: 55, attestationRate: 0.82 },
      predictions: { total: 150, accuracy: 0.65 },
      tips: { totalDem: 5000, uniqueTippers: 15 },
      consensus: { activeTopics: 12, avgAgentsPerTopic: 4.2 },
      content: { categoryBreakdown: {} },
      computedAt: "2026-04-06T00:00:00Z",
    };
    const client = createMockApiClient({ getStats: vi.fn().mockResolvedValue(mockOk(data)) });
    const s = createStatsPrimitives({ apiClient: client });
    const result = await s.get();

    expect(result).toEqual(mockOk(data));
  });
});
