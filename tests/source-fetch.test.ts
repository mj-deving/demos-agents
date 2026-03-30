/**
 * Tests for tools/lib/sources/fetch.ts — HTTP fetch with retry, timeout,
 * and rate-limit integration.
 *
 * Mocks global fetch and rate-limit module to isolate fetch logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SourceRecordV2 } from "../src/lib/sources/catalog.js";

// ── Mocks ────────────────────────────────────────────

vi.mock("../src/toolkit/sources/rate-limit.js", () => ({
  acquireRateLimitToken: vi.fn(() => true),
  recordRateLimitResponse: vi.fn(),
}));

import { fetchSource } from "../src/lib/sources/fetch.js";
import {
  acquireRateLimitToken,
  recordRateLimitResponse,
} from "../src/toolkit/sources/rate-limit.js";

const mockAcquire = vi.mocked(acquireRateLimitToken);
const mockRecord = vi.mocked(recordRateLimitResponse);

// ── Helpers ──────────────────────────────────────────

/** Minimal SourceRecordV2 with runtime config for fetch tests. */
function makeSource(overrides?: Partial<SourceRecordV2["runtime"]>): SourceRecordV2 {
  return {
    id: "test-source",
    name: "Test Source",
    provider: "test-provider",
    url: "https://example.com/api",
    urlPattern: "https://example.com/api",
    domainTags: ["test"],
    responseFormat: "json",
    scope: { visibility: "global", importedFrom: ["sentinel"] },
    runtime: {
      timeoutMs: 5000,
      retry: {
        maxAttempts: 3,
        backoffMs: 10, // very short for tests
        retryOn: ["5xx", "timeout", "429"],
        ...overrides?.retry,
      },
      timeoutMs: overrides?.timeoutMs ?? 5000,
    },
    trustTier: "established",
    status: "active",
    rating: {
      overall: 80,
      uptime: 90,
      relevance: 80,
      freshness: 70,
      sizeStability: 80,
      engagement: 0,
      trust: 80,
      testCount: 5,
      successCount: 5,
      consecutiveFailures: 0,
    },
    lifecycle: {
      discoveredAt: "2026-01-01T00:00:00Z",
      discoveredBy: "manual",
    },
  } as SourceRecordV2;
}

/** Create a mock Response object. */
function mockResponse(status: number, body: string, headers: Record<string, string> = {}): Response {
  const h = new Headers(headers);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: h,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

// ── Tests ────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
  mockAcquire.mockReturnValue(true);
  mockRecord.mockReset();
  // Reset global fetch
  vi.stubGlobal("fetch", vi.fn());
});

describe("fetchSource — successful fetch", () => {
  it("returns ok: true with response data on 200", async () => {
    const body = '{"data":"hello"}';
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, body, { "content-type": "application/json" }));

    const result = await fetchSource("https://example.com/api", makeSource());

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.response).toBeDefined();
    expect(result.response!.status).toBe(200);
    expect(result.response!.bodyText).toBe(body);
    expect(result.response!.url).toBe("https://example.com/api");
    expect(result.response!.headers["content-type"]).toBe("application/json");
    expect(result.totalMs).toBeGreaterThanOrEqual(0);
  });
});

describe("fetchSource — 5xx retry", () => {
  it("retries on 500 up to maxAttempts then returns last response", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(mockResponse(500, "error1"))
      .mockResolvedValueOnce(mockResponse(500, "error2"))
      .mockResolvedValueOnce(mockResponse(500, "error3"));

    const source = makeSource();
    const result = await fetchSource("https://example.com/api", source);

    // 3 attempts (maxAttempts = 3), last one is returned as non-ok
    expect(result.attempts).toBe(3);
    expect(result.ok).toBe(false);
    expect(result.response).toBeDefined();
    expect(result.response!.status).toBe(500);
  });

  it("succeeds on retry after initial 500", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(mockResponse(500, "error"))
      .mockResolvedValueOnce(mockResponse(200, '{"ok":true}'));

    const result = await fetchSource("https://example.com/api", makeSource());

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.response!.status).toBe(200);
  });
});

describe("fetchSource — 429 rate limit", () => {
  it("records rate limit response and retries when configured", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(mockResponse(429, "rate limited", { "retry-after": "30" }))
      .mockResolvedValueOnce(mockResponse(200, '{"ok":true}'));

    const result = await fetchSource("https://example.com/api", makeSource(), {
      rateLimitBucket: "test-bucket",
    });

    // Should have recorded the 429
    expect(mockRecord).toHaveBeenCalledWith("test-bucket", 30);
    // Should have retried and succeeded
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it("returns last 429 response when retries exhausted", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValue(mockResponse(429, "rate limited", { "retry-after": "60" }));

    const result = await fetchSource("https://example.com/api", makeSource(), {
      rateLimitBucket: "test-bucket",
    });

    // All 3 attempts were 429
    expect(result.attempts).toBe(3);
    expect(result.ok).toBe(false);
    expect(result.response!.status).toBe(429);
  });
});

describe("fetchSource — rate limited before fetch", () => {
  it("returns immediately with error when rate limit token denied", async () => {
    mockAcquire.mockReturnValue(false);

    const result = await fetchSource("https://example.com/api", makeSource(), {
      rateLimitBucket: "test-bucket",
    });

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.error).toContain("Rate limited");
    expect(result.totalMs).toBe(0);
    // fetch should never have been called
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("fetchSource — timeout retry", () => {
  it("retries on timeout when configured", async () => {
    const fetchMock = vi.mocked(fetch);
    // First call aborts, second succeeds
    fetchMock
      .mockRejectedValueOnce(new DOMException("The operation was aborted", "AbortError"))
      .mockResolvedValueOnce(mockResponse(200, '{"ok":true}'));

    const result = await fetchSource("https://example.com/api", makeSource());

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it("fails after all timeout retries exhausted", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));

    const result = await fetchSource("https://example.com/api", makeSource());

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.error).toContain("Timeout");
  });
});

describe("fetchSource — no retry configured", () => {
  it("does not retry when retryOn is empty", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(mockResponse(500, "error"));

    const source = makeSource();
    // Override retryOn to be empty
    source.runtime.retry.retryOn = [];

    const result = await fetchSource("https://example.com/api", source);

    expect(result.attempts).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.response!.status).toBe(500);
  });
});
