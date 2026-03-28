/**
 * Tests for tip() chain-first recipient resolution.
 *
 * Chain-first: tip uses bridge.resolvePostAuthor (getTxByHash on-chain).
 * No feed API fallback — resolution is entirely on-chain.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DemosSession } from "../../../src/toolkit/session.js";
import { FileStateStore } from "../../../src/toolkit/state-store.js";
import type { SdkBridge, D402SettlementResult, ApiCallResult } from "../../../src/toolkit/sdk-bridge.js";
import { tip } from "../../../src/toolkit/tools/tip.js";

// ── Helpers ──────────────────────────────────────────

function mockBridge(overrides?: Partial<SdkBridge>): SdkBridge {
  return {
    attestDahr: vi.fn(async () => ({ responseHash: "h", txHash: "t", data: {}, url: "" })),
    apiCall: vi.fn(async (): Promise<ApiCallResult> => ({ ok: false, status: 0, data: "chain-only mode" })),
    publishHivePost: vi.fn(async () => ({ txHash: "p" })),
    transferDem: vi.fn(async () => ({ txHash: "tip-tx-123" })),
    getDemos: vi.fn(() => ({} as any)),
    payD402: vi.fn(async (): Promise<D402SettlementResult> => ({ success: true, hash: "d" })),
    apiAccess: "none" as const,
    verifyTransaction: vi.fn(async () => ({ confirmed: true, blockNumber: 42, from: "demos1a" })),
    getHivePosts: vi.fn(async () => []),
    resolvePostAuthor: vi.fn(async () => "demos1author"),
    publishHiveReaction: vi.fn(async () => ({ txHash: "r" })),
    ...overrides,
  };
}

function createSession(tempDir: string, bridge: SdkBridge) {
  return new DemosSession({
    walletAddress: "demos1tiptest",
    rpcUrl: "https://demosnode.discus.sh",
    algorithm: "falcon",
    authToken: "test-token",
    signingHandle: { demos: {}, bridge },
    stateStore: new FileStateStore(tempDir),
    tipPolicy: { maxPerTip: 10, maxPerPost: 5, cooldownMs: 0 },
  });
}

const TARGET_TX_HASH = "AABBCCDD1122334455667788";
const CHAIN_AUTHOR = "demos1chain_resolved_author";

// ── Tests ────────────────────────────────────────────

describe("tip() chain-first recipient resolution", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "demos-tip-chain-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("resolves author from chain via resolvePostAuthor", async () => {
    const bridge = mockBridge({
      resolvePostAuthor: vi.fn(async () => CHAIN_AUTHOR),
    });
    const session = createSession(tempDir, bridge);

    const result = await tip(session, { txHash: TARGET_TX_HASH, amount: 2 });

    expect(result.ok).toBe(true);
    expect(bridge.transferDem).toHaveBeenCalledWith(
      CHAIN_AUTHOR,
      2,
      expect.stringContaining(TARGET_TX_HASH),
    );
    // Feed API must NOT be called — chain-first
    expect(bridge.apiCall).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT when chain resolution fails", async () => {
    const bridge = mockBridge({
      resolvePostAuthor: vi.fn(async () => null),
    });
    const session = createSession(tempDir, bridge);

    const result = await tip(session, { txHash: TARGET_TX_HASH, amount: 2 });

    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
    expect(result.error!.message).toContain("not found on chain");
    expect(bridge.transferDem).not.toHaveBeenCalled();
  });

  it("does not fall back to feed API when chain fails", async () => {
    const bridge = mockBridge({
      resolvePostAuthor: vi.fn(async () => null),
    });
    const session = createSession(tempDir, bridge);

    await tip(session, { txHash: TARGET_TX_HASH, amount: 2 });

    // apiCall must NEVER be called for tip resolution
    expect(bridge.apiCall).not.toHaveBeenCalled();
  });

  it("transfers correct amount and memo", async () => {
    const bridge = mockBridge({
      resolvePostAuthor: vi.fn(async () => CHAIN_AUTHOR),
    });
    const session = createSession(tempDir, bridge);

    await tip(session, { txHash: TARGET_TX_HASH, amount: 5 });

    expect(bridge.transferDem).toHaveBeenCalledWith(
      CHAIN_AUTHOR,
      5,
      `HIVE_TIP:${TARGET_TX_HASH}`,
    );
  });
});
