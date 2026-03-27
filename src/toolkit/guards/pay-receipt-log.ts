/**
 * Pay receipt log — persists payment records to prevent duplicates after crash.
 *
 * Idempotency key: hash(url + method + bodyHash).
 */

import { createHash } from "node:crypto";
import type { StateStore } from "../types.js";
import { stateKey, loadState, GUARD_LOCK_TTL_MS } from "./state-helpers.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface PayReceipt {
  txHash: string;
  url: string;
  amount: number;
  timestamp: number;
  idempotencyKey: string;
}

interface ReceiptLogState {
  receipts: PayReceipt[];
}

const DEFAULT_STATE: ReceiptLogState = { receipts: [] };

/** Generate idempotency key from request details */
export function makeIdempotencyKey(
  url: string,
  method?: string,
  body?: unknown,
): string {
  const bodyHash = body ? createHash("sha256").update(JSON.stringify(body)).digest("hex") : "";
  return createHash("sha256")
    .update(`${url}:${method ?? "GET"}:${bodyHash}`)
    .digest("hex");
}

/** Check if a payment was already made (by idempotency key) — acquires lock for consistency */
export async function checkPayReceipt(
  store: StateStore,
  walletAddress: string,
  idempotencyKey: string,
): Promise<PayReceipt | null> {
  const key = stateKey("pay-receipts", walletAddress);
  const unlock = await store.lock(key, GUARD_LOCK_TTL_MS);
  try {
    const state = await loadState<ReceiptLogState>(store, key, DEFAULT_STATE);
    return state.receipts.find((r) => r.idempotencyKey === idempotencyKey) ?? null;
  } finally {
    await unlock();
  }
}

/** Record a payment receipt */
export async function recordPayReceipt(
  store: StateStore,
  walletAddress: string,
  receipt: PayReceipt,
): Promise<void> {
  const key = stateKey("pay-receipts", walletAddress);
  const unlock = await store.lock(key, GUARD_LOCK_TTL_MS);
  try {
    const state = await loadState<ReceiptLogState>(store, key, DEFAULT_STATE);
    const weekAgo = Date.now() - WEEK_MS;
    state.receipts = state.receipts.filter((r) => r.timestamp > weekAgo);
    state.receipts.push(receipt);
    await store.set(key, JSON.stringify(state));
  } finally {
    await unlock();
  }
}
