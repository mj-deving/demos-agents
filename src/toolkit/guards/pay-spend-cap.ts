/**
 * Pay spend cap — rolling 24h cumulative cap for D402 payments.
 *
 * Per wallet address, NOT per session. Cap does NOT reset on connect()
 * or process restart. File-persisted with timestamps.
 */

import type { StateStore, DemosError, PayPolicy } from "../types.js";
import { demosError } from "../types.js";
import { stateKey, loadState, checkAndAppend, GUARD_LOCK_TTL_MS } from "./state-helpers.js";

const DAY_MS = 24 * 60 * 60 * 1000;

interface PayEntry {
  timestamp: number;
  amount: number;
  url: string;
}

interface PaySpendState {
  entries: PayEntry[];
}

const DEFAULT_STATE: PaySpendState = { entries: [] };

/** Check if a payment is allowed */
export async function checkPaySpendCap(
  store: StateStore,
  walletAddress: string,
  amount: number,
  policy: Required<PayPolicy>,
): Promise<DemosError | null> {
  // Per-call max (no lock needed)
  if (amount > policy.maxPerCall) {
    return demosError(
      "SPEND_LIMIT",
      `Payment ${amount} DEM exceeds per-call max ${policy.maxPerCall} DEM`,
      false,
    );
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return demosError("INVALID_INPUT", "Payment amount must be a positive finite number", false);
  }

  const key = stateKey("pay-spend", walletAddress);
  const { error } = await checkAndAppend<PaySpendState, PayEntry>(
    store,
    key,
    DEFAULT_STATE,
    DAY_MS,
    (state) => {
      const spent24h = state.entries.reduce((sum, e) => sum + e.amount, 0);
      if (spent24h + amount > policy.rolling24hCap) {
        return `Rolling 24h spend cap: ${spent24h.toFixed(1)}/${policy.rolling24hCap} DEM used, requested ${amount}`;
      }
      return null;
    },
  );

  return error ? demosError("SPEND_LIMIT", error, false) : null;
}

/** Record a successful payment */
export async function recordPayment(
  store: StateStore,
  walletAddress: string,
  amount: number,
  url: string,
): Promise<void> {
  const key = stateKey("pay-spend", walletAddress);
  const unlock = await store.lock(key, GUARD_LOCK_TTL_MS);
  try {
    const state = await loadState<PaySpendState>(store, key, DEFAULT_STATE);
    const dayAgo = Date.now() - DAY_MS;
    state.entries = state.entries.filter((e) => e.timestamp > dayAgo);
    state.entries.push({ timestamp: Date.now(), amount, url });
    await store.set(key, JSON.stringify(state));
  } finally {
    await unlock();
  }
}
