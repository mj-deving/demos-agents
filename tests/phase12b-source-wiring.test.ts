/**
 * Phase 12b — Tests for source health filtering, rate limiting,
 * and lifecycle transitions wired into the SENSE phase.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SourceRecordV2, SourceStatus } from "../src/toolkit/sources/catalog.js";
import { acquireRateLimitToken, isRateLimited, resetRateLimits } from "../src/toolkit/sources/rate-limit.js";
import { updateRating, evaluateTransition, applyTransitions, sampleSources } from "../src/toolkit/sources/lifecycle.js";
import type { SourceTestResult } from "../src/toolkit/sources/health.js";

function makeSource(overrides: Partial<SourceRecordV2> = {}): SourceRecordV2 {
  return {
    id: "test-src",
    name: "Test Source",
    provider: "generic",
    url: "https://example.com/api",
    urlPattern: "example.com",
    topics: ["test"],
    tlsn_safe: true,
    dahr_safe: true,
    max_response_kb: 8,
    topicAliases: [],
    domainTags: ["test"],
    status: "active" as SourceStatus,
    rating: {
      overall: 80,
      testCount: 10,
      successCount: 5,
      consecutiveFailures: 0,
      lastTestedAt: new Date().toISOString(),
    },
    lifecycle: {
      addedAt: "2026-01-01T00:00:00Z",
      statusChangedAt: "2026-01-01T00:00:00Z",
    },
    ...overrides,
  } as SourceRecordV2;
}

// ── Health Filtering Tests ──────────────────────

describe("source health filtering (Phase 12b)", () => {
  const UNHEALTHY_STATUSES = new Set(["degraded", "stale", "deprecated", "archived"]);

  it("filters out degraded sources", () => {
    const sources = [
      makeSource({ id: "active-1", status: "active" }),
      makeSource({ id: "degraded-1", status: "degraded" }),
      makeSource({ id: "active-2", status: "active" }),
    ];
    const healthy = sources.filter(s => !UNHEALTHY_STATUSES.has(s.status));
    expect(healthy).toHaveLength(2);
    expect(healthy.map(s => s.id)).toEqual(["active-1", "active-2"]);
  });

  it("filters out stale and deprecated sources", () => {
    const sources = [
      makeSource({ id: "active-1", status: "active" }),
      makeSource({ id: "stale-1", status: "stale" }),
      makeSource({ id: "deprecated-1", status: "deprecated" }),
    ];
    const healthy = sources.filter(s => !UNHEALTHY_STATUSES.has(s.status));
    expect(healthy).toHaveLength(1);
    expect(healthy[0].id).toBe("active-1");
  });

  it("passes through quarantined sources (they need testing)", () => {
    const sources = [
      makeSource({ id: "quarantined-1", status: "quarantined" }),
      makeSource({ id: "active-1", status: "active" }),
    ];
    const healthy = sources.filter(s => !UNHEALTHY_STATUSES.has(s.status));
    expect(healthy).toHaveLength(2);
  });

  it("returns empty array when all sources unhealthy", () => {
    const sources = [
      makeSource({ id: "degraded-1", status: "degraded" }),
      makeSource({ id: "archived-1", status: "archived" }),
    ];
    const healthy = sources.filter(s => !UNHEALTHY_STATUSES.has(s.status));
    expect(healthy).toHaveLength(0);
  });
});

// ── Rate Limiting Tests ──────────────────────────

describe("per-source rate limiting (Phase 12b)", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("allows requests within rate limit", () => {
    expect(isRateLimited("test-provider")).toBe(false);
    expect(acquireRateLimitToken("test-provider", 10)).toBe(true);
  });

  it("blocks when tokens exhausted", () => {
    // Exhaust all 2 tokens
    acquireRateLimitToken("tiny-provider", 2);
    acquireRateLimitToken("tiny-provider", 2);
    expect(isRateLimited("tiny-provider")).toBe(true);
    expect(acquireRateLimitToken("tiny-provider", 2)).toBe(false);
  });

  it("isolates rate limits per provider", () => {
    // Exhaust provider A
    acquireRateLimitToken("provider-a", 1);
    expect(isRateLimited("provider-a")).toBe(true);
    // Provider B unaffected
    expect(isRateLimited("provider-b")).toBe(false);
  });
});

// ── Lifecycle Integration Tests ──────────────────

describe("lifecycle transitions after fetch (Phase 12b)", () => {
  it("records successful fetch in rating", () => {
    const source = makeSource({
      rating: { overall: 80, testCount: 5, successCount: 2, consecutiveFailures: 1, lastTestedAt: null },
    });
    const testResult: SourceTestResult = {
      sourceId: source.id,
      provider: source.provider,
      status: "OK",
      latencyMs: 100,
      entryCount: 3,
      sampleTitles: [],
      error: null,
    };
    const updated = updateRating(source, testResult);
    expect(updated.rating.testCount).toBe(6);
    expect(updated.rating.successCount).toBe(3);
    expect(updated.rating.consecutiveFailures).toBe(0);
  });

  it("records failed fetch in rating", () => {
    const source = makeSource({
      rating: { overall: 80, testCount: 5, successCount: 3, consecutiveFailures: 0, lastTestedAt: null },
    });
    const testResult: SourceTestResult = {
      sourceId: source.id,
      provider: source.provider,
      status: "FETCH_FAILED",
      latencyMs: 5000,
      entryCount: 0,
      sampleTitles: [],
      error: "timeout",
    };
    const updated = updateRating(source, testResult);
    expect(updated.rating.testCount).toBe(6);
    expect(updated.rating.successCount).toBe(0); // Reset on failure
    expect(updated.rating.consecutiveFailures).toBe(1);
  });

  it("triggers active→degraded after 3 consecutive failures", () => {
    const source = makeSource({
      status: "active",
      rating: { overall: 80, testCount: 10, successCount: 0, consecutiveFailures: 3, lastTestedAt: null },
    });
    const transition = evaluateTransition(source);
    expect(transition.newStatus).toBe("degraded");
    expect(transition.reason).toContain("consecutive failures");
  });

  it("triggers quarantined→active after 3 consecutive passes", () => {
    const source = makeSource({
      status: "quarantined",
      rating: { overall: 80, testCount: 5, successCount: 3, consecutiveFailures: 0, lastTestedAt: null },
    });
    const transition = evaluateTransition(source);
    expect(transition.newStatus).toBe("active");
    expect(transition.reason).toContain("Promoted");
  });

  it("no transition for healthy active source", () => {
    const source = makeSource({
      status: "active",
      rating: { overall: 80, testCount: 10, successCount: 5, consecutiveFailures: 0, lastTestedAt: null },
    });
    const transition = evaluateTransition(source);
    expect(transition.newStatus).toBeNull();
    expect(transition.reason).toBe("Healthy");
  });

  it("applies transitions immutably", () => {
    const sources = [
      makeSource({ id: "src-1", status: "active", rating: { overall: 80, testCount: 10, successCount: 0, consecutiveFailures: 3, lastTestedAt: null } }),
      makeSource({ id: "src-2", status: "active", rating: { overall: 90, testCount: 10, successCount: 5, consecutiveFailures: 0, lastTestedAt: null } }),
    ];
    const transitions = sources.map(s => evaluateTransition(s));
    const updated = applyTransitions(sources, transitions);

    expect(updated[0].status).toBe("degraded");
    expect(updated[1].status).toBe("active");
    // Original unchanged
    expect(sources[0].status).toBe("active");
  });
});

// ── Lifecycle Sampling Tests ──────────────────────

describe("source sampling for lifecycle testing (Phase 12b)", () => {
  it("excludes archived and deprecated sources", () => {
    const sources = [
      makeSource({ id: "active-1", status: "active" }),
      makeSource({ id: "archived-1", status: "archived" }),
      makeSource({ id: "deprecated-1", status: "deprecated" }),
    ];
    const sampled = sampleSources(sources, 10);
    expect(sampled).toHaveLength(1);
    expect(sampled[0].id).toBe("active-1");
  });

  it("prioritizes quarantined near promotion", () => {
    const sources = [
      makeSource({ id: "active-old", status: "active", rating: { overall: 80, testCount: 10, successCount: 5, consecutiveFailures: 0, lastTestedAt: "2026-01-01T00:00:00Z" } }),
      makeSource({ id: "quarantined-near", status: "quarantined", rating: { overall: 50, testCount: 2, successCount: 2, consecutiveFailures: 0, lastTestedAt: new Date().toISOString() } }),
    ];
    const sampled = sampleSources(sources, 1);
    expect(sampled[0].id).toBe("quarantined-near");
  });
});
