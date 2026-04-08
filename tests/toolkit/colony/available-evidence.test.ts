import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { computeAvailableEvidence } from "../../../src/toolkit/colony/available-evidence.js";
import { initColonyCache } from "../../../src/toolkit/colony/schema.js";
import { upsertSourceResponse } from "../../../src/toolkit/colony/source-cache.js";
import { MIN_PUBLISH_EVIDENCE_RICHNESS } from "../../../src/toolkit/strategy/engine-helpers.js";

describe("available evidence", () => {
  let db: ReturnType<typeof initColonyCache>;

  beforeEach(() => {
    db = initColonyCache(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("returns only fresh, healthy cached sources as available evidence", () => {
    upsertSourceResponse(db, {
      sourceId: "fresh-btc",
      url: "https://example.com/btc",
      lastFetchedAt: "2026-03-31T11:55:00.000Z",
      responseStatus: 200,
      responseSize: 256,
      responseBody: "{\"hash_rate\":877.9}",
      ttlSeconds: 900,
      consecutiveFailures: 0,
    });
    upsertSourceResponse(db, {
      sourceId: "stale-defi",
      url: "https://example.com/defi",
      lastFetchedAt: "2026-03-31T10:00:00.000Z",
      responseStatus: 200,
      responseSize: 128,
      responseBody: "{\"tvl\":1000}",
      ttlSeconds: 900,
      consecutiveFailures: 0,
    });
    upsertSourceResponse(db, {
      sourceId: "degraded-macro",
      url: "https://example.com/macro",
      lastFetchedAt: "2026-03-31T11:58:00.000Z",
      responseStatus: 503,
      responseSize: 64,
      responseBody: "down",
      ttlSeconds: 900,
      consecutiveFailures: 3,
    });
    upsertSourceResponse(db, {
      sourceId: "bad-status",
      url: "https://example.com/bad",
      lastFetchedAt: "2026-03-31T11:58:00.000Z",
      responseStatus: 500,
      responseSize: 64,
      responseBody: "oops",
      ttlSeconds: 900,
      consecutiveFailures: 0,
    });

    expect(computeAvailableEvidence(db, [
      { id: "fresh-btc", topics: ["bitcoin"], domainTags: ["hash_rate", "difficulty"] },
      { id: "stale-defi", topics: ["defi"], domainTags: ["tvl"] },
      { id: "degraded-macro", topics: ["macro"], domainTags: ["cpi"] },
      { id: "bad-status", topics: ["macro"], domainTags: ["rates"] },
      { id: "never-fetched", topics: ["solana"], domainTags: ["tps"] },
    ], new Date("2026-03-31T12:00:00.000Z"))).toEqual([
      // Evidence now indexed by all topics + domain tags (Phase 12 fix)
      // Insertion order: topics first (bitcoin), then domainTags (hash_rate, difficulty)
      { sourceId: "fresh-btc", subject: "bitcoin", metrics: ["hash_rate", "difficulty"], richness: 48, freshness: 300, stale: false },
      { sourceId: "fresh-btc", subject: "hash_rate", metrics: ["hash_rate", "difficulty"], richness: 48, freshness: 300, stale: false },
      { sourceId: "fresh-btc", subject: "difficulty", metrics: ["hash_rate", "difficulty"], richness: 48, freshness: 300, stale: false },
    ]);
  });

  it("normalizes response size into the 0-100 richness range using the expected logarithmic anchors", () => {
    const sizes = [
      { sourceId: "empty", responseSize: 0, expected: 0 },
      { sourceId: "minimal", responseSize: 100, expected: 30 },
      { sourceId: "moderate", responseSize: 500, expected: 60 },
      { sourceId: "good", responseSize: 2000, expected: 80 },
      { sourceId: "excellent", responseSize: 5000, expected: 95 },
      { sourceId: "capped", responseSize: 9000, expected: 95 },
    ];

    for (const { sourceId, responseSize } of sizes) {
      upsertSourceResponse(db, {
        sourceId,
        url: `https://example.com/${sourceId}`,
        lastFetchedAt: "2026-03-31T11:55:00.000Z",
        responseStatus: 200,
        responseSize,
        responseBody: "x".repeat(responseSize),
        ttlSeconds: 900,
        consecutiveFailures: 0,
      });
    }

    const evidence = computeAvailableEvidence(db, sizes.map(({ sourceId }) => ({
      id: sourceId,
      topics: [sourceId],
      domainTags: [],
    })), new Date("2026-03-31T12:00:00.000Z"));

    expect(evidence.map(({ sourceId, richness }) => ({ sourceId, richness }))).toEqual([
      { sourceId: "capped", richness: 95 },
      { sourceId: "excellent", richness: 95 },
      { sourceId: "good", richness: 80 },
      { sourceId: "moderate", richness: 60 },
      { sourceId: "minimal", richness: 30 },
      { sourceId: "empty", richness: 0 },
    ]);
    expect(evidence.every(({ richness }) => richness >= 0 && richness <= 100)).toBe(true);
  });

  it("keeps empty and tiny responses below the publish richness minimum", () => {
    upsertSourceResponse(db, {
      sourceId: "empty",
      url: "https://example.com/empty",
      lastFetchedAt: "2026-03-31T11:55:00.000Z",
      responseStatus: 200,
      responseSize: 0,
      responseBody: "",
      ttlSeconds: 900,
      consecutiveFailures: 0,
    });
    upsertSourceResponse(db, {
      sourceId: "tiny",
      url: "https://example.com/tiny",
      lastFetchedAt: "2026-03-31T11:55:00.000Z",
      responseStatus: 200,
      responseSize: 49,
      responseBody: "x".repeat(49),
      ttlSeconds: 900,
      consecutiveFailures: 0,
    });

    const evidence = computeAvailableEvidence(db, [
      { id: "empty", topics: ["empty"], domainTags: [] },
      { id: "tiny", topics: ["tiny"], domainTags: [] },
    ], new Date("2026-03-31T12:00:00.000Z"));

    expect(evidence).toEqual([
      { sourceId: "tiny", subject: "tiny", metrics: [], richness: 25, freshness: 300, stale: false },
      { sourceId: "empty", subject: "empty", metrics: [], richness: 0, freshness: 300, stale: false },
    ]);
    expect(evidence.every(({ richness }) => richness < MIN_PUBLISH_EVIDENCE_RICHNESS)).toBe(true);
  });
});
