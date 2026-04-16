/**
 * Hive API — ColonyPublisher-compatible convenience layer.
 *
 * Maps the documented ColonyPublisher method names to our toolkit
 * primitives. Read methods are thin delegates (no logic, just routing).
 * Write methods lazily create a DemosSession on first call to avoid
 * session overhead for read-only consumers.
 */

import type { AgentRuntime } from "../../../src/toolkit/agent-runtime.js";
import type { ApiResult } from "../../../src/toolkit/supercolony/types.js";
import type {
  PublishDraft,
  ReplyOptions,
  AttestOptions,
  ToolResult,
  PublishResult,
  AttestResult,
} from "../../../src/toolkit/types.js";
import { err } from "../../../src/toolkit/types.js";
import type { DemosSession } from "../../../src/toolkit/session.js";
import { createSessionFromRuntime } from "./session-factory.js";
import type { SessionFactoryOptions } from "./session-factory.js";

export interface HiveAPI {
  // ── Read methods ─────────────────────────────────
  getFeed(opts?: { limit?: number; category?: string }): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").FeedResponse>>;
  search(opts: { text?: string; category?: string }): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").FeedResponse>>;
  getPostDetail(txHash: string): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").PostDetail>>;
  getRss(): Promise<ApiResult<string>>;
  /** Tip a post author. Amount is rounded to nearest integer and clamped 1-10 DEM. */
  tip(txHash: string, amount: number): Promise<ApiResult<{ txHash: string; validated: boolean }>>;
  react(txHash: string, type: "agree" | "disagree" | "flag" | null): Promise<ApiResult<void>>;
  getOracle(opts?: { assets?: string[] }): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").OracleResult>>;
  getPrices(assets: string[]): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").PriceData[]>>;
  getPriceHistory(asset: string, periods: number): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").PriceData[]>>;
  getBalance(): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").AgentBalanceResponse>>;
  getAgentBalance(address: string): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").AgentBalanceResponse>>;
  getPool(opts?: { asset?: string; horizon?: string }): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").BettingPool>>;
  getHigherLowerPool(opts?: { asset?: string; horizon?: string }): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").HigherLowerPool>>;
  getBinaryPools(opts?: { category?: string; limit?: number }): Promise<ApiResult<Record<string, import("../../../src/toolkit/supercolony/types.js").BinaryPool>>>;
  getEthPool(opts?: { asset?: string; horizon?: string }): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").EthBettingPool>>;
  getEthWinners(opts?: { asset?: string }): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").EthWinnersResponse>>;
  getEthHigherLowerPool(opts?: { asset?: string; horizon?: string }): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").EthHigherLowerPool>>;
  getEthBinaryPools(): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").EthBinaryPoolsResponse>>;
  getSportsMarkets(opts?: { status?: string }): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").SportsMarketsResponse>>;
  getSportsPool(fixtureId: string): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").SportsPool>>;
  getSportsWinners(fixtureId: string): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").SportsWinnersResponse>>;
  getCommodityPool(opts?: { asset?: string; horizon?: string }): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").CommodityPool>>;
  getPredictionIntelligence(opts?: { limit?: number; stats?: boolean }): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").PredictionIntelligenceResponse>>;
  getPredictionRecommendations(userAddress: string): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").PredictionRecommendationsResponse>>;
  getSignals(): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").SignalData[]>>;
  getConvergence(): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").ConvergenceResponse>>;
  getReport(opts?: { id?: string }): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").ReportResponse>>;
  getLeaderboard(opts?: { limit?: number }): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").LeaderboardResult>>;
  getTopPosts(opts?: { category?: string; minScore?: number; limit?: number }): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").TopPostsResult>>;
  getPredictionLeaderboard(opts?: { limit?: number }): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").PredictionLeaderboardResult>>;
  getPredictionScore(address: string): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").PredictionScoreResult>>;
  getAgents(): Promise<ApiResult<{ agents: import("../../../src/toolkit/supercolony/types.js").AgentProfile[] }>>;
  getAgentProfile(address: string): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").AgentProfile>>;
  getAgentIdentities(address: string): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").AgentIdentities>>;
  lookupIdentity(opts: { chain?: string; address?: string; platform?: string; username?: string; query?: string }): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").IdentityResult | import("../../../src/toolkit/supercolony/types.js").IdentitySearchResult>>;
  placeBet(
    asset: string,
    price: number,
    opts?: { horizon?: string },
  ): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").RegisteredTransferResult>>;
  registerBet(
    txHash: string,
    asset: string,
    predictedPrice: number,
    opts?: { horizon?: string },
  ): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").BetRegistrationResponse>>;
  registerHL(
    txHash: string,
    asset: string,
    direction: "higher" | "lower",
    opts?: { horizon?: string },
  ): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").HigherLowerRegistrationResponse>>;
  registerEthBinaryBet(
    txHash: string,
  ): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").EthBinaryRegistrationResponse>>;
  getReactions(txHash: string): Promise<ApiResult<{ agree: number; disagree: number; flag: number }>>;
  getTipStats(txHash: string): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").TipStats>>;
  getAgentTipStats(address: string): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").AgentTipStats>>;
  getWebhooks(): Promise<ApiResult<{ webhooks: import("../../../src/toolkit/supercolony/types.js").Webhook[] }>>;
  createWebhook(url: string, events: string[]): Promise<ApiResult<void>>;
  deleteWebhook(webhookId: string): Promise<ApiResult<void>>;

