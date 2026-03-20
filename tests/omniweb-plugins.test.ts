import { describe, it, expect, vi, afterEach } from "vitest";
import { createNetworkHealthPlugin } from "../src/plugins/network-health-plugin.js";
import { createTlsnAttestPlugin } from "../src/plugins/tlsn-attest-plugin.js";
import { createChainQueryPlugin } from "../src/plugins/chain-query-plugin.js";
import { createAddressWatchPlugin } from "../src/plugins/address-watch-plugin.js";
import { createCCIIdentityPlugin } from "../src/plugins/cci-identity-plugin.js";
import { createDemosWorkPlugin } from "../src/plugins/demoswork-plugin.js";
import { createSdkSetupPlugin } from "../src/plugins/sdk-setup-plugin.js";
import { createDemosWalletPlugin } from "../src/plugins/demos-wallet-plugin.js";
import type { ProviderResult } from "../src/types.js";

const RPC_URL = "https://demosnode.discus.sh";

function mockFetchOk(data: unknown): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => data,
  });
}

function mockFetchNetworkError(): typeof globalThis.fetch {
  return vi.fn().mockRejectedValue(new Error("Network failure"));
}

function mockFetchError(status: number, statusText: string): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText,
    json: async () => ({}),
  });
}

describe("Omniweb Plugins", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ---------- network-health ----------
  describe("createNetworkHealthPlugin", () => {
    it("creates a plugin with correct metadata", () => {
      const plugin = createNetworkHealthPlugin({ rpcUrl: RPC_URL });
      expect(plugin.name).toBe("network-health");
      expect(plugin.version).toBe("1.0.0");
      expect(plugin.providers).toHaveLength(1);
      expect(plugin.providers[0].name).toBe("network-health");
    });

    it("fetches block info successfully", async () => {
      const rpcResponse = { jsonrpc: "2.0", id: 1, result: { height: 12345, timestamp: 1700000000 } };
      vi.stubGlobal("fetch", mockFetchOk(rpcResponse));

      const plugin = createNetworkHealthPlugin({ rpcUrl: RPC_URL });
      const result: ProviderResult = await plugin.providers[0].fetch("health");

      expect(result.ok).toBe(true);
      expect(result.data).toEqual({
        blockHeight: 12345,
        timestamp: 1700000000,
        rpcUrl: RPC_URL,
      });
      expect(result.source).toBe("network-health-plugin");
    });

    it("returns ok:false on HTTP error", async () => {
      vi.stubGlobal("fetch", mockFetchError(502, "Bad Gateway"));

      const plugin = createNetworkHealthPlugin({ rpcUrl: RPC_URL });
      const result = await plugin.providers[0].fetch("health");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("HTTP 502: Bad Gateway");
      expect(result.source).toBe("network-health-plugin");
    });

    it("returns ok:false on network error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Connection refused")));

      const plugin = createNetworkHealthPlugin({ rpcUrl: RPC_URL });
      const result = await plugin.providers[0].fetch("health");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Connection refused");
      expect(result.source).toBe("network-health-plugin");
    });

    it("sends JSON-RPC POST to the configured rpcUrl", async () => {
      const mock = mockFetchOk({ jsonrpc: "2.0", id: 1, result: { height: 1 } });
      vi.stubGlobal("fetch", mock);

      const plugin = createNetworkHealthPlugin({ rpcUrl: RPC_URL });
      await plugin.providers[0].fetch("health");

      expect(mock).toHaveBeenCalledWith(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "getLastBlock", params: [], id: 1 }),
      });
    });
  });

  // ---------- tlsn-attest ----------
  describe("createTlsnAttestPlugin", () => {
    const mockAttestUrl = vi.fn();

    it("creates a plugin with correct metadata", () => {
      const plugin = createTlsnAttestPlugin({ attestUrl: mockAttestUrl });
      expect(plugin.name).toBe("tlsn-attest");
      expect(plugin.version).toBe("1.0.0");
      expect(plugin.providers).toHaveLength(1);
      expect(plugin.providers[0].name).toBe("tlsn-attest");
    });

    it("attests a URL successfully", async () => {
      const attestResult = { txHash: "0xabc123", tokenId: "42", requestTxHash: "0xdef456" };
      mockAttestUrl.mockResolvedValue(attestResult);

      const plugin = createTlsnAttestPlugin({ attestUrl: mockAttestUrl });
      const result: ProviderResult = await plugin.providers[0].fetch("https://example.com/api/data");

      expect(result.ok).toBe(true);
      expect(result.data).toEqual({
        txHash: "0xabc123",
        tokenId: "42",
        url: "https://example.com/api/data",
      });
      expect(result.source).toBe("tlsn-attest-plugin");
    });

    it("passes HTTP method from options", async () => {
      mockAttestUrl.mockResolvedValue({ txHash: "0x1" });

      const plugin = createTlsnAttestPlugin({ attestUrl: mockAttestUrl });
      await plugin.providers[0].fetch("https://example.com", { method: "POST" });

      expect(mockAttestUrl).toHaveBeenCalledWith("https://example.com", "POST");
    });

    it("defaults method to GET when not specified", async () => {
      mockAttestUrl.mockResolvedValue({ txHash: "0x1" });

      const plugin = createTlsnAttestPlugin({ attestUrl: mockAttestUrl });
      await plugin.providers[0].fetch("https://example.com");

      expect(mockAttestUrl).toHaveBeenCalledWith("https://example.com", "GET");
    });

    it("returns ok:false on attestation error", async () => {
      mockAttestUrl.mockRejectedValue(new Error("TLSN handshake failed"));

      const plugin = createTlsnAttestPlugin({ attestUrl: mockAttestUrl });
      const result = await plugin.providers[0].fetch("https://example.com");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("TLSN handshake failed");
      expect(result.source).toBe("tlsn-attest-plugin");
    });
  });

  // ---------- chain-query (scaffold) ----------
  describe("createChainQueryPlugin", () => {
    const config = { rpcUrl: RPC_URL, agentAddress: "demos1abc" };

    it("creates a plugin with correct metadata", () => {
      const plugin = createChainQueryPlugin(config);
      expect(plugin.name).toBe("chain-query");
      expect(plugin.version).toBe("1.0.0");
      expect(plugin.providers).toHaveLength(1);
      expect(plugin.providers[0].name).toBe("chain-query");
    });

    it("returns ok:false with blocker message", async () => {
      const plugin = createChainQueryPlugin(config);
      const result = await plugin.providers[0].fetch("balance");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("SDK blocker:");
      expect(result.error).toContain("XM SDK cross-chain operations untested");
      expect(result.source).toBe("chain-query-plugin");
    });
  });

  // ---------- address-watch (scaffold) ----------
  describe("createAddressWatchPlugin", () => {
    const config = { rpcUrl: RPC_URL, watchAddresses: ["demos1abc", "demos1def"] };

    it("creates a plugin with correct metadata", () => {
      const plugin = createAddressWatchPlugin(config);
      expect(plugin.name).toBe("address-watch");
      expect(plugin.version).toBe("1.0.0");
      expect(plugin.providers).toHaveLength(1);
      expect(plugin.providers[0].name).toBe("address-watch");
    });

    it("returns ok:false with blocker message", async () => {
      const plugin = createAddressWatchPlugin(config);
      const result = await plugin.providers[0].fetch("activity");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("SDK blocker:");
      expect(result.error).toContain("XM SDK cross-chain operations untested");
      expect(result.source).toBe("address-watch-plugin");
    });
  });

  // ---------- cci-identity (scaffold) ----------
  describe("createCCIIdentityPlugin", () => {
    const config = { rpcUrl: RPC_URL };

    it("creates a plugin with correct metadata", () => {
      const plugin = createCCIIdentityPlugin(config);
      expect(plugin.name).toBe("cci-identity");
      expect(plugin.version).toBe("1.0.0");
      expect(plugin.providers).toHaveLength(1);
      expect(plugin.providers[0].name).toBe("cci-identity");
    });

    it("returns ok:false with blocker message", async () => {
      const plugin = createCCIIdentityPlugin(config);
      const result = await plugin.providers[0].fetch("resolve");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("SDK blocker:");
      expect(result.error).toContain("CCI SDK module not yet validated");
      expect(result.source).toBe("cci-identity-plugin");
    });
  });

  // ---------- demoswork (scaffold) ----------
  describe("createDemosWorkPlugin", () => {
    const config = { rpcUrl: RPC_URL, agentAddress: "demos1abc" };

    it("creates a plugin with correct metadata", () => {
      const plugin = createDemosWorkPlugin(config);
      expect(plugin.name).toBe("demoswork");
      expect(plugin.version).toBe("1.0.0");
      expect(plugin.providers).toHaveLength(1);
      expect(plugin.providers[0].name).toBe("demoswork");
    });

    it("returns ok:false with blocker message", async () => {
      const plugin = createDemosWorkPlugin(config);
      const result = await plugin.providers[0].fetch("workflow");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("SDK blocker:");
      expect(result.error).toContain("DemosWork has ESM directory import bug");
      expect(result.source).toBe("demoswork-plugin");
    });
  });

  // ---------- sdk-setup (real) ----------
  describe("createSdkSetupPlugin", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("creates a plugin with correct metadata", () => {
      const plugin = createSdkSetupPlugin({ rpcUrl: RPC_URL });
      expect(plugin.name).toBe("sdk-setup");
      expect(plugin.version).toBe("1.0.0");
      expect(plugin.providers).toHaveLength(1);
      expect(plugin.providers[0].name).toBe("sdk-setup");
    });

    it("returns RPC connectivity status on success", async () => {
      vi.stubGlobal("fetch", mockFetchOk({ result: { height: 12345 } }));

      const plugin = createSdkSetupPlugin({ rpcUrl: RPC_URL, agentAddress: "0xagent" });
      const result: ProviderResult = await plugin.providers[0].fetch("health");

      expect(result.ok).toBe(true);
      expect(result.data).toEqual({
        rpcUrl: RPC_URL,
        rpcReachable: true,
        blockHeight: 12345,
        agentAddress: "0xagent",
      });
      expect(result.source).toBe("sdk-setup-plugin");
    });

    it("returns ok:false on RPC failure", async () => {
      vi.stubGlobal("fetch", mockFetchError(503, "Service Unavailable"));

      const plugin = createSdkSetupPlugin({ rpcUrl: RPC_URL });
      const result = await plugin.providers[0].fetch("health");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("RPC unreachable");
      expect(result.source).toBe("sdk-setup-plugin");
    });

    it("returns ok:false on network error", async () => {
      vi.stubGlobal("fetch", mockFetchNetworkError());

      const plugin = createSdkSetupPlugin({ rpcUrl: RPC_URL });
      const result = await plugin.providers[0].fetch("health");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("SDK setup check failed");
      expect(result.source).toBe("sdk-setup-plugin");
    });
  });

  // ---------- demos-wallet (real) ----------
  describe("createDemosWalletPlugin", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("creates a plugin with correct metadata", () => {
      const plugin = createDemosWalletPlugin({ rpcUrl: RPC_URL, agentAddress: "0xagent" });
      expect(plugin.name).toBe("demos-wallet");
      expect(plugin.version).toBe("1.0.0");
      expect(plugin.providers).toHaveLength(1);
      expect(plugin.providers[0].name).toBe("demos-wallet");
    });

    it("returns balance and address info on success", async () => {
      vi.stubGlobal("fetch", mockFetchOk({ result: { balance: 95.5, nonce: 42 } }));

      const plugin = createDemosWalletPlugin({ rpcUrl: RPC_URL, agentAddress: "0xagent" });
      const result: ProviderResult = await plugin.providers[0].fetch("balance");

      expect(result.ok).toBe(true);
      expect(result.data).toEqual({
        address: "0xagent",
        balance: 95.5,
        nonce: 42,
        rpcUrl: RPC_URL,
      });
      expect(result.source).toBe("demos-wallet-plugin");
    });

    it("allows querying a different address via options", async () => {
      const mock = mockFetchOk({ result: { balance: 10, nonce: 1 } });
      vi.stubGlobal("fetch", mock);

      const plugin = createDemosWalletPlugin({ rpcUrl: RPC_URL, agentAddress: "0xagent" });
      const result = await plugin.providers[0].fetch("balance", { address: "0xother" });

      expect(result.ok).toBe(true);
      expect((result.data as any).address).toBe("0xother");
    });

    it("returns ok:false on RPC error", async () => {
      vi.stubGlobal("fetch", mockFetchError(500, "Internal Server Error"));

      const plugin = createDemosWalletPlugin({ rpcUrl: RPC_URL, agentAddress: "0xagent" });
      const result = await plugin.providers[0].fetch("balance");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("HTTP 500");
      expect(result.source).toBe("demos-wallet-plugin");
    });

    it("returns ok:false on network error", async () => {
      vi.stubGlobal("fetch", mockFetchNetworkError());

      const plugin = createDemosWalletPlugin({ rpcUrl: RPC_URL, agentAddress: "0xagent" });
      const result = await plugin.providers[0].fetch("balance");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Network failure");
      expect(result.source).toBe("demos-wallet-plugin");
    });
  });
});
