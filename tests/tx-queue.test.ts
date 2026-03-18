/**
 * Tests for tx-queue.ts — serialized nonce management for concurrent agents.
 */

import { describe, it, expect, vi } from "vitest";
import { createTxQueue, type TxResult } from "../tools/lib/tx-queue.js";

describe("createTxQueue", () => {
  // ── Basic Operations ──────────────────────────

  it("exports createTxQueue function", () => {
    expect(typeof createTxQueue).toBe("function");
  });

  it("creates queue with default nonce 0", () => {
    const queue = createTxQueue();
    expect(queue.currentNonce()).toBe(0);
  });

  it("creates queue with custom initial nonce", () => {
    const queue = createTxQueue({ initialNonce: 42 });
    expect(queue.currentNonce()).toBe(42);
  });

  it("reports 0 pending when idle", () => {
    const queue = createTxQueue();
    expect(queue.pending()).toBe(0);
  });

  // ── Nonce Management ──────────────────────────

  it("passes current nonce to transaction function", async () => {
    const queue = createTxQueue({ initialNonce: 10 });
    let receivedNonce = -1;

    await queue.enqueue(async (nonce) => {
      receivedNonce = nonce;
      return { success: true, txHash: "tx1", nonce };
    });

    expect(receivedNonce).toBe(10);
  });

  it("increments nonce after successful tx", async () => {
    const queue = createTxQueue({ initialNonce: 5 });

    await queue.enqueue(async (nonce) => ({ success: true, txHash: "tx1", nonce }));
    expect(queue.currentNonce()).toBe(6);

    await queue.enqueue(async (nonce) => ({ success: true, txHash: "tx2", nonce }));
    expect(queue.currentNonce()).toBe(7);
  });

  it("does not increment nonce after failed tx", async () => {
    const queue = createTxQueue({ initialNonce: 5 });

    await queue.enqueue(async (nonce) => ({ success: false, error: "broadcast failed", nonce }));
    expect(queue.currentNonce()).toBe(5);
  });

  it("resetNonce changes current nonce", () => {
    const queue = createTxQueue({ initialNonce: 0 });
    queue.resetNonce(100);
    expect(queue.currentNonce()).toBe(100);
  });

  // ── Serialization ─────────────────────────────

  it("serializes concurrent enqueue calls", async () => {
    const queue = createTxQueue({ initialNonce: 0 });
    const executionOrder: number[] = [];

    const p1 = queue.enqueue(async (nonce) => {
      await new Promise(r => setTimeout(r, 50));
      executionOrder.push(nonce);
      return { success: true, txHash: "tx1", nonce };
    });

    const p2 = queue.enqueue(async (nonce) => {
      executionOrder.push(nonce);
      return { success: true, txHash: "tx2", nonce };
    });

    const p3 = queue.enqueue(async (nonce) => {
      executionOrder.push(nonce);
      return { success: true, txHash: "tx3", nonce };
    });

    await Promise.all([p1, p2, p3]);

    // Should execute in order with incrementing nonces
    expect(executionOrder).toEqual([0, 1, 2]);
    expect(queue.currentNonce()).toBe(3);
  });

  it("each concurrent tx gets its own nonce", async () => {
    const queue = createTxQueue({ initialNonce: 10 });
    const nonces: number[] = [];

    const promises = Array.from({ length: 5 }, (_, i) =>
      queue.enqueue(async (nonce) => {
        nonces.push(nonce);
        return { success: true, txHash: `tx${i}`, nonce };
      }),
    );

    await Promise.all(promises);

    expect(nonces).toEqual([10, 11, 12, 13, 14]);
    expect(queue.currentNonce()).toBe(15);
  });

  it("failed tx in middle does not affect subsequent nonces", async () => {
    const queue = createTxQueue({ initialNonce: 0 });
    const results: TxResult[] = [];

    const p1 = queue.enqueue(async (nonce) => ({ success: true, txHash: "tx1", nonce }));
    const p2 = queue.enqueue(async (nonce) => ({ success: false, error: "rejected", nonce }));
    const p3 = queue.enqueue(async (nonce) => ({ success: true, txHash: "tx3", nonce }));

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    results.push(r1, r2, r3);

    // tx1 succeeds (nonce 0 → increment to 1)
    expect(r1.success).toBe(true);
    expect(r1.nonce).toBe(0);

    // tx2 fails (nonce 1 → stays at 1)
    expect(r2.success).toBe(false);
    expect(r2.nonce).toBe(1);

    // tx3 succeeds (nonce 1 → increment to 2)
    expect(r3.success).toBe(true);
    expect(r3.nonce).toBe(1);

    expect(queue.currentNonce()).toBe(2);
  });

  // ── Timeout ───────────────────────────────────

  it("times out slow transactions", async () => {
    const queue = createTxQueue({ initialNonce: 0, timeoutMs: 50 });

    const result = await queue.enqueue(async (nonce) => {
      await new Promise(r => setTimeout(r, 200));
      return { success: true, txHash: "slow-tx", nonce };
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
    expect(queue.currentNonce()).toBe(0); // nonce not incremented
  });

  // ── Error Handling ────────────────────────────

  it("catches thrown errors in transaction function", async () => {
    const queue = createTxQueue({ initialNonce: 0 });

    const result = await queue.enqueue(async () => {
      throw new Error("SDK connection lost");
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("SDK connection lost");
    expect(result.nonce).toBe(0);
    expect(queue.currentNonce()).toBe(0);
  });

  it("queue continues working after error", async () => {
    const queue = createTxQueue({ initialNonce: 0 });

    // First tx throws
    await queue.enqueue(async () => {
      throw new Error("crash");
    });

    // Second tx should still work
    const result = await queue.enqueue(async (nonce) => ({
      success: true,
      txHash: "recovery-tx",
      nonce,
    }));

    expect(result.success).toBe(true);
    expect(result.nonce).toBe(0);
    expect(queue.currentNonce()).toBe(1);
  });
});