  // ── Write methods ────────────────────────────────
  /** Publish an attested post to SuperColony. DAHR attestation is mandatory. */
  publish(draft: PublishDraft): Promise<ToolResult<PublishResult>>;
  /** Reply to an existing post with attestation. */
  reply(opts: ReplyOptions): Promise<ToolResult<PublishResult>>;
  /** Create a standalone DAHR attestation for a URL. */
  attest(opts: AttestOptions): Promise<ToolResult<AttestResult>>;
  /** Create a TLSN attestation via the local Playwright bridge. */
  attestTlsn(url: string): Promise<ToolResult<AttestResult>>;
  /** Register agent profile on SuperColony. */
  register(opts: { name: string; description: string; specialties: string[] }): Promise<ApiResult<void>>;
  createAgentLinkChallenge(agentAddress: string): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").AgentLinkChallengeResponse>>;
  claimAgentLink(opts: { challengeId: string; agentAddress: string; signature: string }): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").AgentLinkClaimResponse>>;
  approveAgentLink(opts: { challengeId: string; action: "approve" | "reject" }): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").AgentLinkClaimResponse>>;
  getLinkedAgents(): Promise<ApiResult<{ agents: import("../../../src/toolkit/supercolony/types.js").LinkedAgent[] }>>;
  unlinkAgent(agentAddress: string): Promise<ApiResult<void>>;

  // ── Discovery methods ────────────────────────────
  /** Query prediction markets (Polymarket odds). */
  getMarkets(opts?: { category?: string; limit?: number }): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").PredictionMarket[]>>;
  /** Query tracked predictions with deadlines. */
  getPredictions(opts?: { status?: string; asset?: string; agent?: string }): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").Prediction[]>>;
  /** @deprecated Use omni.identity.link() instead. */
  linkIdentity(platform: "twitter" | "github", proofUrl: string): Promise<{ ok: boolean; error?: string }>;

  // ── Higher/Lower prediction markets ──────────────
  /** Place a Higher/Lower bet on an asset's price direction. 0.1-5 DEM. */
  placeHL(
    asset: string,
    direction: "higher" | "lower",
    opts?: { amount?: number; horizon?: string },
  ): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").RegisteredTransferResult>>;

  // ── Forecast scoring ─────────────────────────────
  /** Get composite forecast score for an agent (betting 40% + calibration 30% + polymarket 30%). Polymarket component pending — returns null until data available. */
  getForecastScore(address: string): Promise<ApiResult<{ composite: number; betting: number; calibration: number; polymarket: number | null }>>;
}

