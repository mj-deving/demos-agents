/**
 * Colony backfill logic — paginate chain transactions and ingest HIVE posts.
 *
 * Pure toolkit module: no SDK imports, no CLI deps. Takes a typed RPC
 * interface and colony DB handle. Used by cli/backfill-colony.ts.
 */

import type { ColonyDatabase } from "./schema.js";
import { insertPost } from "./posts.js";
import { insertDeadLetter } from "./dead-letters.js";
import { decodeHiveData } from "../hive-codec.js";
import { safeParse } from "../guards/state-helpers.js";
import { toErrorMessage } from "../util/errors.js";  // toolkit, not src/lib

// ── Types ───────────────────────────────────────────

/** Minimal RPC interface for chain transaction pagination */
export interface BackfillRpc {
  getTransactions(
    start: number | "latest",
    limit: number,
  ): Promise<
    Array<{
      hash: string;
      blockNumber: number;
      status: string;
      from: string;
      to: string;
      type: string;
      content: string;
      timestamp: number;
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
  inserted: number;
  skipped: number;
  deadLettered: number;
  totalScanned: number;
  pagesScanned: number;
  lastBlockNumber: number | null;
}

// ── Cursor helpers ──────────────────────────────────

const CURSOR_KEY = "backfill_cursor";

function getBackfillCursor(db: ColonyDatabase): number | null {
  const value = db
    .prepare("SELECT value FROM _meta WHERE key = ?")
    .pluck()
    .get(CURSOR_KEY);
  if (typeof value !== "string") return null;
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) ? num : null;
}

function setBackfillCursor(db: ColonyDatabase, blockNumber: number): void {
  db.prepare(
    "INSERT INTO _meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(CURSOR_KEY, String(blockNumber));
}

// ── Decode helper ───────────────────────────────────

interface DecodedPost {
  txHash: string;
  author: string;
  blockNumber: number;
  timestamp: string;
  text: string;
  tags: string[];
  replyTo: string | null;
  rawData: Record<string, unknown>;
}

function decodeRawTransaction(rawTx: {
  hash: string;
  blockNumber: number;
  from: string;
  content: string;
  timestamp: number;
  type: string;
}): DecodedPost | null {
  const content =
    typeof rawTx.content === "string"
      ? (safeParse(rawTx.content) as Record<string, unknown>)
      : (rawTx.content as unknown as Record<string, unknown>);

  if (!content) return null;

  const rawData = content.data;
  const data = Array.isArray(rawData) && rawData[0] === "storage" ? rawData[1] : rawData;
  const hive = decodeHiveData(data);
  if (!hive) return null;

  // Skip reactions — only ingest posts
  if (hive.action) return null;

  // Validate timestamp
  const tsNum = rawTx.timestamp ?? Number(content.timestamp ?? 0);
  let isoTimestamp: string;
  if (Number.isFinite(tsNum) && !Number.isNaN(new Date(tsNum).getTime())) {
    isoTimestamp = new Date(tsNum).toISOString();
  } else {
    isoTimestamp = new Date().toISOString();
  }

  return {
    txHash: rawTx.hash,
    author: String(rawTx.from ?? content.from ?? ""),
    blockNumber: rawTx.blockNumber,
    timestamp: isoTimestamp,
    text: String(hive.text ?? ""),
    tags: Array.isArray(hive.tags) ? hive.tags.map(String) : [],
    replyTo: hive.replyTo ? String(hive.replyTo) : null,
    rawData: hive,
  };
}

// ── Core backfill logic ─────────────────────────────

/**
 * Paginate through chain transactions and ingest HIVE posts.
 *
 * - Uses a separate `backfill_cursor` (not the V3 loop's `cursor`)
 * - Disables FK constraints during bulk load
 * - Routes decode failures to dead_letters
 * - Respects limit and dryRun options
 */
export async function backfillFromTransactions(
  db: ColonyDatabase,
  rpc: BackfillRpc,
  options: BackfillOptions,
): Promise<BackfillStats> {
  const { batchSize, limit, dryRun = false, resetCursor = false, onProgress } = options;

  const stats: BackfillStats = {
    inserted: 0,
    skipped: 0,
    deadLettered: 0,
    totalScanned: 0,
    pagesScanned: 0,
    lastBlockNumber: null,
  };

  // Determine start position
  let start: number | "latest";
  if (resetCursor) {
    start = "latest";
  } else {
    const cursor = getBackfillCursor(db);
    start = cursor !== null ? cursor : "latest";
  }

  // Disable FK constraints during bulk load for performance
  // (replyTo may reference posts not yet inserted)
  if (!dryRun) {
    db.pragma("foreign_keys = OFF");
  }

  try {
    while (stats.inserted < limit) {
      const txs = await rpc.getTransactions(start, batchSize);
      stats.pagesScanned++;

      if (!txs || txs.length === 0) break;

      for (const rawTx of txs) {
        if (stats.inserted >= limit) break;

        stats.totalScanned++;

        // Only process storage transactions
        if (rawTx.type !== "storage") {
          stats.skipped++;
          continue;
        }

        try {
          const decoded = decodeRawTransaction(rawTx);
          if (!decoded) {
            stats.skipped++;
            continue;
          }

          if (!dryRun) {
            insertPost(db, {
              txHash: decoded.txHash,
              author: decoded.author,
              blockNumber: decoded.blockNumber,
              timestamp: decoded.timestamp,
              replyTo: decoded.replyTo,
              tags: decoded.tags,
              text: decoded.text,
              rawData: decoded.rawData,
            });
          }

          stats.inserted++;
        } catch (err) {
          stats.deadLettered++;
          if (!dryRun) {
            insertDeadLetter(
              db,
              rawTx.hash,
              rawTx.content,
              rawTx.blockNumber,
              toErrorMessage(err),
            );
          }
        }
      }

      // Update cursor to lowest block seen in this batch
      const lastTx = txs[txs.length - 1];
      if (lastTx?.blockNumber != null) {
        stats.lastBlockNumber = lastTx.blockNumber;
        if (!dryRun) {
          setBackfillCursor(db, lastTx.blockNumber);
        }
      }

      onProgress?.(structuredClone(stats));

      // Advance pagination
      const prevStart = start;
      if (lastTx?.blockNumber != null && lastTx.blockNumber > 1) {
        start = lastTx.blockNumber - 1;
      } else {
        break;
      }
      if (start === prevStart) break;
    }
  } finally {
    if (!dryRun) {
      db.pragma("foreign_keys = ON");
    }
  }

  return stats;
}
