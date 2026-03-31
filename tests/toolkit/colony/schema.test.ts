import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CURRENT_SCHEMA_VERSION, getCursor, getSchemaVersion, initColonyCache, setCursor } from "../../../src/toolkit/colony/schema.js";

describe("colony schema", () => {
  let db: ReturnType<typeof initColonyCache>;

  beforeEach(() => {
    db = initColonyCache(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("initializes the schema metadata and core tables", () => {
    expect(getSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    expect(getCursor(db)).toBe(0);

    const tableNames = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all() as Array<{ name: string }>;

    expect(tableNames.map((row) => row.name)).toEqual(expect.arrayContaining([
      "_meta",
      "attestations",
      "claim_ledger",
      "dead_letters",
      "posts",
      "reaction_cache",
      "source_response_cache",
    ]));
  });

  it("updates the scan cursor in metadata", () => {
    setCursor(db, 1980084);

    expect(getCursor(db)).toBe(1980084);
  });

  it("requests WAL mode and leaves in-memory sqlite in its supported journal mode", () => {
    const journalMode = String(db.pragma("journal_mode", { simple: true })).toLowerCase();

    expect(["wal", "memory"]).toContain(journalMode);
  });
});
