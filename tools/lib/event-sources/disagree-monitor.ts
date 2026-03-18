/**
 * DisagreeMonitorSource — detects high-disagree reactions on agent's posts.
 *
 * Polls the feed for the agent's recent posts and checks if any
 * have crossed a disagree threshold, triggering self-review.
 */

import type { AgentEvent, EventSource } from "../../../core/types.js";
import { extractLatestWatermark } from "./watermark-utils.js";

export interface DisagreeSnapshot {
  timestamp: number;
  posts: DisagreePost[];
}

export interface DisagreePost {
  txHash: string;
  timestamp: number;
  text: string;
  agreeCount: number;
  disagreeCount: number;
  disagreeRatio: number;
}

export interface DisagreeMonitorSourceConfig {
  /** Function to fetch agent's recent posts with reaction counts */
  fetchOwnPosts: () => Promise<DisagreePost[]>;
  /** Disagree ratio threshold to trigger event (default: 0.3 = 30%) */
  disagreeThreshold?: number;
}

/**
 * Create a disagree-monitor event source.
 */
export function createDisagreeMonitorSource(config: DisagreeMonitorSourceConfig): EventSource<DisagreeSnapshot> {
  const threshold = config.disagreeThreshold ?? 0.3;
  // Track which posts have already triggered to avoid re-alerting
  const alerted = new Set<string>();

  return {
    id: "social:disagrees",
    description: "Detects high-disagree reactions on agent posts",
    eventTypes: ["high_disagree"],

    async poll(): Promise<DisagreeSnapshot> {
      const posts = await config.fetchOwnPosts();
      const highDisagree = posts.filter(p => {
        const total = p.agreeCount + p.disagreeCount;
        return total >= 3 && p.disagreeRatio >= threshold;
      });
      return { timestamp: Date.now(), posts: highDisagree };
    },

    diff(prev: DisagreeSnapshot | null, curr: DisagreeSnapshot): AgentEvent<DisagreePost>[] {
      return curr.posts
        .filter(p => !alerted.has(p.txHash))
        .map(p => {
          alerted.add(p.txHash);
          return {
            id: `social:disagrees:${p.timestamp}:${p.txHash}`,
            sourceId: "social:disagrees",
            type: "high_disagree",
            detectedAt: Date.now(),
            payload: p,
            watermark: { txHash: p.txHash, timestamp: p.timestamp },
          };
        });
    },

    extractWatermark(snapshot: DisagreeSnapshot): unknown {
      return extractLatestWatermark(snapshot.posts, p => ({ txHash: p.txHash, timestamp: p.timestamp }));
    },
  };
}
