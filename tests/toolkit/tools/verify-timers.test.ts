/**
 * Tests for verify() with mocked sleep — no real delays.
 *
 * Mocks the sleep function from state-helpers to avoid 3/5/10s waits.
 * Tests retry logic and chain-first confirmation behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DemosSession } from "../../../src/toolkit/session.js";
import { FileStateStore } from "../../../src/toolkit/state-store.js";
import type { SdkBridge, ApiCallResult, D402SettlementResult } from "../../../src/toolkit/sdk-bridge.js";

// Mock sleep to be instant
vi.mock("../../../src/toolkit/guards/state-helpers.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/toolkit/guards/state-helpers.js")>();
  return {
    ...original,
    sleep: vi.fn().mockResolvedValue(undefined),
  };
});

// Import verify AFTER mock setup
const { verify } = await import("../../../src/toolkit/tools/verify.js");
const { sleep } = await import("../../../src/toolkit/guards/state-helpers.js");

type VerifyResult = { confirmed: boolean; blockNumber?: number; from?: string } | null;

function createMockBridge(verifyFn: (txHash: string) => Promise<VerifyResult>): SdkBridge {
  return {
    attestDahr: vi.fn(),
    apiCall: vi.fn(async (): Promise<ApiCallResult> => ({ ok: false, status: 0, data: "chain-only mode" })),
    publishHivePost: vi.fn(),
    transferDem: vi.fn(),
    payD402: vi.fn(async (): Promise<D402SettlementResult> => ({ success: true, hash: "d" })),
    getDemos: vi.fn() as unknown as SdkBridge["getDemos"],
    apiAccess: "none" as const,
    verifyTransaction: verifyFn,
    getHivePosts: vi.fn(async () => []),
    resolvePostAuthor: vi.fn(async () => null),
    publishHiveReaction: vi.fn(async () => ({ txHash: "r" })),
  };
}

function createTestSession(tempDir: string, bridge: SdkBridge) {
  return new DemosSession({
    walletAddress: "demos1verify",
    rpcUrl: "https://demosnode.discus.sh",
    algorithm: "falcon",
    authToken: "test-token",
    signingHandle: { bridge },
    stateStore: new FileStateStore(tempDir),
  });
}

describe("verify() timer behavior", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "demos-verify-timer-"));
    vi.mocked(sleep).mockClear();
  });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it("returns confirmed on first attempt without retries", async () => {
    const bridge = createMockBridge(async () => ({
      confirmed: true,
      blockNumber: 42,
      from: "demos1author",
    }));

    const session = createTestSession(tempDir, bridge);
    const result = await verify(session, { txHash: "0xfound" });

    expect(result.ok).toBe(true);
    expect(result.data!.confirmed).toBe(true);
    expect(result.data!.blockHeight).toBe(42);
    // No retries needed — sleep should not be called
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries and returns unconfirmed when tx not found on chain", async () => {
    const bridge = createMockBridge(async () => null);

    const session = createTestSession(tempDir, bridge);
    const result = await verify(session, { txHash: "0xmissing" });

    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("CONFIRM_TIMEOUT");
    expect(result.error!.message).toContain("not confirmed");
    // Should have retried 3 times (delays at attempts 1, 2, 3)
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it("retries on RPC error and returns timeout", async () => {
    const bridge = createMockBridge(async () => {
      throw new Error("RPC connection refused");
    });

    const session = createTestSession(tempDir, bridge);
    const result = await verify(session, { txHash: "0xfail" });

    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("CONFIRM_TIMEOUT");
    expect(result.error!.message).toContain("retries");
    // Should have retried with sleep calls
    expect(sleep).toHaveBeenCalled();
  });

  it("succeeds on retry after initial miss", async () => {
    let callCount = 0;
    const bridge = createMockBridge(async () => {
      callCount++;
      if (callCount <= 2) return null; // not found yet
      return { confirmed: true, blockNumber: 55, from: "demos1a" };
    });

    const session = createTestSession(tempDir, bridge);
    const result = await verify(session, { txHash: "0xlate" });

    expect(result.ok).toBe(true);
    expect(result.data!.confirmed).toBe(true);
    expect(result.data!.blockHeight).toBe(55);
    // Sleep called for retries before the successful attempt
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("passes correct retry delays to sleep", async () => {
    const bridge = createMockBridge(async () => ({
      confirmed: false,
      blockNumber: 0,
    }));

    const session = createTestSession(tempDir, bridge);
    await verify(session, { txHash: "0xnever" });

    expect(sleep).toHaveBeenCalledWith(3000);
    expect(sleep).toHaveBeenCalledWith(5000);
    expect(sleep).toHaveBeenCalledWith(10000);
  });

  it("returns blockHeight when confirmed", async () => {
    const bridge = createMockBridge(async () => ({
      confirmed: true,
      blockNumber: 12345,
      from: "demos1poster",
    }));

    const session = createTestSession(tempDir, bridge);
    const result = await verify(session, { txHash: "0xwithblock" });

    expect(result.ok).toBe(true);
    expect(result.data!.confirmed).toBe(true);
    expect(result.data!.blockHeight).toBe(12345);
  });
});
