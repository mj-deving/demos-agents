/**
 * ProtocolEventSource — monitors DeFi protocol events.
 *
 * Polls for protocol-level events (TVL changes, rate changes,
 * governance proposals, exploits) and emits typed events for
 * downstream handlers.
 */

import type { AgentEvent, EventSource } from "../../../core/types.js";
import { extractLatestWatermark } from "./watermark-utils.js";

export interface ProtocolEventSnapshot {
  timestamp: number;
  events: ProtocolEvent[];
}

export const PROTOCOL_EVENT_TYPES = ["tvl_change", "rate_change", "governance", "exploit"] as const;
export type ProtocolEventType = typeof PROTOCOL_EVENT_TYPES[number];

export interface ProtocolEvent {
  id: string;
  protocol: string;
  type: ProtocolEventType;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface ProtocolEventSourceConfig {
  /** Function to fetch protocol events (injected for testability) */
  fetchEvents: () => Promise<ProtocolEvent[]>;
}

/**
 * Create a protocol event source.
 *
 * The source polls for protocol events and emits typed events
 * for each new event detected since the last poll.
 */
export function createProtocolEventSource(config: ProtocolEventSourceConfig): EventSource<ProtocolEventSnapshot> {
  return {
    id: "defi:protocol-events",
    description: "Monitors DeFi protocol events (TVL changes, rate changes, governance, exploits)",
    eventTypes: [...PROTOCOL_EVENT_TYPES],

    async poll(): Promise<ProtocolEventSnapshot> {
      const events = await config.fetchEvents();
      return { timestamp: Date.now(), events };
    },

    diff(prev: ProtocolEventSnapshot | null, curr: ProtocolEventSnapshot): AgentEvent<ProtocolEvent>[] {
      if (!prev) return []; // First poll is baseline (warm-up pattern)
      const prevIds = new Set(prev.events.map(e => e.id));
      return curr.events
        .filter(e => !prevIds.has(e.id))
        .map(e => ({
          id: `defi:protocol-events:${e.timestamp}:${e.id}`,
          sourceId: "defi:protocol-events",
          type: e.type,
          detectedAt: Date.now(),
          payload: e,
          watermark: { id: e.id, timestamp: e.timestamp },
        }));
    },

    extractWatermark(snapshot: ProtocolEventSnapshot): unknown {
      return extractLatestWatermark(snapshot.events, e => ({ id: e.id, timestamp: e.timestamp }));
    },
  };
}
