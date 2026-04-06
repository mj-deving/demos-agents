/**
 * API-based colony backfill — fill sync gaps using paginated /api/feed.
 *
 * Uses SuperColonyApiClient.getFeed() with offset pagination to fetch
 * historical posts and insert them into the colony DB.
 */

import type { ColonyDatabase } from "./schema.js";
import type { SuperColonyApiClient } from "../supercolony/api-client.js";
import { insertPost, type CachedPost } from "./posts.js";

export interface ApiBackfillStats {
  fetched: number;
  inserted: number;
  skipped: number;
  pages: number;
}

export interface ApiBackfillOptions {
  /** Max posts to fetch total. */
  limit: number;
  /** Posts per API request (default 100). */
  batchSize?: number;
  /** Progress callback. */
  onProgress?: (stats: ApiBackfillStats) => void;
}

/**
 * Backfill colony DB from the SuperColony API feed endpoint.
 * Paginates using cursor-based pagination, inserts posts into the DB,
 * and skips duplicates (ON CONFLICT).
 */
export async function backfillFromApi(
  db: ColonyDatabase,
  apiClient: SuperColonyApiClient,
  options: ApiBackfillOptions,
): Promise<ApiBackfillStats> {
  const batchSize = options.batchSize ?? 100;
  const stats: ApiBackfillStats = { fetched: 0, inserted: 0, skipped: 0, pages: 0 };
  let cursor: string | undefined;

  while (stats.fetched < options.limit) {
    const remaining = options.limit - stats.fetched;
    const limit = Math.min(batchSize, remaining);

    const result = await apiClient.getFeed({ limit, cursor });
    if (!result || !result.ok || !result.data.posts.length) break;

    stats.pages++;

    for (const post of result.data.posts) {
      stats.fetched++;
      const payload = (post.payload ?? {}) as Record<string, unknown>;

      const cached: CachedPost = {
        txHash: post.txHash,
        author: post.author,
        blockNumber: (post as Record<string, unknown>).blockNumber as number ?? 0,
        timestamp: String(post.timestamp),
        replyTo: payload.replyTo ? String(payload.replyTo) : null,
        tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
        text: String(payload.text ?? ""),
        rawData: {
          category: String(payload.cat ?? payload.category ?? ""),
          reactions: (post as Record<string, unknown>).reactions ?? { agree: 0, disagree: 0 },
          reactionsKnown: true,
        },
      };

      try {
        insertPost(db, cached);
        stats.inserted++;
      } catch {
        stats.skipped++; // Duplicate or constraint violation
      }
    }

    options.onProgress?.(stats);

    if (!result.data.hasMore) break;

    // Extract cursor for next page from the last post
    const lastPost = result.data.posts[result.data.posts.length - 1];
    cursor = lastPost.txHash;
  }

  return stats;
}
