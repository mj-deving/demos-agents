/**
 * API-based colony backfill — fill sync gaps using paginated /api/feed.
 *
 * Fetches newest-first from the API and stops when an entire page
 * consists of posts already in the colony DB. This makes it self-tuning:
 * - Empty DB: fetches everything (slow, but only happens once)
 * - Small gap: 1-3 pages, stops in seconds
 * - No gap: first page all duplicates, returns immediately
 */

import type { ColonyDatabase } from "./schema.js";
import type { SuperColonyApiClient } from "../supercolony/api-client.js";
import { insertPost, type CachedPost } from "./posts.js";

export interface ApiBackfillStats {
  fetched: number;
  inserted: number;
  duplicates: number;
  pages: number;
}

export interface ApiBackfillOptions {
  /** Posts per API request (default 100). */
  batchSize?: number;
  /** Max pages to fetch (safety valve, default 2500 = ~250K posts). */
  maxPages?: number;
  /** Progress callback. */
  onProgress?: (stats: ApiBackfillStats) => void;
}

/** Check if a post already exists in the colony DB. */
function postExists(db: ColonyDatabase, txHash: string): boolean {
  const row = db.prepare("SELECT 1 FROM posts WHERE tx_hash = ?").get(txHash);
  return row !== undefined;
}

function toApiCachedPost(post: { txHash: string; author: string; timestamp: number; payload: Record<string, unknown> }): CachedPost {
  const payload = post.payload ?? {};
  return {
    txHash: post.txHash,
    author: post.author,
    blockNumber: (post as Record<string, unknown>).blockNumber as number ?? 0,
    timestamp: String(post.timestamp),
    replyTo: (payload.replyTo ?? payload.reply_to) ? String(payload.replyTo ?? payload.reply_to) : null,
    tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
    text: String(payload.text ?? ""),
    rawData: {
      category: String(payload.cat ?? payload.category ?? ""),
      reactions: (post as Record<string, unknown>).reactions ?? { agree: 0, disagree: 0 },
      reactionsKnown: true,
    },
  };
}

/**
 * Sync colony DB with the SuperColony API feed (contiguous gap fill).
 *
 * Fetches pages newest-first. Stops when a full page is duplicates
 * (the newest contiguous gap is bridged). Handles empty DB, small gaps, and no-ops.
 *
 * NOTE: This only fills contiguous gaps from the newest data backward.
 * Sparse holes in older data (e.g., from partial manual backfills) are NOT detected.
 * Use backfillFromApi() with an explicit limit for full historical recovery.
 */
export async function syncColonyFromApi(
  db: ColonyDatabase,
  apiClient: SuperColonyApiClient,
  options?: ApiBackfillOptions,
): Promise<ApiBackfillStats> {
  const batchSize = options?.batchSize ?? 100;
  const maxPages = options?.maxPages ?? 2500;
  const stats: ApiBackfillStats = { fetched: 0, inserted: 0, duplicates: 0, pages: 0 };
  let cursor: string | undefined;

  while (stats.pages < maxPages) {
    const result = await apiClient.getFeed({ limit: batchSize, cursor });
    if (!result || !result.ok || !result.data?.posts?.length) break;

    stats.pages++;
    let pageNewCount = 0;

    for (const post of result.data.posts) {
      stats.fetched++;

      if (postExists(db, post.txHash)) {
        stats.duplicates++;
        continue;
      }

      insertPost(db, toApiCachedPost(post));
      stats.inserted++;
      pageNewCount++;
    }

    options?.onProgress?.(stats);

    // Stop when an entire page is duplicates — we've bridged the gap
    if (pageNewCount === 0) break;

    if (!result.data.hasMore) break;

    // Cursor for next page
    const lastPost = result.data.posts[result.data.posts.length - 1];
    cursor = lastPost.txHash;
  }

  return stats;
}

/**
 * Legacy backfill with explicit limit (used by CLI runner).
 * @deprecated Use syncColonyFromApi() instead — it auto-detects the gap.
 */
export async function backfillFromApi(
  db: ColonyDatabase,
  apiClient: SuperColonyApiClient,
  options: { limit: number; batchSize?: number; onProgress?: (stats: ApiBackfillStats) => void },
): Promise<ApiBackfillStats> {
  const batchSize = options.batchSize ?? 100;
  const stats: ApiBackfillStats = { fetched: 0, inserted: 0, duplicates: 0, pages: 0 };
  let cursor: string | undefined;

  while (stats.fetched < options.limit) {
    const remaining = options.limit - stats.fetched;
    const limit = Math.min(batchSize, remaining);

    const result = await apiClient.getFeed({ limit, cursor });
    if (!result || !result.ok || !result.data?.posts?.length) break;

    stats.pages++;

    for (const post of result.data.posts) {
      stats.fetched++;
      if (postExists(db, post.txHash)) {
        stats.duplicates++;
        continue;
      }
      insertPost(db, toApiCachedPost(post));
      stats.inserted++;
    }

    options.onProgress?.(stats);
    if (!result.data.hasMore) break;

    const lastPost = result.data.posts[result.data.posts.length - 1];
    cursor = lastPost.txHash;
  }

  return stats;
}
