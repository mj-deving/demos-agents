import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SourceRecordV2, SourceStatus } from "../tools/lib/sources/catalog.js";
import type { SourceTestResult, SourceTestStatus } from "../tools/lib/sources/health.js";

// ── Mocks ────────────────────────────────────────────

vi.mock("../tools/lib/sdk.js", () => ({
  apiCall: vi.fn(),
  info: vi.fn(),
}));

import {
  evaluateTransition,
  updateRating,
  applyTransitions,
  type TransitionResult,
} from "../tools/lib/sources/lifecycle.js";

// ── Fixtures ─────────────────────────────────────────

function makeSource(overrides: Partial<SourceRecordV2> = {}): SourceRecordV2 {
  return {
    id: "test-source-abc123",
    name: "Test Source",
    provider: "coingecko",
    url: "https://api.example.com/test",
    urlPattern: "api.example.com/test",
    topics: ["test"],
    tlsn_safe: true,
    dahr_safe: true,
    max_response_kb: 8,
    topicAliases: [],
    domainTags: ["test"],
    responseFormat: "json",
    scope: { visibility: "global", importedFrom: ["sentinel"] },
    runtime: {
      timeoutMs: 5000,
      retry: { maxAttempts: 2, backoffMs: 500, retryOn: ["timeout"] },
    },
    trustTier: "official",
    status: "active",
    rating: {
      overall: 90,
      uptime: 90,
      relevance: 90,
      freshness: 90,
      sizeStability: 90,
      engagement: 90,
      trust: 90,
      testCount: 10,
      successCount: 10,
      consecutiveFailures: 0,
    },
    lifecycle: {
      discoveredAt: "2026-01-01T00:00:00.000Z",
      discoveredBy: "manual",
    },
    ...overrides,
  };
}

function makeTestResult(overrides: Partial<SourceTestResult> = {}): SourceTestResult {
  return {
    sourceId: "test-source-abc123",
    provider: "coingecko",
    status: "OK",
    latencyMs: 200,
    entryCount: 5,
    sampleTitles: ["Test"],
    error: null,
    ...overrides,
  };
}

// ── evaluateTransition ───────────────────────────────

