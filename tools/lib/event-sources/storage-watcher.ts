/**
 * StorageWatcher — polls Demos Storage Programs for state changes.
 *
 * Watches specified Storage Program addresses and emits events when
 * field values change. Used for inter-agent coordination.
 *
 * Follows the standard EventSource pattern: poll → diff → events.
 * Warm-up: first poll establishes baseline without emitting events.
 */

import type { AgentEvent, EventSource } from "../../../core/types.js";
import { extractLatestWatermark } from "./watermark-utils.js";

// ── Types ───────────────────────────────────────────

export interface StorageWatcherConfig {
  /** Storage Program addresses to monitor */
  watchAddresses: string[];
  /** Specific fields to watch (default: all fields) */
  watchFields?: string[];
  /** RPC URL for Storage Program queries */
  rpcUrl: string;
  /** Agent address for ACL-protected reads */
  agentAddress?: string;
}

export interface StorageSnapshot {
  /** Timestamp of this snapshot */
  timestamp: number;
  /** Current field values per storage address */
  states: Record<string, Record<string, unknown>>;
}

export interface StorageUpdatePayload {
  storageAddress: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  timestamp: number;
}

// ── Fetch Function Type ─────────────────────────────

/** Injected function to read a Storage Program's fields. */
export type FetchStorageFn = (
  rpcUrl: string,
  storageAddress: string,
  identity?: string,
) => Promise<Record<string, unknown> | null>;

// ── Factory ─────────────────────────────────────────

/**
 * Create a StorageWatcher event source.
 *
 * @param config — addresses and fields to watch
 * @param fetchStorage — injected read function (defaults to SDK call)
 */
export function createStorageWatcher(
  config: StorageWatcherConfig,
  fetchStorage: FetchStorageFn,
): EventSource<StorageSnapshot> {
  const { watchAddresses, watchFields, rpcUrl, agentAddress } = config;

  return {
    id: "storage:watcher",
    description: `Watch ${watchAddresses.length} Storage Program(s) for field changes`,
    eventTypes: ["storage_update"],

    async poll(): Promise<StorageSnapshot> {
      const states: Record<string, Record<string, unknown>> = {};

      for (const addr of watchAddresses) {
        try {
          const data = await fetchStorage(rpcUrl, addr, agentAddress);
          if (data) {
            if (watchFields) {
              // Filter to watched fields only
              const filtered: Record<string, unknown> = {};
              for (const f of watchFields) {
                if (f in data) filtered[f] = data[f];
              }
              states[addr] = filtered;
            } else {
              states[addr] = data;
            }
          }
        } catch {
          // Skip unreachable programs — don't crash the source
        }
      }

      return { timestamp: Date.now(), states };
    },

    diff(prev: StorageSnapshot | null, curr: StorageSnapshot): AgentEvent<StorageUpdatePayload>[] {
      if (!prev) return []; // Warm-up: baseline established, no events

      const events: AgentEvent<StorageUpdatePayload>[] = [];

      for (const addr of watchAddresses) {
        const prevState = prev.states[addr] ?? {};
        const currState = curr.states[addr] ?? {};

        // Check each field for changes
        const allFields = new Set([...Object.keys(prevState), ...Object.keys(currState)]);
        for (const field of allFields) {
          const oldVal = prevState[field];
          const newVal = currState[field];

          // Compare by JSON serialization (handles objects/arrays)
          if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
            const payload: StorageUpdatePayload = {
              storageAddress: addr,
              field,
              oldValue: oldVal,
              newValue: newVal,
              timestamp: curr.timestamp,
            };
            events.push({
              id: `storage:watcher:storage_update:${curr.timestamp}:${addr}:${field}`,
              sourceId: "storage:watcher",
              type: "storage_update",
              detectedAt: curr.timestamp,
              payload,
              watermark: { timestamp: curr.timestamp, address: addr, field },
            });
          }
        }
      }

      return events;
    },

    extractWatermark(snapshot: StorageSnapshot): unknown {
      return { timestamp: snapshot.timestamp };
    },
  };
}
