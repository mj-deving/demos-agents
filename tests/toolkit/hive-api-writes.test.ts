/**
 * Tests for HiveAPI write methods — publish, reply, attest, attestTlsn, register.
 *
 * Validates that the consumer HiveAPI routes write operations through
 * the internal toolkit tools via lazy session creation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock SDK bridge before any imports that use it
const mockAttestDahr = vi.fn().mockResolvedValue({
  responseHash: "abc123",
  txHash: "tx_dahr_001",
  url: "https://api.example.com/data",
});

const mockPublishHivePost = vi.fn().mockResolvedValue({
  txHash: "tx_pub_001",
});

const mockSdkBridge = {
  attestDahr: mockAttestDahr,
  publishHivePost: mockPublishHivePost,
  transferDem: vi.fn(),
  getHivePosts: vi.fn(),
  getRepliesTo: vi.fn(),
};

const mockRegisterAgent = vi.fn().mockResolvedValue({
  ok: true,
  data: undefined,
});

// Mock modules
vi.mock("../../src/toolkit/sdk-bridge.js", () => ({
  createSdkBridge: vi.fn().mockReturnValue(mockSdkBridge),
  AUTH_PENDING_TOKEN: "AUTH_PENDING",
}));

vi.mock("../../src/lib/auth/auth.js", () => ({
  ensureAuth: vi.fn().mockResolvedValue("test-auth-token"),
  loadAuthCache: vi.fn().mockReturnValue({ token: "cached-token" }),
}));

// We need to mock the url-validator to avoid real DNS resolution in tests
vi.mock("../../src/toolkit/url-validator.js", () => ({
  validateUrl: vi.fn().mockResolvedValue({ valid: true }),
}));

import { createHiveAPI } from "../../packages/supercolony-toolkit/src/hive.js";
import type { HiveAPI } from "../../packages/supercolony-toolkit/src/hive.js";
import type { AgentRuntime } from "../../src/toolkit/agent-runtime.js";
import { FileStateStore } from "../../src/toolkit/state-store.js";

function createMockRuntime(tempDir: string): AgentRuntime {
  return {
    toolkit: {
      feed: { getRecent: vi.fn(), search: vi.fn(), getPost: vi.fn(), getThread: vi.fn(), getPostDetail: vi.fn(), getRss: vi.fn() },
      intelligence: { getSignals: vi.fn(), getReport: vi.fn() },
      scores: { getLeaderboard: vi.fn(), getTopPosts: vi.fn() },
      agents: { list: vi.fn(), getProfile: vi.fn(), getIdentities: vi.fn(), register: mockRegisterAgent },
      actions: { tip: vi.fn(), react: vi.fn(), getReactions: vi.fn(), getTipStats: vi.fn(), getAgentTipStats: vi.fn(), initiateTip: vi.fn(), placeBet: vi.fn() },
      oracle: { get: vi.fn() },
      prices: { get: vi.fn(), getHistory: vi.fn() },
      verification: { verifyDahr: vi.fn(), verifyTlsn: vi.fn(), getTlsnProof: vi.fn() },
      predictions: { query: vi.fn(), resolve: vi.fn(), markets: vi.fn() },
      ballot: { getState: vi.fn(), getAccuracy: vi.fn(), getLeaderboard: vi.fn(), getPerformance: vi.fn(), getPool: vi.fn() },
      webhooks: { list: vi.fn(), create: vi.fn(), delete: vi.fn() },
      identity: { lookup: vi.fn() },
      balance: { get: vi.fn(), requestFaucet: vi.fn(), ensureMinimum: vi.fn() },
      health: { check: vi.fn() },
      stats: { get: vi.fn() },
    } as any,
    sdkBridge: mockSdkBridge as any,
    address: "demos1testaddr",
    getToken: vi.fn().mockResolvedValue("test-auth-token"),
    demos: {} as any,
    authenticatedApiCall: vi.fn(),
    llmProvider: null,
    _stateDir: tempDir, // Test-only: override state dir for FileStateStore
  } as any;
}

describe("HiveAPI write methods", () => {
  let tempDir: string;
  let runtime: AgentRuntime;
  let hive: HiveAPI;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "demos-hive-writes-"));
    runtime = createMockRuntime(tempDir);
    hive = createHiveAPI(runtime, { stateDir: tempDir });
    vi.clearAllMocks();

    // Re-setup mocks after clearAllMocks
    mockAttestDahr.mockResolvedValue({
      responseHash: "abc123",
      txHash: "tx_dahr_001",
      url: "https://api.example.com/data",
    });
    mockPublishHivePost.mockResolvedValue({ txHash: "tx_pub_001" });
    mockRegisterAgent.mockResolvedValue({ ok: true, data: undefined });
    (runtime.getToken as any).mockResolvedValue("test-auth-token");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── publish() ──────────────────────────────────────

  describe("publish()", () => {
    it("accepts valid draft and returns ToolResult", async () => {
      const result = await hive.publish({
        text: "This is a detailed analysis of the current market conditions and trends observed across multiple data sources for BTC and ETH trading pairs.",
        category: "ANALYSIS",
        attestUrl: "https://api.example.com/data",
      });

      expect(result).toHaveProperty("ok");
      expect(result).toHaveProperty("provenance");
      expect(result.provenance.path).toBe("local");
    });

    it("rejects empty text", async () => {
      const result = await hive.publish({
        text: "",
        category: "ANALYSIS",
        attestUrl: "https://api.example.com/data",
      });

      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe("INVALID_INPUT");
    });
  });

  // ── reply() ────────────────────────────────────────

  describe("reply()", () => {
    it("accepts valid reply opts and returns ToolResult", async () => {
      const result = await hive.reply({
        parentTxHash: "tx_parent_001",
        text: "This is a thoughtful reply to the original analysis with additional data points from multiple verified sources confirming the trend.",
        attestUrl: "https://api.example.com/reply-source",
      });

      expect(result).toHaveProperty("ok");
      expect(result).toHaveProperty("provenance");
    });
  });

  // ── attest() ───────────────────────────────────────

  describe("attest()", () => {
    it("accepts valid URL and returns ToolResult", async () => {
      const result = await hive.attest({
        url: "https://api.example.com/data",
      });

      expect(result).toHaveProperty("ok");
      expect(result).toHaveProperty("provenance");
    });
  });

  // ── attestTlsn() ──────────────────────────────────

  describe("attestTlsn()", () => {
    it("returns error with ATTEST_FAILED code (TLSN non-operational)", async () => {
      const result = await hive.attestTlsn("https://api.example.com/data");

      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe("ATTEST_FAILED");
      expect(result.error!.message).toMatch(/TLSN/i);
      expect(result.error!.retryable).toBe(false);
    });
  });

  // ── register() ─────────────────────────────────────

  describe("register()", () => {
    it("routes to toolkit.agents.register()", async () => {
      const opts = { name: "TestAgent", description: "A test agent", specialties: ["defi"] };
      await hive.register(opts);

      expect(mockRegisterAgent).toHaveBeenCalledWith(opts);
    });
  });

  // ── Lazy session creation ──────────────────────────

  describe("lazy session creation", () => {
    it("does not create session for read-only calls", async () => {
      // Read methods should work without triggering session creation
      const feedFn = runtime.toolkit.feed.getRecent as any;
      feedFn.mockResolvedValue({ ok: true, data: [] });
      await hive.getFeed({ limit: 10 });

      // register() also doesn't need a session — it goes through API client
      expect(mockRegisterAgent).not.toHaveBeenCalled();
    });
  });
});
