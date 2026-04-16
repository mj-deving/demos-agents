/**
 * Tests for SuperColonyApiClient -- typed, session-scoped API client.
 *
 * Mocks fetch for each endpoint category. Validates:
 * - Successful response parsing with typed results
 * - 502 graceful degradation returns null
 * - Auth header injection
 * - Network error handling returns null
 * - At least one method per category
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SuperColonyApiClient } from "../../../src/toolkit/supercolony/api-client.js";
import type { AgentProfile, LeaderboardResult } from "../../../src/toolkit/supercolony/types.js";

// ── Test Helpers ────────────────────────────────────

function mockFetchResponse(data: unknown, status = 200, ok = true): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(data)),
  }));
}

function mockFetchNetworkError(message = "ECONNREFUSED"): void {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error(message)));
}

function mockFetch502(): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
    ok: false,
    status: 502,
    text: () => Promise.resolve("Bad Gateway"),
  }));
}

function createClient(token: string | null = "test-token"): SuperColonyApiClient {
  return new SuperColonyApiClient({
    getToken: () => Promise.resolve(token),
    baseUrl: "https://www.supercolony.ai",
    timeout: 5000,
  });
}

// ── Tests ───────────────────────────────────────────

describe("SuperColonyApiClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Construction ────────────────────────────────

  describe("constructor", () => {
    it("uses default baseUrl when not provided", () => {
      const client = new SuperColonyApiClient({
        getToken: () => Promise.resolve(null),
      });
      // Client should exist without error
      expect(client).toBeDefined();
    });
  });

  // ── Auth Header Injection ──────────────────────

  describe("auth header injection", () => {
    it("attaches Bearer token to requests when token is available", async () => {
      const agents = { agents: [] };
      mockFetchResponse(agents);

      const client = createClient("my-secret-token");
      await client.listAgents();

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      const headers = fetchCall[1]?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer my-secret-token");
    });

    it("omits Authorization header when token is null", async () => {
      const agents = { agents: [] };
      mockFetchResponse(agents);

      const client = createClient(null);
      await client.listAgents();

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      const headers = fetchCall[1]?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBeUndefined();
    });
  });

  // ── Graceful Degradation ──────────────────────

  describe("graceful degradation", () => {
    it("returns null on network error", async () => {
      mockFetchNetworkError();
      const client = createClient();
      const result = await client.listAgents();
      expect(result).toBeNull();
    });

    it("returns null on 502 Bad Gateway", async () => {
      mockFetch502();
      const client = createClient();
      const result = await client.listAgents();
      expect(result).toBeNull();
    });

    it("returns error result on 401 Unauthorized", async () => {
      mockFetchResponse({ message: "unauthorized" }, 401, false);
      const client = createClient();
      const result = await client.listAgents();
      expect(result).not.toBeNull();
      expect(result?.ok).toBe(false);
      if (result && !result.ok) {
        expect(result.status).toBe(401);
      }
    });

    it("returns error result on 404 Not Found", async () => {
      mockFetchResponse({ message: "not found" }, 404, false);
      const client = createClient();
      const result = await client.getAgentProfile("0xdead");
      expect(result).not.toBeNull();
      expect(result?.ok).toBe(false);
      if (result && !result.ok) {
        expect(result.status).toBe(404);
      }
    });
  });

  // ── Agent Identity ─────────────────────────────

  describe("agent identity", () => {
    it("registerAgent sends POST with agent data", async () => {
      mockFetchResponse({ success: true });
      const client = createClient();
      const result = await client.registerAgent({
        name: "sentinel",
        description: "A test agent",
        specialties: ["crypto", "defi"],
      });
      expect(result?.ok).toBe(true);

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(fetchCall[1]?.method).toBe("POST");
      const body = JSON.parse(fetchCall[1]?.body as string);
      expect(body.name).toBe("sentinel");
    });

    it("registerAgent slugifies names to the upstream format", async () => {
      mockFetchResponse({ success: true });
      const client = createClient();
      await client.registerAgent({
        name: "My Market Agent!!",
        description: "A test agent",
        specialties: ["crypto"],
      });

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      const body = JSON.parse(fetchCall[1]?.body as string);
      expect(body.name).toBe("my-market-agent");
    });

    it("registerAgent rejects names that collapse below 2 slug characters", async () => {
      const client = createClient();
      const result = await client.registerAgent({
        name: "!",
        description: "A test agent",
        specialties: ["crypto"],
      });

      expect(result?.ok).toBe(false);
      expect(vi.isMockFunction(globalThis.fetch)).toBe(false);
    });

    it("listAgents returns typed AgentProfile array", async () => {
      const payload = {
        agents: [
          {
            address: "0xabc",
            name: "sentinel",
            description: "test",
            specialties: ["crypto"],
            postCount: 42,
            lastActiveAt: Date.now(),
          },
        ],
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.listAgents();
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.agents).toHaveLength(1);
        expect(result.data.agents[0].name).toBe("sentinel");
      }
    });

    it("getAgentProfile returns single profile", async () => {
      const profile: AgentProfile = {
        address: "0xabc",
        name: "sentinel",
        description: "test",
        specialties: ["crypto"],
        postCount: 10,
        lastActiveAt: Date.now(),
      };
      mockFetchResponse(profile);
      const client = createClient();
      const result = await client.getAgentProfile("0xabc");
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.address).toBe("0xabc");
      }
    });

    it("getAgentIdentities returns web2 and xm identities", async () => {
      const identities = {
        web2Identities: [{ platform: "twitter", username: "test" }],
        xmIdentities: [{ chain: "eth.mainnet", address: "0xdef" }],
      };
      mockFetchResponse(identities);
      const client = createClient();
      const result = await client.getAgentIdentities("0xabc");
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.web2Identities).toHaveLength(1);
        expect(result.data.xmIdentities).toHaveLength(1);
      }
    });

    it("createAgentLinkChallenge sends the agent address", async () => {
      mockFetchResponse({ challengeId: "c1", nonce: "n1", message: "sign me" });
      const client = createClient();
      const result = await client.createAgentLinkChallenge("0xagent");
      expect(result?.ok).toBe(true);

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(fetchCall[1]?.method).toBe("POST");
      expect(JSON.parse(fetchCall[1]?.body as string)).toEqual({ agentAddress: "0xagent" });
    });

    it("claimAgentLink posts publicly without Authorization", async () => {
      mockFetchResponse({ ok: true, status: "pending_approval" });
      const client = createClient("test-token");
      const result = await client.claimAgentLink({
        challengeId: "c1",
        agentAddress: "0xagent",
        signature: "sig",
      });
      expect(result?.ok).toBe(true);

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      const headers = fetchCall[1]?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBeUndefined();
    });

    it("approveAgentLink requires auth and posts approval action", async () => {
      mockFetchResponse({ ok: true, status: "approved", linked: true });
      const client = createClient();
      const result = await client.approveAgentLink({ challengeId: "c1", action: "approve" });
      expect(result?.ok).toBe(true);

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      const headers = fetchCall[1]?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer test-token");
      expect(JSON.parse(fetchCall[1]?.body as string)).toEqual({ challengeId: "c1", action: "approve" });
    });

    it("listLinkedAgents returns the linked agent envelope", async () => {
      mockFetchResponse({ agents: [{ agentAddress: "0xagent", name: "sentinel", status: "linked" }] });
      const client = createClient();
      const result = await client.listLinkedAgents();
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.agents[0].agentAddress).toBe("0xagent");
      }
    });

    it("unlinkAgent sends DELETE to the address route", async () => {
      mockFetchResponse({ ok: true });
      const client = createClient();
      await client.unlinkAgent("0xagent");

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(fetchCall[1]?.method).toBe("DELETE");
      expect(fetchCall[0]).toBe("https://www.supercolony.ai/api/user/agents/0xagent");
    });
  });

  // ── Identity Lookup ────────────────────────────

  describe("identity lookup", () => {
    it("lookupByPlatform sends correct query params", async () => {
      const payload = {
        platform: "twitter",
        username: "vitalik",
        accounts: [{ address: "0x123", displayName: "Vitalik" }],
        found: true,
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.lookupByPlatform("twitter", "vitalik");
      expect(result?.ok).toBe(true);

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("twitter");
      expect(fetchUrl).toContain("vitalik");
    });

    it("searchIdentity returns search results", async () => {
      const payload = { results: [] };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.searchIdentity("sentinel");
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.results).toEqual([]);
      }
    });

    it("lookupByChainAddress sends chain and address", async () => {
      const payload = {
        platform: "eth.mainnet",
        username: "",
        accounts: [],
        found: false,
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.lookupByChainAddress("eth.mainnet", "0xdead");
      expect(result?.ok).toBe(true);

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("eth.mainnet");
      expect(fetchUrl).toContain("0xdead");
    });
  });

  // ── Predictions ────────────────────────────────

  describe("predictions", () => {
    it("queryPredictions returns typed predictions", async () => {
      const payload = { predictions: [{
        txHash: "0xabc",
        author: "0x123",
        asset: "BTC",
        predictedPrice: 100000,
        status: "pending",
      }], total: 1, pendingExpired: 0 };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.queryPredictions({ asset: "BTC" });
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data[0].status).toBe("pending");
      }
    });

    it("queryPredictions returns error when wrapper field is missing", async () => {
      mockFetchResponse({ data: [] }); // wrong key — should be predictions
      const client = createClient();
      const result = await client.queryPredictions();
      expect(result?.ok).toBe(false);
      if (result && !result.ok) {
        expect(result.error).toContain("missing expected field");
      }
    });

    it("resolvePrediction sends POST with outcome and evidence", async () => {
      mockFetchResponse({ success: true });
      const client = createClient();
      await client.resolvePrediction("0xabc", "correct", "price hit $100k");

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(fetchCall[1]?.method).toBe("POST");
      const body = JSON.parse(fetchCall[1]?.body as string);
      expect(body.outcome).toBe("correct");
      expect(body.evidence).toBe("price hit $100k");
    });
  });

  // ── Tipping ────────────────────────────────────

  describe("tipping", () => {
    it("getTipStats returns tip data for a post", async () => {
      const payload = {
        totalTips: 3,
        totalDem: 15,
        tippers: ["0x1", "0x2", "0x3"],
        topTip: 10,
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getTipStats("0xabc");
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.totalTips).toBe(3);
        expect(result.data.tippers).toHaveLength(3);
      }
    });

    it("getAgentTipStats returns given and received stats", async () => {
      const payload = {
        tipsGiven: { count: 5, totalDem: 25 },
        tipsReceived: { count: 10, totalDem: 50 },
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getAgentTipStats("0xabc");
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.tipsGiven.count).toBe(5);
        expect(result.data.tipsReceived.count).toBe(10);
      }
    });
  });

  // ── Scoring & Leaderboard ─────────────────────

  describe("scoring and leaderboard", () => {
    it("getAgentLeaderboard returns leaderboard with agents", async () => {
      const payload: LeaderboardResult = {
        agents: [{
          address: "0xabc",
          name: "sentinel",
          totalPosts: 100,
          avgScore: 72.5,
          bayesianScore: 68.3,
          topScore: 95,
          lowScore: 30,
          lastActiveAt: Date.now(),
        }],
        count: 1,
        globalAvg: 65.0,
        confidenceThreshold: 10,
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getAgentLeaderboard({ sortBy: "bayesianScore", limit: 10 });
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.agents[0].bayesianScore).toBe(68.3);
        expect(result.data.globalAvg).toBe(65.0);
      }
    });

    it("getTopPosts returns posts with scores", async () => {
      const payload = {
        posts: [{
          txHash: "0xabc",
          author: "0x123",
          category: "crypto",
          text: "Great insight",
          score: 92,
          timestamp: Date.now(),
          blockNumber: 1000,
        }],
        count: 1,
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getTopPosts({ category: "crypto", limit: 5 });
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.posts[0].score).toBe(92);
      }
    });

    it("getPredictionLeaderboard returns forecast leaderboard rows", async () => {
      const payload = {
        agents: [{
          address: "0xabc",
          composite: 82,
          betting: 80,
          calibration: 85,
          polymarket: 79,
          predictionCount: 14,
        }],
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getPredictionLeaderboard({ limit: 20 });
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.agents[0].predictionCount).toBe(14);
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("/api/predictions/leaderboard");
      expect(fetchUrl).toContain("limit=20");
    });

    it("getPredictionScore returns the official per-agent breakdown", async () => {
      const payload = {
        composite: 81,
        breakdown: { betting: 78, calibration: 84, polymarket: null },
        recentPredictions: [],
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getPredictionScore("0xabc");
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.breakdown.calibration).toBe(84);
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toBe("https://www.supercolony.ai/api/predictions/score/0xabc");
    });
  });

  // ── Verification ───────────────────────────────

  describe("verification", () => {
    it("verifyDahr returns attestation data", async () => {
      const payload = {
        verified: true,
        attestations: [{
          url: "https://example.com",
          responseHash: "0xhash",
          txHash: "0xtx",
          explorerUrl: "https://explorer.demos.sh/tx/0xtx",
        }],
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.verifyDahr("0xabc");
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.verified).toBe(true);
        expect(result.data.attestations).toHaveLength(1);
      }
    });
  });

  // ── Webhooks ───────────────────────────────────

  describe("webhooks", () => {
    it("listWebhooks returns webhook array", async () => {
      const payload = [{
        id: "wh-1",
        url: "https://hook.example.com",
        events: ["post.created"],
        active: true,
      }];
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.listWebhooks();
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data[0].id).toBe("wh-1");
      }
    });

    it("createWebhook sends POST with url and events", async () => {
      mockFetchResponse({ success: true });
      const client = createClient();
      await client.createWebhook("https://hook.example.com", ["post.created"]);

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(fetchCall[1]?.method).toBe("POST");
      const body = JSON.parse(fetchCall[1]?.body as string);
      expect(body.url).toBe("https://hook.example.com");
      expect(body.events).toEqual(["post.created"]);
    });

    it("deleteWebhook sends DELETE request", async () => {
      mockFetchResponse({ success: true });
      const client = createClient();
      await client.deleteWebhook("wh-1");

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(fetchCall[1]?.method).toBe("DELETE");
    });
  });

  // ── Feed ───────────────────────────────────────

  describe("feed", () => {
    it("getPostDetail returns post with replies", async () => {
      const payload = {
        post: { txHash: "0xabc", content: "test" },
        replies: [{ txHash: "0xdef", content: "reply" }],
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getPostDetail("0xabc");
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.replies).toHaveLength(1);
      }
    });

    it("getRssFeed returns raw XML string", async () => {
      const xml = '<?xml version="1.0"?><feed><entry/></feed>';
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(xml),
      }));
      const client = createClient();
      const result = await client.getRssFeed();
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data).toContain("<?xml");
      }
    });
  });

  // ── Betting ────────────────────────────────────

  describe("betting", () => {
    it("getBettingPool returns pool data", async () => {
      const payload = {
        asset: "BTC",
        horizon: "24h",
        totalBets: 10,
        totalDem: 500,
        poolAddress: "0xpool",
        roundEnd: Date.now() + 86400000,
        bets: [],
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getBettingPool("BTC", "24h");
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.asset).toBe("BTC");
        expect(result.data.totalBets).toBe(10);
      }
    });

    it("getEthBettingPool uses the ETH pool route and preserves wei totals", async () => {
      const payload = {
        asset: "BTC",
        horizon: "30m",
        totalBets: 0,
        totalEth: 0,
        totalEthWei: "0",
        contractAddress: "0xaD8a58B90879b46dD3E0b35aD76F9e7ccA027373",
        roundEnd: Date.now() + 1_800_000,
        bets: [],
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getEthBettingPool("BTC", "30m");
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.contractAddress).toBe(payload.contractAddress);
        expect(result.data.totalEthWei).toBe("0");
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("/api/bets/eth/pool");
      expect(fetchUrl).toContain("asset=BTC");
      expect(fetchUrl).toContain("horizon=30m");
    });

    it("getEthWinners returns the winners envelope", async () => {
      const payload = {
        winners: [{
          txHash: "0xwinner",
          asset: "BTC",
          bettor: "",
          evmAddress: "0x64511E62431A1Aac49aA068f7806C0A2AC34350A",
          predictedPrice: 74500,
          actualPrice: 74581,
          amount: "100000000000000",
          amountEth: 0.0001,
          payout: "100000000000000",
          payoutEth: 0.0001,
          roundEnd: Date.now(),
          horizon: "10m",
          timestamp: Date.now(),
        }],
        count: 1,
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getEthWinners("BTC");
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.count).toBe(1);
        expect(result.data.winners[0].payoutEth).toBe(0.0001);
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("/api/bets/eth/winners");
      expect(fetchUrl).toContain("asset=BTC");
    });

    it("getEthHigherLowerPool uses the ETH higher-lower route", async () => {
      const payload = {
        totalEth: 0,
        totalEthWei: "0",
        totalHigher: 0,
        totalHigherWei: "0",
        totalLower: 0,
        totalLowerWei: "0",
        higherCount: 0,
        lowerCount: 0,
        asset: "BTC",
        horizon: "30m",
        contractAddress: "0xf3CaF2263FE9991e6Ec3c37a87Bed94865D347f2",
        roundEnd: Date.now() + 1_800_000,
        referencePrice: null,
        currentPrice: 74766,
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getEthHigherLowerPool("BTC", "30m");
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.contractAddress).toBe(payload.contractAddress);
        expect(result.data.currentPrice).toBe(74766);
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("/api/bets/eth/hl/pool");
      expect(fetchUrl).toContain("asset=BTC");
      expect(fetchUrl).toContain("horizon=30m");
    });

    it("getEthBinaryPools returns the full ETH binary pools envelope", async () => {
      const payload = {
        pools: {},
        count: 0,
        enabled: true,
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getEthBinaryPools();
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.enabled).toBe(true);
        expect(result.data.count).toBe(0);
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("/api/bets/eth/binary/pools");
    });

    it("getSportsMarkets returns the sports markets envelope", async () => {
      const payload = {
        markets: [{
          fixtureId: "nba_espn_401866757",
          fixture: {
            id: "nba_espn_401866757",
            sport: "nba",
            league: "NBA",
            homeTeam: "Philadelphia 76ers",
            awayTeam: "Orlando Magic",
            homeScore: null,
            awayScore: null,
            status: "scheduled",
            startTime: 1776295800000,
            endTime: null,
            metadata: "{\"source\":\"espn\"}",
          },
          winnerPool: { home: 0, draw: 0, away: 0, totalDem: 0, totalBets: 0, homeBets: 0, drawBets: 0, awayBets: 0 },
          scorePool: { totalDem: 0, totalBets: 0, predictions: [] },
        }],
        poolAddress: "0x8e39a7b63da4fc41e6680042a379fbeaf1623368ff8205ba2b2c8bd6918e7c42",
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getSportsMarkets({ status: "upcoming" });
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.markets[0].fixture.league).toBe("NBA");
        expect(result.data.poolAddress).toBe(payload.poolAddress);
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("/api/bets/sports/markets");
      expect(fetchUrl).toContain("status=upcoming");
    });

    it("getSportsPool returns the sports pool state", async () => {
      const payload = {
        fixtureId: "nba_espn_401866757",
        fixture: {
          id: "nba_espn_401866757",
          sport: "nba",
          league: "NBA",
          homeTeam: "Philadelphia 76ers",
          awayTeam: "Orlando Magic",
          homeScore: null,
          awayScore: null,
          status: "scheduled",
          startTime: 1776295800000,
          endTime: null,
          metadata: "{\"source\":\"espn\"}",
        },
        winnerPool: { home: 0, draw: 0, away: 0, totalDem: 0, totalBets: 0, homeBets: 0, drawBets: 0, awayBets: 0 },
        scorePool: { totalDem: 0, totalBets: 0, predictions: [] },
        poolAddress: "0x8e39a7b63da4fc41e6680042a379fbeaf1623368ff8205ba2b2c8bd6918e7c42",
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getSportsPool("nba_espn_401866757");
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.fixtureId).toBe("nba_espn_401866757");
        expect(result.data.poolAddress).toBe(payload.poolAddress);
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("/api/bets/sports/pool");
      expect(fetchUrl).toContain("fixtureId=nba_espn_401866757");
    });

    it("getSportsWinners returns the sports winners envelope", async () => {
      const payload = {
        winners: [],
        count: 0,
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getSportsWinners("nba_espn_401866757");
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.count).toBe(0);
        expect(result.data.winners).toEqual([]);
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("/api/bets/sports/winners");
      expect(fetchUrl).toContain("fixtureId=nba_espn_401866757");
    });

    it("getCommodityPool returns the commodity pool envelope", async () => {
      const payload = {
        totalDem: 0,
        totalBets: 0,
        asset: "XAU",
        name: "Gold",
        category: "Precious Metals",
        unit: "troy oz",
        horizon: "30m",
        poolAddress: "0x8e39a7b63da4fc41e6680042a379fbeaf1623368ff8205ba2b2c8bd6918e7c42",
        roundEnd: 1776285000000,
        currentPrice: 4817,
        bets: [],
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getCommodityPool("XAU", "30m");
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.name).toBe("Gold");
        expect(result.data.currentPrice).toBe(4817);
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("/api/bets/commodity/pool");
      expect(fetchUrl).toContain("asset=XAU");
      expect(fetchUrl).toContain("horizon=30m");
    });
  });

  // ── URL Construction ──────────────────────────

  describe("URL construction", () => {
    it("constructs correct URL for GET endpoints", async () => {
      mockFetchResponse({ agents: [] });
      const client = createClient();
      await client.listAgents();

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toBe("https://www.supercolony.ai/api/agents");
    });

    it("includes query parameters in URL", async () => {
      mockFetchResponse([]);
      const client = createClient();
      await client.queryPredictions({ status: "pending", asset: "BTC" });

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("status=pending");
      expect(fetchUrl).toContain("asset=BTC");
    });
  });

  // ── Timeout ────────────────────────────────────

  describe("timeout", () => {
    it("passes AbortSignal with configured timeout", async () => {
      mockFetchResponse({ agents: [] });
      const client = new SuperColonyApiClient({
        getToken: () => Promise.resolve(null),
        timeout: 3000,
      });
      await client.listAgents();

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      const signal = fetchCall[1]?.signal;
      expect(signal).toBeDefined();
    });
  });

  // ── Oracle ──────────────────────────────────

  describe("oracle endpoints", () => {
    it("getOracle fetches from /api/oracle", async () => {
      const payload = {
        overallSentiment: { direction: "bullish", score: 40, agentCount: 10, topAssets: ["BTC"] },
        divergences: [],
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getOracle();
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.divergences).toEqual([]);
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toBe("https://www.supercolony.ai/api/oracle");
    });

    it("getOracle passes assets query param", async () => {
      const payload = {
        overallSentiment: { direction: "bullish", score: 40, agentCount: 10, topAssets: ["BTC", "ETH"] },
        divergences: [{ type: "agents_vs_market", asset: "BTC", description: "test", severity: "low" }],
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getOracle({ assets: ["BTC", "ETH"] });
      expect(result?.ok).toBe(true);

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("assets=BTC%2CETH");
    });
  });

  // ── Prices ──────────────────────────────────

  describe("prices endpoints", () => {
    it("getPrices builds correct assets query param", async () => {
      const payload = {
        prices: [
          { ticker: "BTC", priceUsd: 100000, fetchedAt: Date.now(), source: "binance" },
          { ticker: "ETH", priceUsd: 3500, fetchedAt: Date.now(), source: "binance" },
        ],
        fetchedAt: Date.now(),
        stale: false,
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getPrices(["BTC", "ETH"]);
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0].ticker).toBe("BTC");
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("assets=BTC%2CETH");
    });

    it("getPrices returns error when wrapper field is missing", async () => {
      // API returns unexpected shape without "prices" field
      mockFetchResponse({ data: [], stale: false });
      const client = createClient();
      const result = await client.getPrices(["BTC"]);
      expect(result?.ok).toBe(false);
      if (result && !result.ok) {
        expect(result.error).toContain("missing expected field");
        expect(result.status).toBe(200);
      }
    });

    it("getPriceHistory builds asset and history params", async () => {
      const payload = [
        { price: 99000, timestamp: Date.now() - 3600000 },
        { price: 100000, timestamp: Date.now() },
      ];
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getPriceHistory("BTC", 60);
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0].price).toBe(99000);
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("asset=BTC");
      expect(fetchUrl).toContain("history=60");
    });
  });

  // ── Public Endpoints ────────────────────────

  describe("public endpoints", () => {
    it("getStats does not send Authorization header", async () => {
      const mockFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({
          network: { totalPosts: 100, totalAgents: 50, registeredAgents: 45 },
          activity: { postsLast24h: 24, activeAgents24h: 10 },
          quality: { attestedPosts: 60, attestationRate: 58.84 },
          predictions: { total: 10, accuracy: 0.65 },
          tips: { totalDem: 500, uniqueTippers: 5 },
          consensus: { signalCount: 3 },
          content: { categories: [] },
          computedAt: Date.now(),
        })),
      });
      vi.stubGlobal("fetch", mockFn);

      const client = new SuperColonyApiClient({
        getToken: async () => "my-secret-token",
        baseUrl: "https://www.supercolony.ai",
      });
      const result = await client.getStats();
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.network.totalPosts).toBe(100);
      }

      const headers = mockFn.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBeUndefined();
    });

    it("getHealth does not send Authorization header", async () => {
      const mockFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({
          status: "ok",
          uptime: 1234567,
          timestamp: Date.now(),
        })),
      });
      vi.stubGlobal("fetch", mockFn);

      const client = new SuperColonyApiClient({
        getToken: async () => "my-secret-token",
        baseUrl: "https://www.supercolony.ai",
      });
      const result = await client.getHealth();
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.status).toBe("ok");
      }

      const headers = mockFn.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBeUndefined();
    });
  });

  // ── TLSN Verification ──────────────────────

  describe("tlsn endpoints", () => {
    it("verifyTlsn URL-encodes txHash", async () => {
      const payload = {
        verified: true,
        proof: { notary: "example" },
        txHash: "0xabc/def",
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.verifyTlsn("0xabc/def");
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.verified).toBe(true);
        expect(result.data.txHash).toBe("0xabc/def");
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("/api/verify-tlsn/0xabc%2Fdef");
    });
  });

  describe("feed stream URL", () => {
    it("includes categories, assets, mentions, and bearer token query params", async () => {
      const client = createClient("stream-token");
      const url = await client.getFeedStreamUrl({
        categories: ["ALERT", "SIGNAL"],
        assets: ["ETH"],
        mentions: ["0xabc"],
      });

      expect(url).toBe(
        "https://www.supercolony.ai/api/feed/stream?categories=ALERT%2CSIGNAL&assets=ETH&mentions=0xabc&token=stream-token",
      );
    });
  });

  // ── Feed (paginated timeline) ───────────────

  describe("feed paginated timeline", () => {
    it("getFeed fetches /api/feed with no params", async () => {
      const payload = { posts: [], hasMore: false };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getFeed();
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.posts).toEqual([]);
        expect(result.data.hasMore).toBe(false);
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toBe("https://www.supercolony.ai/api/feed");
    });

    it("getFeed includes category, author, and limit params", async () => {
      const payload = { posts: [{ txHash: "0x1", author: "0xa", timestamp: 1000, payload: {} }], hasMore: true };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getFeed({ category: "ANALYSIS", author: "0xa", limit: 5 });
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.posts).toHaveLength(1);
        expect(result.data.hasMore).toBe(true);
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("category=ANALYSIS");
      expect(fetchUrl).toContain("author=0xa");
      expect(fetchUrl).toContain("limit=5");
    });

    it("getFeed passes replies as string", async () => {
      const payload = { posts: [], hasMore: false };
      mockFetchResponse(payload);
      const client = createClient();
      await client.getFeed({ replies: true });

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("replies=true");
    });
  });

  // ── Search Feed ─────────────────────────────

  describe("search feed", () => {
    it("searchFeed sends text and since params", async () => {
      const payload = { posts: [], hasMore: false };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.searchFeed({ text: "bitcoin", since: 1700000000 });
      expect(result?.ok).toBe(true);

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("/api/feed/search");
      expect(fetchUrl).toContain("text=bitcoin");
      expect(fetchUrl).toContain("since=1700000000");
    });

    it("searchFeed includes agent and mentions params", async () => {
      const payload = { posts: [], hasMore: false };
      mockFetchResponse(payload);
      const client = createClient();
      await client.searchFeed({ agent: "sentinel", mentions: "0xabc" });

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("agent=sentinel");
      expect(fetchUrl).toContain("mentions=0xabc");
    });
  });

  // ── Thread ──────────────────────────────────

  describe("thread", () => {
    it("getThread URL-encodes txHash", async () => {
      const payload = { root: { txHash: "0xabc/def" }, replies: [] };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getThread("0xabc/def");
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.root).toHaveProperty("txHash");
        expect(result.data.replies).toEqual([]);
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("/api/feed/thread/0xabc%2Fdef");
    });
  });

  // ── Signals ─────────────────────────────────

  describe("signals", () => {
    it("getSignals fetches from /api/signals", async () => {
      const payload = { consensusAnalysis: [{
        topic: "BTC bullish",
        consensus: true,
        direction: "bullish",
        agentCount: 12,
        totalAgents: 42,
        confidence: 85,
        text: "Strong bullish consensus",
        trending: true,
      }] };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getSignals();
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].topic).toBe("BTC bullish");
        expect(result.data[0].trending).toBe(true);
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toBe("https://www.supercolony.ai/api/signals");
    });

    it("getSignals returns error when wrapper field is missing", async () => {
      mockFetchResponse({ signals: [] }); // wrong key — should be consensusAnalysis
      const client = createClient();
      const result = await client.getSignals();
      expect(result?.ok).toBe(false);
      if (result && !result.ok) {
        expect(result.error).toContain("missing expected field");
      }
    });
  });

  // ── TLSN Proof ──────────────────────────────

  describe("tlsn proof", () => {
    it("getTlsnProof URL-encodes txHash", async () => {
      const payload = { proof: { notary: "example" }, txHash: "0xabc/def" };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getTlsnProof("0xabc/def");
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.txHash).toBe("0xabc/def");
        expect(result.data.proof).toHaveProperty("notary");
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("/api/tlsn-proof/0xabc%2Fdef");
    });
  });

  // ── Tip Initiation ──────────────────────────

  describe("tip initiation", () => {
    it("initiateTip sends POST with body", async () => {
      const payload = { ok: true, recipient: "0xrecipient" };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.initiateTip("0xpost", 5);
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.ok).toBe(true);
        expect(result.data.recipient).toBe("0xrecipient");
      }

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(fetchCall[1]?.method).toBe("POST");
      const body = JSON.parse(fetchCall[1]?.body as string);
      expect(body.postTxHash).toBe("0xpost");
      expect(body.amount).toBe(5);
    });
  });

  // ── Agent Balance ───────────────────────────

  describe("agent balance", () => {
    it("getAgentBalance constructs correct URL", async () => {
      const payload = { balance: 1500, updatedAt: Date.now() };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getAgentBalance("0xwallet");
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.balance).toBe(1500);
        expect(result.data.updatedAt).toBeTypeOf("number");
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toBe("https://www.supercolony.ai/api/agent/0xwallet/balance");
    });

    it("getAgentBalance URL-encodes address", async () => {
      const payload = { balance: 0, updatedAt: 0 };
      mockFetchResponse(payload);
      const client = createClient();
      await client.getAgentBalance("0xabc/def");

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("/api/agent/0xabc%2Fdef/balance");
    });
  });

  // ── Report ──────────────────────────────────

  describe("report", () => {
    it("getReport fetches without id param", async () => {
      const payload = { id: "r1", title: "Daily", summary: "Summary", script: "Full text", status: "published", createdAt: "2026-04-06T00:00:00Z" };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getReport();
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.title).toBe("Daily");
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toBe("https://www.supercolony.ai/api/report");
    });

    it("getReport passes id param", async () => {
      const payload = { id: "r42", title: "Specific", summary: "Detail", script: "Full", status: "published", createdAt: "2026-04-06T00:00:00Z" };
      mockFetchResponse(payload);
      const client = createClient();
      await client.getReport({ id: "r42" });

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("id=r42");
    });
  });

  // ── Convergence ─────────────────────────────

  describe("convergence", () => {
    it("getConvergence fetches the convergence surface", async () => {
      const payload = {
        pulse: {
          activeSignals: 8,
          agentsOnline: 19,
          postsPerHour: 12,
          dataSources: 4,
          signalAgentRunning: true,
          lastSynthesisAt: 1700000000000,
        },
        mindshare: { buckets: [1700000000000], series: [] },
        stats: { totalPosts: 11, totalAgents: 19, totalAssets: 2 },
        cached: false,
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getConvergence();
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.pulse.activeSignals).toBe(8);
        expect(result.data.stats.totalAssets).toBe(2);
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toBe("https://www.supercolony.ai/api/convergence");
    });
  });

  // ── Prediction Markets ──────────────────────

  describe("prediction markets", () => {
    it("getPredictionMarkets includes category param", async () => {
      const payload = { predictions: [{
        marketId: "553828",
        question: "Will BTC hit 100k?",
        category: "crypto",
        outcomeYes: 0.62,
        outcomeNo: 0.38,
        volume: "5000",
      }], count: 1, categories: ["crypto"] };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getPredictionMarkets({ category: "crypto" });
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].marketId).toBe("553828");
        expect(result.data[0].outcomeYes).toBe(0.62);
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("/api/predictions/markets");
      expect(fetchUrl).toContain("category=crypto");
    });

    it("getPredictionMarkets returns error when wrapper field is missing", async () => {
      mockFetchResponse({ markets: [] }); // wrong key — should be predictions
      const client = createClient();
      const result = await client.getPredictionMarkets();
      expect(result?.ok).toBe(false);
      if (result && !result.ok) {
        expect(result.error).toContain("missing expected field");
      }
    });
  });

  // ── Partial Fixes — param additions ─────────

  describe("partial fixes for existing methods", () => {
    it("react posts null when removing a reaction", async () => {
      mockFetchResponse({ success: true });
      const client = createClient();
      const result = await client.react("0xabc", null);

      expect(result?.ok).toBe(true);
      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(fetchCall[0]).toBe("https://www.supercolony.ai/api/feed/0xabc/react");
      expect(JSON.parse(fetchCall[1]?.body as string)).toEqual({ type: null });
    });

    it("queryPredictions includes agent param", async () => {
      mockFetchResponse([]);
      const client = createClient();
      await client.queryPredictions({ agent: "sentinel" });

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("agent=sentinel");
    });

    it("getOracle includes window param", async () => {
      const payload = { divergences: [], overallSentiment: { direction: "neutral", score: 0, agentCount: 0, topAssets: [] } };
      mockFetchResponse(payload);
      const client = createClient();
      await client.getOracle({ window: "24h" });

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("window=24h");
    });

    it("getPriceHistory uses history not minutes param name", async () => {
      mockFetchResponse([]);
      const client = createClient();
      await client.getPriceHistory("ETH", 120);

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("history=120");
      expect(fetchUrl).not.toContain("minutes=");
    });

    it("getPredictionIntelligence includes limit and stats params", async () => {
      const payload = {
        scores: [{
          marketId: "1747257",
          question: "Will Trump say Alien Dot Gov in April?",
          category: "crypto",
          currentPrice: 0.08,
          eloProb: 0,
          gbsProb: null,
          mirofishProb: 0,
          ensembleProb: 0,
          edge: 0.08,
          edgeSide: "NO",
          ev: 0.0869,
          kellyFraction: 1,
          kellySize: 200,
          strategies: ["S06"],
          scoredAt: 1776285510379,
        }],
        total: 1,
        lastScoredAt: 1776285510379,
        engineVersion: "1.0.0",
        stats: {
          totalMarketsScored: 2324,
          marketsWithEdge: 601,
          recommendationsGenerated: 0,
          resolvedMarkets: 0,
          weights: {
            elo: { brierScore: 0.25, weight: 0.5, samples: 0 },
            gbs: { brierScore: 0.25, weight: 0, samples: 0 },
            mirofish: { brierScore: 0.25, weight: 0.5, samples: 0 },
            warmup: true,
            updatedAt: 1776285510378,
          },
          lastScoredAt: 1776285510383,
          engineVersion: "1.0.0",
          pipelineDurationMs: 26157,
        },
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getPredictionIntelligence({ limit: 5, stats: true });
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.scores[0].marketId).toBe("1747257");
        expect(result.data.stats?.weights.elo.weight).toBe(0.5);
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("/api/predictions/intelligence");
      expect(fetchUrl).toContain("limit=5");
      expect(fetchUrl).toContain("stats=true");
    });

    it("getPredictionIntelligence returns 401 errors as structured results", async () => {
      mockFetchResponse({ message: "unauthorized" }, 401, false);
      const client = createClient();
      const result = await client.getPredictionIntelligence({ limit: 5, stats: true });

      expect(result).not.toBeNull();
      expect(result?.ok).toBe(false);
      if (result && !result.ok) {
        expect(result.status).toBe(401);
      }
    });

    it("getPredictionRecommendations includes userAddress param", async () => {
      const payload = {
        recommendations: [{
          marketId: "1651775",
          question: "Red Wings vs. Panthers: O/U 6.5",
          category: "sports",
          side: "NO",
          ensembleProb: 0.2426,
          marketPrice: 0.515,
          edge: 0.2424,
          ev: 0.4706,
          kellyFraction: 0.4997,
          suggestedBet: 99.95,
          confidenceTier: "moderate",
          strategies: ["S06", "S16"],
          betPayload: {
            marketId: "1651775",
            direction: "NO",
            amount: 99.95,
          },
        }],
        total: 1,
        bankroll: 1000,
        openExposure: 0,
        varHeadroom: 1000,
        lastScoredAt: 1776285510379,
        engineVersion: "1.0.0",
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getPredictionRecommendations("demo");
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.recommendations[0].betPayload.direction).toBe("NO");
        expect(result.data.bankroll).toBe(1000);
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("/api/predictions/recommend");
      expect(fetchUrl).toContain("userAddress=demo");
    });

    it("registerBet posts txHash, asset, predictedPrice, and horizon", async () => {
      mockFetchResponse({
        ok: true,
        txHash: "a".repeat(64),
        asset: "BTC",
        predictedPrice: 70000,
        amount: 5,
        message: "Bet placed: BTC @ $70000",
      });
      const client = createClient();
      const result = await client.registerBet("a".repeat(64), "BTC", 70000, { horizon: "30m" });

      expect(result?.ok).toBe(true);
      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(fetchCall[0]).toBe("https://www.supercolony.ai/api/bets/place");
      expect(fetchCall[1]?.method).toBe("POST");
      expect(JSON.parse(fetchCall[1]?.body as string)).toEqual({
        txHash: "a".repeat(64),
        asset: "BTC",
        predictedPrice: 70000,
        horizon: "30m",
      });
    });

    it("registerHigherLowerBet posts normalized direction fields", async () => {
      mockFetchResponse({
        ok: true,
        txHash: "a".repeat(64),
        asset: "BTC",
        direction: "HIGHER",
        horizon: "4h",
        amount: 5,
        message: "Prediction placed: BTC HIGHER",
      });
      const client = createClient();
      const result = await client.registerHigherLowerBet("a".repeat(64), "BTC", "HIGHER", { horizon: "4h" });

      expect(result?.ok).toBe(true);
      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(fetchCall[0]).toBe("https://www.supercolony.ai/api/bets/higher-lower/place");
      expect(JSON.parse(fetchCall[1]?.body as string)).toEqual({
        txHash: "a".repeat(64),
        asset: "BTC",
        direction: "HIGHER",
        horizon: "4h",
      });
    });

    it("registerEthBinaryBet posts only the txHash", async () => {
      mockFetchResponse({
        ok: true,
        txHash: `0x${"a".repeat(64)}`,
        message: "Bet registered",
      });
      const client = createClient();
      const txHash = `0x${"a".repeat(64)}`;
      const result = await client.registerEthBinaryBet(txHash);

      expect(result?.ok).toBe(true);
      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(fetchCall[0]).toBe("https://www.supercolony.ai/api/bets/eth/binary/place");
      expect(JSON.parse(fetchCall[1]?.body as string)).toEqual({ txHash });
    });

  });

  // ── Feed (FEED category) — DEPRECATED ──────

  describe("feed category endpoints (deprecated)", () => {
    it("getFeeds includes category=FEED in query", async () => {
      const payload = {
        posts: [{
          txHash: "0xfeed1",
          author: "0xagent",
          text: "Feed post",
          timestamp: Date.now(),
          tags: ["crypto"],
        }],
        count: 1,
      };
      mockFetchResponse(payload);
      const client = createClient();
      const result = await client.getFeeds();
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.data.posts).toHaveLength(1);
        expect(result.data.posts[0].txHash).toBe("0xfeed1");
      }

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("category=FEED");
    });

    it("getFeeds passes limit and offset", async () => {
      const payload = { posts: [], count: 0 };
      mockFetchResponse(payload);
      const client = createClient();
      await client.getFeeds({ limit: 10, offset: 20 });

      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(fetchUrl).toContain("category=FEED");
      expect(fetchUrl).toContain("limit=10");
      expect(fetchUrl).toContain("offset=20");
    });
  });
});
