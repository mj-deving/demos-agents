/**
 * Colony backfill logic — paginate chain transactions and ingest ALL HIVE data.
 *
 * Captures posts AND reactions with full SDK RawTransaction metadata.
 * Pure toolkit module: no SDK imports, no CLI deps. Takes a typed RPC
 * interface and colony DB handle. Used by cli/backfill-colony.ts.
 */

import type { ColonyDatabase } from "./schema.js";
import { insertPost } from "./posts.js";
import { insertHiveReaction, recomputeReactionCache } from "./hive-reactions.js";
import { insertDeadLetter } from "./dead-letters.js";
import { decodeHiveData } from "../hive-codec.js";
import { safeParse } from "../guards/state-helpers.js";
import { toErrorMessage } from "../util/errors.js";

// ── Types ───────────────────────────────────────────

/** Minimal RPC interface — mirrors SDK RawTransaction fields */
export interface BackfillRpc {
  getTransactions(
    start: number | "latest",
    limit: number,
  ): Promise<
    Array<{
      id: number;
      hash: string;
      blockNumber: number;
      status: string;
      from: string;
      from_ed25519_address?: string;
      to: string;
      type: string;
      content: string;
      timestamp: number;
      nonce?: number;
      amount?: number;
      networkFee?: number;
      rpcFee?: number;
      additionalFee?: number;
    }>
  >;
}

export interface BackfillOptions {
  batchSize: number;
  limit: number;
  dryRun?: boolean;
  resetCursor?: boolean;
  onProgress?: (stats: BackfillStats) => void;
}

export interface BackfillStats {
  postsInserted: number;
  reactionsInserted: number;
  skipped: number;
  deadLettered: number;
  totalScanned: number;
  pagesScanned: number;
  lastBlockNumber: number | null;
}

// ── Cursor helpers ──────────────────────────────────

const CURSOR_KEY = "backfill_offset";

function getBackfillCursor(db: ColonyDatabase): number | null {
  const value = db
    .prepare("SELECT value FROM _meta WHERE key = ?")
    .pluck()
    .get(CURSOR_KEY);
  if (typeof value !== "string") return null;
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) ? num : null;
}

