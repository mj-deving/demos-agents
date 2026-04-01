import type { ColonyDatabase } from "./schema.js";

export interface CachedPost {
  txHash: string;
  author: string;
  blockNumber: number;
  timestamp: string;
  replyTo: string | null;
  tags: string[];
  text: string;
  rawData: Record<string, unknown>;
  /** Global transaction index from SDK RawTransaction.id */
  txId?: number;
  /** Ed25519 address of the sender */
  fromEd25519?: string;
  /** Transaction nonce */
  nonce?: number;
  /** Transfer amount (DEM) */
  amount?: number;
  /** Network fee */
  networkFee?: number;
  /** RPC fee */
  rpcFee?: number;
  /** Additional fee */
  additionalFee?: number;
}

interface PostRow {
  tx_hash: string;
  author: string;
  block_number: number;
  timestamp: string;
  reply_to: string | null;
  tags: string;
  text: string;
  raw_data: string;
}

function mapPostRow(row: PostRow | undefined): CachedPost | null {
  if (!row) {
    return null;
  }

  return {
    txHash: row.tx_hash,
    author: row.author,
    blockNumber: row.block_number,
    timestamp: row.timestamp,
    replyTo: row.reply_to,
    tags: JSON.parse(row.tags) as string[],
    text: row.text,
    rawData: JSON.parse(row.raw_data) as Record<string, unknown>,
  };
}

function mapPostRows(rows: PostRow[]): CachedPost[] {
  return rows.map((row) => mapPostRow(row)).filter((row): row is CachedPost => row !== null);
}

export function insertPost(db: ColonyDatabase, post: CachedPost): void {
  db.prepare(`
    INSERT INTO posts (
      tx_hash, author, block_number, timestamp, reply_to, tags, text, raw_data,
      tx_id, from_ed25519, nonce, amount, network_fee, rpc_fee, additional_fee
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tx_hash) DO UPDATE SET
      author = excluded.author,
      block_number = excluded.block_number,
      timestamp = excluded.timestamp,
      reply_to = excluded.reply_to,
      tags = excluded.tags,
      text = excluded.text,
      raw_data = excluded.raw_data,
      tx_id = COALESCE(excluded.tx_id, posts.tx_id),
      from_ed25519 = COALESCE(excluded.from_ed25519, posts.from_ed25519),
      nonce = COALESCE(excluded.nonce, posts.nonce),
      amount = COALESCE(excluded.amount, posts.amount),
      network_fee = COALESCE(excluded.network_fee, posts.network_fee),
      rpc_fee = COALESCE(excluded.rpc_fee, posts.rpc_fee),
      additional_fee = COALESCE(excluded.additional_fee, posts.additional_fee)
  `).run(
    post.txHash,
    post.author,
    post.blockNumber,
    post.timestamp,
    post.replyTo,
    JSON.stringify(post.tags),
    post.text,
    JSON.stringify(post.rawData),
    post.txId ?? null,
    post.fromEd25519 ?? null,
    post.nonce ?? null,
    post.amount ?? null,
    post.networkFee ?? null,
    post.rpcFee ?? null,
    post.additionalFee ?? null,
  );
}

export function getPost(db: ColonyDatabase, txHash: string): CachedPost | null {
  const row = db.prepare(`
    SELECT tx_hash, author, block_number, timestamp, reply_to, tags, text, raw_data
    FROM posts
    WHERE tx_hash = ?
  `).get(txHash) as PostRow | undefined;

  return mapPostRow(row);
}

export function getPostsByAuthor(db: ColonyDatabase, author: string, limit?: number): CachedPost[] {
  const query = limit === undefined
    ? `
      SELECT tx_hash, author, block_number, timestamp, reply_to, tags, text, raw_data
      FROM posts
      WHERE author = ?
      ORDER BY block_number DESC, timestamp DESC
    `
    : `
      SELECT tx_hash, author, block_number, timestamp, reply_to, tags, text, raw_data
      FROM posts
      WHERE author = ?
      ORDER BY block_number DESC, timestamp DESC
      LIMIT ?
    `;

  const rows = (limit === undefined
    ? db.prepare(query).all(author)
    : db.prepare(query).all(author, limit)) as PostRow[];

  return mapPostRows(rows);
}

export function getRecentPosts(db: ColonyDatabase, since: string, limit?: number): CachedPost[] {
  const query = limit === undefined
    ? `
      SELECT tx_hash, author, block_number, timestamp, reply_to, tags, text, raw_data
      FROM posts
      WHERE timestamp >= ?
      ORDER BY timestamp DESC, block_number DESC
    `
    : `
      SELECT tx_hash, author, block_number, timestamp, reply_to, tags, text, raw_data
      FROM posts
      WHERE timestamp >= ?
      ORDER BY timestamp DESC, block_number DESC
      LIMIT ?
    `;

  const rows = (limit === undefined
    ? db.prepare(query).all(since)
    : db.prepare(query).all(since, limit)) as PostRow[];

  return mapPostRows(rows);
}

export function getRepliesTo(db: ColonyDatabase, parentTxHash: string): CachedPost[] {
  const rows = db.prepare(`
    SELECT tx_hash, author, block_number, timestamp, reply_to, tags, text, raw_data
    FROM posts
    WHERE reply_to = ?
    ORDER BY block_number ASC, timestamp ASC
  `).all(parentTxHash) as PostRow[];

  return mapPostRows(rows);
}

export function countPosts(db: ColonyDatabase): number {
  return Number(db.prepare("SELECT COUNT(*) FROM posts").pluck().get());
}
