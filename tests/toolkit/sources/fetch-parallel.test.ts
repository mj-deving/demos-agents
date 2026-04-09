import { describe, it, expect, vi } from "vitest";

// Mock all external dependencies before importing
vi.mock("../../../src/toolkit/sources/fetch.js", () => ({
  fetchSource: vi.fn(),
}));

vi.mock("../../../src/toolkit/sources/rate-limit.js", () => ({
  acquireRateLimitToken: vi.fn(() => true),
}));

vi.mock("../../../src/toolkit/sources/lifecycle.js", () => ({
  persistRatingUpdate: vi.fn((_db, source) => source),
  persistTransition: vi.fn(() => ({ newStatus: null, reason: "Healthy" })),
}));

vi.mock("../../../src/toolkit/colony/source-cache.js", () => ({
  upsertSourceResponse: vi.fn(),
  getSourceResponse: vi.fn(() => null),
}));

vi.mock("../../../src/toolkit/util/limiter.js", () => ({
  createLimiter: () => <T>(fn: () => Promise<T>) => fn(),
}));

import { fetchSourcesParallel } from "../../../src/toolkit/sources/fetch-parallel.js";

describe("fetchSourcesParallel (toolkit)", () => {
  const observe = vi.fn();
  const fakeDb = {
    transaction: (fn: () => void) => fn,
  } as any;

  it("is importable from toolkit path", () => {
    expect(typeof fetchSourcesParallel).toBe("function");
  });

  it("returns zeros for empty sources array", async () => {
    const result = await fetchSourcesParallel([], fakeDb, observe);
    expect(result).toEqual({ fetched: 0, cached: 0, lifecycleTransitions: 0 });
  });

  it("completes without hanging when given a short budget", async () => {
    // Verifies the timer cleanup path runs correctly — no leaked timers
    const { fetchSource } = await import("../../../src/toolkit/sources/fetch.js");
    (fetchSource as any).mockResolvedValue({
      ok: true,
      response: { url: "https://example.com", status: 200, bodyText: "ok" },
    });

    const source = {
      id: "s1",
      name: "s1",
      url: "https://example.com",
      provider: "test",
      status: "active",
      domainTags: [],
      responseFormat: "json",
      rating: { overall: 80, uptime: 90, relevance: 70, freshness: 80, sizeStability: 80, engagement: 0, trust: 0, testCount: 5, successCount: 3, consecutiveFailures: 0 },
      lifecycle: {},
    } as any;

    const result = await fetchSourcesParallel([source], fakeDb, observe, 5000, 1);
    expect(result.fetched).toBe(1);
    expect(result.cached).toBe(1);
  });
});
