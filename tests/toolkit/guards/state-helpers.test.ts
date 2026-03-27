/**
 * Tests for state-helpers: stateKey(), loadState(), checkAndAppend(), sleep().
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { stateKey, loadState, checkAndAppend, GUARD_LOCK_TTL_MS } from "../../../src/toolkit/guards/state-helpers.js";
import type { StateStore, Unlock } from "../../../src/toolkit/types.js";

function createMockStore(data: Record<string, string> = {}): StateStore {
  const store: Record<string, string> = { ...data };
  return {
    async get(key: string) { return store[key] ?? null; },
    async set(key: string, value: string) { store[key] = value; },
    async lock(_key: string, _ttlMs: number): Promise<Unlock> {
      return async () => {};
    },
  };
}

describe("stateKey()", () => {
  it("returns prefix-hash format", () => {
    const key = stateKey("rate-limit", "demos1abc123");
    expect(key).toMatch(/^rate-limit-[a-f0-9]{32}$/);
  });

  it("produces different keys for different addresses", () => {
    const k1 = stateKey("rate-limit", "demos1abc");
    const k2 = stateKey("rate-limit", "demos1xyz");
    expect(k1).not.toBe(k2);
  });

  it("produces different keys for different prefixes", () => {
    const k1 = stateKey("rate-limit", "demos1abc");
    const k2 = stateKey("dedup", "demos1abc");
    expect(k1).not.toBe(k2);
  });

  it("produces consistent keys for same inputs", () => {
    const k1 = stateKey("rate-limit", "demos1abc");
    const k2 = stateKey("rate-limit", "demos1abc");
    expect(k1).toBe(k2);
  });
});

describe("loadState()", () => {
  it("returns default on missing key", async () => {
    const store = createMockStore();
    const result = await loadState(store, "nonexistent", { count: 0 });
    expect(result).toEqual({ count: 0 });
  });

  it("returns parsed value on valid JSON", async () => {
    const store = createMockStore({ mykey: JSON.stringify({ count: 42 }) });
    const result = await loadState(store, "mykey", { count: 0 });
    expect(result).toEqual({ count: 42 });
  });

  it("returns default on corrupt JSON and logs warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createMockStore({ mykey: "not-json{{{" });
    const result = await loadState(store, "mykey", { count: 0 });
    expect(result).toEqual({ count: 0 });
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("State corruption detected");
    warnSpy.mockRestore();
  });

  it("returns deep clone of default (mutation safe)", async () => {
    const store = createMockStore();
    const defaultVal = { entries: [{ ts: 1 }] };
    const result = await loadState(store, "missing", defaultVal);
    result.entries.push({ ts: 2 });
    expect(defaultVal.entries).toHaveLength(1);
  });
});

describe("checkAndAppend()", () => {
  it("prunes old entries beyond window", async () => {
    const now = Date.now();
    const state = {
      entries: [
        { timestamp: now - 200_000 },  // old, should be pruned
        { timestamp: now - 100 },       // recent, should stay
      ],
    };
    const store = createMockStore({ mykey: JSON.stringify(state) });

    const result = await checkAndAppend(
      store, "mykey",
      { entries: [] as { timestamp: number }[] },
      60_000, // 60s window
      () => null, // always allow
    );

    expect(result.error).toBeNull();
    const persisted = JSON.parse(await store.get("mykey") as string);
    expect(persisted.entries).toHaveLength(1);
    expect(persisted.entries[0].timestamp).toBeCloseTo(now - 100, -2);
  });

  it("rejects when check fails", async () => {
    const store = createMockStore();

    const result = await checkAndAppend(
      store, "mykey",
      { entries: [] as { timestamp: number }[] },
      60_000,
      () => "rate limited: too many requests",
    );

    expect(result.error).toBe("rate limited: too many requests");
  });

  it("appends entry on success", async () => {
    const store = createMockStore();
    const now = Date.now();

    const result = await checkAndAppend(
      store, "mykey",
      { entries: [] as { timestamp: number }[] },
      60_000,
      () => null,
      { timestamp: now },
    );

    expect(result.error).toBeNull();
    const persisted = JSON.parse(await store.get("mykey") as string);
    expect(persisted.entries).toHaveLength(1);
    expect(persisted.entries[0].timestamp).toBe(now);
  });

  it("does not append when check rejects", async () => {
    const store = createMockStore();
    const now = Date.now();

    await checkAndAppend(
      store, "mykey",
      { entries: [] as { timestamp: number }[] },
      60_000,
      () => "blocked",
      { timestamp: now },
    );

    const raw = await store.get("mykey");
    // State not persisted on rejection (no set call)
    expect(raw).toBeNull();
  });

  it("calls unlock even on error", async () => {
    const unlockSpy = vi.fn(async () => {});
    const store: StateStore = {
      async get() { throw new Error("boom"); },
      async set() {},
      async lock() { return unlockSpy; },
    };

    await expect(
      checkAndAppend(
        store, "mykey",
        { entries: [] as { timestamp: number }[] },
        60_000,
        () => null,
      ),
    ).rejects.toThrow("boom");

    expect(unlockSpy).toHaveBeenCalledOnce();
  });
});

describe("GUARD_LOCK_TTL_MS", () => {
  it("is a positive number", () => {
    expect(GUARD_LOCK_TTL_MS).toBeGreaterThan(0);
    expect(typeof GUARD_LOCK_TTL_MS).toBe("number");
  });
});
