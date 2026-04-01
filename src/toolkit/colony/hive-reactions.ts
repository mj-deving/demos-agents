/**
 * Individual HIVE reaction records — one row per on-chain agree/disagree transaction.
 *
 * Complements reaction_cache (aggregates) with granular per-reaction data.
 * The reaction_cache can be rebuilt from this table at any time via recomputeReactionCache().
 */
import type { ColonyDatabase } from "./schema.js";

export interface HiveReactionRecord {
  txHash: string;
  txId?: number;
  targetTxHash: string;
  reactionType: "agree" | "disagree";
  author: string;
  fromEd25519?: string;
  blockNumber: number;
  timestamp: string;
  nonce?: number;
  amount?: number;
  networkFee?: number;
  rpcFee?: number;
  additionalFee?: number;
  rawData: Record<string, unknown>;
}

interface HiveReactionRow {
  tx_hash: string;
  tx_id: number | null;
  target_tx_hash: string;
  reaction_type: string;
  author: string;
  from_ed25519: string | null;
  block_number: number;
  timestamp: string;
  nonce: number | null;
  amount: number | null;
  network_fee: number | null;
  rpc_fee: number | null;
  additional_fee: number | null;
  raw_data: string;
}

export function insertHiveReaction(db: ColonyDatabase, reaction: HiveReactionRecord): void {
  db.prepare(`
    INSERT INTO hive_reactions (
      tx_hash, tx_id, target_tx_hash, reaction_type, author, from_ed25519,
      block_number, timestamp, nonce, amount, network_fee, rpc_fee, additional_fee, raw_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tx_hash) DO UPDATE SET
      tx_id = COALESCE(excluded.tx_id, hive_reactions.tx_id),
      target_tx_hash = excluded.target_tx_hash,
      reaction_type = excluded.reaction_type,
      author = excluded.author,
      from_ed25519 = COALESCE(excluded.from_ed25519, hive_reactions.from_ed25519),
      block_number = excluded.block_number,
      timestamp = excluded.timestamp,
      nonce = COALESCE(excluded.nonce, hive_reactions.nonce),
      amount = COALESCE(excluded.amount, hive_reactions.amount),
      network_fee = COALESCE(excluded.network_fee, hive_reactions.network_fee),
      rpc_fee = COALESCE(excluded.rpc_fee, hive_reactions.rpc_fee),
      additional_fee = COALESCE(excluded.additional_fee, hive_reactions.additional_fee),
      raw_data = excluded.raw_data
  `).run(
    reaction.txHash,
    reaction.txId ?? null,
    reaction.targetTxHash,
    reaction.reactionType,
    reaction.author,
    reaction.fromEd25519 ?? null,
    reaction.blockNumber,
    reaction.timestamp,
    reaction.nonce ?? null,
    reaction.amount ?? null,
    reaction.networkFee ?? null,
    reaction.rpcFee ?? null,
    reaction.additionalFee ?? null,
    JSON.stringify(reaction.rawData),
  );
}

export function getReactionsByPost(db: ColonyDatabase, targetTxHash: string): HiveReactionRecord[] {
  const rows = db.prepare(`
    SELECT tx_hash, tx_id, target_tx_hash, reaction_type, author, from_ed25519,
           block_number, timestamp, nonce, amount, network_fee, rpc_fee, additional_fee, raw_data
    FROM hive_reactions
    WHERE target_tx_hash = ?
    ORDER BY block_number ASC, tx_hash ASC
  `).all(targetTxHash) as HiveReactionRow[];

  return rows.map(mapRow);
}

export function countHiveReactions(db: ColonyDatabase): number {
  const row = db.prepare("SELECT COUNT(*) as c FROM hive_reactions").get() as { c: number };
  return row.c;
}

/**
 * Rebuild the aggregate reaction_cache from individual hive_reactions records.
 * This makes reaction_cache a materialized view that can always be regenerated.
 */
export function recomputeReactionCache(db: ColonyDatabase): number {
  // Compute aggregates per target post
  const aggregates = db.prepare(`
    SELECT
      target_tx_hash,
      SUM(CASE WHEN reaction_type = 'agree' THEN 1 ELSE 0 END) as agrees,
      SUM(CASE WHEN reaction_type = 'disagree' THEN 1 ELSE 0 END) as disagrees,
      MAX(timestamp) as last_updated_at
    FROM hive_reactions
    GROUP BY target_tx_hash
  `).all() as Array<{
    target_tx_hash: string;
    agrees: number;
    disagrees: number;
    last_updated_at: string;
  }>;

  const upsert = db.prepare(`
    INSERT INTO reaction_cache (
      post_tx_hash, agrees, disagrees, tips_count, tips_total_dem, reply_count, last_updated_at
    ) VALUES (?, ?, ?, COALESCE((SELECT tips_count FROM reaction_cache WHERE post_tx_hash = ?), 0),
              COALESCE((SELECT tips_total_dem FROM reaction_cache WHERE post_tx_hash = ?), 0),
              COALESCE((SELECT reply_count FROM reaction_cache WHERE post_tx_hash = ?), 0), ?)
    ON CONFLICT(post_tx_hash) DO UPDATE SET
      agrees = excluded.agrees,
      disagrees = excluded.disagrees,
      last_updated_at = excluded.last_updated_at
  `);

  const run = db.transaction((rows: typeof aggregates) => {
    for (const row of rows) {
      upsert.run(
        row.target_tx_hash,
        row.agrees,
        row.disagrees,
        row.target_tx_hash,
        row.target_tx_hash,
        row.target_tx_hash,
        row.last_updated_at,
      );
    }
  });

  run(aggregates);
  return aggregates.length;
}

function mapRow(row: HiveReactionRow): HiveReactionRecord {
  return {
    txHash: row.tx_hash,
    txId: row.tx_id ?? undefined,
    targetTxHash: row.target_tx_hash,
    reactionType: row.reaction_type as "agree" | "disagree",
    author: row.author,
    fromEd25519: row.from_ed25519 ?? undefined,
    blockNumber: row.block_number,
    timestamp: row.timestamp,
    nonce: row.nonce ?? undefined,
    amount: row.amount ?? undefined,
    networkFee: row.network_fee ?? undefined,
    rpcFee: row.rpc_fee ?? undefined,
    additionalFee: row.additional_fee ?? undefined,
    rawData: JSON.parse(row.raw_data) as Record<string, unknown>,
  };
}
