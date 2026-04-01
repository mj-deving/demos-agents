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
      /** Global transaction index — used for offset-based pagination */
      id: number;
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
}): DecodedPost | "not-hive" | "malformed" {
  const content =
    typeof rawTx.content === "string"
      ? (safeParse(rawTx.content) as Record<string, unknown>)
      : (rawTx.content as unknown as Record<string, unknown>);

  if (!content) return "not-hive" as const;

  const rawData = content.data;
  const data = Array.isArray(rawData) && rawData[0] === "storage" ? rawData[1] : rawData;

  // Check if the payload looks like HIVE data (has prefix) BEFORE decoding.
  // This lets us distinguish "not HIVE" from "malformed HIVE".
  const looksLikeHive = typeof data === "string" && (
    data.toLowerCase().startsWith("48495645") || data.startsWith("HIVE")
  );

  const hive = decodeHiveData(data);
  if (!hive) {
    return looksLikeHive ? "malformed" as const : "not-hive" as const;
  }

  // Skip reactions — only ingest posts
  if (hive.action) return "not-hive" as const;

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

  // Determine start position — offset-based forward pagination.
  // SDK's getTransactions(start) treats start as a global tx index (1-based).
  // Forward scan: start=1 → genesis, increment by page size each iteration.
  let start: number;
  if (resetCursor) {
    start = 1;
  } else {
    const cursor = getBackfillCursor(db);
    start = cursor !== null ? cursor : 1;
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

      let lastProcessedBlock: number | null = null;

      for (const rawTx of txs) {
        if (stats.inserted >= limit) break;

        stats.totalScanned++;

        // Only process storage transactions
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
            // Malformed HIVE payload — route to dead letters, not silent skip
            stats.deadLettered++;
            if (!dryRun) {
              insertDeadLetter(
                db,
                rawTx.hash,
                rawTx.content,
                rawTx.blockNumber,
                "Malformed HIVE payload: decodeHiveData returned null for storage transaction",
              );
            }
            lastProcessedBlock = rawTx.blockNumber;
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
          lastProcessedBlock = rawTx.blockNumber;
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
          lastProcessedBlock = rawTx.blockNumber;
        }
      }

      // Track last block seen for stats
      if (lastProcessedBlock != null) {
        stats.lastBlockNumber = lastProcessedBlock;
      }

      // Advance offset — forward pagination by page size.
      // SDK's getTransactions(start, limit) returns txs starting from index `start`.
      start += txs.length;

      // Persist cursor as the next offset to resume from
      if (!dryRun) {
        setBackfillCursor(db, start);
      }

      onProgress?.(structuredClone(stats));
    }
  } finally {
    if (!dryRun) {
      db.pragma("foreign_keys = ON");
    }
  }

  return stats;
}
