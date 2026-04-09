/**
 * Feed domain primitives — read posts, search, get threads.
 *
 * getRecent/search use apiClient directly (return FeedResponse).
 * getPost/getThread use DataSource (API-first with chain fallback).
 */

import type { SuperColonyApiClient } from "../supercolony/api-client.js";
import type { ApiResult, FeedResponse } from "../supercolony/types.js";
import type { DataSource } from "../data-source.js";
import type { ScanPost } from "../types.js";
import type { FeedPrimitives } from "./types.js";

interface FeedDeps {
  apiClient: SuperColonyApiClient;
  dataSource: DataSource;
}

export function createFeedPrimitives(deps: FeedDeps): FeedPrimitives {
  return {
    async getRecent(opts) {
      return deps.apiClient.getFeed({
        limit: opts?.limit,
        category: opts?.category,
        cursor: opts?.cursor,
        author: opts?.author,
        asset: opts?.asset,
        replies: opts?.replies,
      });
    },

    async search(opts) {
      return deps.apiClient.searchFeed(opts);
    },

    async getPost(txHash: string): Promise<ScanPost | null> {
      return deps.dataSource.getPostByHash(txHash);
    },

    async getThread(txHash: string): Promise<{ root: ScanPost; replies: ScanPost[] } | null> {
      return deps.dataSource.getThread(txHash);
    },

    async getPostDetail(txHash) {
      return deps.apiClient.getPostDetail(txHash);
    },

    async getRss() {
      return deps.apiClient.getRssFeed();
    },
  };
}
