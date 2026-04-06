/**
 * DataSource abstraction — API/chain routing with automatic fallback.
 *
 * Three implementations:
 * - ApiDataSource: wraps SuperColonyApiClient (fast, enriched, paginated)
 * - ChainDataSource: wraps chain-reader.ts (always-available, no reactions)
 * - AutoDataSource: tries API first, falls back to chain on failure
 *
 * All return ScanPost[] — normalized to the same shape regardless of source.
 */

import type { SuperColonyApiClient } from "./supercolony/api-client.js";
import type { FeedResponse, ThreadResponse, PostDetail } from "./supercolony/types.js";
import type { ScanPost } from "./types.js";
import type { ChainReaderRpc } from "./chain-reader.js";

// ── Interface ──────────────────────────────────

export interface DataSource {
  readonly name: "api" | "chain" | "auto";
  getRecentPosts(limit: number, opts?: { category?: string }): Promise<ScanPost[]>;
  getPostByHash(txHash: string): Promise<ScanPost | null>;
  getThread(txHash: string): Promise<{ root: ScanPost; replies: ScanPost[] } | null>;
  getRepliesTo(txHashes: string[]): Promise<ScanPost[]>;
}

// ── Normalization helpers ──────────────────────

/** Convert an API feed post (enriched payload) into a ScanPost. */
function normalizeApiFeedPost(post: FeedResponse["posts"][0]): ScanPost {
  const payload = (post.payload ?? {}) as Record<string, unknown>;
  const reactions = (post as Record<string, unknown>).reactions as
    | { agree?: number; disagree?: number }
    | undefined;
  return {
    txHash: post.txHash,
    author: post.author,
    timestamp: post.timestamp,
    text: String(payload.text ?? ""),
    category: String(payload.cat ?? payload.category ?? ""),
    tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
    replyTo: payload.replyTo ? String(payload.replyTo) : undefined,
    blockNumber: (post as Record<string, unknown>).blockNumber as number | undefined,
    reactions: {
      agree: reactions?.agree ?? 0,
      disagree: reactions?.disagree ?? 0,
    },
    reactionsKnown: true,
  };
}

/** Convert a generic API post object (PostDetail/ThreadResponse) into a ScanPost. */
function normalizeApiPostObject(obj: Record<string, unknown>): ScanPost {
  const payload = (obj.payload ?? {}) as Record<string, unknown>;
  const reactions = obj.reactions as { agree?: number; disagree?: number } | undefined;
  return {
    txHash: String(obj.txHash ?? ""),
    author: String(obj.author ?? ""),
    timestamp: Number(obj.timestamp ?? 0),
    text: String(payload.text ?? ""),
    category: String(payload.cat ?? payload.category ?? ""),
    tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
    replyTo: payload.replyTo ? String(payload.replyTo) : undefined,
    blockNumber: obj.blockNumber as number | undefined,
    reactions: {
      agree: reactions?.agree ?? 0,
      disagree: reactions?.disagree ?? 0,
    },
    reactionsKnown: !!reactions,
  };
}

// ── Chain delegate interface ──────────────────

/** Allows injecting chain-reader functions for testability. */
export interface ChainDelegate {
  getHivePosts: (rpc: ChainReaderRpc, limit: number) => Promise<ScanPost[]>;
  getPostByHash?: (txHash: string) => Promise<ScanPost | null>;
  getThread?: (txHash: string) => Promise<{ root: ScanPost; replies: ScanPost[] } | null>;
  getRepliesTo?: (rpc: ChainReaderRpc, txHashes: string[]) => Promise<ScanPost[]>;
}

// ── ApiDataSource ──────────────────────────────

export class ApiDataSource implements DataSource {
  readonly name = "api" as const;
  constructor(private readonly client: SuperColonyApiClient) {}

  async getRecentPosts(limit: number, opts?: { category?: string }): Promise<ScanPost[]> {
    const result = await this.client.getFeed({ limit, category: opts?.category });
    if (!result || !result.ok) return [];
    return result.data.posts.map(normalizeApiFeedPost);
  }

