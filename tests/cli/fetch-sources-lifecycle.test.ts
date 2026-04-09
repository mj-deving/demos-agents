import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch to avoid real network calls
vi.stubGlobal("fetch", vi.fn());

// Mock the source modules
const persistRatingUpdateMock = vi.fn();
const persistTransitionMock = vi.fn();

vi.mock("../../src/toolkit/sources/lifecycle.js", () => ({
  persistRatingUpdate: (...args: any[]) => persistRatingUpdateMock(...args),
  persistTransition: (...args: any[]) => persistTransitionMock(...args),
}));

vi.mock("../../src/toolkit/sources/rate-limit.js", () => ({
  acquireRateLimitToken: vi.fn(() => true),
}));

vi.mock("../../src/toolkit/sources/fetch.js", () => ({
  fetchSource: vi.fn(async (url: string) => {
    if (url.includes("fail")) {
      throw new Error("fetch failed");
    }
    return {
      ok: true,
      response: {
        url,
        status: 200,
        bodyText: "response body",
      },
    };
  }),
}));

vi.mock("../../src/toolkit/colony/source-cache.js", () => ({
  upsertSourceResponse: vi.fn(),
  getSourceResponse: vi.fn(() => null),
}));

vi.mock("../../src/toolkit/util/limiter.js", () => ({
  createLimiter: () => <T>(fn: () => Promise<T>) => fn(),
}));

import { fetchSourcesParallel } from "../../src/toolkit/sources/fetch-parallel.js";
import type { SourceRecordV2 } from "../../src/toolkit/sources/catalog.js";

function makeSource(id: string, url = "https://example.com"): SourceRecordV2 {
  return {
    id,
    name: id,
    url,
    provider: "test-provider",
    status: "active",
    domainTags: [],
    responseFormat: "json",
    rating: {
      overall: 80,
      uptime: 90,
      relevance: 70,
      freshness: 80,
      sizeStability: 80,
      engagement: 0,
      trust: 0,
      testCount: 5,
      successCount: 3,
      consecutiveFailures: 0,
    },
    lifecycle: {},
  } as SourceRecordV2;
}

describe("fetchSourcesParallel lifecycle persistence", () => {
  const observe = vi.fn();
  // Mock DB needs transaction() — SQLite transaction wraps a function and executes it
  const fakeDb = {
    transaction: (fn: () => void) => fn,
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    persistRatingUpdateMock.mockImplementation((_db, source, _testResult) => source);
    persistTransitionMock.mockReturnValue({ newStatus: null, reason: "Healthy" });
  });

  it("calls persistRatingUpdate for each fetched source", async () => {
    const sources = [makeSource("s1"), makeSource("s2")];
    await fetchSourcesParallel(sources, fakeDb, observe);

    expect(persistRatingUpdateMock).toHaveBeenCalledTimes(2);
    expect(persistRatingUpdateMock).toHaveBeenCalledWith(
      fakeDb,
      expect.objectContaining({ id: "s1" }),
      expect.objectContaining({ status: "OK" }),
    );
    expect(persistRatingUpdateMock).toHaveBeenCalledWith(
      fakeDb,
      expect.objectContaining({ id: "s2" }),
      expect.objectContaining({ status: "OK" }),
    );
  });

  it("calls persistTransition for each fetched source", async () => {
    const sources = [makeSource("s1"), makeSource("s2")];
    await fetchSourcesParallel(sources, fakeDb, observe);

    expect(persistTransitionMock).toHaveBeenCalledTimes(2);
    // persistTransition receives the updated source from persistRatingUpdate
    expect(persistTransitionMock).toHaveBeenCalledWith(
      fakeDb,
      expect.objectContaining({ id: "s1" }),
      expect.objectContaining({ status: "OK" }),
    );
  });

  it("passes FETCH_FAILED status for failed sources", async () => {
    const sources = [makeSource("s-fail", "https://fail.example.com")];
    await fetchSourcesParallel(sources, fakeDb, observe);

    expect(persistRatingUpdateMock).toHaveBeenCalledWith(
      fakeDb,
      expect.objectContaining({ id: "s-fail" }),
      expect.objectContaining({ status: "FETCH_FAILED" }),
    );
  });

  it("counts lifecycle transitions in return value", async () => {
    persistTransitionMock.mockReturnValueOnce({
      newStatus: "degraded",
      currentStatus: "active",
      reason: "3 consecutive failures",
    });
    persistTransitionMock.mockReturnValueOnce({ newStatus: null, reason: "Healthy" });

    const sources = [makeSource("s1"), makeSource("s2")];
    const result = await fetchSourcesParallel(sources, fakeDb, observe);

    expect(result.lifecycleTransitions).toBe(1);
  });
});
