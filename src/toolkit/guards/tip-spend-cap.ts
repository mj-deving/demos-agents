/**
 * Tip spend cap — enforces per-tip, per-post, and cooldown limits.
 *
 * Defaults: max 10 DEM/tip, max 5 tips/post, 1-min cooldown.
 * Wallet-scoped, StateStore-backed with exclusive locking.
 */

import type { StateStore, DemosError, TipPolicy } from "../types.js";
import { demosError } from "../types.js";
import { stateKey, checkAndAppend, appendEntry, DAY_MS } from "./state-helpers.js";

interface TipEntry {
  timestamp: number;
  postTxHash: string;
  amount: number;
}

interface TipState {
  entries: TipEntry[];
}

const DEFAULT_STATE: TipState = { entries: [] };
const MS_PER_SECOND = 1000;

/** Check if a tip is allowed and optionally record it */
export async function checkAndRecordTip(
  store: StateStore,
  walletAddress: string,
  postTxHash: string,
  amount: number,
  policy: Required<TipPolicy>,
  record: boolean = false,
): Promise<DemosError | null> {
  // Validate finiteness first (NaN > X is always false — would bypass maxPerTip)
  if (!Number.isFinite(amount) || amount <= 0) {
    return demosError("INVALID_INPUT", "Tip amount must be a positive finite number", false);
  }

  // Per-tip max (no lock needed)
  if (amount > policy.maxPerTip) {
    return demosError(
      "SPEND_LIMIT",
      `Tip amount ${amount} exceeds max ${policy.maxPerTip} DEM per tip`,
      false,
    );
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
        const remaining = Math.ceil((policy.cooldownMs - (now - lastTimestamp)) / MS_PER_SECOND);
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

/** @deprecated Use checkAndRecordTip() instead. Removal: v2.0 (2026-Q3). */
export async function checkTipSpendCap(
  store: StateStore,
  walletAddress: string,
  postTxHash: string,
  amount: number,
  policy: Required<TipPolicy>,
): Promise<DemosError | null> {
  return checkAndRecordTip(store, walletAddress, postTxHash, amount, policy, false);
}

/** @deprecated Use checkAndRecordTip() with record=true, or appendEntry() for record-only. Removal: v2.0 (2026-Q3). */
export async function recordTip(
  store: StateStore,
  walletAddress: string,
  postTxHash: string,
  amount: number,
): Promise<void> {
  const key = stateKey("tip-spend", walletAddress);
  await appendEntry<TipState, TipEntry>(
    store, key, DEFAULT_STATE, DAY_MS,
    { timestamp: Date.now(), postTxHash, amount },
  );
}
