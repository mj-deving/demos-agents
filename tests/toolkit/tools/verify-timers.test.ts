/**
 * Tests for verify() with mocked sleep — no real delays.
 *
 * Mocks the sleep function from state-helpers to avoid 3/5/10s waits.
 * Tests retry logic and confirmation behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DemosSession } from "../../../src/toolkit/session.js";
import { FileStateStore } from "../../../src/toolkit/state-store.js";
import type { SdkBridge, ApiCallResult } from "../../../src/toolkit/sdk-bridge.js";

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

function createMockBridge(apiCallFn: (path: string) => Promise<ApiCallResult>): SdkBridge {
  return {
    attestDahr: vi.fn(),
    apiCall: apiCallFn as SdkBridge["apiCall"],
    signAndBroadcast: vi.fn(),
    publishHivePost: vi.fn(),
    transferDem: vi.fn(),
    payD402: vi.fn(),
    getDemos: vi.fn() as unknown as SdkBridge["getDemos"],
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
      ok: true,
      status: 200,
      data: { posts: [{ txHash: "0xfound" }] },
    }));

    const session = createTestSession(tempDir, bridge);
    const result = await verify(session, { txHash: "0xfound" });

    expect(result.ok).toBe(true);
    expect(result.data!.confirmed).toBe(true);
    // No retries needed — sleep should not be called
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries and returns unconfirmed when post not found", async () => {
    const bridge = createMockBridge(async () => ({
      ok: true,
      status: 200,
      data: { posts: [{ txHash: "0xother" }] },
    }));

    const session = createTestSession(tempDir, bridge);
    const result = await verify(session, { txHash: "0xmissing" });

    expect(result.ok).toBe(true);
    expect(result.data!.confirmed).toBe(false);
    // Should have retried 3 times (delays at attempts 1, 2, 3)
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it("retries on API error and returns timeout", async () => {
    const bridge = createMockBridge(async () => ({
      ok: false,
      status: 500,
      data: "Internal Server Error",
    }));

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
      if (callCount <= 2) {
        return { ok: true, status: 200, data: { posts: [] } };
      }
      return { ok: true, status: 200, data: { posts: [{ txHash: "0xlate" }] } };
    });

    const session = createTestSession(tempDir, bridge);
    const result = await verify(session, { txHash: "0xlate" });

    expect(result.ok).toBe(true);
    expect(result.data!.confirmed).toBe(true);
    // Sleep called for retries before the successful attempt
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("passes correct retry delays to sleep", async () => {
    const bridge = createMockBridge(async () => ({
      ok: true,
      status: 200,
      data: { posts: [] },
    }));

    const session = createTestSession(tempDir, bridge);
    await verify(session, { txHash: "0xnever" });

    expect(sleep).toHaveBeenCalledWith(3000);
    expect(sleep).toHaveBeenCalledWith(5000);
    expect(sleep).toHaveBeenCalledWith(10000);
  });
});
