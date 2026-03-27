/**
 * Pay spend cap — rolling 24h cumulative cap for D402 payments.
 *
 * Per wallet address, NOT per session. Cap does NOT reset on connect()
 * or process restart. File-persisted with timestamps.
 */

import { randomUUID } from "node:crypto";
import type { StateStore, DemosError, PayPolicy } from "../types.js";
import { demosError } from "../types.js";
import { stateKey, checkAndAppend, appendEntry, loadState, GUARD_LOCK_TTL_MS, DAY_MS } from "./state-helpers.js";

interface PayEntry {
  timestamp: number;
  amount: number;
  url: string;
  reservationId?: string;
}

interface PaySpendState {
  entries: PayEntry[];
}

const DEFAULT_STATE: PaySpendState = { entries: [] };

/** @deprecated Use reservePaySpend() for atomic check-reserve-rollback */
export async function checkPaySpendCap(
  store: StateStore,
  walletAddress: string,
  amount: number,
  policy: Required<PayPolicy>,
): Promise<DemosError | null> {
  // Validate input before any comparison (NaN > X is always false, would bypass maxPerCall)
  if (!Number.isFinite(amount) || amount <= 0) {
    return demosError("INVALID_INPUT", "Payment amount must be a positive finite number", false);
  }

  // Per-call max (no lock needed)
  if (amount > policy.maxPerCall) {
    return demosError(
      "SPEND_LIMIT",
      `Payment ${amount} DEM exceeds per-call max ${policy.maxPerCall} DEM`,
      false,
    );
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

/** @deprecated Use reservePaySpend() for atomic check-reserve-rollback */
export async function recordPayment(
  store: StateStore,
  walletAddress: string,
  amount: number,
  url: string,
): Promise<void> {
  const key = stateKey("pay-spend", walletAddress);
  await appendEntry<PaySpendState, PayEntry>(
    store, key, DEFAULT_STATE, DAY_MS,
    { timestamp: Date.now(), amount, url },
  );
}

/**
 * Atomically check spend cap AND reserve the amount in one lock acquisition.
 *
 * reservePaySpend intentionally diverges from checkAndRecord* — atomic reservation
 * with rollback for settlement failure. D402 payments need the amount reserved during
 * the settlement window, then rolled back if settlement fails.
 *
 * Returns the unlock function — caller MUST call rollback on settlement failure
 * or confirm after successful settlement. This keeps the lock held during settlement
 * to prevent race conditions between concurrent pay() calls.
 */
export async function reservePaySpend(
  store: StateStore,
  walletAddress: string,
  amount: number,
  url: string,
  policy: Required<PayPolicy>,
): Promise<{ error: DemosError | null; rollback: () => Promise<void> }> {
  // Validate finiteness first (NaN > X is always false — would bypass maxPerCall)
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      error: demosError("INVALID_INPUT", "Payment amount must be a positive finite number", false),
      rollback: async () => {},
    };
  }

  if (amount > policy.maxPerCall) {
    return {
      error: demosError("SPEND_LIMIT", `Payment ${amount} DEM exceeds per-call max ${policy.maxPerCall} DEM`, false),
      rollback: async () => {},
    };
  }

  const key = stateKey("pay-spend", walletAddress);
  const unlock = await store.lock(key, GUARD_LOCK_TTL_MS);

  try {
    const state = await loadState<PaySpendState>(store, key, DEFAULT_STATE);
    const now = Date.now();
    const dayAgo = now - DAY_MS;

    // Prune old entries
    state.entries = state.entries.filter((e) => e.timestamp > dayAgo);

    // Check cap
    const spent24h = state.entries.reduce((sum, e) => sum + e.amount, 0);
    if (spent24h + amount > policy.rolling24hCap) {
      await unlock();
      return {
        error: demosError(
          "SPEND_LIMIT",
          `Rolling 24h spend cap: ${spent24h.toFixed(1)}/${policy.rolling24hCap} DEM used, requested ${amount}`,
          false,
        ),
        rollback: async () => {},
      };
    }

    // Reserve: append entry with unique ID for collision-free rollback
    const resId = randomUUID();
    const entry: PayEntry = { timestamp: now, amount, url, reservationId: resId };
    state.entries.push(entry);
    await store.set(key, JSON.stringify(state));
    await unlock();

    const rollback = async () => {
      const rollbackUnlock = await store.lock(key, GUARD_LOCK_TTL_MS);
      try {
        const current = await loadState<PaySpendState>(store, key, DEFAULT_STATE);
        const idx = current.entries.findIndex((e) => e.reservationId === resId);
        if (idx !== -1) {
          current.entries.splice(idx, 1);
          await store.set(key, JSON.stringify(current));
        }
      } finally {
        await rollbackUnlock();
      }
    };

    return { error: null, rollback };
  } catch (e) {
    await unlock();
    throw e;
  }
}
