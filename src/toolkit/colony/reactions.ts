import type { CachedPost } from "./posts.js";
import type { ColonyDatabase } from "./schema.js";

export interface CachedReaction {
  postTxHash: string;
  agrees: number;
  disagrees: number;
  tipsCount: number;
  tipsTotalDem: number;
  replyCount: number;
  lastUpdatedAt: string;
}

interface ReactionRow {
  post_tx_hash: string;
  agrees: number;
  disagrees: number;
  tips_count: number;
  tips_total_dem: number;
  reply_count: number;
  last_updated_at: string;
}

interface PostWithReactionRow extends ReactionRow {
  tx_hash: string;
  author: string;
  block_number: number;
  timestamp: string;
  reply_to: string | null;
  tags: string;
  text: string;
  raw_data: string;
}

function mapReactionRow(row: ReactionRow | undefined): CachedReaction | null {
  if (!row) {
    return null;
  }

  return {
    postTxHash: row.post_tx_hash,
    agrees: row.agrees,
    disagrees: row.disagrees,
    tipsCount: row.tips_count,
    tipsTotalDem: row.tips_total_dem,
    replyCount: row.reply_count,
    lastUpdatedAt: row.last_updated_at,
  };
}

export function upsertReaction(db: ColonyDatabase, reaction: CachedReaction): void {
  db.prepare(`
    INSERT INTO reaction_cache (
      post_tx_hash, agrees, disagrees, tips_count, tips_total_dem, reply_count, last_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(post_tx_hash) DO UPDATE SET
      agrees = excluded.agrees,
      disagrees = excluded.disagrees,
      tips_count = excluded.tips_count,
      tips_total_dem = excluded.tips_total_dem,
      reply_count = excluded.reply_count,
      last_updated_at = excluded.last_updated_at
  `).run(
    reaction.postTxHash,
    reaction.agrees,
    reaction.disagrees,
    reaction.tipsCount,
    reaction.tipsTotalDem,
    reaction.replyCount,
    reaction.lastUpdatedAt,
  );
}

export function getReaction(db: ColonyDatabase, postTxHash: string): CachedReaction | null {
  const row = db.prepare(`
    SELECT post_tx_hash, agrees, disagrees, tips_count, tips_total_dem, reply_count, last_updated_at
    FROM reaction_cache
    WHERE post_tx_hash = ?
  `).get(postTxHash) as ReactionRow | undefined;

  return mapReactionRow(row);
}

export function getRecentReactions(db: ColonyDatabase, since: string): CachedReaction[] {
  const rows = db.prepare(`
    SELECT post_tx_hash, agrees, disagrees, tips_count, tips_total_dem, reply_count, last_updated_at
    FROM reaction_cache
    WHERE last_updated_at >= ?
    ORDER BY last_updated_at DESC, post_tx_hash ASC
  `).all(since) as ReactionRow[];

  return rows.map((row) => mapReactionRow(row)).filter((row): row is CachedReaction => row !== null);
}

export function getOurPostsWithReactions(
  db: ColonyDatabase,
  author: string,
  since: string,
): Array<CachedPost & { reactions: CachedReaction }> {
  const rows = db.prepare(`
    SELECT
      p.tx_hash,
      p.author,
      p.block_number,
      p.timestamp,
      p.reply_to,
      p.tags,
      p.text,
      p.raw_data,
      r.post_tx_hash,
      r.agrees,
      r.disagrees,
      r.tips_count,
      r.tips_total_dem,
      r.reply_count,
      r.last_updated_at
    FROM posts p
    JOIN reaction_cache r ON r.post_tx_hash = p.tx_hash
    WHERE p.author = ?
      AND p.timestamp >= ?
    ORDER BY p.timestamp DESC, p.block_number DESC
  `).all(author, since) as PostWithReactionRow[];

  return rows.map((row) => ({
    txHash: row.tx_hash,
    author: row.author,
    blockNumber: row.block_number,
    timestamp: row.timestamp,
    replyTo: row.reply_to,
    tags: JSON.parse(row.tags) as string[],
    text: row.text,
    rawData: JSON.parse(row.raw_data) as Record<string, unknown>,
    reactions: {
      postTxHash: row.post_tx_hash,
      agrees: row.agrees,
      disagrees: row.disagrees,
      tipsCount: row.tips_count,
      tipsTotalDem: row.tips_total_dem,
      replyCount: row.reply_count,
      lastUpdatedAt: row.last_updated_at,
    },
  }));
}
