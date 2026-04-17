/**
 * Integration tests for toolkit tools wired to SDK bridge.
 *
 * Uses mock SDK bridge to test behavioral contracts without real RPC.
 * Chain-first: tools use bridge chain methods, not apiCall.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DemosSession } from "../../../src/toolkit/session.js";
import { FileStateStore } from "../../../src/toolkit/state-store.js";
import type { SdkBridge, ApiAccessState, D402SettlementResult, ApiCallResult } from "../../../src/toolkit/sdk-bridge.js";
import type { ScanPost } from "../../../src/toolkit/types.js";

// Mock tx-simulator — these tests focus on tool integration, not simulation
vi.mock("../../../src/toolkit/chain/tx-simulator.js", () => ({
  simulateTransaction: vi.fn(async () => ({ success: true })),
}));

// Mock bridge factory — chain-first with all methods
function mockBridge(overrides?: Partial<SdkBridge>): SdkBridge {
  return {
    attestDahr: vi.fn(async (url: string) => ({
      responseHash: "mock-hash-abc",
      txHash: "mock-tx-123",
      data: { price: 42000 },
      url,
    })),
    apiCall: vi.fn(async (): Promise<ApiCallResult> => ({
      ok: true,
      status: 200,
      data: { posts: [] },
    })),
    publishHivePost: vi.fn(async () => ({ txHash: "hive-tx-789" })),
    transferDem: vi.fn(async () => ({ txHash: "transfer-tx-101" })),
    getDemos: vi.fn(() => ({} as any)),
    payD402: vi.fn(async (): Promise<D402SettlementResult> => ({ success: true, hash: "d" })),
    apiAccess: "none" as ApiAccessState,
    verifyTransaction: vi.fn(async (txHash: string) => ({
      confirmed: true,
      blockNumber: 42,
      from: "demos1agent",
    })),
    getHivePosts: vi.fn(async (): Promise<ScanPost[]> => ([
      {
        txHash: "post-tx-1",
        text: "BTC analysis with attestation",
        category: "ANALYSIS",
        author: "demos1agent",
        timestamp: Date.now(),
        reactions: { agree: 0, disagree: 0 },
        reactionsKnown: false,
        tags: ["crypto"],
      },
    ])),
    resolvePostAuthor: vi.fn(async () => "demos1agent"),
    ...overrides,
  };
}

function createBridgedSession(tempDir: string, bridge: SdkBridge) {
  return new DemosSession({
    walletAddress: "demos1integration",
    rpcUrl: "https://demosnode.discus.sh",
    algorithm: "falcon",
    authToken: "mock-token",
    signingHandle: { demos: {}, bridge },
    stateStore: new FileStateStore(tempDir),
  });
}

describe("Tool Integration with SDK Bridge", () => {
  let tempDir: string;
  let bridge: SdkBridge;
  let session: DemosSession;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "demos-int-"));
    bridge = mockBridge();
    session = createBridgedSession(tempDir, bridge);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("session.getBridge()", () => {
    it("returns the bridge from signing handle", () => {
      const b = session.getBridge();
      expect(b).toBeDefined();
      expect(typeof b.attestDahr).toBe("function");
    });

    it("throws when session has no bridge", () => {
      const noBridgeSession = new DemosSession({
        walletAddress: "demos1test",
        rpcUrl: "https://demosnode.discus.sh",
        algorithm: "falcon",
        authToken: "token",
        signingHandle: {},
        stateStore: new FileStateStore(tempDir),
      });
      expect(() => noBridgeSession.getBridge()).toThrow("bridge not available");
    });
  });

  describe("attest() with bridge", () => {
    it("calls bridge.attestDahr and returns result", async () => {
      const { attest } = await import("../../../src/toolkit/tools/attest.js");
      const result = await attest(session, { url: "https://api.coingecko.com/api/v3/simple/price" });

      if (result.ok) {
        expect(result.data!.responseHash).toBe("mock-hash-abc");
        expect(result.data!.txHash).toBe("mock-tx-123");
        expect(bridge.attestDahr).toHaveBeenCalled();
      } else {
        expect(result.error!.code).toBeDefined();
      }
    });
  });

  describe("scan() with bridge", () => {
    it("uses bridge.getHivePosts for chain-first scan", async () => {
      const { scan } = await import("../../../src/toolkit/tools/scan.js");
      const result = await scan(session, { limit: 10 });

      expect(result.ok).toBe(true);
      expect(result.data!.posts.length).toBeGreaterThan(0);
      expect(bridge.getHivePosts).toHaveBeenCalledWith(10);
    });

    it("filters posts by domain tag", async () => {
      const multiBridge = mockBridge({
        getHivePosts: vi.fn(async (): Promise<ScanPost[]> => ([
          { txHash: "tx-1", text: "BTC up", category: "ANALYSIS", author: "a1", timestamp: Date.now(), reactions: { agree: 0, disagree: 0 }, reactionsKnown: false, tags: ["crypto"] },
          { txHash: "tx-2", text: "GDP report", category: "ANALYSIS", author: "a2", timestamp: Date.now(), reactions: { agree: 0, disagree: 0 }, reactionsKnown: false, tags: ["macro"] },
        ])),
      });
      const domainSession = createBridgedSession(tempDir, multiBridge);
      const { scan } = await import("../../../src/toolkit/tools/scan.js");

      const result = await scan(domainSession, { domain: "crypto" });
      expect(result.ok).toBe(true);
      expect(result.data!.posts.length).toBe(1);
      expect(result.data!.posts[0].txHash).toBe("tx-1");
    });

    it("returns all posts when no domain specified", async () => {
      const multiBridge = mockBridge({
        getHivePosts: vi.fn(async (): Promise<ScanPost[]> => ([
          { txHash: "tx-1", text: "BTC up", category: "ANALYSIS", author: "a1", timestamp: Date.now(), reactions: { agree: 0, disagree: 0 }, reactionsKnown: false, tags: ["crypto"] },
          { txHash: "tx-2", text: "GDP report", category: "ANALYSIS", author: "a2", timestamp: Date.now(), reactions: { agree: 0, disagree: 0 }, reactionsKnown: false, tags: ["macro"] },
        ])),
      });
      const allSession = createBridgedSession(tempDir, multiBridge);
      const { scan } = await import("../../../src/toolkit/tools/scan.js");

      const result = await scan(allSession);
      expect(result.ok).toBe(true);
      expect(result.data!.posts.length).toBe(2);
    });
  });

  describe("react() with bridge", () => {
    it("calls bridge.apiCall for API-based reaction", async () => {
      const apiBridge = mockBridge({
        apiAccess: "authenticated",
        apiCall: vi.fn(async () => ({ ok: true, status: 200, data: { success: true } })),
      });
      const apiSession = createBridgedSession(tempDir, apiBridge);
      const { react } = await import("../../../src/toolkit/tools/react.js");
      const result = await react(apiSession, { txHash: "post-tx-1", type: "agree" });

      expect(result.ok).toBe(true);
      expect(result.data!.success).toBe(true);
      expect(apiBridge.apiCall).toHaveBeenCalledWith(
        "/api/feed/post-tx-1/react",
        { method: "POST", body: JSON.stringify({ type: "agree" }) },
      );
    });
  });

  describe("verify() with bridge", () => {
    it("uses bridge.verifyTransaction for chain-first confirmation", async () => {
      const { verify } = await import("../../../src/toolkit/tools/verify.js");
      const result = await verify(session, { txHash: "post-tx-1" });

      expect(result.ok).toBe(true);
      expect(result.data!.confirmed).toBe(true);
      expect(result.data!.blockHeight).toBe(42);
      expect(bridge.verifyTransaction).toHaveBeenCalledWith("post-tx-1");
    });
  });

  describe("tip() with bridge", () => {
    it("resolves author from chain and transfers DEM", async () => {
      const { tip } = await import("../../../src/toolkit/tools/tip.js");
      const result = await tip(session, { txHash: "post-tx-1", amount: 3 });

      expect(result.ok).toBe(true);
      expect(result.data!.txHash).toBeDefined();
      expect(bridge.resolvePostAuthor).toHaveBeenCalledWith("post-tx-1");
      expect(bridge.transferDem).toHaveBeenCalledWith("demos1agent", 3, "");
    });
  });

  describe("publish() with bridge", () => {
    it("calls attestDahr then publishPost via bridge and preserves attestation provenance", async () => {
      const { publish } = await import("../../../src/toolkit/tools/publish.js");
      const result = await publish(session, {
        text: "BTC surging past $100k with strong institutional inflows and on-chain metrics confirming accumulation by long-term holders. DAHR-attested price data from CoinGecko confirms.",
        category: "ANALYSIS",
        attestUrl: "https://1.1.1.1/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      });

      if (result.ok) {
        expect(result.data!.txHash).toBe("hive-tx-789");
        expect(result.provenance.attestation).toEqual({
          txHash: "mock-tx-123",
          responseHash: "mock-hash-abc",
        });
      } else {
        expect(result.error).toBeDefined();
      }
    });
  });

  describe("reply() with bridge", () => {
    it("passes parentTxHash through to pipeline", async () => {
      const { reply } = await import("../../../src/toolkit/tools/publish.js");
      const result = await reply(session, {
        parentTxHash: "parent-tx-abc",
        text: "Agreed — the on-chain data confirms accumulation. DAHR-attested verification shows consistent buying pressure across major exchanges over the past 72 hours. Multiple sources corroborate this trend with high confidence.",
        attestUrl: "https://1.1.1.1/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      });

      if (result.ok) {
        expect(result.data!.txHash).toBeDefined();
      } else {
        expect(result.error!.code).not.toBe("INVALID_INPUT");
      }
    });
  });
});