  async getPostByHash(txHash: string): Promise<ScanPost | null> {
    const result = await this.client.getPostDetail(txHash);
    if (!result || !result.ok) return null;
    return normalizeApiPostObject(result.data.post as unknown as Record<string, unknown>);
  }

  async getThread(txHash: string): Promise<{ root: ScanPost; replies: ScanPost[] } | null> {
    const result = await this.client.getThread(txHash);
    if (!result || !result.ok) return null;
    return {
      root: normalizeApiPostObject(result.data.root as Record<string, unknown>),
      replies: (result.data.replies ?? []).map(
        (r) => normalizeApiPostObject(r as Record<string, unknown>),
      ),
    };
  }

  async getRepliesTo(_txHashes: string[]): Promise<ScanPost[]> {
    // API doesn't have a batch replies endpoint — use getThread per hash
    const results: ScanPost[] = [];
    for (const txHash of _txHashes) {
      const thread = await this.getThread(txHash);
      if (thread) results.push(...thread.replies);
    }
    return results;
  }
}

// ── ChainDataSource ────────────────────────────

export class ChainDataSource implements DataSource {
  readonly name = "chain" as const;
  private readonly delegate: ChainDelegate;

  constructor(
    private readonly rpc: ChainReaderRpc,
    delegate?: Partial<ChainDelegate>,
  ) {
    // Default delegate uses the real chain-reader functions (lazy import to avoid circular deps)
    this.delegate = {
      getHivePosts: delegate?.getHivePosts ?? (async (r, l) => {
        const { getHivePosts } = await import("./chain-reader.js");
        return getHivePosts(r, l);
      }),
      getPostByHash: delegate?.getPostByHash,
      getThread: delegate?.getThread,
      getRepliesTo: delegate?.getRepliesTo ?? (async (r, hashes) => {
        const { getRepliesTo } = await import("./chain-reader.js");
        return getRepliesTo(r, hashes);
      }),
    };
  }

  async getRecentPosts(limit: number, _opts?: { category?: string }): Promise<ScanPost[]> {
    const posts = await this.delegate.getHivePosts(this.rpc, limit);
    if (_opts?.category) {
      return posts.filter((p) => p.category === _opts.category);
    }
    return posts;
  }

  async getPostByHash(txHash: string): Promise<ScanPost | null> {
    if (this.delegate.getPostByHash) {
      return this.delegate.getPostByHash(txHash);
    }
    return null;
  }

  async getThread(txHash: string): Promise<{ root: ScanPost; replies: ScanPost[] } | null> {
    if (this.delegate.getThread) {
      return this.delegate.getThread(txHash);
    }
    return null;
  }

  async getRepliesTo(txHashes: string[]): Promise<ScanPost[]> {
    if (this.delegate.getRepliesTo) {
      return this.delegate.getRepliesTo(this.rpc, txHashes);
    }
    return [];
  }
}

// ── AutoDataSource ─────────────────────────────

export class AutoDataSource implements DataSource {
  readonly name = "auto" as const;

  constructor(
    private readonly api: ApiDataSource,
    private readonly chain: ChainDataSource,
  ) {}

  async getRecentPosts(limit: number, opts?: { category?: string }): Promise<ScanPost[]> {
    const apiPosts = await this.api.getRecentPosts(limit, opts);
    if (apiPosts.length > 0) return apiPosts;
    return this.chain.getRecentPosts(limit, opts);
  }

  async getPostByHash(txHash: string): Promise<ScanPost | null> {
    const apiPost = await this.api.getPostByHash(txHash);
    if (apiPost) return apiPost;
    return this.chain.getPostByHash(txHash);
  }

  async getThread(txHash: string): Promise<{ root: ScanPost; replies: ScanPost[] } | null> {
    const apiThread = await this.api.getThread(txHash);
    if (apiThread) return apiThread;
    return this.chain.getThread(txHash);
  }

  async getRepliesTo(txHashes: string[]): Promise<ScanPost[]> {
    const apiReplies = await this.api.getRepliesTo(txHashes);
    if (apiReplies.length > 0) return apiReplies;
    return this.chain.getRepliesTo(txHashes);
  }
}
