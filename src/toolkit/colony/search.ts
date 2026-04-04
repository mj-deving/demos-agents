import type { ColonyDatabase } from "./schema.js";
import type { CachedPost } from "./posts.js";
import { mapPostRows, type PostRow } from "./posts.js";
import { embed } from "./embeddings.js";

export interface SearchOptions {
  limit?: number;
  offset?: number;
  author?: string;
}

export interface HybridSearchOptions extends SearchOptions {
  /** Weight for FTS5 keyword results (default: 0.4) */
  ftsWeight?: number;
  /** Weight for vector semantic results (default: 0.6) */
  vecWeight?: number;
  /** RRF k constant (default: 60) */
  rrfK?: number;
}

export interface ScoredPost extends CachedPost {
  /** Combined RRF score (higher = more relevant) */
  score: number;
}

const POST_COLUMNS = `p.tx_hash, p.author, p.block_number, p.timestamp, p.reply_to, p.tags, p.text, p.raw_data,
       p.tx_id, p.from_ed25519, p.nonce, p.amount, p.network_fee, p.rpc_fee, p.additional_fee`;

/** Keyword-only search using FTS5 BM25 ranking. */
export function searchPosts(db: ColonyDatabase, query: string, opts?: SearchOptions): CachedPost[] {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const conditions = ["posts_fts MATCH ?"];
  const params: unknown[] = [query];

  if (opts?.author) {
    conditions.push("p.author = ?");
    params.push(opts.author);
  }

  params.push(limit, offset);

  const rows = db.prepare(`
    SELECT ${POST_COLUMNS}
    FROM posts_fts fts
    JOIN posts p ON p.rowid = fts.rowid
    WHERE ${conditions.join(" AND ")}
    ORDER BY fts.rank
    LIMIT ? OFFSET ?
  `).all(...params) as PostRow[];

  return mapPostRows(rows);
}

/**
 * Check if vec_posts table exists (sqlite-vec loaded and migration v7 applied).
 */
function hasVecTable(db: ColonyDatabase): boolean {
  try {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='vec_posts'",
    ).get() as { name: string } | undefined;
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Hybrid search combining FTS5 keyword search with vec0 semantic search
 * via Reciprocal Rank Fusion (RRF).
 *
 * Falls back to FTS5-only when vector embeddings are unavailable.
 */
export async function hybridSearch(
  db: ColonyDatabase,
  query: string,
  opts?: HybridSearchOptions,
): Promise<ScoredPost[]> {
  const limit = opts?.limit ?? 20;
  const wFts = opts?.ftsWeight ?? 0.4;
  const wVec = opts?.vecWeight ?? 0.6;
  const k = opts?.rrfK ?? 60;

  // FTS5 keyword results
  const ftsRows = db.prepare(`
    SELECT p.rowid AS rid, ${POST_COLUMNS}
    FROM posts_fts fts
    JOIN posts p ON p.rowid = fts.rowid
    WHERE posts_fts MATCH ?
    ORDER BY fts.rank
    LIMIT ?
  `).all(query, limit * 2) as (PostRow & { rid: number })[];

  // Vector results (if available)
  let vecRowids: Array<{ rowid: number | bigint; distance: number }> = [];
  if (hasVecTable(db)) {
    const queryEmbedding = await embed(query);
    if (queryEmbedding) {
      const buf = Buffer.from(queryEmbedding.buffer);
      vecRowids = db.prepare(`
        SELECT vp.rowid, vp.distance
        FROM vec_posts vp
        WHERE vp.embedding MATCH ?
        ORDER BY vp.distance
        LIMIT ?
      `).all(buf, limit * 2) as Array<{ rowid: number | bigint; distance: number }>;
    }
  }

  // If no vector results, return FTS5-only with uniform scores
  if (vecRowids.length === 0) {
    return ftsRows.slice(0, limit).map((row, i) => ({
      ...mapPostRows([row])[0],
      score: wFts / (k + i + 1),
    }));
  }

  // Build vec rowid → post data map (need to look up post data for vec-only results)
  const vecRowidToRank = new Map<number, number>();
  for (let i = 0; i < vecRowids.length; i++) {
    vecRowidToRank.set(Number(vecRowids[i].rowid), i + 1);
  }

  // Map vec rowids to post_embeddings to get post rowids
  const vecPostRowids = vecRowids.map((v) => Number(v.rowid));
  const vecPostMap = new Map<number, PostRow>();
  if (vecPostRowids.length > 0) {
    // Look up post data for vec results via post_embeddings mapping
    const placeholders = vecPostRowids.map(() => "?").join(",");
    const vecPosts = db.prepare(`
      SELECT pe.vec_rowid, ${POST_COLUMNS}
      FROM post_embeddings pe
      JOIN posts p ON p.rowid = pe.post_rowid
      WHERE pe.vec_rowid IN (${placeholders})
    `).all(...vecPostRowids) as (PostRow & { vec_rowid: number })[];
    for (const row of vecPosts) {
      vecPostMap.set(row.vec_rowid, row);
    }
  }

  // Reciprocal Rank Fusion
  const ftsRankMap = new Map<string, number>();
  for (let i = 0; i < ftsRows.length; i++) {
    ftsRankMap.set(ftsRows[i].tx_hash, i + 1);
  }

  const scored = new Map<string, { post: CachedPost; score: number }>();

  // Add FTS results
  for (const row of ftsRows) {
    const ftsRank = ftsRankMap.get(row.tx_hash) ?? ftsRows.length + 1;
    const post = mapPostRows([row])[0];
    scored.set(row.tx_hash, { post, score: wFts / (k + ftsRank) });
  }

  // Add/merge vec results
  for (const vecRow of vecRowids) {
    const vecRank = vecRowidToRank.get(Number(vecRow.rowid)) ?? vecRowids.length + 1;
    const postRow = vecPostMap.get(Number(vecRow.rowid));
    if (!postRow) continue;

    const txHash = postRow.tx_hash;
    const vecScore = wVec / (k + vecRank);
    const existing = scored.get(txHash);
    if (existing) {
      existing.score += vecScore;
    } else {
      scored.set(txHash, { post: mapPostRows([postRow])[0], score: vecScore });
    }
  }

  // Sort by combined score (descending) and return top N
  return Array.from(scored.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ post, score }) => ({ ...post, score }));
}

