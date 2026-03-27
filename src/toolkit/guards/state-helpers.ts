/**
 * Shared helpers for guard state management.
 *
 * Eliminates duplicated loadState/appendAndPrune patterns across guards.
 */

import { createHash } from "node:crypto";
import type { StateStore } from "../types.js";

/** Default lock TTL for guard operations */
export const GUARD_LOCK_TTL_MS = 5000;

/** Construct a wallet-scoped state key (16-char hash for collision resistance) */
export function stateKey(prefix: string, walletAddress: string): string {
  const hash = createHash("sha256").update(walletAddress).digest("hex").slice(0, 16);
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
    return JSON.parse(raw) as T;
  } catch {
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

/** Simple sleep utility */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
