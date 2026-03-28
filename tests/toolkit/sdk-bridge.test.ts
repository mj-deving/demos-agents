/**
 * Tests for SDK bridge adapter.
 *
 * Uses mocked Demos SDK to verify bridge behavior without real RPC connection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSdkBridge } from "../../src/toolkit/sdk-bridge.js";
import type { SdkBridge } from "../../src/toolkit/sdk-bridge.js";

// Mock DemosTransactions (static methods)
const mockDemosTransactions = {
  store: vi.fn(async () => ({ type: "store", data: "encoded" })),
  confirm: vi.fn(async () => ({
    response: { data: { transaction: { hash: "mock-confirm-hash" } } },
  })),
  broadcast: vi.fn(async () => ({
    response: { results: { tx1: { hash: "mock-broadcast-hash" } } },
  })),
};

// Mock Demos instance
function mockDemos() {
  return {
    signMessage: vi.fn(async (msg: string) => ({
      data: "mock-signature",
      type: "falcon",
    })),
    web2: {
      createDahr: vi.fn(async () => ({
        startProxy: vi.fn(async (opts: { url: string; method: string }) => ({
          responseHash: "mock-response-hash",
          txHash: "mock-tx-hash",
          data: JSON.stringify({ price: 42 }),
          status: 200,
        })),
      })),
    },
    sendTransaction: vi.fn(async () => ({
      hash: "mock-send-tx-hash",
    })),
    // transfer creates a signed tx (step 1 of 3 — confirm + broadcast follow)
    transfer: vi.fn(async (to: string, amount: number) => ({
      hash: "mock-signed-tx-hash",
      content: { to, amount, type: "native" },
    })),
    confirm: vi.fn(async () => ({
      response: { data: { transaction: { hash: "mock-transfer-hash" } } },
    })),
    broadcast: vi.fn(async () => ({
      response: { results: { tx1: { hash: "mock-broadcast-hash" } } },
    })),
  };
}

describe("SDK Bridge Adapter", () => {
  let bridge: SdkBridge;
  let demos: ReturnType<typeof mockDemos>;

  beforeEach(() => {
    demos = mockDemos();
    bridge = createSdkBridge(demos as any, "https://www.supercolony.ai", "mock-auth-token");
  });

  describe("structure", () => {
    it("wraps Demos instance and auth token", () => {
      expect(bridge).toBeDefined();
      expect(bridge.attestDahr).toBeDefined();
      expect(bridge.apiCall).toBeDefined();
    });

    it("exposes attestDahr method", () => {
      expect(typeof bridge.attestDahr).toBe("function");
    });

    it("exposes apiCall method", () => {
      expect(typeof bridge.apiCall).toBe("function");
    });

  });

  describe("attestDahr", () => {
    it("calls DAHR proxy with URL and returns result", async () => {
      const result = await bridge.attestDahr("https://api.example.com/price");
      expect(result.responseHash).toBe("mock-response-hash");
      expect(result.txHash).toBe("mock-tx-hash");
      expect(demos.web2.createDahr).toHaveBeenCalled();
    });

    it("passes method to DAHR proxy", async () => {
      const result = await bridge.attestDahr("https://api.example.com/data", "POST");
      expect(demos.web2.createDahr).toHaveBeenCalled();
      expect(result.txHash).toBe("mock-tx-hash");
    });

    it("throws on non-2xx HTTP status from proxy", async () => {
      demos.web2.createDahr = vi.fn(async () => ({
        startProxy: vi.fn(async () => ({ status: 403, data: "{}" })),
      }));
      bridge = createSdkBridge(demos as any, "https://www.supercolony.ai", "token");
      await expect(bridge.attestDahr("https://example.com")).rejects.toThrow("HTTP 403");
    });

    it("throws on XML/HTML response", async () => {
      demos.web2.createDahr = vi.fn(async () => ({
        startProxy: vi.fn(async () => ({
          status: 200, data: "<html>Error</html>",
          responseHash: "h", txHash: "t",
        })),
      }));
      bridge = createSdkBridge(demos as any, "https://www.supercolony.ai", "token");
      await expect(bridge.attestDahr("https://example.com")).rejects.toThrow("XML/HTML");
    });

    it("throws on error payload with unauthorized", async () => {
      demos.web2.createDahr = vi.fn(async () => ({
        startProxy: vi.fn(async () => ({
          status: 200, data: JSON.stringify({ error: "Unauthorized access" }),
          responseHash: "h", txHash: "t",
        })),
      }));
      bridge = createSdkBridge(demos as any, "https://www.supercolony.ai", "token");
      await expect(bridge.attestDahr("https://example.com")).rejects.toThrow("Unauthorized");
    });
  });

  describe("apiCall", () => {
    it("calls fetch with auth header for SuperColony paths", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ posts: [] }),
      }));
      const bridgeWithFetch = createSdkBridge(
        demos as any,
        "https://www.supercolony.ai",
        "mock-token",
        fetchMock as any,
      );

      await bridgeWithFetch.apiCall("/api/feed?limit=50");

      expect(fetchMock).toHaveBeenCalledWith(
        "https://www.supercolony.ai/api/feed?limit=50",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer mock-token",
          }),
        }),
      );
    });

    it("rejects absolute URLs to prevent SSRF", async () => {
      const result = await bridge.apiCall("https://evil.com/steal");
      expect(result.ok).toBe(false);
      expect(result.data).toContain("relative paths");
    });

    it("does not attach auth token when auth is pending", async () => {
      const { AUTH_PENDING_TOKEN } = await import("../../src/toolkit/sdk-bridge.js");
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => "{}",
      }));
      const pendingBridge = createSdkBridge(
        demos as any,
        "https://www.supercolony.ai",
        AUTH_PENDING_TOKEN,
        fetchMock as any,
      );

      await pendingBridge.apiCall("/api/feed");
      const headers = (fetchMock.mock.calls[0][1] as any).headers;
      expect(headers.Authorization).toBeUndefined();
    });

    it("returns parsed JSON response (the last apiCall test)", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ posts: [{ txHash: "0x1" }] }),
      }));
      const bridgeWithFetch = createSdkBridge(
        demos as any,
        "https://www.supercolony.ai",
        "mock-token",
        fetchMock as any,
      );

      const result = await bridgeWithFetch.apiCall("/api/feed?limit=50");
      expect(result.ok).toBe(true);
      expect(result.data.posts).toHaveLength(1);
    });
  });

  describe("publishHivePost", () => {
    it("encodes HIVE prefix + JSON and stores on chain", async () => {
      bridge = createSdkBridge(
        demos as any,
        "https://www.supercolony.ai",
        "token",
        undefined,
        mockDemosTransactions as any,
      );

      const result = await bridge.publishHivePost({
        text: "BTC at 100k",
        category: "ANALYSIS",
        tags: ["crypto"],
        confidence: 80,
        sourceAttestations: [{ url: "https://api.coingecko.com", responseHash: "abc", txHash: "def" }],
      });

      expect(result.txHash).toBe("mock-confirm-hash");
      expect(mockDemosTransactions.store).toHaveBeenCalled();
      expect(mockDemosTransactions.confirm).toHaveBeenCalled();
      expect(mockDemosTransactions.broadcast).toHaveBeenCalled();
    });

    it("extracts txHash from confirm response", async () => {
      bridge = createSdkBridge(
        demos as any,
        "https://www.supercolony.ai",
        "token",
        undefined,
        mockDemosTransactions as any,
      );

      const result = await bridge.publishHivePost({
        text: "Test post",
        category: "UPDATE",
      });

      expect(typeof result.txHash).toBe("string");
      expect(result.txHash.length).toBeGreaterThan(0);
    });

    it("includes replyTo when provided", async () => {
      const localTxMock = {
        store: vi.fn(async () => ({ type: "store" })),
        confirm: vi.fn(async () => ({
          response: { data: { transaction: { hash: "reply-hash" } } },
        })),
        broadcast: vi.fn(async () => ({})),
      };

      bridge = createSdkBridge(
        demos as any,
        "https://www.supercolony.ai",
        "token",
        undefined,
        localTxMock as any,
      );

      await bridge.publishHivePost({
        text: "Reply text",
        category: "ANALYSIS",
        replyTo: "parent-tx-abc",
      });

      // Verify store was called with encoded data containing replyTo
      const storeCall = localTxMock.store.mock.calls[0];
      const encoded = storeCall[0] as Uint8Array;
      const decoded = new TextDecoder().decode(encoded.slice(4)); // skip HIVE prefix
      const parsed = JSON.parse(decoded);
      expect(parsed.replyTo).toBe("parent-tx-abc");
    });
  });

  describe("transferDem", () => {
    it("calls transfer → confirm → broadcast pipeline", async () => {
      const result = await bridge.transferDem("demos1recipient", 5, "HIVE_TIP:tx123");

      expect(result.txHash).toBeDefined();
      // Step 1: transfer creates signed tx (2 params — memo not passed to SDK)
      expect(demos.transfer).toHaveBeenCalledWith("demos1recipient", 5);
      // Step 2: confirm validates the signed tx
      expect(demos.confirm).toHaveBeenCalled();
      // Step 3: broadcast submits to network
      expect(demos.broadcast).toHaveBeenCalled();
    });

    it("extracts txHash from confirm response (SDK convention)", async () => {
      const result = await bridge.transferDem("demos1recipient", 3, "memo");
      // extractTxHash checks confirm response first, then broadcast
      expect(result.txHash).toBe("mock-transfer-hash");
    });

    it("does not pass memo to SDK transfer (SDK only accepts 2 params)", async () => {
      await bridge.transferDem("demos1recipient", 5, "HIVE_TIP:tx123");
      // transfer should be called with exactly 2 args, not 3
      expect(demos.transfer).toHaveBeenCalledWith("demos1recipient", 5);
      expect(demos.transfer.mock.calls[0]).toHaveLength(2);
    });
  });

  describe("getHiveReactions", () => {
    function makeReactionTx(target: string, type: "agree" | "disagree", hash = "rx-hash") {
      const payload = JSON.stringify({ v: 1, action: "react", target, type });
      return {
        hash,
        blockNumber: 100,
        status: "confirmed",
        from: "reactor1",
        to: "chain",
        type: "storage",
        // String form with HIVE prefix — decodeHiveData handles this
        content: JSON.stringify({ data: ["storage", "HIVE" + payload] }),
        timestamp: Date.now(),
      };
    }

    function makePostTx(text: string, hash = "post-hash") {
      const payload = JSON.stringify({ v: 1, text, cat: "ANALYSIS" });
      return {
        hash,
        blockNumber: 100,
        status: "confirmed",
        from: "author1",
        to: "chain",
        type: "storage",
        content: JSON.stringify({ data: ["storage", "HIVE" + payload] }),
        timestamp: Date.now(),
      };
    }

    // Helper: make a tx using the base64 {"bytes":"..."} envelope (real chain format)
    function makeBase64ReactionTx(target: string, type: "agree" | "disagree", hash = "rx-b64") {
      const payload = JSON.stringify({ v: 1, action: "react", target, type });
      const b64 = Buffer.from("HIVE" + payload).toString("base64");
      return {
        hash,
        blockNumber: 100,
        status: "confirmed",
        from: "reactor1",
        to: "chain",
        type: "storage",
        content: JSON.stringify({ data: ["storage", { bytes: b64 }] }),
        timestamp: Date.now(),
      };
    }

    function makeBase64PostTx(text: string, hash = "post-b64") {
      const payload = JSON.stringify({ v: 1, text, cat: "ANALYSIS" });
      const b64 = Buffer.from("HIVE" + payload).toString("base64");
      return {
        hash,
        blockNumber: 100,
        status: "confirmed",
        from: "author1",
        to: "chain",
        type: "storage",
        content: JSON.stringify({ data: ["storage", { bytes: b64 }] }),
        timestamp: Date.now(),
      };
    }

    it("decodes base64 bytes envelope (real chain format)", async () => {
      const demosWithTxs = {
        ...mockDemos(),
        getTransactions: vi.fn()
          .mockResolvedValueOnce([
            makeBase64ReactionTx("tx-abc", "agree", "rx1"),
            makeBase64ReactionTx("tx-abc", "disagree", "rx2"),
            makeBase64PostTx("test post", "post1"),
          ])
          .mockResolvedValue([]),
      };
      const b = createSdkBridge(demosWithTxs as any, undefined, "token");
      const result = await b.getHiveReactions(["tx-abc"]);

      expect(result.get("tx-abc")).toEqual({ agree: 1, disagree: 1 });
    });

    it("getHivePosts decodes base64 bytes envelope", async () => {
      const demosWithTxs = {
        ...mockDemos(),
        getTransactions: vi.fn()
          .mockResolvedValueOnce([
            makeBase64PostTx("Compound TVL analysis", "post1"),
            makeBase64ReactionTx("post1", "agree", "rx1"),
          ])
          .mockResolvedValue([]),
      };
      const b = createSdkBridge(demosWithTxs as any, undefined, "token");
      const posts = await b.getHivePosts(10);

      expect(posts).toHaveLength(1);
      expect(posts[0].text).toBe("Compound TVL analysis");
      expect(posts[0].txHash).toBe("post1");
    });

    it("counts agree and disagree reactions for target txHashes", async () => {
      const demosWithTxs = {
        ...mockDemos(),
        getTransactions: vi.fn()
          .mockResolvedValueOnce([
            makeReactionTx("tx-abc", "agree", "rx1"),
            makeReactionTx("tx-abc", "agree", "rx2"),
            makeReactionTx("tx-abc", "disagree", "rx3"),
            makeReactionTx("tx-def", "disagree", "rx4"),
            makePostTx("some post", "post1"), // not a reaction — should be ignored
          ])
          .mockResolvedValue([]),
      };
      const b = createSdkBridge(demosWithTxs as any, undefined, "token");
      const result = await b.getHiveReactions(["tx-abc", "tx-def"]);

      expect(result.get("tx-abc")).toEqual({ agree: 2, disagree: 1 });
      expect(result.get("tx-def")).toEqual({ agree: 0, disagree: 1 });
    });

    it("returns zero counts for txHashes with no reactions", async () => {
      const demosWithTxs = {
        ...mockDemos(),
        getTransactions: vi.fn()
          .mockResolvedValueOnce([
            makePostTx("a regular post", "post1"),
          ])
          .mockResolvedValue([]),
      };
      const b = createSdkBridge(demosWithTxs as any, undefined, "token");
      const result = await b.getHiveReactions(["tx-missing"]);

      expect(result.get("tx-missing")).toEqual({ agree: 0, disagree: 0 });
    });

    it("returns empty map when getTransactions is not available", async () => {
      // Default mockDemos() has no getTransactions
      const b = createSdkBridge(demos as any, undefined, "token");
      const result = await b.getHiveReactions(["tx-abc"]);

      expect(result.size).toBe(0);
    });

    it("ignores reactions targeting txHashes not in the target set", async () => {
      const demosWithTxs = {
        ...mockDemos(),
        getTransactions: vi.fn()
          .mockResolvedValueOnce([
            makeReactionTx("tx-other", "agree", "rx1"),
            makeReactionTx("tx-abc", "agree", "rx2"),
          ])
          .mockResolvedValue([]), // empty on subsequent pages
      };
      const b = createSdkBridge(demosWithTxs as any, undefined, "token");
      const result = await b.getHiveReactions(["tx-abc"]);

      expect(result.get("tx-abc")).toEqual({ agree: 1, disagree: 0 });
      expect(result.has("tx-other")).toBe(false);
    });
  });

  describe("queryAgentActivity", () => {
    it("separates posts and reactions from getTransactionHistory", async () => {
      const postPayload = JSON.stringify({ v: 1, text: "DeFi TVL analysis", cat: "ANALYSIS", tags: ["defi"] });
      const reactionPayload = JSON.stringify({ v: 1, action: "react", target: "target-tx-1", type: "agree" });
      const replyPayload = JSON.stringify({ v: 1, text: "Reply to your point", cat: "ANALYSIS", replyTo: "parent-tx-1" });
      const b64Post = Buffer.from("HIVE" + postPayload).toString("base64");
      const b64Reaction = Buffer.from("HIVE" + reactionPayload).toString("base64");
      const b64Reply = Buffer.from("HIVE" + replyPayload).toString("base64");

      const demosWithHistory = {
        ...mockDemos(),
        getTransactionHistory: vi.fn()
          .mockResolvedValueOnce([
            { hash: "post-1", blockNumber: 200, status: "confirmed", content: { from: "agent1", type: "storage", data: ["storage", { bytes: b64Post }], timestamp: 1000 } },
            { hash: "react-1", blockNumber: 199, status: "confirmed", content: { from: "agent1", type: "storage", data: ["storage", { bytes: b64Reaction }], timestamp: 1001 } },
            { hash: "reply-1", blockNumber: 198, status: "confirmed", content: { from: "agent1", type: "storage", data: ["storage", { bytes: b64Reply }], timestamp: 1002 } },
          ])
          .mockResolvedValue([]),
      };
      const b = createSdkBridge(demosWithHistory as any, undefined, "token");
      const activity = await b.queryAgentActivity("agent1");

      expect(activity.address).toBe("agent1");
      expect(activity.posts).toHaveLength(2); // post + reply (both have text)
      expect(activity.reactionsGiven).toHaveLength(1);
      expect(activity.posts[0].text).toBe("DeFi TVL analysis");
      expect(activity.posts[0].tags).toEqual(["defi"]);
      expect(activity.posts[1].replyTo).toBe("parent-tx-1");
      expect(activity.reactionsGiven[0].targetTxHash).toBe("target-tx-1");
      expect(activity.reactionsGiven[0].type).toBe("agree");
    });

    it("falls back to getTransactions when getTransactionHistory unavailable", async () => {
      const postPayload = JSON.stringify({ v: 1, text: "Fallback post", cat: "PREDICTION" });
      const b64 = Buffer.from("HIVE" + postPayload).toString("base64");

      const demosNoHistory = {
        ...mockDemos(),
        // No getTransactionHistory — only getTransactions
        getTransactions: vi.fn()
          .mockResolvedValueOnce([
            { hash: "tx-1", blockNumber: 100, status: "confirmed", from: "agent1", to: "chain", type: "storage", content: JSON.stringify({ from: "agent1", data: ["storage", { bytes: b64 }], timestamp: 2000 }), timestamp: 2000 },
            { hash: "tx-2", blockNumber: 100, status: "confirmed", from: "other-agent", to: "chain", type: "storage", content: JSON.stringify({ from: "other-agent", data: ["storage", { bytes: b64 }], timestamp: 2001 }), timestamp: 2001 },
          ])
          .mockResolvedValue([]),
      };
      const b = createSdkBridge(demosNoHistory as any, undefined, "token");
      const activity = await b.queryAgentActivity("agent1");

      // Only includes posts from agent1, not other-agent
      expect(activity.posts).toHaveLength(1);
      expect(activity.posts[0].txHash).toBe("tx-1");
    });

    it("returns empty activity when no methods available", async () => {
      const b = createSdkBridge(demos as any, undefined, "token");
      const activity = await b.queryAgentActivity("agent1");

      expect(activity.posts).toHaveLength(0);
      expect(activity.reactionsGiven).toHaveLength(0);
    });
  });
});
