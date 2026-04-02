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
      "hive_reactions",
      "posts",
      "reaction_cache",
      "source_response_cache",
    ]));
  });

  it("schema v2 adds tx metadata columns to posts and hive_reactions table", () => {
    // Verify posts has the new columns
    const postCols = db.prepare("PRAGMA table_info(posts)").all() as Array<{ name: string }>;
    const colNames = postCols.map((c) => c.name);
    expect(colNames).toContain("tx_id");
    expect(colNames).toContain("from_ed25519");
    expect(colNames).toContain("nonce");
    expect(colNames).toContain("amount");
    expect(colNames).toContain("network_fee");
    expect(colNames).toContain("rpc_fee");
    expect(colNames).toContain("additional_fee");

    // Verify hive_reactions table exists with correct columns
    const rxCols = db.prepare("PRAGMA table_info(hive_reactions)").all() as Array<{ name: string }>;
    const rxColNames = rxCols.map((c) => c.name);
    expect(rxColNames).toContain("tx_hash");
    expect(rxColNames).toContain("tx_id");
    expect(rxColNames).toContain("target_tx_hash");
    expect(rxColNames).toContain("reaction_type");
    expect(rxColNames).toContain("author");
    expect(rxColNames).toContain("from_ed25519");
    expect(rxColNames).toContain("network_fee");
  });

  it("updates the scan cursor in metadata", () => {
    setCursor(db, 1980084);

    expect(getCursor(db)).toBe(1980084);
  });

  it("schema v3 creates posts_fts virtual table and sync triggers", () => {
    // Check for posts_fts in sqlite_master
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'posts_fts'",
    ).all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);
    expect(tables[0].name).toBe("posts_fts");

    // Check for 3 triggers: posts_fts_ai, posts_fts_ad, posts_fts_au
    const triggers = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'posts_fts_%' ORDER BY name",
    ).all() as Array<{ name: string }>;
    expect(triggers).toHaveLength(3);
    expect(triggers.map((t) => t.name)).toEqual(["posts_fts_ad", "posts_fts_ai", "posts_fts_au"]);
  });

  it("requests WAL mode and leaves in-memory sqlite in its supported journal mode", () => {
    const journalMode = String(db.pragma("journal_mode", { simple: true })).toLowerCase();

    expect(["wal", "memory"]).toContain(journalMode);
  });
});
