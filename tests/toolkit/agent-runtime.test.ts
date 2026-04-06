/**
 * Tests for agent-runtime.ts — factory encapsulating the 6-step SDK init.
 *
 * Mocks at the SDK boundary:
 * - connectWallet -> fake demos + address
 * - ensureAuth -> token (and test graceful failure)
 * - createSdkBridge -> mock bridge
 * - SuperColonyApiClient -> mock
 * - createToolkit -> real (verify 15 domains)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted values (available inside vi.mock factories) ──

const FAKE_ADDRESS = "0xfakeaddress1234567890";
const FAKE_TOKEN = "test-auth-token-123";

const { fakeDemos, mockSdkBridge, mockConnectWallet, mockEnsureAuth, mockLoadAuthCache, mockApiCall, mockResolveProvider } = vi.hoisted(() => {
  const fakeDemos = {
    connect: vi.fn(),
    connectWallet: vi.fn(),
    getAddress: vi.fn().mockReturnValue("0xfakeaddress1234567890"),
  } as any;

  const mockSdkBridge = {
    apiCall: vi.fn().mockResolvedValue({ ok: true, status: 200, data: {} }),
    publishHivePost: vi.fn().mockResolvedValue({ txHash: "0xpub" }),
    transferDem: vi.fn().mockResolvedValue({ txHash: "0xtip" }),
    getHivePosts: vi.fn().mockResolvedValue([]),
    getHivePostsByAuthor: vi.fn().mockResolvedValue([]),
    getRepliesTo: vi.fn().mockResolvedValue([]),
    resolvePostAuthor: vi.fn().mockResolvedValue(null),
    verifyTransaction: vi.fn().mockResolvedValue(null),
    apiAccessState: vi.fn().mockReturnValue("authenticated" as const),
  };

  return {
    fakeDemos,
    mockSdkBridge,
    mockConnectWallet: vi.fn().mockResolvedValue({ demos: fakeDemos, address: "0xfakeaddress1234567890" }),
    mockEnsureAuth: vi.fn().mockResolvedValue("test-auth-token-123"),
    mockLoadAuthCache: vi.fn().mockReturnValue({ token: "test-auth-token-123", expiresAt: "2099-01-01", address: "0xfakeaddress1234567890" }),
    mockApiCall: vi.fn().mockResolvedValue({ ok: true, status: 200, data: {} }),
    mockResolveProvider: vi.fn().mockReturnValue({ name: "mock-provider", generate: vi.fn().mockResolvedValue("mock response") }),
  };
});

vi.mock("../../src/lib/network/sdk.js", () => ({
  connectWallet: mockConnectWallet,
  apiCall: mockApiCall,
}));

vi.mock("../../src/lib/auth/auth.js", () => ({
  ensureAuth: mockEnsureAuth,
  loadAuthCache: mockLoadAuthCache,
}));

vi.mock("../../src/toolkit/sdk-bridge.js", () => ({
  createSdkBridge: vi.fn().mockReturnValue(mockSdkBridge),
  AUTH_PENDING_TOKEN: "__AUTH_PENDING__",
}));

vi.mock("../../src/lib/llm/llm-provider.js", () => ({
  resolveProvider: mockResolveProvider,
}));

// ── Import under test ────────────────────────────

import { createAgentRuntime } from "../../src/toolkit/agent-runtime.js";
import { createSdkBridge } from "../../src/toolkit/sdk-bridge.js";

// ── Tests ────────────────────────────────────────

describe("createAgentRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore defaults after clearAllMocks
    mockConnectWallet.mockResolvedValue({ demos: fakeDemos, address: FAKE_ADDRESS });
    mockEnsureAuth.mockResolvedValue(FAKE_TOKEN);
    mockLoadAuthCache.mockReturnValue({ token: FAKE_TOKEN, expiresAt: "2099-01-01", address: FAKE_ADDRESS });
    mockApiCall.mockResolvedValue({ ok: true, status: 200, data: {} });
    mockResolveProvider.mockReturnValue({ name: "mock-provider", generate: vi.fn() });
  });

  it("returns a complete AgentRuntime with all required fields", async () => {
    const runtime = await createAgentRuntime({ envPath: ".env" });

    expect(runtime.address).toBe(FAKE_ADDRESS);
    expect(runtime.demos).toBe(fakeDemos);
    expect(runtime.sdkBridge).toBe(mockSdkBridge);
    expect(typeof runtime.getToken).toBe("function");
    expect(typeof runtime.authenticatedApiCall).toBe("function");
    expect(runtime.toolkit).toBeDefined();
    expect(runtime.llmProvider).toBeDefined();
    expect(runtime.llmProvider?.name).toBe("mock-provider");
  });

  it("calls connectWallet with provided envPath", async () => {
    await createAgentRuntime({ envPath: "/custom/.env" });
    expect(mockConnectWallet).toHaveBeenCalledWith("/custom/.env", undefined);
  });

  it("calls connectWallet with agentName when provided", async () => {
    await createAgentRuntime({ envPath: ".env", agentName: "sentinel" });
    expect(mockConnectWallet).toHaveBeenCalledWith(".env", "sentinel");
  });

  it("calls createSdkBridge with demos, apiBaseUrl, and AUTH_PENDING_TOKEN", async () => {
    await createAgentRuntime({ apiBaseUrl: "https://custom.api.com" });
    expect(createSdkBridge).toHaveBeenCalledWith(fakeDemos, "https://custom.api.com", "__AUTH_PENDING__");
  });

  it("calls ensureAuth with demos and address", async () => {
    await createAgentRuntime();
    expect(mockEnsureAuth).toHaveBeenCalledWith(fakeDemos, FAKE_ADDRESS);
  });

  it("toolkit has all 15 domains", async () => {
    const runtime = await createAgentRuntime();
    const expectedDomains = [
      "feed", "intelligence", "scores", "agents", "actions",
      "oracle", "prices", "verification", "predictions", "ballot",
      "webhooks", "identity", "balance", "health", "stats",
    ];
    for (const domain of expectedDomains) {
      expect(runtime.toolkit).toHaveProperty(domain);
      expect((runtime.toolkit as any)[domain]).toBeDefined();
    }
  });

  it("getToken returns the auth token", async () => {
    const runtime = await createAgentRuntime();
    const token = await runtime.getToken();
    expect(token).toBe(FAKE_TOKEN);
  });

  it("authenticatedApiCall passes the token to apiCall", async () => {
    const runtime = await createAgentRuntime();
    await runtime.authenticatedApiCall("/api/test", { method: "POST" });
    expect(mockApiCall).toHaveBeenCalledWith("/api/test", FAKE_TOKEN, { method: "POST" });
  });

  describe("graceful auth degradation", () => {
    it("continues when ensureAuth throws", async () => {
      mockEnsureAuth.mockRejectedValueOnce(new Error("Auth server down"));
      const runtime = await createAgentRuntime();

      expect(runtime.address).toBe(FAKE_ADDRESS);
      expect(runtime.toolkit).toBeDefined();
    });

    it("getToken falls back to loadAuthCache on auth failure", async () => {
      mockEnsureAuth.mockRejectedValueOnce(new Error("Auth failed"));
      const runtime = await createAgentRuntime();
      const token = await runtime.getToken();
      expect(token).toBe(FAKE_TOKEN);
    });

    it("getToken returns null when auth fails and no cache exists", async () => {
      mockEnsureAuth.mockRejectedValueOnce(new Error("Auth failed"));
      mockLoadAuthCache.mockReturnValue(null);
      const runtime = await createAgentRuntime();
      const token = await runtime.getToken();
      expect(token).toBeNull();
    });
  });

  it("defaults envPath to .env when not provided", async () => {
    await createAgentRuntime();
    expect(mockConnectWallet).toHaveBeenCalledWith(".env", undefined);
  });

  it("colonyDb is undefined by default", async () => {
    const runtime = await createAgentRuntime();
    expect(runtime.colonyDb).toBeUndefined();
  });

  it("llmProvider is null when resolveProvider returns null", async () => {
    mockResolveProvider.mockReturnValue(null);
    const runtime = await createAgentRuntime();
    expect(runtime.llmProvider).toBeNull();
  });
});
