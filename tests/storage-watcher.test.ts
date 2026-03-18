/**
 * Tests for StorageWatcher event source.
 *
 * Uses injected mock fetchStorage — no network I/O.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createStorageWatcher,
  type FetchStorageFn,
  type StorageSnapshot,
} from "../tools/lib/event-sources/storage-watcher.js";

// ── Mock fetch ──────────────────────────────────────

function makeMockFetch(data: Record<string, Record<string, unknown>>): FetchStorageFn {
  return vi.fn().mockImplementation(async (_rpc: string, addr: string) => {
    return data[addr] ?? null;
  });
}

const ADDR_A = "stor-aaa";
const ADDR_B = "stor-bbb";

// ════════════════════════════════════════════════════
// Poll
// ════════════════════════════════════════════════════

describe("StorageWatcher — poll", () => {
  it("returns snapshot with states for watched addresses", async () => {
    const fetch = makeMockFetch({
      [ADDR_A]: { status: "active", count: 5 },
    });
    const watcher = createStorageWatcher(
      { watchAddresses: [ADDR_A], rpcUrl: "http://rpc", agentAddress: "me" },
      fetch,
    );

    const snapshot = await watcher.poll();
    expect(snapshot.timestamp).toBeGreaterThan(0);
    expect(snapshot.states[ADDR_A]).toEqual({ status: "active", count: 5 });
  });

  it("filters to watchFields when specified", async () => {
    const fetch = makeMockFetch({
      [ADDR_A]: { status: "active", count: 5, secret: "hidden" },
    });
    const watcher = createStorageWatcher(
      { watchAddresses: [ADDR_A], watchFields: ["status"], rpcUrl: "http://rpc" },
      fetch,
    );

    const snapshot = await watcher.poll();
    expect(snapshot.states[ADDR_A]).toEqual({ status: "active" });
    expect(snapshot.states[ADDR_A].secret).toBeUndefined();
  });

  it("handles unreachable programs gracefully", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("timeout"));
    const watcher = createStorageWatcher(
      { watchAddresses: [ADDR_A], rpcUrl: "http://rpc" },
      fetch,
    );

    const snapshot = await watcher.poll();
    expect(snapshot.states[ADDR_A]).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════
// Diff
// ════════════════════════════════════════════════════

describe("StorageWatcher — diff", () => {
  const watcher = createStorageWatcher(
    { watchAddresses: [ADDR_A, ADDR_B], rpcUrl: "http://rpc" },
    makeMockFetch({}),
  );

  it("returns empty on first poll (warm-up)", () => {
    const curr: StorageSnapshot = {
      timestamp: 1000,
      states: { [ADDR_A]: { status: "active" } },
    };
    const events = watcher.diff(null, curr);
    expect(events).toHaveLength(0);
  });

  it("detects field value change", () => {
    const prev: StorageSnapshot = {
      timestamp: 1000,
      states: { [ADDR_A]: { status: "active", count: 5 } },
    };
    const curr: StorageSnapshot = {
      timestamp: 2000,
      states: { [ADDR_A]: { status: "active", count: 10 } },
    };

    const events = watcher.diff(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("storage_update");
    expect(events[0].payload.field).toBe("count");
    expect(events[0].payload.oldValue).toBe(5);
    expect(events[0].payload.newValue).toBe(10);
  });

  it("detects new field added", () => {
    const prev: StorageSnapshot = {
      timestamp: 1000,
      states: { [ADDR_A]: { status: "active" } },
    };
    const curr: StorageSnapshot = {
      timestamp: 2000,
      states: { [ADDR_A]: { status: "active", newField: "hello" } },
    };

    const events = watcher.diff(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0].payload.field).toBe("newField");
    expect(events[0].payload.oldValue).toBeUndefined();
    expect(events[0].payload.newValue).toBe("hello");
  });

  it("detects field removed", () => {
    const prev: StorageSnapshot = {
      timestamp: 1000,
      states: { [ADDR_A]: { status: "active", temp: 42 } },
    };
    const curr: StorageSnapshot = {
      timestamp: 2000,
      states: { [ADDR_A]: { status: "active" } },
    };

    const events = watcher.diff(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0].payload.field).toBe("temp");
    expect(events[0].payload.oldValue).toBe(42);
    expect(events[0].payload.newValue).toBeUndefined();
  });

  it("emits no events when nothing changed", () => {
    const prev: StorageSnapshot = {
      timestamp: 1000,
      states: { [ADDR_A]: { status: "active" } },
    };
    const curr: StorageSnapshot = {
      timestamp: 2000,
      states: { [ADDR_A]: { status: "active" } },
    };

    const events = watcher.diff(prev, curr);
    expect(events).toHaveLength(0);
  });

  it("handles changes across multiple addresses", () => {
    const prev: StorageSnapshot = {
      timestamp: 1000,
      states: {
        [ADDR_A]: { x: 1 },
        [ADDR_B]: { y: 2 },
      },
    };
    const curr: StorageSnapshot = {
      timestamp: 2000,
      states: {
        [ADDR_A]: { x: 99 },
        [ADDR_B]: { y: 2 },
      },
    };

    const events = watcher.diff(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0].payload.storageAddress).toBe(ADDR_A);
  });

  it("detects object/array field changes", () => {
    const prev: StorageSnapshot = {
      timestamp: 1000,
      states: { [ADDR_A]: { config: { a: 1, b: 2 } } },
    };
    const curr: StorageSnapshot = {
      timestamp: 2000,
      states: { [ADDR_A]: { config: { a: 1, b: 3 } } },
    };

    const events = watcher.diff(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0].payload.field).toBe("config");
  });
});

// ════════════════════════════════════════════════════
// Watermark
// ════════════════════════════════════════════════════

describe("StorageWatcher — watermark", () => {
  const watcher = createStorageWatcher(
    { watchAddresses: [ADDR_A], rpcUrl: "http://rpc" },
    makeMockFetch({}),
  );

  it("extracts timestamp from snapshot", () => {
    const snapshot: StorageSnapshot = { timestamp: 5000, states: {} };
    const wm = watcher.extractWatermark(snapshot) as any;
    expect(wm.timestamp).toBe(5000);
  });
});
