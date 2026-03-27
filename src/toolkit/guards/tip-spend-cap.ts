/**
 * Tip spend cap — enforces per-tip, per-post, and cooldown limits.
 *
 * Defaults: max 10 DEM/tip, max 5 tips/post, 1-min cooldown.
 * Wallet-scoped, StateStore-backed with exclusive locking.
 */

import type { StateStore, DemosError, TipPolicy } from "../types.js";
import { demosError } from "../types.js";
import { stateKey, checkAndAppend } from "./state-helpers.js";

const DAY_MS = 24 * 60 * 60 * 1000;

interface TipEntry {
  timestamp: number;
  postTxHash: string;
  amount: number;
}

interface TipState {
  entries: TipEntry[];
}

const DEFAULT_STATE: TipState = { entries: [] };

/** Check if a tip is allowed and optionally record it */
export async function checkAndRecordTip(
  store: StateStore,
  walletAddress: string,
  postTxHash: string,
  amount: number,
  policy: Required<TipPolicy>,
  record: boolean = false,
): Promise<DemosError | null> {
  // Per-tip max (no lock needed)
  if (amount > policy.maxPerTip) {
    return demosError(
      "SPEND_LIMIT",
      `Tip amount ${amount} exceeds max ${policy.maxPerTip} DEM per tip`,
      false,
    );
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return demosError("INVALID_INPUT", "Tip amount must be a positive finite number", false);
  }

  const key = stateKey("tip-spend", walletAddress);
  const { error } = await checkAndAppend<TipState, TipEntry>(
    store,
    key,
    DEFAULT_STATE,
    DAY_MS,
    (state, now) => {
      // Per-post cap
      const tipsForPost = state.entries.filter((e) => e.postTxHash === postTxHash);
      if (tipsForPost.length >= policy.maxPerPost) {
        return `Max ${policy.maxPerPost} tips per post reached`;
      }

      // Cooldown — find most recent tip via linear scan
      let lastTimestamp = 0;
      for (const e of state.entries) {
        if (e.timestamp > lastTimestamp) lastTimestamp = e.timestamp;
      }

      if (lastTimestamp > 0 && now - lastTimestamp < policy.cooldownMs) {
        const remaining = Math.ceil((policy.cooldownMs - (now - lastTimestamp)) / 1000);
        return `Tip cooldown: ${remaining}s remaining`;
      }

      return null;
    },
    record ? { timestamp: Date.now(), postTxHash, amount } : undefined,
  );

  if (error) {
    // Distinguish rate-limited (cooldown) from spend-limit (per-post cap)
    const code = error.includes("cooldown") ? "RATE_LIMITED" : "SPEND_LIMIT";
    return demosError(code, error, code === "RATE_LIMITED");
  }
  return null;
}

/** Check if a tip is allowed (backward compat) */
export async function checkTipSpendCap(
  store: StateStore,
  walletAddress: string,
  postTxHash: string,
  amount: number,
  policy: Required<TipPolicy>,
): Promise<DemosError | null> {
  return checkAndRecordTip(store, walletAddress, postTxHash, amount, policy, false);
}

/** Record a successful tip (backward compat) */
export async function recordTip(
  store: StateStore,
  walletAddress: string,
  postTxHash: string,
  amount: number,
): Promise<void> {
  const key = stateKey("tip-spend", walletAddress);
  await checkAndAppend<TipState, TipEntry>(
    store, key, DEFAULT_STATE, DAY_MS,
    () => null, // always allowed — unconditional record
    { timestamp: Date.now(), postTxHash, amount },
  );
}
