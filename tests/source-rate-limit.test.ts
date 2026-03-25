/**
 * Tests for tools/lib/sources/rate-limit.ts — in-memory token bucket rate limiter.
 *
 * Tests token acquisition, exhaustion, daily limits, retryAfter deadlines,
 * reset, and isRateLimited read-only checks.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  acquireRateLimitToken,
  recordRateLimitResponse,
  isRateLimited,
  resetRateLimits,
} from "../src/lib/sources/rate-limit.js";

beforeEach(() => {
  resetRateLimits();
  vi.useRealTimers();
});

describe("acquireRateLimitToken — fresh bucket", () => {
  it("succeeds on first acquire with default limits", () => {
    expect(acquireRateLimitToken("test-bucket")).toBe(true);
  });

  it("succeeds on first acquire with custom limits", () => {
    expect(acquireRateLimitToken("custom", 10, 100)).toBe(true);
  });
});

describe("acquireRateLimitToken — token exhaustion", () => {
  it("fails after exhausting all per-minute tokens", () => {
    const rpm = 5;
    // Consume all 5 tokens
    for (let i = 0; i < rpm; i++) {
      expect(acquireRateLimitToken("exhaust", rpm)).toBe(true);
    }
    // 6th should fail — no time to refill
    expect(acquireRateLimitToken("exhaust", rpm)).toBe(false);
  });

  it("refills tokens over time", async () => {
    const rpm = 2;
    // Consume both tokens
    acquireRateLimitToken("refill", rpm);
    acquireRateLimitToken("refill", rpm);
    expect(acquireRateLimitToken("refill", rpm)).toBe(false);

    // Advance time by 60 seconds (full refill for 2 rpm)
    vi.useFakeTimers();
    vi.advanceTimersByTime(60_000);

    expect(acquireRateLimitToken("refill", rpm)).toBe(true);

    vi.useRealTimers();
  });
});

describe("acquireRateLimitToken — daily limit", () => {
  it("fails after exhausting daily limit", () => {
    const dailyLimit = 3;
    for (let i = 0; i < dailyLimit; i++) {
      expect(acquireRateLimitToken("daily", 60, dailyLimit)).toBe(true);
    }
    // Next request exceeds daily cap
    expect(acquireRateLimitToken("daily", 60, dailyLimit)).toBe(false);
  });
});

describe("recordRateLimitResponse — retryAfter deadline", () => {
  it("blocks acquisition until retryAfter deadline expires", () => {
    vi.useFakeTimers();

    // First, create the bucket
    acquireRateLimitToken("retry-test");

    // Record a 429 with 30-second retry-after
    recordRateLimitResponse("retry-test", 30);

    // Should be blocked
    expect(acquireRateLimitToken("retry-test")).toBe(false);
    expect(isRateLimited("retry-test")).toBe(true);

    // Advance past the deadline
    vi.advanceTimersByTime(31_000);

    // Tokens were drained by recordRateLimitResponse, but refill should have
    // replenished some after 31 seconds at 60 rpm (31 tokens refilled)
    expect(acquireRateLimitToken("retry-test")).toBe(true);

    vi.useRealTimers();
  });

  it("drains all tokens on 429", () => {
    // Create bucket with plenty of tokens
    acquireRateLimitToken("drain-test", 100);

    // Record rate limit — should drain tokens to 0
    recordRateLimitResponse("drain-test", 60);

    // Even without retryAfter check, tokens should be 0
    // (but retryAfter will also block, so just check isRateLimited)
    expect(isRateLimited("drain-test")).toBe(true);
  });

  it("does nothing for unknown bucket", () => {
    expect(() => recordRateLimitResponse("nonexistent", 30)).not.toThrow();
  });
});

describe("isRateLimited", () => {
  it("returns false for unknown bucket", () => {
    expect(isRateLimited("never-created")).toBe(false);
  });

  it("returns false when tokens are available", () => {
    acquireRateLimitToken("check-test");
    expect(isRateLimited("check-test")).toBe(false);
  });

  it("returns true when tokens exhausted", () => {
    const rpm = 2;
    acquireRateLimitToken("check-exhaust", rpm);
    acquireRateLimitToken("check-exhaust", rpm);
    expect(isRateLimited("check-exhaust")).toBe(true);
  });

  it("does not consume a token", () => {
    const rpm = 1;
    acquireRateLimitToken("no-consume", rpm);
    // Only 0 tokens left, so isRateLimited should be true
    expect(isRateLimited("no-consume")).toBe(true);
    // But calling isRateLimited again should not change state further
    expect(isRateLimited("no-consume")).toBe(true);
  });
});

describe("resetRateLimits", () => {
  it("clears all bucket state", () => {
    acquireRateLimitToken("reset-a", 1);
    acquireRateLimitToken("reset-b", 1);

    // Both buckets should be exhausted
    expect(isRateLimited("reset-a")).toBe(true);
    expect(isRateLimited("reset-b")).toBe(true);

    resetRateLimits();

    // After reset, buckets don't exist — isRateLimited returns false
    expect(isRateLimited("reset-a")).toBe(false);
    expect(isRateLimited("reset-b")).toBe(false);

    // New acquire should succeed (fresh bucket)
    expect(acquireRateLimitToken("reset-a", 1)).toBe(true);
  });
});