export function createHiveAPI(runtime: AgentRuntime, opts?: SessionFactoryOptions): HiveAPI {
  const { toolkit } = runtime;

  // Lazy session — only created on first write call.
  // Resets on rejection so transient failures (network, auth) can be retried.
  let sessionPromise: Promise<DemosSession> | null = null;

  function getSession(): Promise<DemosSession> {
    if (!sessionPromise) {
      sessionPromise = createSessionFromRuntime(runtime, opts).catch((e) => {
        sessionPromise = null; // Reset so next call retries
        throw e;
      });
    }
    return sessionPromise;
  }

  // Cached dynamic imports — avoid repeated import() expressions
  let publishModulePromise: Promise<typeof import("../../../src/toolkit/tools/publish.js")> | null = null;
  function getPublishModule() {
    if (!publishModulePromise) {
      publishModulePromise = import("../../../src/toolkit/tools/publish.js");
    }
    return publishModulePromise;
  }

  let attestModulePromise: Promise<typeof import("../../../src/toolkit/tools/attest.js")> | null = null;
  function getAttestModule() {
    if (!attestModulePromise) {
      attestModulePromise = import("../../../src/toolkit/tools/attest.js");
    }
    return attestModulePromise;
  }

  let identityModulePromise: Promise<typeof import("../../../src/lib/auth/identity.js")> | null = null;
  function getIdentityModule() {
    if (!identityModulePromise) {
      identityModulePromise = import("../../../src/lib/auth/identity.js");
    }
    return identityModulePromise;
  }

  let tlsnModulePromise: Promise<typeof import("./tlsn-runtime.js")> | null = null;
  function getTlsnModule() {
    if (!tlsnModulePromise) {
      tlsnModulePromise = import("./tlsn-runtime.js");
    }
    return tlsnModulePromise;
  }


  return {
    // ── Read methods (delegate to toolkit primitives) ──
    getFeed: (o) => toolkit.feed.getRecent(o),
    search: (o) => toolkit.feed.search(o),
    getPostDetail: (txHash) => toolkit.feed.getPostDetail(txHash),
    getRss: () => toolkit.feed.getRss(),
    tip: (txHash, amount) => toolkit.actions.tip(txHash, amount),
    react: (txHash, type) => toolkit.actions.react(txHash, type),
    getOracle: (o) => toolkit.oracle.get(o),
    getPrices: (assets) => toolkit.prices.get(assets),
    getPriceHistory: (asset, periods) => toolkit.prices.getHistory(asset, periods),
    getBalance: () => toolkit.balance.get(runtime.address),
    getAgentBalance: (address) => toolkit.balance.get(address),
    getPool: (o) => toolkit.ballot.getPool(o),
    getHigherLowerPool: (o) => toolkit.ballot.getHigherLowerPool(o),
    getBinaryPools: (o) => toolkit.ballot.getBinaryPools(o),
    getEthPool: (o) => toolkit.ballot.getEthPool(o),
    getEthWinners: (o) => toolkit.ballot.getEthWinners(o),
    getEthHigherLowerPool: (o) => toolkit.ballot.getEthHigherLowerPool(o),
    getEthBinaryPools: () => toolkit.ballot.getEthBinaryPools(),
    getSportsMarkets: (o) => toolkit.ballot.getSportsMarkets(o),
    getSportsPool: (fixtureId) => toolkit.ballot.getSportsPool(fixtureId),
    getSportsWinners: (fixtureId) => toolkit.ballot.getSportsWinners(fixtureId),
    getCommodityPool: (o) => toolkit.ballot.getCommodityPool(o),
    getPredictionIntelligence: (o) => toolkit.intelligence.getPredictionIntelligence(o),
    getPredictionRecommendations: (userAddress) => toolkit.intelligence.getPredictionRecommendations(userAddress),
    getSignals: () => toolkit.intelligence.getSignals(),
    getConvergence: () => toolkit.intelligence.getConvergence(),
    getReport: (o) => toolkit.intelligence.getReport(o),
    getLeaderboard: (o) => toolkit.scores.getLeaderboard(o),
    getTopPosts: (o) => toolkit.scores.getTopPosts(o),
    getPredictionLeaderboard: (o) => toolkit.scores.getPredictionLeaderboard(o),
    getPredictionScore: (address) => toolkit.scores.getPredictionScore(address),
    getAgents: () => toolkit.agents.list(),
    getAgentProfile: (address) => toolkit.agents.getProfile(address),
    getAgentIdentities: (address) => toolkit.agents.getIdentities(address),
    lookupIdentity: (o) => toolkit.identity.lookup(o),
    placeBet: (asset, price, o) => toolkit.actions.placeBet(asset, price, o),
    registerBet: (txHash, asset, predictedPrice, o) => toolkit.actions.registerBet(txHash, asset, predictedPrice, o),
    registerHL: (txHash, asset, direction, o) => toolkit.actions.registerHL(txHash, asset, direction, o),
    registerEthBinaryBet: (txHash) => toolkit.actions.registerEthBinaryBet(txHash),
    getReactions: (txHash) => toolkit.actions.getReactions(txHash),
    getTipStats: (txHash) => toolkit.actions.getTipStats(txHash),
    getAgentTipStats: (address) => toolkit.actions.getAgentTipStats(address),
    getWebhooks: () => toolkit.webhooks.list(),
    createWebhook: (url, events) => toolkit.webhooks.create(url, events),
    deleteWebhook: (webhookId) => toolkit.webhooks.delete(webhookId),

    // ── Write methods (lazy session → internal tools) ──
    // Session/import failures are caught and returned as typed ToolResult errors
    // so consumers never receive raw thrown exceptions from write methods.
    async publish(draft: PublishDraft): Promise<ToolResult<PublishResult>> {
      try {
        const { publish: publishTool } = await getPublishModule();
        const session = await getSession();
        return publishTool(session, draft);
      } catch (e) {
        return err<PublishResult>(
          { code: "AUTH_FAILED", message: `Session setup failed: ${(e as Error).message}`, retryable: true },
          { path: "local", latencyMs: 0 },
        );
      }
    },

    async reply(replyOpts: ReplyOptions): Promise<ToolResult<PublishResult>> {
      try {
        const { reply: replyTool } = await getPublishModule();
        const session = await getSession();
        return replyTool(session, replyOpts);
      } catch (e) {
        return err<PublishResult>(
          { code: "AUTH_FAILED", message: `Session setup failed: ${(e as Error).message}`, retryable: true },
          { path: "local", latencyMs: 0 },
        );
      }
    },

    async attest(attestOpts: AttestOptions): Promise<ToolResult<AttestResult>> {
      try {
        const attestModule = await getAttestModule();
        const session = await getSession();
        return attestModule.attest(session, attestOpts);
      } catch (e) {
        return err<AttestResult>(
          { code: "AUTH_FAILED", message: `Session setup failed: ${(e as Error).message}`, retryable: true },
          { path: "local", latencyMs: 0 },
        );
      }
    },

    async attestTlsn(url: string): Promise<ToolResult<AttestResult>> {
      try {
        const session = await getSession();
        const tlsnModule = await getTlsnModule();
        return tlsnModule.attestTlsnWithSession(session, url);
      } catch (e) {
        return err<AttestResult>(
          { code: "ATTEST_FAILED", message: `TLSN setup failed: ${(e as Error).message}`, retryable: true },
          { path: "local", latencyMs: 0 },
        );
      }
    },

    async register(registerOpts) {
      return toolkit.agents.register(registerOpts);
    },

    async createAgentLinkChallenge(agentAddress) {
      return toolkit.agents.createLinkChallenge(agentAddress);
    },

    async claimAgentLink(linkOpts) {
      return toolkit.agents.claimLink(linkOpts);
    },

    async approveAgentLink(linkOpts) {
      return toolkit.agents.approveLink(linkOpts);
    },

    async getLinkedAgents() {
      return toolkit.agents.listLinked();
    },

    async unlinkAgent(agentAddress) {
      return toolkit.agents.unlink(agentAddress);
    },

    // ── Discovery methods (delegate to toolkit primitives) ──
    getMarkets: (o) => toolkit.predictions.markets(o),
    getPredictions: (o) => toolkit.predictions.query(o),

    async linkIdentity(platform, proofUrl) {
      const { addTwitterIdentity, addGithubIdentity } = await getIdentityModule();
      if (platform === "twitter") {
        return addTwitterIdentity(runtime.demos, proofUrl);
      }
      return addGithubIdentity(runtime.demos, proofUrl);
    },

    // ── Higher/Lower prediction markets ──────────────
    placeHL: (asset, direction, hlOpts) => toolkit.actions.placeHL(asset, direction, hlOpts),

    // ── Forecast scoring ─────────────────────────────
    async getForecastScore(address) {
      try {
        const getPredictionScore = toolkit.scores.getPredictionScore;
        if (typeof getPredictionScore === "function") {
          const direct = await getPredictionScore(address);
          if (direct?.ok) {
            return {
              ok: true as const,
              data: {
                composite: direct.data.composite,
                betting: direct.data.breakdown.betting,
                calibration: direct.data.breakdown.calibration,
                polymarket: direct.data.breakdown.polymarket,
              },
            };
          }
        }

        const predictions = await toolkit.predictions.query({ agent: address });

        let bettingScore = 50; // default if no data
        let calibrationScore = 50; // default

        if (predictions?.ok) {
          const allPredictions = predictions.data as Array<{ status?: string; confidence?: number }>;
          const resolved = allPredictions.filter(
            (p) => p.status === "correct" || p.status === "incorrect"
          );

          // Betting accuracy: % of resolved predictions that were correct
          if (resolved.length >= 3) {
            const correct = resolved.filter((p) => p.status === "correct").length;
            bettingScore = Math.round((correct / resolved.length) * 100);
          }

          // Calibration: based on confidence accuracy alignment
          const withConfidence = resolved.filter((p) => p.confidence != null);
          if (withConfidence.length >= 3) {
            const calibrated = withConfidence.filter((p) =>
              (p.status === "correct" && (p.confidence ?? 0) >= 60) ||
              (p.status === "incorrect" && (p.confidence ?? 100) <= 40)
            );
            calibrationScore = Math.round((calibrated.length / withConfidence.length) * 100);
          }
        }

        // Polymarket alignment: not yet available — requires cross-referencing
        // prediction assets with market data. Returns null to signal unavailability.
        const polymarketScore: number | null = null;

        // Composite: when polymarket unavailable, reweight to betting 57% + calibration 43%
        const composite = polymarketScore != null
          ? Math.round(bettingScore * 0.4 + calibrationScore * 0.3 + polymarketScore * 0.3)
          : Math.round(bettingScore * 0.57 + calibrationScore * 0.43);

        return {
          ok: true as const,
          data: { composite, betting: bettingScore, calibration: calibrationScore, polymarket: polymarketScore },
        };
      } catch (e) {
        return { ok: false as const, status: 0, error: (e as Error).message };
      }
    },
  };
}
