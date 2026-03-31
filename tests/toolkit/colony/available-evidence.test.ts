import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { computeAvailableEvidence } from "../../../src/toolkit/colony/available-evidence.js";
import { initColonyCache } from "../../../src/toolkit/colony/schema.js";
import { upsertSourceResponse } from "../../../src/toolkit/colony/source-cache.js";

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
      {
        sourceId: "fresh-btc",
        subject: "bitcoin",
        metrics: ["hash_rate", "difficulty"],
        richness: 256,
        freshness: 300,
        stale: false,
      },
    ]);
  });
});
