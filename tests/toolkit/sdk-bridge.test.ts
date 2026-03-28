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
});