/**
 * Insert a vector embedding for a post.
 * Returns the vec_rowid or null if insertion failed.
 */
export function insertEmbedding(
  db: ColonyDatabase,
  postRowid: number,
  embedding: Float32Array,
): number | null {
  if (!hasVecTable(db)) return null;

  try {
    const buf = Buffer.from(embedding.buffer);
    const result = db.prepare(
      "INSERT INTO vec_posts(embedding) VALUES (?)",
    ).run(buf);
    const vecRowid = Number(result.lastInsertRowid);

    db.prepare(
      "INSERT OR REPLACE INTO post_embeddings(post_rowid, vec_rowid) VALUES (?, ?)",
    ).run(postRowid, vecRowid);

    return vecRowid;
  } catch {
    return null;
  }
}

/**
 * Backfill embeddings for posts that don't have them yet.
 * Processes in batches, resumable (skips already-embedded posts).
 */
export async function backfillEmbeddings(
  db: ColonyDatabase,
  opts?: { batchSize?: number; observe?: (type: string, msg: string, meta?: Record<string, unknown>) => void },
): Promise<{ embedded: number; skipped: number; failed: number }> {
  if (!hasVecTable(db)) return { embedded: 0, skipped: 0, failed: 0 };

  const batchSize = opts?.batchSize ?? 100;
  const observe = opts?.observe ?? (() => {});
  let embedded = 0;
  let skipped = 0;
  let failed = 0;

  // Find posts without embeddings
  const total = (db.prepare(`
    SELECT COUNT(*) as cnt FROM posts p
    LEFT JOIN post_embeddings pe ON pe.post_rowid = p.rowid
    WHERE pe.post_rowid IS NULL
  `).get() as { cnt: number }).cnt;

  observe("insight", `Backfill: ${total} posts need embeddings`, { total });

  while (true) {
    const batch = db.prepare(`
      SELECT p.rowid as rid, p.text FROM posts p
      LEFT JOIN post_embeddings pe ON pe.post_rowid = p.rowid
      WHERE pe.post_rowid IS NULL
      LIMIT ?
    `).all(batchSize) as Array<{ rid: number; text: string }>;

    if (batch.length === 0) break;

    const { embedBatch } = await import("./embeddings.js");
    const embeddings = await embedBatch(batch.map((r) => r.text));

    for (let i = 0; i < batch.length; i++) {
      const emb = embeddings[i];
      if (!emb) {
        failed++;
        continue;
      }
      const result = insertEmbedding(db, batch[i].rid, emb);
      if (result !== null) {
        embedded++;
      } else {
        failed++;
      }
    }

    observe("insight", `Backfill progress: ${embedded}/${total} embedded, ${failed} failed`, {
      embedded, total, failed,
    });
  }

  observe("insight", `Backfill complete: ${embedded} embedded, ${skipped} skipped, ${failed} failed`, {
    embedded, skipped, failed,
  });

  return { embedded, skipped, failed };
}
