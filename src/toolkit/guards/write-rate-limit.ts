/**
 * Write rate limiter — enforces publish/reply limits per wallet.
 *
 * Limits: 14 posts/day, 5 posts/hour. Chain has no rate limit — these are
 * self-imposed to avoid spamming the network. Previously 4/hour as margin
 * from the SuperColony API (15/day, 5/hour), but API is dead since 2026-03-26.
 * Wallet-scoped, StateStore-backed with exclusive locking.
 */

import type { StateStore, DemosError } from "../types.js";
import { demosError } from "../types.js";
import { stateKey, loadState, checkAndAppend, appendEntry, DAY_MS, GUARD_LOCK_TTL_MS } from "./state-helpers.js";

const DAILY_LIMIT = 14;
const HOURLY_LIMIT = 5;
const HOUR_MS = 60 * 60 * 1000;

interface WriteRateState {
  entries: { timestamp: number }[];
}

const DEFAULT_STATE: WriteRateState = { entries: [] };

/** Result of a write-rate check, including the recorded timestamp for rollback */
export interface WriteRateResult {
  error: DemosError | null;
  /** The timestamp that was recorded, or null if record=false or rate-limited */
  recordedTimestamp: number | null;
}

/** Check and optionally record a write in a single lock acquisition */
export async function checkAndRecordWrite(
  store: StateStore,
  walletAddress: string,
  record: boolean = false,
): Promise<WriteRateResult> {
  const key = stateKey("write-rate", walletAddress);
  const recordedTimestamp = record ? Date.now() : null;
  const { error } = await checkAndAppend<WriteRateState, { timestamp: number }>(
    store,
    key,
    DEFAULT_STATE,
    DAY_MS,
    (state, now) => {
      const hourAgo = now - HOUR_MS;
      const dailyCount = state.entries.length; // already pruned to 24h
      const hourlyCount = state.entries.filter((e) => e.timestamp > hourAgo).length;

      if (dailyCount >= DAILY_LIMIT) {
        return `Daily write limit reached (${DAILY_LIMIT}/day)`;
      }
      if (hourlyCount >= HOURLY_LIMIT) {
        return `Hourly write limit reached (${HOURLY_LIMIT}/hour)`;
      }
      return null;
    },
    recordedTimestamp !== null ? { timestamp: recordedTimestamp } : undefined,
  );

  return {
    error: error ? demosError("RATE_LIMITED", error, true) : null,
    recordedTimestamp: error ? null : recordedTimestamp,
  };
}

/** Remove a specific reservation by timestamp (ID-based, safe for concurrent publishers) */
export async function rollbackWriteRecord(
  store: StateStore,
  walletAddress: string,
  timestamp: number,
): Promise<void> {
  const key = stateKey("write-rate", walletAddress);
  const unlock = await store.lock(key, GUARD_LOCK_TTL_MS);
  try {
    const state = await loadState(store, key, DEFAULT_STATE);
    const idx = state.entries.findIndex((e) => e.timestamp === timestamp);
    if (idx !== -1) {
      state.entries.splice(idx, 1);
      await store.set(key, JSON.stringify(state));
    }
  } finally {
    await unlock();
  }
}

/** Get remaining capacity */
export async function getWriteRateRemaining(
  store: StateStore,
  walletAddress: string,
): Promise<{ dailyRemaining: number; hourlyRemaining: number }> {
  const key = stateKey("write-rate", walletAddress);
  const unlock = await store.lock(key, GUARD_LOCK_TTL_MS);
  try {
    const state = await loadState(store, key, DEFAULT_STATE);
    const now = Date.now();
    const dayAgo = now - DAY_MS;
    const hourAgo = now - HOUR_MS;

    const dailyCount = state.entries.filter((e) => e.timestamp > dayAgo).length;
    const hourlyCount = state.entries.filter((e) => e.timestamp > hourAgo).length;

    return {
      dailyRemaining: Math.max(0, DAILY_LIMIT - dailyCount),
      hourlyRemaining: Math.max(0, HOURLY_LIMIT - hourlyCount),
    };
  } finally {
    await unlock();
  }
}