function setBackfillCursor(db: ColonyDatabase, offset: number): void {
  db.prepare(
    "INSERT INTO _meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(CURSOR_KEY, String(offset));
}

// ── Decode helpers ──────────────────────────────────

interface TxEnvelope {
  txId: number;
  txHash: string;
  author: string;
  fromEd25519?: string;
  blockNumber: number;
  timestamp: string;
  nonce?: number;
  amount?: number;
  networkFee?: number;
  rpcFee?: number;
  additionalFee?: number;
}

interface DecodedPost extends TxEnvelope {
  kind: "post";
  text: string;
  tags: string[];
  replyTo: string | null;
  rawData: Record<string, unknown>;
}

interface DecodedReaction extends TxEnvelope {
  kind: "reaction";
  targetTxHash: string;
  reactionType: "agree" | "disagree";
  rawData: Record<string, unknown>;
}

type DecodeResult = DecodedPost | DecodedReaction | "not-hive" | "malformed";

function decodeRawTransaction(rawTx: {
  id: number;
  hash: string;
  blockNumber: number;
  from: string;
  from_ed25519_address?: string;
  content: string;
  timestamp: number;
  type: string;
  nonce?: number;
  amount?: number;
  networkFee?: number;
  rpcFee?: number;
  additionalFee?: number;
}): DecodeResult {
  const content =
    typeof rawTx.content === "string"
      ? (safeParse(rawTx.content) as Record<string, unknown>)
      : (rawTx.content as unknown as Record<string, unknown>);

  if (!content) return "not-hive";

  const rawData = content.data;
  const data = Array.isArray(rawData) && rawData[0] === "storage" ? rawData[1] : rawData;

  const looksLikeHive = typeof data === "string" && (
    data.toLowerCase().startsWith("48495645") || data.startsWith("HIVE")
  );

  const hive = decodeHiveData(data);
  if (!hive) {
    return looksLikeHive ? "malformed" : "not-hive";
  }

  // Build shared tx envelope
  const tsNum = rawTx.timestamp ?? Number(content.timestamp ?? 0);
  let isoTimestamp: string;
  if (Number.isFinite(tsNum) && !Number.isNaN(new Date(tsNum).getTime())) {
    isoTimestamp = new Date(tsNum).toISOString();
  } else {
    isoTimestamp = new Date().toISOString();
  }

  const envelope: TxEnvelope = {
    txId: rawTx.id,
    txHash: rawTx.hash,
    author: String(rawTx.from ?? content.from ?? ""),
    fromEd25519: rawTx.from_ed25519_address,
    blockNumber: rawTx.blockNumber,
    timestamp: isoTimestamp,
    nonce: rawTx.nonce,
    amount: rawTx.amount,
    networkFee: rawTx.networkFee,
    rpcFee: rawTx.rpcFee,
    additionalFee: rawTx.additionalFee,
  };

  // Reactions have an action field
  if (hive.action === "react") {
    const target = String(hive.target ?? "");
    const reactionType = String(hive.type ?? "agree");
    if (reactionType !== "agree" && reactionType !== "disagree") return "not-hive";
    return {
      ...envelope,
      kind: "reaction",
      targetTxHash: target,
      reactionType: reactionType as "agree" | "disagree",
      rawData: hive,
    };
  }

  // Any other action we don't recognize — skip
  if (hive.action) return "not-hive";

  // Posts — no action field, has text
  return {
    ...envelope,
    kind: "post",
    text: String(hive.text ?? ""),
    tags: Array.isArray(hive.tags) ? hive.tags.map(String) : [],
    replyTo: hive.replyTo ? String(hive.replyTo) : null,
    rawData: hive,
  };
}

// ── Core backfill logic ─────────────────────────────

/**
 * Paginate through chain transactions and ingest ALL HIVE data:
 * posts + reactions, with full SDK RawTransaction metadata.
 *
 * - Forward offset-based pagination (start=1 → genesis, increment by page)
 * - Uses separate `backfill_offset` cursor (not the V3 loop's `cursor`)
 * - Disables FK constraints during bulk load
 * - Routes decode failures to dead_letters
 * - Recomputes reaction_cache aggregates after each batch
 */
export async function backfillFromTransactions(
  db: ColonyDatabase,
  rpc: BackfillRpc,
  options: BackfillOptions,
): Promise<BackfillStats> {
  const { batchSize, limit, dryRun = false, resetCursor = false, onProgress } = options;

  const stats: BackfillStats = {
    postsInserted: 0,
    reactionsInserted: 0,
    skipped: 0,
    deadLettered: 0,
    totalScanned: 0,
    pagesScanned: 0,
    lastBlockNumber: null,
  };

  let start: number;
  if (resetCursor) {
    start = 1;
  } else {
    const cursor = getBackfillCursor(db);
    start = cursor !== null ? cursor : 1;
  }

  if (!dryRun) {
    db.pragma("foreign_keys = OFF");
  }

  try {
    const totalInserted = () => stats.postsInserted + stats.reactionsInserted;

    while (totalInserted() < limit) {
      const txs = await rpc.getTransactions(start, batchSize);
      stats.pagesScanned++;

      if (!txs || txs.length === 0) break;

      let lastProcessedBlock: number | null = null;

      for (const rawTx of txs) {
        if (totalInserted() >= limit) break;

        stats.totalScanned++;

        if (rawTx.type !== "storage") {
          stats.skipped++;
          lastProcessedBlock = rawTx.blockNumber;
          continue;
        }

        try {
          const decoded = decodeRawTransaction(rawTx);
          if (decoded === "not-hive") {
            stats.skipped++;
            lastProcessedBlock = rawTx.blockNumber;
            continue;
          }
          if (decoded === "malformed") {
            stats.deadLettered++;
            if (!dryRun) {
              insertDeadLetter(db, rawTx.hash, rawTx.content, rawTx.blockNumber,
                "Malformed HIVE payload: decodeHiveData returned null for storage transaction");
            }
            lastProcessedBlock = rawTx.blockNumber;
            continue;
          }

          if (!dryRun) {
            if (decoded.kind === "post") {
              insertPost(db, {
                txHash: decoded.txHash,
                author: decoded.author,
                blockNumber: decoded.blockNumber,
                timestamp: decoded.timestamp,
                replyTo: decoded.replyTo,
                tags: decoded.tags,
                text: decoded.text,
                rawData: decoded.rawData,
                txId: decoded.txId,
                fromEd25519: decoded.fromEd25519,
                nonce: decoded.nonce,
                amount: decoded.amount,
                networkFee: decoded.networkFee,
                rpcFee: decoded.rpcFee,
                additionalFee: decoded.additionalFee,
              });
              stats.postsInserted++;
            } else {
              insertHiveReaction(db, {
                txHash: decoded.txHash,
                txId: decoded.txId,
                targetTxHash: decoded.targetTxHash,
                reactionType: decoded.reactionType,
                author: decoded.author,
                fromEd25519: decoded.fromEd25519,
                blockNumber: decoded.blockNumber,
                timestamp: decoded.timestamp,
                nonce: decoded.nonce,
                amount: decoded.amount,
                networkFee: decoded.networkFee,
                rpcFee: decoded.rpcFee,
                additionalFee: decoded.additionalFee,
                rawData: decoded.rawData,
              });
              stats.reactionsInserted++;
            }
          } else {
            if (decoded.kind === "post") stats.postsInserted++;
            else stats.reactionsInserted++;
          }

          lastProcessedBlock = rawTx.blockNumber;
        } catch (err) {
          stats.deadLettered++;
          if (!dryRun) {
            insertDeadLetter(db, rawTx.hash, rawTx.content, rawTx.blockNumber, toErrorMessage(err));
          }
          lastProcessedBlock = rawTx.blockNumber;
        }
      }

      if (lastProcessedBlock != null) {
        stats.lastBlockNumber = lastProcessedBlock;
      }

      start += txs.length;

      if (!dryRun) {
        setBackfillCursor(db, start);
      }

      onProgress?.(structuredClone(stats));
    }

    // Recompute reaction_cache aggregates from individual records
    if (!dryRun && stats.reactionsInserted > 0) {
      recomputeReactionCache(db);
    }
  } finally {
    if (!dryRun) {
      db.pragma("foreign_keys = ON");
    }
  }

  return stats;
}
