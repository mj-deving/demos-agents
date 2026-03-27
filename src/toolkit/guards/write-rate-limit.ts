/**
 * Write rate limiter — enforces publish/reply limits per wallet.
 *
 * Limits: 14 posts/day, 4 posts/hour (margin of 1 from API's 15/5).
 * Wallet-scoped, StateStore-backed with exclusive locking.
 */

import type { StateStore, DemosError } from "../types.js";
import { demosError } from "../types.js";
import { stateKey, loadState, checkAndAppend, GUARD_LOCK_TTL_MS } from "./state-helpers.js";

const DAILY_LIMIT = 14;
const HOURLY_LIMIT = 4;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

interface WriteRateState {
  entries: { timestamp: number }[];
}

const DEFAULT_STATE: WriteRateState = { entries: [] };

/** Check and optionally record a write in a single lock acquisition */
export async function checkAndRecordWrite(
  store: StateStore,
  walletAddress: string,
  record: boolean = false,
): Promise<DemosError | null> {
  const key = stateKey("write-rate", walletAddress);
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
    record ? { timestamp: Date.now() } : undefined,
  );

  return error ? demosError("RATE_LIMITED", error, true) : null;
}

/** Check if a write is allowed (backward compat) */
export async function checkWriteRateLimit(
  store: StateStore,
  walletAddress: string,
): Promise<DemosError | null> {
  return checkAndRecordWrite(store, walletAddress, false);
}

/** Record a successful write (unconditional — does not check limits) */
export async function recordWrite(
  store: StateStore,
  walletAddress: string,
): Promise<void> {
  const key = stateKey("write-rate", walletAddress);
  const unlock = await store.lock(key, GUARD_LOCK_TTL_MS);
  try {
    const state = await loadState<WriteRateState>(store, key, DEFAULT_STATE);
    const dayAgo = Date.now() - DAY_MS;
    state.entries = state.entries.filter((e) => e.timestamp > dayAgo);
    state.entries.push({ timestamp: Date.now() });
    await store.set(key, JSON.stringify(state));
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
}
