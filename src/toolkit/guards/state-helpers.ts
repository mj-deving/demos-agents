/**
 * Shared helpers for guard state management.
 *
 * Eliminates duplicated loadState/appendAndPrune patterns across guards.
 */

import { createHash } from "node:crypto";
import type { StateStore } from "../types.js";

/** Default lock TTL for guard operations */
export const GUARD_LOCK_TTL_MS = 5000;

/** Construct a wallet-scoped state key (32-char hash for 128-bit collision resistance) */
export function stateKey(prefix: string, walletAddress: string): string {
  const hash = createHash("sha256").update(walletAddress).digest("hex").slice(0, 32);
  return `${prefix}-${hash}`;
}

/** Load and parse JSON state from store, returning deep copy of default on missing/corrupt */
export async function loadState<T>(
  store: StateStore,
  key: string,
  defaultValue: T,
): Promise<T> {
  const raw = await store.get(key);
  if (!raw) return structuredClone(defaultValue);
  try {
    return safeParse(raw) as T;
  } catch (e) {
    console.warn(`[demos-toolkit] State corruption detected for key — resetting to default. Parse error: ${(e as Error).message}`);
    return structuredClone(defaultValue);
  }
}

/**
 * Atomically check a condition and record an entry in a single lock acquisition.
 *
 * Eliminates double-lock overhead (check then record = 2 locks → 1 lock).
 * Returns the check result. If allowed and `newEntry` is provided, appends it.
 */
export async function checkAndAppend<TState extends { entries: TEntry[] }, TEntry extends { timestamp: number }>(
  store: StateStore,
  key: string,
  defaultState: TState,
  pruneWindowMs: number,
  check: (state: TState, now: number) => string | null, // null = allowed, string = error message
  newEntry?: TEntry,
): Promise<{ error: string | null }> {
  const unlock = await store.lock(key, GUARD_LOCK_TTL_MS);
  try {
    const state = await loadState(store, key, defaultState);
    const now = Date.now();
    const cutoff = now - pruneWindowMs;

    // Prune old entries
    state.entries = state.entries.filter((e) => e.timestamp > cutoff) as TState["entries"];

    // Check condition
    const errorMsg = check(state, now);
    if (errorMsg) return { error: errorMsg };

    // Append entry if provided
    if (newEntry) {
      state.entries.push(newEntry);
    }

    // Always persist pruned state (prevents unbounded growth on check-only paths)
    await store.set(key, JSON.stringify(state));

    return { error: null };
  } finally {
    await unlock();
  }
}

/**
 * Unconditionally append an entry with pruning — no check, just record.
 * Convenience wrapper over checkAndAppend for record-only paths.
 */
export async function appendEntry<TState extends { entries: TEntry[] }, TEntry extends { timestamp: number }>(
  store: StateStore,
  key: string,
  defaultState: TState,
  pruneWindowMs: number,
  entry: TEntry,
): Promise<void> {
  await checkAndAppend(store, key, defaultState, pruneWindowMs, () => null, entry);
}

/**
 * Safe JSON parser that strips prototype pollution vectors (__proto__, constructor, prototype).
 * Drop-in replacement for JSON.parse in security-sensitive paths.
 */
export function safeParse(raw: string): unknown {
  return JSON.parse(raw, (key, value) =>
    key === "__proto__" || key === "constructor" || key === "prototype" ? undefined : value,
  );
}

/** Simple sleep utility */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
