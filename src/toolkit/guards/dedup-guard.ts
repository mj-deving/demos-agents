/**
 * Dedup guard — prevents duplicate posts within a 24h window.
 *
 * Uses SHA-256 text hash for exact-match comparison.
 * No LLM in the guard layer — semantic dedup is the consumer's responsibility.
 */

import { createHash } from "node:crypto";
import type { StateStore, DemosError } from "../types.js";
import { demosError } from "../types.js";
import { stateKey, checkAndAppend, appendEntry, DAY_MS } from "./state-helpers.js";

interface DedupEntry {
  timestamp: number;
  hash: string;
}

interface DedupState {
  entries: DedupEntry[];
}

const DEFAULT_STATE: DedupState = { entries: [] };

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Check if text is a duplicate and optionally record it */
export async function checkAndRecordDedup(
  store: StateStore,
  walletAddress: string,
  text: string,
  record: boolean = false,
): Promise<DemosError | null> {
  const hash = hashText(text);
  const key = stateKey("dedup", walletAddress);
  const { error } = await checkAndAppend<DedupState, DedupEntry>(
    store,
    key,
    DEFAULT_STATE,
    DAY_MS,
    (state) => {
      const isDuplicate = state.entries.some((e) => e.hash === hash);
      return isDuplicate ? "Duplicate post detected within 24h window" : null;
    },
    record ? { timestamp: Date.now(), hash } : undefined,
  );

  return error ? demosError("DUPLICATE", error, false) : null;
}

/** @deprecated Use checkAndRecordDedup() instead. Removal: v2.0 (2026-Q3). */
export function checkDedup(
  store: StateStore,
  walletAddress: string,
  text: string,
): Promise<DemosError | null> {
  return checkAndRecordDedup(store, walletAddress, text, false);
}

/** @deprecated Use checkAndRecordDedup() with record=true, or appendEntry() for record-only. Removal: v2.0 (2026-Q3). */
export async function recordPublish(
  store: StateStore,
  walletAddress: string,
  text: string,
): Promise<void> {
  const hash = hashText(text);
  const key = stateKey("dedup", walletAddress);
  await appendEntry<DedupState, DedupEntry>(
    store, key, DEFAULT_STATE, DAY_MS,
    { timestamp: Date.now(), hash },
  );
}