describe("evaluateTransition", () => {
  it("quarantined with 3+ successCount and 0 failures → recommends active", () => {
    const source = makeSource({
      status: "quarantined",
      rating: {
        overall: 70, uptime: 70, relevance: 70, freshness: 70,
        sizeStability: 70, engagement: 70, trust: 70,
        testCount: 5, successCount: 3, consecutiveFailures: 0,
      },
    });

    const result = evaluateTransition(source);

    expect(result.newStatus).toBe("active");
    expect(result.reason.toLowerCase()).toContain("promot");
  });

  it("quarantined with 2 successCount → no change", () => {
    const source = makeSource({
      status: "quarantined",
      rating: {
        overall: 70, uptime: 70, relevance: 70, freshness: 70,
        sizeStability: 70, engagement: 70, trust: 70,
        testCount: 4, successCount: 2, consecutiveFailures: 0,
      },
    });

    const result = evaluateTransition(source);

    expect(result.newStatus).toBeNull();
  });

  it("quarantined with consecutiveFailures > 0 → no change", () => {
    const source = makeSource({
      status: "quarantined",
      rating: {
        overall: 70, uptime: 70, relevance: 70, freshness: 70,
        sizeStability: 70, engagement: 70, trust: 70,
        testCount: 5, successCount: 3, consecutiveFailures: 1,
      },
    });

    const result = evaluateTransition(source);

    expect(result.newStatus).toBeNull();
  });

  it("active with rating.overall < 40 → recommends degraded", () => {
    const source = makeSource({
      status: "active",
      rating: {
        overall: 35, uptime: 30, relevance: 50, freshness: 30,
        sizeStability: 30, engagement: 30, trust: 30,
        testCount: 10, successCount: 5, consecutiveFailures: 2,
      },
    });

    const result = evaluateTransition(source);

    expect(result.newStatus).toBe("degraded");
  });

  it("active with consecutiveFailures >= 3 → recommends degraded", () => {
    const source = makeSource({
      status: "active",
      rating: {
        overall: 80, uptime: 80, relevance: 80, freshness: 80,
        sizeStability: 80, engagement: 80, trust: 80,
        testCount: 15, successCount: 12, consecutiveFailures: 3,
      },
    });

    const result = evaluateTransition(source);

    expect(result.newStatus).toBe("degraded");
  });

  it("active with good rating and 0 failures → no change", () => {
    const source = makeSource({
      status: "active",
      rating: {
        overall: 90, uptime: 90, relevance: 90, freshness: 90,
        sizeStability: 90, engagement: 90, trust: 90,
        testCount: 20, successCount: 20, consecutiveFailures: 0,
      },
    });

    const result = evaluateTransition(source);

    expect(result.newStatus).toBeNull();
  });

  it("degraded with statusChangedAt > 14 days ago → recommends stale", () => {
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    const source = makeSource({
      status: "degraded",
      rating: {
        overall: 30, uptime: 30, relevance: 30, freshness: 30,
        sizeStability: 30, engagement: 30, trust: 30,
        testCount: 10, successCount: 0, consecutiveFailures: 5,
      },
      lifecycle: {
        discoveredAt: "2026-01-01T00:00:00.000Z",
        discoveredBy: "manual",
        statusChangedAt: fifteenDaysAgo,
      },
    });

    const result = evaluateTransition(source);

    expect(result.newStatus).toBe("stale");
  });

  it("degraded with statusChangedAt < 14 days ago → no change", () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const source = makeSource({
      status: "degraded",
      rating: {
        overall: 30, uptime: 30, relevance: 30, freshness: 30,
        sizeStability: 30, engagement: 30, trust: 30,
        testCount: 10, successCount: 0, consecutiveFailures: 5,
      },
      lifecycle: {
        discoveredAt: "2026-01-01T00:00:00.000Z",
        discoveredBy: "manual",
        statusChangedAt: fiveDaysAgo,
      },
    });

    const result = evaluateTransition(source);

    expect(result.newStatus).toBeNull();
  });

  it("degraded with 3 consecutive passes and rating >= 60 → recommends active (recovery)", () => {
    const source = makeSource({
      status: "degraded",
      rating: {
        overall: 65, uptime: 60, relevance: 70, freshness: 60,
        sizeStability: 60, engagement: 60, trust: 60,
        testCount: 20, successCount: 3, consecutiveFailures: 0,
      },
    });

    const result = evaluateTransition(source);

    expect(result.newStatus).toBe("active");
  });

  it("stale with statusChangedAt > 30 days ago → recommends deprecated", () => {
    const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
    const source = makeSource({
      status: "stale",
      lifecycle: {
        discoveredAt: "2026-01-01T00:00:00.000Z",
        discoveredBy: "manual",
        statusChangedAt: thirtyFiveDaysAgo,
      },
    });

    const result = evaluateTransition(source);

    expect(result.newStatus).toBe("deprecated");
  });

  it("archived → always no change", () => {
    const source = makeSource({ status: "archived" });

    const result = evaluateTransition(source);

    expect(result.newStatus).toBeNull();
  });

  it("quarantined with historical successes + recent failure + 1 recovery → no change", () => {
    // Regression: source had many successes, then failed, then 1 pass
    // successCount was reset to 0 on failure, now at 1 — NOT enough for promotion
    const source = makeSource({
      status: "quarantined",
      rating: {
        overall: 70, uptime: 70, relevance: 70, freshness: 70,
        sizeStability: 70, engagement: 70, trust: 70,
        testCount: 10, successCount: 1, consecutiveFailures: 0,
      },
    });

    const result = evaluateTransition(source);

    expect(result.newStatus).toBeNull(); // Need 3 consecutive, only have 1
  });

  it("applyTransitions sets statusChangedAt on every transition", () => {
    const source = makeSource({ status: "quarantined" });
    const transition: TransitionResult = {
      sourceId: source.id,
      currentStatus: "quarantined",
      newStatus: "active",
      reason: "promoted",
    };

    const updated = applyTransitions([source], [transition]);

    expect(updated[0].lifecycle.statusChangedAt).toBeDefined();
  });

  it("evaluateTransition without testResult uses only historical rating data", () => {
    const source = makeSource({
      status: "quarantined",
      rating: {
        overall: 70, uptime: 70, relevance: 70, freshness: 70,
        sizeStability: 70, engagement: 70, trust: 70,
        testCount: 5, successCount: 3, consecutiveFailures: 0,
      },
    });

    // No testResult provided — should still evaluate based on rating
    const result = evaluateTransition(source);

    expect(result.newStatus).toBe("active");
    expect(result.testResult).toBeUndefined();
  });
});

