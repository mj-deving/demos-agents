/**
 * TDD tests for packages/omniweb-toolkit.
 *
 * Tests the public API surface: connect(), Colony, hive.*, toolkit.*,
 * and agent re-exports.
 *
 * Strategy: Test createHiveAPI directly with injected mock runtime
 * (no vi.mock path resolution issues). Test connect() structure via
 * a module-level mock of the colony's dependency.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Toolkit } from "../../src/toolkit/primitives/types.js";

// ── Mock helpers ─────────────────────────────────

/** Build a stub Toolkit where every domain method returns a tagged ApiResult. */
function stubToolkit(): Toolkit {
  const tag = (domain: string, method: string) =>
    vi.fn().mockResolvedValue({ ok: true, data: { _stub: `${domain}.${method}` } });

  return {
    feed: {
      getRecent: tag("feed", "getRecent"),
      search: tag("feed", "search"),
      getPost: tag("feed", "getPost"),
      getThread: tag("feed", "getThread"),
      getPostDetail: tag("feed", "getPostDetail"),
      getRss: tag("feed", "getRss"),
    },
    intelligence: {
      getSignals: tag("intelligence", "getSignals"),
      getConvergence: tag("intelligence", "getConvergence"),
      getReport: tag("intelligence", "getReport"),
      getPredictionIntelligence: tag("intelligence", "getPredictionIntelligence"),
      getPredictionRecommendations: tag("intelligence", "getPredictionRecommendations"),
    },
    scores: {
      getLeaderboard: tag("scores", "getLeaderboard"),
      getTopPosts: tag("scores", "getTopPosts"),
    },
    agents: { list: tag("agents", "list"), getProfile: tag("agents", "getProfile"), getIdentities: tag("agents", "getIdentities") },
    actions: {
      tip: tag("actions", "tip"), react: tag("actions", "react"),
      getReactions: tag("actions", "getReactions"), getTipStats: tag("actions", "getTipStats"),
      getAgentTipStats: tag("actions", "getAgentTipStats"), placeBet: tag("actions", "placeBet"),
      placeHL: tag("actions", "placeHL"), registerBet: tag("actions", "registerBet"),
      registerHL: tag("actions", "registerHL"), registerEthBinaryBet: tag("actions", "registerEthBinaryBet"),
    },
    oracle: { get: tag("oracle", "get") },
    prices: { get: tag("prices", "get"), getHistory: tag("prices", "getHistory") },
    verification: { verifyDahr: tag("verification", "verifyDahr"), verifyTlsn: tag("verification", "verifyTlsn") },
    predictions: { query: tag("predictions", "query"), resolve: tag("predictions", "resolve"), markets: tag("predictions", "markets") },
    ballot: {
      getPool: tag("ballot", "getPool"),
      getHigherLowerPool: tag("ballot", "getHigherLowerPool"),
      getBinaryPools: tag("ballot", "getBinaryPools"),
      getEthPool: tag("ballot", "getEthPool"),
      getEthWinners: tag("ballot", "getEthWinners"),
      getEthHigherLowerPool: tag("ballot", "getEthHigherLowerPool"),
      getEthBinaryPools: tag("ballot", "getEthBinaryPools"),
      getSportsMarkets: tag("ballot", "getSportsMarkets"),
      getSportsPool: tag("ballot", "getSportsPool"),
      getSportsWinners: tag("ballot", "getSportsWinners"),
      getCommodityPool: tag("ballot", "getCommodityPool"),
    },
    webhooks: { list: tag("webhooks", "list"), create: tag("webhooks", "create"), delete: tag("webhooks", "delete") },
    identity: { lookup: tag("identity", "lookup") },
    balance: { get: tag("balance", "get") },
    health: { check: tag("health", "check") },
    stats: { get: tag("stats", "get") },
  } as unknown as Toolkit;
}

function stubRuntime(toolkit: Toolkit) {
  return {
    toolkit,
    sdkBridge: {} as any,
    address: "0xTEST_ADDRESS",
    rpcUrl: "https://rpc.test",
    algorithm: "ed25519" as const,
    getToken: vi.fn().mockResolvedValue("mock-token"),
    demos: {} as any,
    authenticatedApiCall: vi.fn(),
    llmProvider: null,
  };
}

// ── Mock the entire colony module's createAgentRuntime dependency ─────

const mockToolkit = stubToolkit();
const mockRuntime = stubRuntime(mockToolkit);

// Mock at paths resolved from this test file (tests/packages/).
// vi.mock resolves relative to the test file, then intercepts by absolute module ID.
// From tests/packages/, ../../src/ reaches the project's src/.

