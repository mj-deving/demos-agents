/**
 * Direct test coverage for tip() tool.
 *
 * Tests: validation errors, spend cap exceeded, chain-first author resolution.
 * Chain-first: tip uses bridge.resolvePostAuthor (no feed fallback).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DemosSession } from "../../../src/toolkit/session.js";
import { FileStateStore } from "../../../src/toolkit/state-store.js";
import { tip } from "../../../src/toolkit/tools/tip.js";
import type { SdkBridge, ApiCallResult, D402SettlementResult } from "../../../src/toolkit/sdk-bridge.js";

// Mock tx-simulator — these tests focus on tip logic, not simulation
vi.mock("../../../src/toolkit/chain/tx-simulator.js", () => ({
  simulateTransaction: vi.fn(async () => ({ success: true })),
}));

// ── Helpers ──────────────────────────────────────────

const TARGET_TX = "AABBCCDD11223344DEADBEEF";
const AUTHOR_ADDR = "demos1postauthor";

function mockBridge(overrides?: Partial<SdkBridge>): SdkBridge {
  return {
    attestDahr: vi.fn(async () => ({ responseHash: "h", txHash: "t", data: {}, url: "" })),
    apiCall: vi.fn(async (): Promise<ApiCallResult> => ({ ok: false, status: 0, data: "chain-only mode" })),
    publishHivePost: vi.fn(async () => ({ txHash: "p" })),
    transferDem: vi.fn(async () => ({ txHash: "tip-result-hash" })),
    getDemos: vi.fn(() => ({}) as any),
    payD402: vi.fn(async (): Promise<D402SettlementResult> => ({ success: true, hash: "d" })),
    apiAccess: "none" as const,
    verifyTransaction: vi.fn(async () => ({ confirmed: true, blockNumber: 42, from: AUTHOR_ADDR })),
    getHivePosts: vi.fn(async () => []),
    resolvePostAuthor: vi.fn(async () => AUTHOR_ADDR),
    ...overrides,
  };
}

function createSession(tempDir: string, bridge: SdkBridge, tipPolicy?: { maxPerTip?: number; maxPerPost?: number; cooldownMs?: number }) {
  return new DemosSession({
    walletAddress: "demos1tiptest",
    rpcUrl: "https://demosnode.discus.sh",
    algorithm: "falcon",
    authToken: "test-token",
    signingHandle: { demos: {}, bridge },
    stateStore: new FileStateStore(tempDir),
    tipPolicy: tipPolicy ?? { maxPerTip: 10, maxPerPost: 5, cooldownMs: 0 },
  });
}

// ── Tests ────────────────────────────────────────────

describe("tip() direct tests", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "demos-tip-direct-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("validation error case", () => {
    it("returns INVALID_INPUT when txHash is empty", async () => {
      const bridge = mockBridge();
      const session = createSession(tempDir, bridge);

      const result = await tip(session, { txHash: "", amount: 2 });

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe("INVALID_INPUT");
      expect(result.error!.retryable).toBe(false);
    });

    it("returns INVALID_INPUT when txHash is whitespace only", async () => {
      const bridge = mockBridge();
      const session = createSession(tempDir, bridge);

      const result = await tip(session, { txHash: "   ", amount: 2 });

      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe("INVALID_INPUT");
    });

    it("returns INVALID_INPUT when amount is zero", async () => {
      const bridge = mockBridge();
      const session = createSession(tempDir, bridge);

      const result = await tip(session, { txHash: TARGET_TX, amount: 0 });

      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe("INVALID_INPUT");
    });

    it("returns INVALID_INPUT when amount is negative", async () => {
      const bridge = mockBridge();
      const session = createSession(tempDir, bridge);

      const result = await tip(session, { txHash: TARGET_TX, amount: -5 });

      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe("INVALID_INPUT");
    });

    it("returns INVALID_INPUT when amount is NaN", async () => {
      const bridge = mockBridge();
      const session = createSession(tempDir, bridge);

      const result = await tip(session, { txHash: TARGET_TX, amount: NaN });

      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe("INVALID_INPUT");
    });
  });

  describe("spend cap exceeded", () => {
    it("returns SPEND_LIMIT when amount exceeds maxPerTip", async () => {
      const bridge = mockBridge();
      const session = createSession(tempDir, bridge, { maxPerTip: 5, maxPerPost: 10, cooldownMs: 0 });

      const result = await tip(session, { txHash: TARGET_TX, amount: 6 });

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe("SPEND_LIMIT");
      expect(result.error!.message).toContain("5");
      expect(bridge.transferDem).not.toHaveBeenCalled();
    });

    it("returns SPEND_LIMIT when per-post tip count exceeded", async () => {
      const bridge = mockBridge();
      // Allow only 2 tips per post
      const session = createSession(tempDir, bridge, { maxPerTip: 10, maxPerPost: 2, cooldownMs: 0 });

      // First two tips should succeed
      const r1 = await tip(session, { txHash: TARGET_TX, amount: 1 });
      expect(r1.ok).toBe(true);
      const r2 = await tip(session, { txHash: TARGET_TX, amount: 1 });
      expect(r2.ok).toBe(true);

      // Third tip should be blocked
      const r3 = await tip(session, { txHash: TARGET_TX, amount: 1 });
      expect(r3.ok).toBe(false);
      expect(r3.error!.code).toBe("SPEND_LIMIT");
      expect(r3.error!.message).toContain("2");
    });
  });

  describe("success with chain-first resolution", () => {
    it("tips successfully using resolvePostAuthor", async () => {
      const bridge = mockBridge({
        resolvePostAuthor: vi.fn(async () => AUTHOR_ADDR),
      });
      const session = createSession(tempDir, bridge);

      const result = await tip(session, { txHash: TARGET_TX, amount: 3 });

      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.txHash).toBe("tip-result-hash");
      expect(bridge.transferDem).toHaveBeenCalledWith(
        AUTHOR_ADDR,
        3,
        "",
      );
      expect(result.provenance.path).toBe("local");
      // apiCall should NOT be called — chain-first
      expect(bridge.apiCall).not.toHaveBeenCalled();
    });
  });

  describe("self-tip guard", () => {
    it("returns INVALID_INPUT when recipient is the sender", async () => {
      const bridge = mockBridge({
        // resolvePostAuthor returns our own address
        resolvePostAuthor: vi.fn(async () => "demos1tiptest"),
      });
      const session = createSession(tempDir, bridge);

      const result = await tip(session, { txHash: TARGET_TX, amount: 3 });

      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe("INVALID_INPUT");
      expect(result.error!.message).toContain("self-tip");
      expect(bridge.transferDem).not.toHaveBeenCalled();
    });

    it("returns INVALID_INPUT for case-insensitive self-tip", async () => {
      const bridge = mockBridge({
        resolvePostAuthor: vi.fn(async () => "DEMOS1TIPTEST"),
      });
      const session = createSession(tempDir, bridge);

      const result = await tip(session, { txHash: TARGET_TX, amount: 3 });

      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe("INVALID_INPUT");
      expect(result.error!.message).toContain("self-tip");
    });
  });

  describe("chain resolution failure", () => {
    it("returns INVALID_INPUT when resolvePostAuthor returns null", async () => {
      const bridge = mockBridge({
        resolvePostAuthor: vi.fn(async () => null),
      });
      const session = createSession(tempDir, bridge);

      const result = await tip(session, { txHash: TARGET_TX, amount: 2 });

      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe("INVALID_INPUT");
      expect(result.error!.message).toContain("not found on chain");
      expect(bridge.transferDem).not.toHaveBeenCalled();
    });
  });
});
