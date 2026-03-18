/**
 * SocialMentionSource — detects /ask mentions directed at the agent.
 *
 * Polls the feed API and filters for posts containing /ask @address.
 * Transfers mention-detection ownership from cron's beforeSense.
 */

import type { AgentEvent, EventSource } from "../../../core/types.js";
import { extractLatestWatermark } from "./watermark-utils.js";

export interface MentionSnapshot {
  timestamp: number;
  mentions: MentionPost[];
}

export interface MentionPost {
  txHash: string;
  author: string;
  timestamp: number;
  text: string;
}

export interface SocialMentionSourceConfig {
  /** Function to fetch feed posts (injected for testability) */
  fetchFeed: () => Promise<MentionPost[]>;
  /** Agent's address (lowercased) to match mentions against */
  agentAddress: string;
}

/**
 * Create a social mention event source.
 */
export function createSocialMentionSource(config: SocialMentionSourceConfig): EventSource<MentionSnapshot> {
  const addr = config.agentAddress.toLowerCase();

  return {
    id: "social:mentions",
    description: "Detects /ask mentions directed at the agent",
    eventTypes: ["ask_mention"],

    async poll(): Promise<MentionSnapshot> {
      const posts = await config.fetchFeed();
      const mentions = posts.filter(p =>
        p.text.toLowerCase().includes("/ask") &&
        p.text.toLowerCase().includes(addr)
      );
      return { timestamp: Date.now(), mentions };
    },

    diff(prev: MentionSnapshot | null, curr: MentionSnapshot): AgentEvent<MentionPost>[] {
      const prevHashes = new Set(prev?.mentions.map(m => m.txHash) ?? []);
      return curr.mentions
        .filter(m => !prevHashes.has(m.txHash))
        .map(m => ({
          id: `social:mentions:${m.timestamp}:${m.txHash}`,
          sourceId: "social:mentions",
          type: "ask_mention",
          detectedAt: Date.now(),
          payload: m,
          watermark: { txHash: m.txHash, timestamp: m.timestamp },
        }));
    },

    extractWatermark(snapshot: MentionSnapshot): unknown {
      return extractLatestWatermark(snapshot.mentions, m => ({ txHash: m.txHash, timestamp: m.timestamp }));
    },
  };
}
