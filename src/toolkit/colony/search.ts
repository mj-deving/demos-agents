import type { ColonyDatabase } from "./schema.js";
import type { CachedPost } from "./posts.js";
import { mapPostRows, type PostRow } from "./posts.js";

export interface SearchOptions {
  limit?: number;
  author?: string;
}

export function searchPosts(db: ColonyDatabase, query: string, opts?: SearchOptions): CachedPost[] {
  const limit = opts?.limit ?? 50;

  if (opts?.author) {
    const rows = db.prepare(`
      SELECT p.tx_hash, p.author, p.block_number, p.timestamp, p.reply_to, p.tags, p.text, p.raw_data,
             p.tx_id, p.from_ed25519, p.nonce, p.amount, p.network_fee, p.rpc_fee, p.additional_fee
      FROM posts_fts fts
      JOIN posts p ON p.rowid = fts.rowid
      WHERE posts_fts MATCH ?
        AND p.author = ?
      ORDER BY fts.rank
      LIMIT ?
    `).all(query, opts.author, limit) as PostRow[];
    return mapPostRows(rows);
  }

  const rows = db.prepare(`
    SELECT p.tx_hash, p.author, p.block_number, p.timestamp, p.reply_to, p.tags, p.text, p.raw_data,
           p.tx_id, p.from_ed25519, p.nonce, p.amount, p.network_fee, p.rpc_fee, p.additional_fee
    FROM posts_fts fts
    JOIN posts p ON p.rowid = fts.rowid
    WHERE posts_fts MATCH ?
    ORDER BY fts.rank
    LIMIT ?
  `).all(query, limit) as PostRow[];
  return mapPostRows(rows);
}
