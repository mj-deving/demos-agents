/**
 * StatusMonitorSource — monitors infrastructure service health.
 *
 * Polls for service status snapshots and emits events when
 * services change state (healthy, degraded, down, maintenance).
 * Uses the warm-up pattern: first poll establishes baseline without emitting events.
 */

import type { AgentEvent, EventSource } from "../../../core/types.js";
import { extractLatestWatermark } from "./watermark-utils.js";

export const STATUS_EVENT_TYPES = ["status_change", "degradation", "outage", "recovery"] as const;
export type StatusEventType = typeof STATUS_EVENT_TYPES[number];

export interface StatusSnapshot {
  timestamp: number;
  statuses: ServiceStatus[];
}

export interface ServiceStatus {
  id: string;
  service: string;
  status: "healthy" | "degraded" | "down" | "maintenance";
  timestamp: number;
  latencyMs?: number;
  details?: string;
}

export interface StatusMonitorSourceConfig {
  /** Function to fetch current service statuses (injected for testability) */
  fetchStatuses: () => Promise<ServiceStatus[]>;
}

/**
 * Create a status monitor event source.
 *
 * The source polls for service health, compares against previous state,
 * and emits events for status transitions (outage, degradation, recovery).
 */
export function createStatusMonitorSource(
  config: StatusMonitorSourceConfig,
): EventSource<StatusSnapshot> {
  return {
    id: "infra:status-monitor",
    description:
      "Monitors infrastructure service health and detects status changes",
    eventTypes: [...STATUS_EVENT_TYPES],

    async poll(): Promise<StatusSnapshot> {
      const statuses = await config.fetchStatuses();
      return { timestamp: Date.now(), statuses };
    },

    diff(
      prev: StatusSnapshot | null,
      curr: StatusSnapshot,
    ): AgentEvent<ServiceStatus>[] {
      if (!prev) return []; // First poll is baseline (warm-up pattern)

      const prevMap = new Map(prev.statuses.map((s) => [s.service, s]));
      const events: AgentEvent<ServiceStatus>[] = [];

      for (const status of curr.statuses) {
        const prevStatus = prevMap.get(status.service);
        if (!prevStatus || prevStatus.status !== status.status) {
          const eventType =
            status.status === "down"
              ? "outage"
              : status.status === "degraded"
                ? "degradation"
                : status.status === "healthy" && prevStatus
                  ? "recovery"
                  : "status_change";

          events.push({
            id: `infra:status-monitor:${status.timestamp}:${status.id}`,
            sourceId: "infra:status-monitor",
            type: eventType,
            detectedAt: Date.now(),
            payload: status,
            watermark: { id: status.id, timestamp: status.timestamp },
          });
        }
      }

      return events;
    },

    extractWatermark(snapshot: StatusSnapshot): unknown {
      return extractLatestWatermark(snapshot.statuses, s => ({ id: s.id, timestamp: s.timestamp }));
    },
  };
}
