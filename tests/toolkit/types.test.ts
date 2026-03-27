/**
 * Tests for core toolkit types and helper functions.
 */

import { describe, it, expect } from "vitest";
import {
  ok,
  err,
  demosError,
} from "../../src/toolkit/types.js";
import type {
  DemosError,
  DemosErrorCode,
  ToolResult,
  Provenance,
  StateStore,
  Unlock,
  ConnectOptions,
  PublishDraft,
  ReactOptions,
  TipOptions,
  VerifyOptions,
  AttestOptions,
  PayOptions,
  DiscoverSourcesOptions,
} from "../../src/toolkit/types.js";

describe("DemosError", () => {
  it("has typed code union of 9 error codes", () => {
    const codes: DemosErrorCode[] = [
      "RATE_LIMITED",
      "AUTH_FAILED",
      "ATTEST_FAILED",
      "TX_FAILED",
      "CONFIRM_TIMEOUT",
      "DUPLICATE",
      "INVALID_INPUT",
      "NETWORK_ERROR",
      "SPEND_LIMIT",
      "PARTIAL_SUCCESS",
    ];
    // 10 codes total (9 + PARTIAL_SUCCESS from the design doc)
    expect(codes).toHaveLength(10);
  });

  it("has retryable boolean field", () => {
    const error = demosError("RATE_LIMITED", "test", true);
    expect(typeof error.retryable).toBe("boolean");
    expect(error.retryable).toBe(true);
  });

  it("has optional detail with step, txHash, partialData", () => {
    const error = demosError("TX_FAILED", "test", false, {
      step: "confirm",
      txHash: "0xabc",
      partialData: { foo: "bar" },
    });
    expect(error.detail).toBeDefined();
    expect(error.detail!.step).toBe("confirm");
    expect(error.detail!.txHash).toBe("0xabc");
    expect(error.detail!.partialData).toEqual({ foo: "bar" });
  });

  it("omits detail when not provided", () => {
    const error = demosError("RATE_LIMITED", "test", true);
    expect(error.detail).toBeUndefined();
  });
});

describe("ToolResult", () => {
  it("has ok, data, error, provenance fields", () => {
    const provenance: Provenance = { path: "local", latencyMs: 42 };
    const success = ok({ txHash: "0x123" }, provenance);

    expect(success.ok).toBe(true);
    expect(success.data).toEqual({ txHash: "0x123" });
    expect(success.error).toBeUndefined();
    expect(success.provenance).toBeDefined();
  });

  it("provenance includes path and latencyMs", () => {
    const result = ok("test", { path: "local" as const, latencyMs: 100 });
    expect(result.provenance.path).toBe("local");
    expect(result.provenance.latencyMs).toBe(100);
  });

  it("provenance includes optional attestation metadata", () => {
    const result = ok("test", {
      path: "local",
      latencyMs: 50,
      attestation: { txHash: "0xabc", responseHash: "0xdef" },
    });
    expect(result.provenance.attestation).toBeDefined();
    expect(result.provenance.attestation!.txHash).toBe("0xabc");
    expect(result.provenance.attestation!.responseHash).toBe("0xdef");
  });

  it("error result has ok=false and error field", () => {
    const error = demosError("NETWORK_ERROR", "timeout", true);
    const result = err(error, { path: "local", latencyMs: 500 });

    expect(result.ok).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("NETWORK_ERROR");
  });
});

describe("demosError helper", () => {
  it("creates error with all required fields", () => {
    const error = demosError("AUTH_FAILED", "Bad token", false);
    expect(error.code).toBe("AUTH_FAILED");
    expect(error.message).toBe("Bad token");
    expect(error.retryable).toBe(false);
  });
});

describe("Type contracts (compile-time verification)", () => {
  it("StateStore interface has get, set, lock methods", () => {
    // Type-level test: verify the interface shape compiles
    const mockStore: StateStore = {
      get: async (_key: string) => null,
      set: async (_key: string, _value: string) => {},
      lock: async (_key: string, _ttlMs: number): Promise<Unlock> => {
        return async () => {};
      },
    };
    expect(mockStore.get).toBeDefined();
    expect(mockStore.set).toBeDefined();
    expect(mockStore.lock).toBeDefined();
  });

  it("ConnectOptions requires walletPath", () => {
    const opts: ConnectOptions = { walletPath: "/path/to/wallet" };
    expect(opts.walletPath).toBe("/path/to/wallet");
  });

  it("PublishDraft requires text and category", () => {
    const draft: PublishDraft = { text: "hello", category: "ANALYSIS" };
    expect(draft.text).toBe("hello");
    expect(draft.category).toBe("ANALYSIS");
  });

  it("PayOptions requires maxSpend", () => {
    const opts: PayOptions = { url: "https://example.com", maxSpend: 10 };
    expect(opts.maxSpend).toBe(10);
  });
});
