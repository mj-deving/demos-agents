import { describe, expect, it, vi } from "vitest";

import { executeChainTx } from "../../../src/toolkit/chain/tx-pipeline.js";

describe("executeChainTx", () => {
  it("always broadcasts after successful confirm", async () => {
    const calls: string[] = [];
    const pipeline = {
      store: vi.fn(async (payload: Uint8Array) => {
        calls.push(`store:${payload.length}`);
        return { signed: true };
      }),
      confirm: vi.fn(async () => {
        calls.push("confirm");
        return { txHash: "0xabc", blockNumber: 42 };
      }),
      broadcast: vi.fn(async () => {
        calls.push("broadcast");
        return { ok: true };
      }),
    };

    const result = await executeChainTx(pipeline, new Uint8Array([1, 2, 3]));

    expect(calls).toEqual(["store:3", "confirm", "broadcast"]);
    expect(pipeline.broadcast).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ txHash: "0xabc", blockNumber: 42 });
  });

  it("does not broadcast if confirm fails", async () => {
    const pipeline = {
      store: vi.fn(async () => ({ signed: true })),
      confirm: vi.fn(async () => {
        throw new Error("confirm failed");
      }),
      broadcast: vi.fn(async () => ({ ok: true })),
    };

    await expect(executeChainTx(pipeline, { id: 1 })).rejects.toThrow("confirm failed");
    expect(pipeline.broadcast).not.toHaveBeenCalled();
  });

  it("returns the txHash from the confirm step", async () => {
    const pipeline = {
      store: vi.fn(async () => ({ signed: true })),
      confirm: vi.fn(async () => ({
        response: {
          data: {
            transaction: {
              hash: "confirm-hash",
              blockNumber: 99,
            },
          },
        },
      })),
      broadcast: vi.fn(async () => ({
        response: { results: { tx1: { hash: "broadcast-hash" } } },
      })),
    };

    const result = await executeChainTx(pipeline, { encoded: "payload" });
    expect(result).toEqual({ txHash: "confirm-hash", blockNumber: 99 });
  });

  it.each([
    ["store", "store failed"],
    ["confirm", "confirm failed"],
    ["broadcast", "broadcast failed"],
  ] as const)("propagates %s-stage errors", async (stage, message) => {
    const pipeline = {
      store: vi.fn(async () => {
        if (stage === "store") throw new Error(message);
        return { signed: true };
      }),
      confirm: vi.fn(async () => {
        if (stage === "confirm") throw new Error(message);
        return { txHash: "0xabc" };
      }),
      broadcast: vi.fn(async () => {
        if (stage === "broadcast") throw new Error(message);
        return { ok: true };
      }),
    };

    await expect(executeChainTx(pipeline, { id: "same-input" })).rejects.toThrow(message);
  });

  it("is idempotent for deterministic stage implementations", async () => {
    const pipeline = {
      store: vi.fn(async (payload: { id: string }) => ({ stored: payload.id })),
      confirm: vi.fn(async (stored: { stored: string }) => ({ txHash: `tx:${stored.stored}` })),
      broadcast: vi.fn(async () => ({ ok: true })),
    };

    const payload = { id: "abc" };
    const first = await executeChainTx(pipeline, payload);
    const second = await executeChainTx(pipeline, payload);

    expect(first).toEqual({ txHash: "tx:abc" });
    expect(second).toEqual({ txHash: "tx:abc" });
  });
});
