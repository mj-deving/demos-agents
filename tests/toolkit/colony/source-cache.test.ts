import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDegradedSources, getFreshSources, getSourceResponse, getUnfetchedSourceIds, upsertSourceResponse } from "../../../src/toolkit/colony/source-cache.js";
import { initColonyCache } from "../../../src/toolkit/colony/schema.js";

describe("colony source response cache", () => {
  let db: ReturnType<typeof initColonyCache>;

  beforeEach(() => {
    db = initColonyCache(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("upserts and retrieves cached source responses", () => {
    upsertSourceResponse(db, {
      sourceId: "btc-hash-rate",
      url: "https://example.com/hash-rate",
      lastFetchedAt: "2026-03-31T10:00:00.000Z",
      responseStatus: 200,
      responseSize: 128,
      responseBody: "{\"hash_rate\":877.9}",
      ttlSeconds: 3600,
      consecutiveFailures: 0,
    });

    expect(getSourceResponse(db, "btc-hash-rate")).toEqual({
      sourceId: "btc-hash-rate",
      url: "https://example.com/hash-rate",
      lastFetchedAt: "2026-03-31T10:00:00.000Z",
      responseStatus: 200,
      responseSize: 128,
      responseBody: "{\"hash_rate\":877.9}",
      ttlSeconds: 3600,
      consecutiveFailures: 0,
    });
  });

  it("filters fresh, degraded, and unfetched sources", () => {
    upsertSourceResponse(db, {
      sourceId: "fresh-source",
      url: "https://example.com/fresh",
      lastFetchedAt: "2026-03-31T10:45:00.000Z",
      responseStatus: 200,
      responseSize: 64,
      responseBody: "fresh",
      ttlSeconds: 1800,
      consecutiveFailures: 0,
    });
    upsertSourceResponse(db, {
      sourceId: "stale-source",
      url: "https://example.com/stale",
      lastFetchedAt: "2026-03-31T09:00:00.000Z",
      responseStatus: 200,
      responseSize: 64,
      responseBody: "stale",
      ttlSeconds: 1800,
      consecutiveFailures: 0,
    });
    upsertSourceResponse(db, {
      sourceId: "degraded-source",
      url: "https://example.com/degraded",
      lastFetchedAt: "2026-03-31T10:50:00.000Z",
      responseStatus: 503,
      responseSize: 32,
      responseBody: "degraded",
      ttlSeconds: 1800,
      consecutiveFailures: 3,
    });

    expect(getFreshSources(db, new Date("2026-03-31T11:00:00.000Z")).map((source) => source.sourceId)).toEqual([
      "fresh-source",
    ]);
    expect(getDegradedSources(db).map((source) => source.sourceId)).toEqual(["degraded-source"]);
    expect(getUnfetchedSourceIds(db, ["fresh-source", "stale-source", "missing-source"])).toEqual([
      "missing-source",
    ]);
  });
});