// ── updateRating ─────────────────────────────────────

describe("updateRating", () => {
  it("OK test increments testCount and successCount, resets consecutiveFailures", () => {
    const source = makeSource({
      rating: {
        overall: 70, uptime: 70, relevance: 70, freshness: 70,
        sizeStability: 70, engagement: 70, trust: 70,
        testCount: 5, successCount: 3, consecutiveFailures: 2,
      },
    });
    const testResult = makeTestResult({ status: "OK" });

    const updated = updateRating(source, testResult);

    expect(updated.rating.testCount).toBe(6);
    expect(updated.rating.successCount).toBe(4);
    expect(updated.rating.consecutiveFailures).toBe(0);
  });

  it("EMPTY test increments testCount and successCount (valid response)", () => {
    const source = makeSource({
      rating: {
        overall: 70, uptime: 70, relevance: 70, freshness: 70,
        sizeStability: 70, engagement: 70, trust: 70,
        testCount: 5, successCount: 3, consecutiveFailures: 0,
      },
    });
    const testResult = makeTestResult({ status: "EMPTY" });

    const updated = updateRating(source, testResult);

    expect(updated.rating.testCount).toBe(6);
    expect(updated.rating.successCount).toBe(4);
    expect(updated.rating.consecutiveFailures).toBe(0);
  });

  it("FETCH_FAILED increments testCount and consecutiveFailures, resets successCount", () => {
    const source = makeSource({
      rating: {
        overall: 70, uptime: 70, relevance: 70, freshness: 70,
        sizeStability: 70, engagement: 70, trust: 70,
        testCount: 5, successCount: 3, consecutiveFailures: 0,
      },
    });
    const testResult = makeTestResult({ status: "FETCH_FAILED" });

    const updated = updateRating(source, testResult);

    expect(updated.rating.testCount).toBe(6);
    expect(updated.rating.successCount).toBe(0); // reset on failure
    expect(updated.rating.consecutiveFailures).toBe(1);
  });

  it("PARSE_FAILED increments testCount and consecutiveFailures, resets successCount", () => {
    const source = makeSource({
      rating: {
        overall: 70, uptime: 70, relevance: 70, freshness: 70,
        sizeStability: 70, engagement: 70, trust: 70,
        testCount: 5, successCount: 4, consecutiveFailures: 0,
      },
    });
    const testResult = makeTestResult({ status: "PARSE_FAILED" });

    const updated = updateRating(source, testResult);

    expect(updated.rating.testCount).toBe(6);
    expect(updated.rating.successCount).toBe(0);
    expect(updated.rating.consecutiveFailures).toBe(1);
  });

  it("NO_ADAPTER increments testCount only", () => {
    const source = makeSource({
      rating: {
        overall: 70, uptime: 70, relevance: 70, freshness: 70,
        sizeStability: 70, engagement: 70, trust: 70,
        testCount: 5, successCount: 3, consecutiveFailures: 1,
      },
    });
    const testResult = makeTestResult({ status: "NO_ADAPTER" });

    const updated = updateRating(source, testResult);

    expect(updated.rating.testCount).toBe(6);
    expect(updated.rating.successCount).toBe(3); // unchanged
    expect(updated.rating.consecutiveFailures).toBe(1); // unchanged
  });

  it("NOT_SUPPORTED increments testCount only", () => {
    const source = makeSource();
    const testResult = makeTestResult({ status: "NOT_SUPPORTED" });

    const updated = updateRating(source, testResult);

    expect(updated.rating.testCount).toBe(11);
    // successCount and consecutiveFailures unchanged
  });

  it("VALIDATION_REJECTED increments testCount only", () => {
    const source = makeSource();
    const testResult = makeTestResult({ status: "VALIDATION_REJECTED" });

    const updated = updateRating(source, testResult);

    expect(updated.rating.testCount).toBe(11);
  });

  it("NO_CANDIDATES increments testCount only", () => {
    const source = makeSource();
    const testResult = makeTestResult({ status: "NO_CANDIDATES" });

    const updated = updateRating(source, testResult);

    expect(updated.rating.testCount).toBe(11);
  });

  it("UNRESOLVED_VARS increments testCount only", () => {
    const source = makeSource();
    const testResult = makeTestResult({ status: "UNRESOLVED_VARS" });

    const updated = updateRating(source, testResult);

    expect(updated.rating.testCount).toBe(11);
  });

  it("lastTestedAt is set to current time on any test", () => {
    const source = makeSource();
    const before = Date.now();
    const updated = updateRating(source, makeTestResult());
    const after = Date.now();

    const testedAt = new Date(updated.rating.lastTestedAt!).getTime();
    expect(testedAt).toBeGreaterThanOrEqual(before);
    expect(testedAt).toBeLessThanOrEqual(after);
  });

  it("lastFailedAt is set on failure statuses only", () => {
    const source = makeSource();

    // OK → no lastFailedAt
    const okResult = updateRating(source, makeTestResult({ status: "OK" }));
    expect(okResult.lifecycle.lastFailedAt).toBeUndefined();

    // FETCH_FAILED → lastFailedAt set
    const failResult = updateRating(source, makeTestResult({ status: "FETCH_FAILED" }));
    expect(failResult.lifecycle.lastFailedAt).toBeDefined();
  });

  it("does not mutate the original source", () => {
    const source = makeSource();
    const originalTestCount = source.rating.testCount;

    updateRating(source, makeTestResult());

    expect(source.rating.testCount).toBe(originalTestCount);
  });
});

