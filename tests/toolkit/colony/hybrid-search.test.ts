import { describe, it, expect, vi, beforeEach } from "vitest";

const { embedMock } = vi.hoisted(() => ({
  embedMock: vi.fn(),
}));

vi.mock("../../../src/toolkit/colony/embeddings.js", () => ({
  embed: embedMock,
  embedBatch: vi.fn(),
}));

import { initColonyCache, type ColonyDatabase } from "../../../src/toolkit/colony/schema.js";
import { insertPost } from "../../../src/toolkit/colony/posts.js";
import { searchPosts, hybridSearch, insertEmbedding } from "../../../src/toolkit/colony/search.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function createTestDb(): ColonyDatabase {
  const dir = mkdtempSync(join(tmpdir(), "hybrid-search-test-"));
  const dbPath = join(dir, "test.db");
  const db = initColonyCache(dbPath);
  return db;
}

function addPost(db: ColonyDatabase, txHash: string, text: string, author = "alice") {
  insertPost(db, {
    txHash,
    author,
    blockNumber: 100,
    timestamp: new Date().toISOString(),
    replyTo: null,
    tags: [],
    text,
    rawData: {},
  });
}

function getRowid(db: ColonyDatabase, txHash: string): number {
  const row = db.prepare("SELECT rowid FROM posts WHERE tx_hash = ?").get(txHash) as { rowid: number } | undefined;
  return row?.rowid ?? -1;
}

describe("insertEmbedding", () => {
  it("inserts and tracks a vector embedding", () => {
    const db = createTestDb();
    addPost(db, "0x001", "Bitcoin ETF flows reached $1.2B");
    const rowid = getRowid(db, "0x001");

    const embedding = new Float32Array(384).fill(0.1);
    const vecRowid = insertEmbedding(db, rowid, embedding);

    expect(vecRowid).toBeTypeOf("number");
    expect(vecRowid).toBeGreaterThan(0);

    // Verify tracking entry
    const track = db.prepare("SELECT * FROM post_embeddings WHERE post_rowid = ?").get(rowid) as { vec_rowid: number } | undefined;
    expect(track).toBeDefined();
    expect(track!.vec_rowid).toBe(vecRowid);

    db.close();
  });
});

describe("searchPosts (FTS5)", () => {
  it("finds posts by keyword", () => {
    const db = createTestDb();
    addPost(db, "0x001", "Bitcoin ETF inflows reached $1.2B this week");
    addPost(db, "0x002", "Ethereum staking rewards decreased by 10%");

    const results = searchPosts(db, "bitcoin");
    expect(results).toHaveLength(1);
    expect(results[0].txHash).toBe("0x001");

    db.close();
  });
});

describe("hybridSearch", () => {
  it("falls back to FTS5-only when no embeddings exist", async () => {
    embedMock.mockResolvedValue(null);
    const db = createTestDb();
    addPost(db, "0x001", "Bitcoin ETF inflows analysis");
    addPost(db, "0x002", "Ethereum gas fees trending down");

    const results = await hybridSearch(db, "bitcoin");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].txHash).toBe("0x001");
    expect(results[0].score).toBeGreaterThan(0);

    db.close();
  });

  it("combines FTS5 and vector results via RRF", async () => {
    const db = createTestDb();
    addPost(db, "0x001", "Bitcoin ETF inflows reached $1.2B this week with strong volume");
    addPost(db, "0x002", "Institutional crypto adoption accelerates in Q1 reports");
    addPost(db, "0x003", "Ethereum gas fees trending down on layer 2 growth");

    // Embed all posts
    const embedding1 = new Float32Array(384).fill(0.8); // high similarity to query
    const embedding2 = new Float32Array(384).fill(0.6); // medium similarity
    const embedding3 = new Float32Array(384).fill(0.1); // low similarity

    insertEmbedding(db, getRowid(db, "0x001"), embedding1);
    insertEmbedding(db, getRowid(db, "0x002"), embedding2);
    insertEmbedding(db, getRowid(db, "0x003"), embedding3);

    // Mock query embedding to be close to embedding1
    const queryEmbedding = new Float32Array(384).fill(0.8);
    embedMock.mockResolvedValue(queryEmbedding);

    const results = await hybridSearch(db, "bitcoin");

    expect(results.length).toBeGreaterThan(0);
    // First result should be 0x001 (matches both FTS5 "bitcoin" AND vector similarity)
    expect(results[0].txHash).toBe("0x001");
    // All results should have scores
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0);
    }

    db.close();
  });
});
