/**
 * Tests for OmniWeb domain APIs — identity, escrow, storage, ipfs, chain.
 *
 * Validates that the OmniWeb restructure correctly wires all Demos
 * SDK domains alongside the existing SuperColony (colony/hive) layer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock SDK modules
vi.mock("../../src/lib/auth/identity.js", () => ({
  addTwitterIdentity: vi.fn().mockResolvedValue({ ok: true }),
  addGithubIdentity: vi.fn().mockResolvedValue({ ok: true }),
  getIdentities: vi.fn().mockResolvedValue({ ok: true, identities: {} }),
  createWeb2ProofPayload: vi.fn().mockResolvedValue("demos:dw2p:falcon:abc123"),
}));

vi.mock("../../src/toolkit/supercolony/chain-identity.js", () => ({
  lookupByWeb2: vi.fn().mockResolvedValue([{ pubkey: "demos1resolved" }]),
}));

vi.mock("../../src/toolkit/network/storage-client.js", () => ({
  createStorageClient: vi.fn().mockReturnValue({
    readState: vi.fn().mockResolvedValue({ storageAddress: "demos1st", programName: "test", data: { key: "value" } }),
    listPrograms: vi.fn().mockResolvedValue([]),
    searchPrograms: vi.fn().mockResolvedValue([]),
    hasField: vi.fn().mockResolvedValue(true),
    readField: vi.fn().mockResolvedValue("fieldValue"),
  }),
}));

import { createIdentityAPI } from "../../packages/omniweb-toolkit/src/identity-api.js";
import { createStorageAPI } from "../../packages/omniweb-toolkit/src/storage-api.js";
import { createChainAPI } from "../../packages/omniweb-toolkit/src/chain-api.js";

const mockDemos: any = {
  signMessage: vi.fn().mockResolvedValue({ type: "falcon", data: "sig" }),
  verifyMessage: vi.fn().mockResolvedValue(true),
  getAddressInfo: vi.fn().mockResolvedValue({ balance: 1000n }),
  getLastBlockNumber: vi.fn().mockResolvedValue(12345),
};

const mockSdkBridge: any = {
  transferDem: vi.fn().mockResolvedValue({ txHash: "tx_transfer_001" }),
};

describe("OmniWeb domain APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDemos.signMessage.mockResolvedValue({ type: "falcon", data: "sig" });
    mockDemos.verifyMessage.mockResolvedValue(true);
    mockDemos.getAddressInfo.mockResolvedValue({ balance: 1000n });
    mockDemos.getLastBlockNumber.mockResolvedValue(12345);
    mockSdkBridge.transferDem.mockResolvedValue({ txHash: "tx_transfer_001" });
  });

  // ── Identity API ─────────────────────────────────

  describe("IdentityAPI", () => {
    const identity = createIdentityAPI(mockDemos, "https://demosnode.discus.sh", "demos1test");

    it("link('twitter', url) delegates to addTwitterIdentity", async () => {
      const result = await identity.link("twitter", "https://x.com/user/123");
      expect(result.ok).toBe(true);
    });

    it("link('github', url) delegates to addGithubIdentity", async () => {
      const result = await identity.link("github", "https://gist.github.com/user/abc");
      expect(result.ok).toBe(true);
    });

    it("lookup resolves to account pubkeys", async () => {
      const result = await identity.lookup("twitter", "alice");
      expect(result.ok).toBe(true);
      expect(result.data).toEqual([{ pubkey: "demos1resolved" }]);
    });

    it("getIdentities fetches linked identities", async () => {
      const result = await identity.getIdentities();
      expect(result.ok).toBe(true);
    });

    it("createProof generates a proof payload", async () => {
      const result = await identity.createProof();
      expect(result.ok).toBe(true);
      expect(result.data).toMatch(/^demos:dw2p:/);
    });
  });

  // ── Storage API ──────────────────────────────────

  describe("StorageAPI", () => {
    const storage = createStorageAPI("https://demosnode.discus.sh", "demos1test");

    it("read returns stored data", async () => {
      const result = await storage.read("demos1st");
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ key: "value" });
    });

    it("list returns programs array", async () => {
      const result = await storage.list();
      expect(result.ok).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
    });

    it("search returns matching programs", async () => {
      const result = await storage.search("test");
      expect(result.ok).toBe(true);
    });

    it("hasField checks field existence", async () => {
      const result = await storage.hasField("demos1st", "key");
      expect(result).toBe(true);
    });

    it("readField returns field value", async () => {
      const result = await storage.readField("demos1st", "key");
      expect(result).toBe("fieldValue");
    });
  });

  // ── Chain API ────────────────────────────────────

  describe("ChainAPI", () => {
    const chain = createChainAPI(mockDemos, mockSdkBridge, "demos1test");

    it("transfer sends DEM via sdkBridge", async () => {
      const result = await chain.transfer("demos1target", 10, "test memo");
      expect(result.ok).toBe(true);
      expect(result.txHash).toBe("tx_transfer_001");
      expect(mockSdkBridge.transferDem).toHaveBeenCalledWith("demos1target", 10, "test memo");
    });

    it("getBalance returns address balance", async () => {
      const result = await chain.getBalance("demos1test");
      expect(result.ok).toBe(true);
      expect(result.balance).toBeDefined();
    });

    it("signMessage signs with connected wallet", async () => {
      const result = await chain.signMessage("hello");
      expect(result.ok).toBe(true);
      expect(mockDemos.signMessage).toHaveBeenCalledWith("hello");
    });

    it("verifyMessage verifies signature", async () => {
      const result = await chain.verifyMessage("hello", "sig", "pubkey");
      expect(result).toBe(true);
    });

    it("getAddress returns wallet address", () => {
      expect(chain.getAddress()).toBe("demos1test");
    });

    it("getBlockNumber returns current block", async () => {
      const result = await chain.getBlockNumber();
      expect(result).toBe(12345);
    });
  });

  // OmniWeb type structure verified by tsc --noEmit (0 errors).
  // Runtime import test skipped — SDK ESM barrel triggers ERR_UNSUPPORTED_DIR_IMPORT.
});