// ── applyTransitions ─────────────────────────────────

describe("applyTransitions", () => {
  it("sets promotedAt for quarantined→active transition", () => {
    const source = makeSource({ status: "quarantined" });
    const transition: TransitionResult = {
      sourceId: source.id,
      currentStatus: "quarantined",
      newStatus: "active",
      reason: "3 consecutive passes",
    };

    const updated = applyTransitions([source], [transition]);

    expect(updated[0].status).toBe("active");
    expect(updated[0].lifecycle.promotedAt).toBeDefined();
  });

  it("sets deprecatedAt for stale→deprecated transition", () => {
    const source = makeSource({ status: "stale" });
    const transition: TransitionResult = {
      sourceId: source.id,
      currentStatus: "stale",
      newStatus: "deprecated",
      reason: "30+ days stale",
    };

    const updated = applyTransitions([source], [transition]);

    expect(updated[0].status).toBe("deprecated");
    expect(updated[0].lifecycle.deprecatedAt).toBeDefined();
  });

  it("does not modify sources with null newStatus", () => {
    const source = makeSource({ status: "active" });
    const transition: TransitionResult = {
      sourceId: source.id,
      currentStatus: "active",
      newStatus: null,
      reason: "no change needed",
    };

    const updated = applyTransitions([source], [transition]);

    expect(updated[0].status).toBe("active");
    expect(updated[0]).toEqual(source);
  });

  it("preserves all other source fields", () => {
    const source = makeSource({
      status: "quarantined",
      name: "My Special Source",
      topics: ["crypto", "defi"],
      rating: {
        overall: 70, uptime: 70, relevance: 70, freshness: 70,
        sizeStability: 70, engagement: 70, trust: 70,
        testCount: 5, successCount: 3, consecutiveFailures: 0,
      },
    });
    const transition: TransitionResult = {
      sourceId: source.id,
      currentStatus: "quarantined",
      newStatus: "active",
      reason: "promoted",
    };

    const updated = applyTransitions([source], [transition]);

    expect(updated[0].name).toBe("My Special Source");
    expect(updated[0].topics).toEqual(["crypto", "defi"]);
    expect(updated[0].rating.testCount).toBe(5);
  });

  it("is idempotent — applying same transitions twice produces same result", () => {
    const source = makeSource({ status: "quarantined" });
    const transition: TransitionResult = {
      sourceId: source.id,
      currentStatus: "quarantined",
      newStatus: "active",
      reason: "promoted",
    };

    const first = applyTransitions([source], [transition]);
    const second = applyTransitions(first, [transition]);

    // Second apply: transition says quarantined→active but source is already active
    // Should not error, source stays active
    expect(second[0].status).toBe("active");
  });

  it("refuses transitions that violate state machine", () => {
    const source = makeSource({ status: "quarantined" });
    const badTransition: TransitionResult = {
      sourceId: source.id,
      currentStatus: "quarantined",
      newStatus: "stale", // invalid: quarantined can't go to stale
      reason: "bad transition",
    };

    const updated = applyTransitions([source], [badTransition]);

    // Invalid transition is ignored — source unchanged
    expect(updated[0].status).toBe("quarantined");
  });
});