vi.mock("../../src/toolkit/agent-runtime.js", () => ({
  createAgentRuntime: vi.fn().mockResolvedValue({
    toolkit: mockToolkit,
    sdkBridge: {},
    address: "0xTEST_ADDRESS",
    rpcUrl: "https://rpc.test",
    algorithm: "ed25519",
    getToken: vi.fn().mockResolvedValue("mock-token"),
    demos: {},
    authenticatedApiCall: vi.fn(),
    llmProvider: null,
  }),
}));

vi.mock("../../src/toolkit/agent-loop.js", () => ({
  runAgentLoop: vi.fn(),
  defaultObserve: vi.fn(),
  buildColonyStateFromFeed: vi.fn(),
}));

vi.mock("../../src/toolkit/supercolony/types.js", () => ({}));

// ── Tests ────────────────────────────────────────

describe("supercolony-toolkit package", () => {
  describe("connect()", () => {
    it("creates a Colony instance with toolkit, hive, runtime, and address", async () => {
      const { connect } = await import("../../packages/omniweb-toolkit/src/index.js");
      const colony = await connect();

      expect(colony).toBeDefined();
      expect(colony.toolkit).toBeDefined();
      expect(colony.hive).toBeDefined();
      expect(colony.runtime).toBeDefined();
      expect(colony.address).toBe("0xTEST_ADDRESS");
    });

    it("passes options through to createAgentRuntime", async () => {
      const { connect } = await import("../../packages/omniweb-toolkit/src/index.js");
      // Access the mock via the colony module's internal import (same module identity)
      const { createAgentRuntime } = await import("../../packages/omniweb-toolkit/src/colony.js") as any;
      // colony.ts re-exports nothing, so we verify via the mocked module.
      // We use the vi.mocked approach: the mock is registered at ../../../src/toolkit/agent-runtime.js
      // which is the path colony.ts uses. Verify connect() calls it with our options.
      const mod = await vi.importMock<any>("../../src/toolkit/agent-runtime.js");
      mod.createAgentRuntime.mockClear();
      await connect({ envPath: "/custom/.env", agentName: "test-agent" });

      expect(mod.createAgentRuntime).toHaveBeenCalledWith(
        expect.objectContaining({ envPath: "/custom/.env", agentName: "test-agent" }),
      );
    });
  });

  describe("top-level memo helpers", () => {
    it("exports deterministic betting memo builders", async () => {
      const {
        buildBetMemo,
        buildHigherLowerMemo,
        buildBinaryBetMemo,
        VALID_BET_HORIZONS,
      } = await import("../../packages/omniweb-toolkit/src/index.js");

      expect(buildBetMemo("BTC", 70000, { horizon: "30m" })).toBe("HIVE_BET:BTC:70000:30m");
      expect(buildHigherLowerMemo("ETH", "lower", { horizon: "4h" })).toBe("HIVE_HL:ETH:LOWER:4h");
      expect(buildBinaryBetMemo("market-1", "yes")).toBe("HIVE_BINARY:market-1:YES");
      expect(VALID_BET_HORIZONS).toEqual(["10m", "30m", "4h", "24h"]);
    });
  });

  describe("Colony.toolkit — 15 domains", () => {
    it("exposes all 15 toolkit domains", async () => {
      const { connect } = await import("../../packages/omniweb-toolkit/src/index.js");
      const colony = await connect();
      const domains = [
        "feed", "intelligence", "scores", "agents", "actions",
        "oracle", "prices", "verification", "predictions", "ballot",
        "webhooks", "identity", "balance", "health", "stats",
      ];
      for (const domain of domains) {
        expect((colony.toolkit as Record<string, unknown>)[domain]).toBeDefined();
      }
    });
  });

  describe("Colony.hive — convenience API (via createHiveAPI)", () => {
    // Test hive methods directly by importing createHiveAPI with injected runtime
    let hive: any;

    beforeEach(async () => {
      // Reset call history only — keep mock implementations
      for (const domain of Object.values(mockToolkit)) {
        for (const fn of Object.values(domain as Record<string, any>)) {
          if (typeof fn === "function" && "mockClear" in fn) {
            (fn as ReturnType<typeof vi.fn>).mockClear();
          }
        }
      }
      const { createHiveAPI } = await import("../../packages/omniweb-toolkit/src/hive.js");
      hive = createHiveAPI(mockRuntime as any);
    });

    it("getFeed() delegates to toolkit.feed.getRecent()", async () => {
      await hive.getFeed({ limit: 10, category: "market" });
      expect(mockToolkit.feed.getRecent).toHaveBeenCalledWith({ limit: 10, category: "market" });
    });

    it("search() delegates to toolkit.feed.search()", async () => {
      await hive.search({ text: "bitcoin", category: "market" });
      expect(mockToolkit.feed.search).toHaveBeenCalledWith({ text: "bitcoin", category: "market" });
    });

    it("getPostDetail() delegates to toolkit.feed.getPostDetail()", async () => {
      await hive.getPostDetail("0xabc");
      expect(mockToolkit.feed.getPostDetail).toHaveBeenCalledWith("0xabc");
    });

    it("tip() delegates to toolkit.actions.tip()", async () => {
      await hive.tip("0xabc", 100);
      expect(mockToolkit.actions.tip).toHaveBeenCalledWith("0xabc", 100);
    });

    it("react() delegates to toolkit.actions.react()", async () => {
      await hive.react("0xabc", "agree");
      expect(mockToolkit.actions.react).toHaveBeenCalledWith("0xabc", "agree");
    });

    it("getOracle() delegates to toolkit.oracle.get()", async () => {
      await hive.getOracle({ assets: ["BTC"] });
      expect(mockToolkit.oracle.get).toHaveBeenCalledWith({ assets: ["BTC"] });
    });

    it("getPrices() delegates to toolkit.prices.get()", async () => {
      await hive.getPrices(["BTC", "ETH"]);
      expect(mockToolkit.prices.get).toHaveBeenCalledWith(["BTC", "ETH"]);
    });

    it("getPriceHistory() delegates to toolkit.prices.getHistory()", async () => {
      await hive.getPriceHistory("BTC", 30);
      expect(mockToolkit.prices.getHistory).toHaveBeenCalledWith("BTC", 30);
    });

    it("getBalance() delegates to toolkit.balance.get() with runtime address", async () => {
      await hive.getBalance();
      expect(mockToolkit.balance.get).toHaveBeenCalledWith("0xTEST_ADDRESS");
    });

    it("getPool() delegates to toolkit.ballot.getPool()", async () => {
      await hive.getPool({ asset: "BTC", horizon: "24h" });
      expect(mockToolkit.ballot.getPool).toHaveBeenCalledWith({ asset: "BTC", horizon: "24h" });
    });

    it("getHigherLowerPool() delegates to toolkit.ballot.getHigherLowerPool()", async () => {
      await hive.getHigherLowerPool({ asset: "BTC", horizon: "30m" });
      expect(mockToolkit.ballot.getHigherLowerPool).toHaveBeenCalledWith({ asset: "BTC", horizon: "30m" });
    });

    it("getBinaryPools() delegates to toolkit.ballot.getBinaryPools()", async () => {
      await hive.getBinaryPools({ category: "crypto", limit: 4 });
      expect(mockToolkit.ballot.getBinaryPools).toHaveBeenCalledWith({ category: "crypto", limit: 4 });
    });

    it("getEthPool() delegates to toolkit.ballot.getEthPool()", async () => {
      await hive.getEthPool({ asset: "BTC", horizon: "30m" });
      expect(mockToolkit.ballot.getEthPool).toHaveBeenCalledWith({ asset: "BTC", horizon: "30m" });
    });

    it("getEthWinners() delegates to toolkit.ballot.getEthWinners()", async () => {
      await hive.getEthWinners({ asset: "BTC" });
      expect(mockToolkit.ballot.getEthWinners).toHaveBeenCalledWith({ asset: "BTC" });
    });

    it("getEthHigherLowerPool() delegates to toolkit.ballot.getEthHigherLowerPool()", async () => {
      await hive.getEthHigherLowerPool({ asset: "BTC", horizon: "30m" });
      expect(mockToolkit.ballot.getEthHigherLowerPool).toHaveBeenCalledWith({ asset: "BTC", horizon: "30m" });
    });

    it("getEthBinaryPools() delegates to toolkit.ballot.getEthBinaryPools()", async () => {
      await hive.getEthBinaryPools();
      expect(mockToolkit.ballot.getEthBinaryPools).toHaveBeenCalledWith();
    });

    it("getSportsMarkets() delegates to toolkit.ballot.getSportsMarkets()", async () => {
      await hive.getSportsMarkets({ status: "live" });
      expect(mockToolkit.ballot.getSportsMarkets).toHaveBeenCalledWith({ status: "live" });
    });

    it("getSportsPool() delegates to toolkit.ballot.getSportsPool()", async () => {
      await hive.getSportsPool("nba_espn_401866757");
      expect(mockToolkit.ballot.getSportsPool).toHaveBeenCalledWith("nba_espn_401866757");
    });

    it("getSportsWinners() delegates to toolkit.ballot.getSportsWinners()", async () => {
      await hive.getSportsWinners("nba_espn_401866757");
      expect(mockToolkit.ballot.getSportsWinners).toHaveBeenCalledWith("nba_espn_401866757");
    });

    it("getCommodityPool() delegates to toolkit.ballot.getCommodityPool()", async () => {
      await hive.getCommodityPool({ asset: "XAU", horizon: "30m" });
      expect(mockToolkit.ballot.getCommodityPool).toHaveBeenCalledWith({ asset: "XAU", horizon: "30m" });
    });

    it("getSignals() delegates to toolkit.intelligence.getSignals()", async () => {
      await hive.getSignals();
      expect(mockToolkit.intelligence.getSignals).toHaveBeenCalled();
    });

    it("getConvergence() delegates to toolkit.intelligence.getConvergence()", async () => {
      await hive.getConvergence();
      expect(mockToolkit.intelligence.getConvergence).toHaveBeenCalled();
    });

    it("getReport() delegates to toolkit.intelligence.getReport()", async () => {
      await hive.getReport({ id: "daily-1" });
      expect(mockToolkit.intelligence.getReport).toHaveBeenCalledWith({ id: "daily-1" });
    });

    it("getPredictionIntelligence() delegates to toolkit.intelligence.getPredictionIntelligence()", async () => {
      await hive.getPredictionIntelligence({ limit: 5, stats: true });
      expect(mockToolkit.intelligence.getPredictionIntelligence).toHaveBeenCalledWith({ limit: 5, stats: true });
    });

    it("getPredictionRecommendations() delegates to toolkit.intelligence.getPredictionRecommendations()", async () => {
      await hive.getPredictionRecommendations("demo");
      expect(mockToolkit.intelligence.getPredictionRecommendations).toHaveBeenCalledWith("demo");
    });

    it("getLeaderboard() delegates to toolkit.scores.getLeaderboard()", async () => {
      await hive.getLeaderboard({ limit: 5 });
      expect(mockToolkit.scores.getLeaderboard).toHaveBeenCalledWith({ limit: 5 });
    });

    it("getTopPosts() delegates to toolkit.scores.getTopPosts()", async () => {
      await hive.getTopPosts({ category: "ANALYSIS", limit: 3 });
      expect(mockToolkit.scores.getTopPosts).toHaveBeenCalledWith({ category: "ANALYSIS", limit: 3 });
    });

    it("getAgents() delegates to toolkit.agents.list()", async () => {
      await hive.getAgents();
      expect(mockToolkit.agents.list).toHaveBeenCalled();
    });

    it("placeBet() delegates to toolkit.actions.placeBet()", async () => {
      await hive.placeBet("BTC", 50000, { horizon: "24h" });
      expect(mockToolkit.actions.placeBet).toHaveBeenCalledWith("BTC", 50000, { horizon: "24h" });
    });

    it("placeHL() delegates to toolkit.actions.placeHL()", async () => {
      await hive.placeHL("BTC", "higher", { amount: 2, horizon: "4h" });
      expect(mockToolkit.actions.placeHL).toHaveBeenCalledWith("BTC", "higher", { amount: 2, horizon: "4h" });
    });

    it("registerBet() delegates to toolkit.actions.registerBet()", async () => {
      await hive.registerBet("tx1", "BTC", 70000, { horizon: "30m" });
      expect(mockToolkit.actions.registerBet).toHaveBeenCalledWith("tx1", "BTC", 70000, { horizon: "30m" });
    });

    it("registerHL() delegates to toolkit.actions.registerHL()", async () => {
      await hive.registerHL("tx2", "ETH", "lower", { horizon: "4h" });
      expect(mockToolkit.actions.registerHL).toHaveBeenCalledWith("tx2", "ETH", "lower", { horizon: "4h" });
    });

    it("registerEthBinaryBet() delegates to toolkit.actions.registerEthBinaryBet()", async () => {
      const txHash = `0x${"a".repeat(64)}`;
      await hive.registerEthBinaryBet(txHash);
      expect(mockToolkit.actions.registerEthBinaryBet).toHaveBeenCalledWith(txHash);
    });

    it("getReactions() delegates to toolkit.actions.getReactions()", async () => {
      await hive.getReactions("0xabc");
      expect(mockToolkit.actions.getReactions).toHaveBeenCalledWith("0xabc");
    });

    it("getTipStats() delegates to toolkit.actions.getTipStats()", async () => {
      await hive.getTipStats("0xabc");
      expect(mockToolkit.actions.getTipStats).toHaveBeenCalledWith("0xabc");
    });
  });

  describe("agent subpath re-exports", () => {
    it("exports runAgentLoop", async () => {
      const agent = await import("../../packages/omniweb-toolkit/src/agent.js");
      expect(typeof agent.runAgentLoop).toBe("function");
    });

    it("exports defaultObserve", async () => {
      const agent = await import("../../packages/omniweb-toolkit/src/agent.js");
      expect(typeof agent.defaultObserve).toBe("function");
    });

    it("exports buildColonyStateFromFeed", async () => {
      const agent = await import("../../packages/omniweb-toolkit/src/agent.js");
      expect(typeof agent.buildColonyStateFromFeed).toBe("function");
    });
  });

  describe("types subpath", () => {
    it("exports are importable (type re-exports compile)", async () => {
      const types = await import("../../packages/omniweb-toolkit/src/types.js");
      expect(types).toBeDefined();
    });
  });
});
