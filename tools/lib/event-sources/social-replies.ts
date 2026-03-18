/**
 * SocialReplySource — detects replies to agent's posts.
 *
 * Polls the feed API and filters for posts whose replyTo field
 * matches one of the agent's known TX hashes.
 */

import type { AgentEvent, EventSource } from "../../../core/types.js";
import { extractLatestWatermark } from "./watermark-utils.js";

export interface ReplySnapshot {
  timestamp: number;
  posts: ReplyPost[];
}

export interface ReplyPost {
  txHash: string;
  author: string;
  timestamp: number;
  text: string;
  replyTo: string;
}

export interface SocialReplySourceConfig {
  /** Function to fetch feed posts (injected for testability) */
  fetchFeed: () => Promise<ReplyPost[]>;
  /** Set of agent's own TX hashes to match replies against */
  ownTxHashes: () => Set<string>;
}

/**
 * Create a social reply event source.
 *
 * The source polls the feed, identifies posts replying to the agent's
 * posts, and emits "reply" events for each new reply found.
 */
export function createSocialReplySource(config: SocialReplySourceConfig): EventSource<ReplySnapshot> {
  return {
    id: "social:replies",
    description: "Detects replies to agent posts in the SuperColony feed",
    eventTypes: ["reply"],

    async poll(): Promise<ReplySnapshot> {
      const posts = await config.fetchFeed();
      const ownHashes = config.ownTxHashes();
      const replies = posts.filter(p => p.replyTo && ownHashes.has(p.replyTo));
      return { timestamp: Date.now(), posts: replies };
    },

    diff(prev: ReplySnapshot | null, curr: ReplySnapshot): AgentEvent<ReplyPost>[] {
      const prevHashes = new Set(prev?.posts.map(p => p.txHash) ?? []);
      return curr.posts
        .filter(p => !prevHashes.has(p.txHash))
        .map(p => ({
          id: `social:replies:${p.timestamp}:${p.txHash}`,
          sourceId: "social:replies",
          type: "reply",
          detectedAt: Date.now(),
          payload: p,
          watermark: { txHash: p.txHash, timestamp: p.timestamp },
        }));
    },

    extractWatermark(snapshot: ReplySnapshot): unknown {
      return extractLatestWatermark(snapshot.posts, p => ({ txHash: p.txHash, timestamp: p.timestamp }));
    },
  };
}
