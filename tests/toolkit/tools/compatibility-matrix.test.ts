/**
 * Compatibility matrix tests — 3 API access states.
 *
 * Tests bridge behavior across: no-API, API+pending auth, API+authenticated.
 * Covers ISC-11, ISC-12, ISC-13.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSdkBridge, AUTH_PENDING_TOKEN } from "../../../src/toolkit/sdk-bridge.js";
import type { SdkBridge, TxModule } from "../../../src/toolkit/sdk-bridge.js";

const mockTxModule: TxModule = {
  store: vi.fn(async () => ({ type: "store" })),
  confirm: vi.fn(async () => ({
    response: { data: { transaction: { hash: "mock-hash" } } },
  })),
  broadcast: vi.fn(async () => ({})),
};

function mockDemos(overrides?: Record<string, unknown>) {
  return {
    web2: { createDahr: vi.fn(async () => ({ startProxy: vi.fn(async () => ({ responseHash: "h", txHash: "t", data: "{}", status: 200 })) })) },
    transfer: vi.fn(async () => ({ hash: "tx-hash" })),
    sendTransaction: vi.fn(async () => ({ hash: "tx-hash" })),
    connect: vi.fn(async () => {}),
    connectWallet: vi.fn(async () => "demos1addr"),
    getTxByHash: vi.fn(async (hash: string) => ({
      hash,
      blockNumber: 42,
      status: "confirmed",
      content: { from: "demos1author", to: "demos1target", type: "storage", data: null, timestamp: 1700000000 },
    })),
    getTransactions: vi.fn(async () => []),
    getMempool: vi.fn(async () => []),
    ...overrides,
  };
}

describe("Compatibility matrix — 3 API access states", () => {

  describe("no-API (chain-only mode)", () => {
    let bridge: SdkBridge;

    beforeEach(() => {
      bridge = createSdkBridge(
        mockDemos() as any,
        undefined, // no API URL
        AUTH_PENDING_TOKEN,
        undefined,
        mockTxModule,
      );
    });

    it("apiAccess returns 'none'", () => {
      expect(bridge.apiAccess).toBe("none");
    });

    it("apiCall returns deterministic error", async () => {
      const result = await bridge.apiCall("/api/feed?limit=50");
      expect(result.ok).toBe(false);
      expect(result.status).toBe(0);
      expect(result.data).toContain("chain-only mode");
    });

    it("verifyTransaction works via chain", async () => {
      const result = await bridge.verifyTransaction("0xabc");
      expect(result).not.toBeNull();
      expect(result!.confirmed).toBe(true);
      expect(result!.blockNumber).toBe(42);
      expect(result!.from).toBe("demos1author");
    });

    it("resolvePostAuthor works via chain", async () => {
      const author = await bridge.resolvePostAuthor("0xabc");
      expect(author).toBe("demos1author");
    });

  });

  describe("API configured, auth pending", () => {
    let bridge: SdkBridge;

    beforeEach(() => {
      bridge = createSdkBridge(
        mockDemos() as any,
        "https://www.supercolony.ai",
        AUTH_PENDING_TOKEN,
        undefined,
        mockTxModule,
      );
    });

    it("apiAccess returns 'configured'", () => {
      expect(bridge.apiAccess).toBe("configured");
    });

    it("apiCall works but does not send auth header", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => "{}",
      }));
      const pendingBridge = createSdkBridge(
        mockDemos() as any,
        "https://www.supercolony.ai",
        AUTH_PENDING_TOKEN,
        fetchMock as any,
        mockTxModule,
      );

      await pendingBridge.apiCall("/api/feed");
      const headers = (fetchMock.mock.calls[0][1] as any).headers;
      expect(headers.Authorization).toBeUndefined();
    });

    it("chain methods still work when API auth is pending", async () => {
      const result = await bridge.verifyTransaction("0xtest");
      expect(result).not.toBeNull();
      expect(result!.confirmed).toBe(true);
    });
  });

  describe("API fully authenticated", () => {
    let bridge: SdkBridge;

    beforeEach(() => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ posts: [] }),
      }));
      bridge = createSdkBridge(
        mockDemos() as any,
        "https://www.supercolony.ai",
        "valid-auth-token",
        fetchMock as any,
        mockTxModule,
      );
    });

    it("apiAccess returns 'authenticated'", () => {
      expect(bridge.apiAccess).toBe("authenticated");
    });

    it("apiCall sends Authorization header", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => "{}",
      }));
      const authedBridge = createSdkBridge(
        mockDemos() as any,
        "https://www.supercolony.ai",
        "my-token",
        fetchMock as any,
        mockTxModule,
      );
      await authedBridge.apiCall("/api/feed");
      const headers = (fetchMock.mock.calls[0][1] as any).headers;
      expect(headers.Authorization).toBe("Bearer my-token");
    });

    it("chain methods work alongside API", async () => {
      const result = await bridge.verifyTransaction("0xabc");
      expect(result).not.toBeNull();
      expect(result!.confirmed).toBe(true);
    });
  });
});

describe("ChainTransaction bridge methods", () => {
  it("verifyTransaction returns null when getTxByHash not available", async () => {
    const demos = mockDemos({ getTxByHash: undefined });
    const bridge = createSdkBridge(demos as any, undefined, AUTH_PENDING_TOKEN, undefined, mockTxModule);
    const result = await bridge.verifyTransaction("0xmissing");
    expect(result).toBeNull();
  });

  it("verifyTransaction throws on RPC error (errors propagate for retry)", async () => {
    const demos = mockDemos({ getTxByHash: vi.fn(async () => { throw new Error("RPC down"); }) });
    const bridge = createSdkBridge(demos as any, undefined, AUTH_PENDING_TOKEN, undefined, mockTxModule);
    await expect(bridge.verifyTransaction("0xfail")).rejects.toThrow("RPC down");
  });

  it("verifyTransaction returns unconfirmed for blockNumber 0", async () => {
    const demos = mockDemos({
      getTxByHash: vi.fn(async () => ({
        hash: "0xpending",
        blockNumber: 0,
        status: "pending",
        content: { from: "demos1a", to: "demos1b", type: "storage", data: null, timestamp: 0 },
      })),
    });
    const bridge = createSdkBridge(demos as any, undefined, AUTH_PENDING_TOKEN, undefined, mockTxModule);
    const result = await bridge.verifyTransaction("0xpending");
    expect(result).not.toBeNull();
    expect(result!.confirmed).toBe(false);
  });

  it("verifyTransaction falls back to recent getTransactions when getTxByHash is malformed", async () => {
    const demos = mockDemos({
      getTxByHash: vi.fn(async () => "error"),
      getTransactions: vi.fn(async () => [
        {
          id: 944768,
          hash: "0xipfs",
          blockNumber: 2096819,
          status: "confirmed",
          from: "demos1ipfs",
          to: "demos1ipfs",
          type: "ipfs",
          content: "{\"type\":\"ipfs\"}",
          timestamp: 1700000000,
        },
      ]),
    });
    const bridge = createSdkBridge(demos as any, undefined, AUTH_PENDING_TOKEN, undefined, mockTxModule);
    const result = await bridge.verifyTransaction("0xipfs");
    expect(result).not.toBeNull();
    expect(result!.confirmed).toBe(true);
    expect(result!.blockNumber).toBe(2096819);
    expect(result!.from).toBe("demos1ipfs");
  });

  it("resolvePostAuthor returns null when getTxByHash not available", async () => {
    const demos = mockDemos({ getTxByHash: undefined });
    const bridge = createSdkBridge(demos as any, undefined, AUTH_PENDING_TOKEN, undefined, mockTxModule);
    const result = await bridge.resolvePostAuthor("0xmissing");
    expect(result).toBeNull();
  });

  it("resolvePostAuthor returns null on RPC error", async () => {
    const demos = mockDemos({ getTxByHash: vi.fn(async () => { throw new Error("RPC down"); }) });
    const bridge = createSdkBridge(demos as any, undefined, AUTH_PENDING_TOKEN, undefined, mockTxModule);
    const result = await bridge.resolvePostAuthor("0xfail");
    expect(result).toBeNull();
  });

  it("resolvePostAuthor falls back to recent getTransactions when getTxByHash is malformed", async () => {
    const demos = mockDemos({
      getTxByHash: vi.fn(async () => "error"),
      getTransactions: vi.fn(async () => [
        {
          id: 944768,
          hash: "0xipfs",
          blockNumber: 2096819,
          status: "confirmed",
          from: "demos1ipfs",
          to: "demos1ipfs",
          type: "ipfs",
          content: "{\"type\":\"ipfs\"}",
          timestamp: 1700000000,
        },
      ]),
    });
    const bridge = createSdkBridge(demos as any, undefined, AUTH_PENDING_TOKEN, undefined, mockTxModule);
    const result = await bridge.resolvePostAuthor("0xipfs");
    expect(result).toBe("demos1ipfs");
  });

  it("getHivePosts returns empty when getTransactions not available", async () => {
    const demos = mockDemos({ getTransactions: undefined });
    const bridge = createSdkBridge(demos as any, undefined, AUTH_PENDING_TOKEN, undefined, mockTxModule);
    const posts = await bridge.getHivePosts(10);
    expect(posts).toEqual([]);
  });

  it("getHivePosts decodes HIVE-prefixed storage transactions", async () => {
    const hiveJson = JSON.stringify({ v: 1, text: "Hello chain", cat: "ANALYSIS", tags: ["defi"] });
    const hiveBytes = "HIVE" + hiveJson;
    let called = false;
    const demos = mockDemos({
      getTransactions: vi.fn(async () => {
        if (called) return []; // no more pages
        called = true;
        return [{
          hash: "0xhive1",
          blockNumber: 100,
          status: "confirmed",
          from: "demos1poster",
          to: "",
          type: "storage",
          content: JSON.stringify({ from: "demos1poster", to: "", type: "storage", data: hiveBytes, timestamp: 1700000000 }),
          timestamp: 1700000000,
        }];
      }),
    });
    const bridge = createSdkBridge(demos as any, undefined, AUTH_PENDING_TOKEN, undefined, mockTxModule);
    const posts = await bridge.getHivePosts(10);
    expect(posts).toHaveLength(1);
    expect(posts[0].txHash).toBe("0xhive1");
    expect(posts[0].text).toBe("Hello chain");
    expect(posts[0].category).toBe("ANALYSIS");
    expect(posts[0].author).toBe("demos1poster");
    expect(posts[0].reactionsKnown).toBe(false);
    expect(posts[0].reactions).toEqual({ agree: 0, disagree: 0 });
    expect(posts[0].tags).toEqual(["defi"]);
  });

  it("getHivePosts skips non-storage transactions", async () => {
    const demos = mockDemos({
      getTransactions: vi.fn(async () => [
        { hash: "0xnative", blockNumber: 100, status: "confirmed", from: "a", to: "b", type: "native", content: "{}", timestamp: 0 },
      ]),
    });
    const bridge = createSdkBridge(demos as any, undefined, AUTH_PENDING_TOKEN, undefined, mockTxModule);
    const posts = await bridge.getHivePosts(10);
    expect(posts).toEqual([]);
  });

  it("getHivePosts handles TransactionContentData tuple format ['storage', payload]", async () => {
    const hiveJson = JSON.stringify({ v: 1, text: "Tuple post", cat: "ANALYSIS", tags: ["test"] });
    let called = false;
    const demos = mockDemos({
      getTransactions: vi.fn(async () => {
        if (called) return [];
        called = true;
        return [{
          hash: "0xtuple",
          blockNumber: 50,
          status: "confirmed",
          from: "demos1tuple",
          to: "",
          type: "storage",
          // TransactionContentData is a tuple ["storage", StoragePayload]
          content: JSON.stringify({
            from: "demos1tuple", to: "", type: "storage",
            data: ["storage", "HIVE" + hiveJson],
            timestamp: 1700000000,
          }),
          timestamp: 1700000000,
        }];
      }),
    });
    const bridge = createSdkBridge(demos as any, undefined, AUTH_PENDING_TOKEN, undefined, mockTxModule);
    const posts = await bridge.getHivePosts(10);
    expect(posts).toHaveLength(1);
    expect(posts[0].text).toBe("Tuple post");
    expect(posts[0].author).toBe("demos1tuple");
  });

  it("getHivePosts respects limit parameter", async () => {
    const makeHiveTx = (i: number) => {
      const hiveJson = JSON.stringify({ v: 1, text: `Post ${i}`, cat: "UPDATE" });
      return {
        hash: `0xhive${i}`,
        blockNumber: 100 - i,
        status: "confirmed",
        from: "demos1poster",
        to: "",
        type: "storage",
        content: JSON.stringify({ from: "demos1poster", to: "", type: "storage", data: "HIVE" + hiveJson, timestamp: 1700000000 }),
        timestamp: 1700000000,
      };
    };
    const demos = mockDemos({
      getTransactions: vi.fn(async () => Array.from({ length: 20 }, (_, i) => makeHiveTx(i))),
    });
    const bridge = createSdkBridge(demos as any, undefined, AUTH_PENDING_TOKEN, undefined, mockTxModule);
    const posts = await bridge.getHivePosts(5);
    expect(posts).toHaveLength(5);
  });

  // publishHiveReaction tests removed — reactions are API-only (not on-chain)
});
