/**
 * Tests for core toolkit types and helper functions.
 *
 * Focuses on behavioral contracts, not construction tautologies.
 */

import { describe, it, expect } from "vitest";
import { ok, err, demosError } from "../../src/toolkit/types.js";
import type {
  DemosErrorCode,
  ToolResult,
  StateStore,
  Unlock,
} from "../../src/toolkit/types.js";

describe("demosError helper", () => {
  it("creates error with all required fields", () => {
    const error = demosError("AUTH_FAILED", "Bad token", false);
    expect(error.code).toBe("AUTH_FAILED");
    expect(error.message).toBe("Bad token");
    expect(error.retryable).toBe(false);
    expect(error.detail).toBeUndefined();
  });

  it("includes detail when provided", () => {
    const error = demosError("TX_FAILED", "broadcast error", false, {
      step: "confirm",
      txHash: "0xabc",
      partialData: { foo: "bar" },
    });
    expect(error.detail!.step).toBe("confirm");
    expect(error.detail!.txHash).toBe("0xabc");
    expect(error.detail!.partialData).toEqual({ foo: "bar" });
  });

  it("omits detail field entirely when not provided", () => {
    const error = demosError("RATE_LIMITED", "test", true);
    expect("detail" in error).toBe(false);
  });
});

describe("ok helper", () => {
  it("creates success result with data and provenance", () => {
    const result = ok({ txHash: "0x123" }, { path: "local" as const, latencyMs: 42 });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ txHash: "0x123" });
    expect(result.error).toBeUndefined();
    expect(result.provenance.path).toBe("local");
    expect(result.provenance.latencyMs).toBe(42);
  });

  it("includes attestation in provenance when provided", () => {
    const result = ok("test", {
      path: "local" as const,
      latencyMs: 50,
      attestation: { txHash: "0xabc", responseHash: "0xdef" },
    });
    expect(result.provenance.attestation!.txHash).toBe("0xabc");
    expect(result.provenance.attestation!.responseHash).toBe("0xdef");
  });
});

describe("err helper", () => {
  it("creates failure result with error and no data", () => {
    const error = demosError("NETWORK_ERROR", "timeout", true);
    const result = err(error, { path: "local" as const, latencyMs: 500 });
    expect(result.ok).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.error!.code).toBe("NETWORK_ERROR");
    expect(result.error!.retryable).toBe(true);
  });
});

describe("DemosErrorCode coverage", () => {
  it("all 10 error codes are distinct values", () => {
    const codes: DemosErrorCode[] = [
      "RATE_LIMITED", "AUTH_FAILED", "ATTEST_FAILED", "TX_FAILED",
      "CONFIRM_TIMEOUT", "DUPLICATE", "INVALID_INPUT", "NETWORK_ERROR",
      "SPEND_LIMIT", "PARTIAL_SUCCESS",
    ];
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });

  it("each code can be used in demosError", () => {
    const codes: DemosErrorCode[] = [
      "RATE_LIMITED", "AUTH_FAILED", "ATTEST_FAILED", "TX_FAILED",
      "CONFIRM_TIMEOUT", "DUPLICATE", "INVALID_INPUT", "NETWORK_ERROR",
      "SPEND_LIMIT", "PARTIAL_SUCCESS",
    ];
    for (const code of codes) {
      const error = demosError(code, `test ${code}`, code === "RATE_LIMITED");
      expect(error.code).toBe(code);
    }
  });
});

describe("StateStore interface contract", () => {
  it("mock implementation satisfies interface", async () => {
    const store: StateStore = {
      get: async (key: string) => key === "exists" ? "value" : null,
      set: async (_key: string, _value: string) => {},
      lock: async (_key: string, _ttlMs: number): Promise<Unlock> => async () => {},
    };

    expect(await store.get("exists")).toBe("value");
    expect(await store.get("missing")).toBeNull();

    const unlock = await store.lock("key", 5000);
    expect(typeof unlock).toBe("function");
    await unlock();
  });
});
