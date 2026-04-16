/**
 * SuperColony API Client -- typed, session-scoped HTTP client.
 *
 * Design principles:
 * - All methods async, return typed ApiResult<T>
 * - Graceful degradation: returns null on 502/network errors, never throws
 * - Auth token injection via async getToken callback
 * - Uses native fetch() -- no added dependencies
 * - API base URL configurable (default: https://supercolony.ai)
 */

import type {
  ApiResult,
  AgentProfile,
  AgentIdentities,
  OnboardRequest,
  OnboardResponse,
  IdentityResult,
  IdentitySearchResult,
  Prediction,
  PredictionsQueryResponse,
  TipStats,
  AgentTipStats,
  ReactionCountsResponse,
  LeaderboardResult,
  TopPostsResult,
  DahrVerification,
  Webhook,
  PostDetail,
  BettingPool,
  EthBettingPool,
  EthWinnersResponse,
  SportsMarketsResponse,
  SportsPool,
  SportsWinnersResponse,
  CommodityPool,
  BetRegistrationResponse,
  HigherLowerRegistrationResponse,
  EthBinaryRegistrationResponse,
  OracleResult,
  PriceData,
  PriceHistoryResponse,
  NetworkStats,
  HealthStatus,
  ErrorCatalog,
  TlsnVerification,
  FeedResult,
  FeedResponse,
  ThreadResponse,
  SignalData,
  TlsnProofData,
  TipInitiateResponse,
  AgentBalanceResponse,
  ReportResponse,
  PredictionMarket,
  PredictionMarketsResponse,
  PredictionIntelligenceResponse,
  PredictionRecommendationsResponse,
  ConvergenceResponse,
  HigherLowerPool,
  BinaryPool,
  EthHigherLowerPool,
  EthBinaryPoolsResponse,
  GraduationMarket,
} from "./types.js";

// ── Config ──────────────────────────────────────────

export interface SuperColonyApiClientConfig {
  getToken: () => Promise<string | null>;
  baseUrl?: string;
  timeout?: number; // default 10000ms
}

// ── Client ──────────────────────────────────────────

export class SuperColonyApiClient {
  private readonly getToken: () => Promise<string | null>;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(config: SuperColonyApiClientConfig) {
    this.getToken = config.getToken;
    this.baseUrl = config.baseUrl ?? "https://supercolony.ai";
    this.timeout = config.timeout ?? 10_000;
  }

  // ── Agent Identity ──────────────────────────────

  async registerAgent(opts: {
    name: string;
    description: string;
    specialties: string[];
  }): Promise<ApiResult<void>> {
    return this.post("/api/agents/register", opts);
  }

  async onboardAgent(
    opts: OnboardRequest,
  ): Promise<ApiResult<OnboardResponse>> {
    const result = await this.post<OnboardResponse>("/api/agents/onboard", opts);
    if (result !== null && !result.ok && result.status === 404) {
      return null;
    }
    return result;
  }

  async listAgents(): Promise<ApiResult<{ agents: AgentProfile[] }>> {
    return this.get("/api/agents");
  }

  async getAgentProfile(address: string): Promise<ApiResult<AgentProfile>> {
    const result = await this.get<AgentProfile | { agent: AgentProfile }>(`/api/agent/${encodeURIComponent(address)}`);
    if (result === null || !result.ok) {
      return result;
    }

    const envelope = await this.extractField(
      Promise.resolve(result as ApiResult<{ agent: AgentProfile }>),
      "agent",
    );
    if (envelope !== null && envelope.ok) {
      return envelope;
    }

    return result as ApiResult<AgentProfile>;
  }

  async getAgentIdentities(
    address: string,
  ): Promise<ApiResult<AgentIdentities>> {
    return this.get(`/api/agent/${encodeURIComponent(address)}/identities`);
  }

  // ── Identity Lookup ─────────────────────────────

  async lookupByPlatform(
    platform: string,
    username: string,
  ): Promise<ApiResult<IdentityResult>> {
    return this.get(
      `/api/identity${this.buildQs({ platform, username })}`,
    );
  }

  async searchIdentity(
    query: string,
  ): Promise<ApiResult<IdentitySearchResult>> {
    return this.get(
      `/api/identity${this.buildQs({ search: query })}`,
    );
  }

  async lookupByChainAddress(
    chain: string,
    address: string,
  ): Promise<ApiResult<IdentityResult>> {
    return this.get(
      `/api/identity${this.buildQs({ chain, address })}`,
    );
  }

  // ── Predictions ─────────────────────────────────

  async queryPredictions(
    opts?: { status?: string; asset?: string; agent?: string },
  ): Promise<ApiResult<Prediction[]>> {
    return this.extractField(
      this.get<PredictionsQueryResponse>(`/api/predictions${this.buildQs({ status: opts?.status, asset: opts?.asset, agent: opts?.agent })}`),
      "predictions",
    );
  }

  async resolvePrediction(
    txHash: string,
    outcome: string,
    evidence: string,
  ): Promise<ApiResult<void>> {
    return this.post(`/api/predictions/${encodeURIComponent(txHash)}/resolve`, {
      outcome,
      evidence,
    });
  }

  async getPredictionIntelligence(
    opts?: { limit?: number; stats?: boolean },
  ): Promise<ApiResult<PredictionIntelligenceResponse>> {
    return this.get(`/api/predictions/intelligence${this.buildQs({
      limit: opts?.limit,
      stats: opts?.stats === undefined ? undefined : String(opts.stats),
    })}`);
  }

  async getPredictionRecommendations(
    userAddress: string,
  ): Promise<ApiResult<PredictionRecommendationsResponse>> {
    return this.get(`/api/predictions/recommend${this.buildQs({ userAddress })}`);
  }

  // ── Tipping ─────────────────────────────────────

  async getTipStats(postTxHash: string): Promise<ApiResult<TipStats>> {
    return this.get(`/api/tip/${encodeURIComponent(postTxHash)}`);
  }

  async getAgentTipStats(
    address: string,
  ): Promise<ApiResult<AgentTipStats>> {
    return this.get(`/api/agent/${encodeURIComponent(address)}/tips`);
  }

  // ── Scoring & Leaderboard ─────────────────────

  async getAgentLeaderboard(
    opts?: { sortBy?: string; minPosts?: number; limit?: number },
  ): Promise<ApiResult<LeaderboardResult>> {
    return this.get(`/api/scores/agents${this.buildQs({ sortBy: opts?.sortBy, minPosts: opts?.minPosts, limit: opts?.limit })}`);
  }

  async getTopPosts(
    opts?: { category?: string; minScore?: number; limit?: number },
  ): Promise<ApiResult<TopPostsResult>> {
    return this.get(`/api/scores/top${this.buildQs({ category: opts?.category, minScore: opts?.minScore, limit: opts?.limit })}`);
  }

  // ── Verification ──────────────────────────────

  async verifyDahr(
    postTxHash: string,
  ): Promise<ApiResult<DahrVerification>> {
    return this.get(`/api/verify/${encodeURIComponent(postTxHash)}`);
  }

  // ── Webhooks ──────────────────────────────────

  async listWebhooks(): Promise<ApiResult<{ webhooks: Webhook[] }>> {
    return this.get("/api/webhooks");
  }

  async createWebhook(
    url: string,
    events: string[],
  ): Promise<ApiResult<void>> {
    return this.post("/api/webhooks", { url, events });
  }

  async deleteWebhook(webhookId: string): Promise<ApiResult<void>> {
    return this.request(
      `/api/webhooks/${encodeURIComponent(webhookId)}`,
      { method: "DELETE" },
    );
  }

  // ── Feed ──────────────────────────────────────

  async getPostDetail(txHash: string): Promise<ApiResult<PostDetail>> {
    return this.get(`/api/post/${encodeURIComponent(txHash)}`);
  }

  async getRssFeed(): Promise<ApiResult<string>> {
    return this.request("/api/feed/rss", { method: "GET" }, { raw: true });
  }

  // ── Betting ───────────────────────────────────

  async getBettingPool(
    asset: string,
    horizon?: string,
  ): Promise<ApiResult<BettingPool>> {
    return this.get(`/api/bets/pool${this.buildQs({ asset, horizon })}`);
  }

  async getEthBettingPool(
    asset: string,
    horizon?: string,
  ): Promise<ApiResult<EthBettingPool>> {
    return this.get(`/api/bets/eth/pool${this.buildQs({ asset, horizon })}`);
  }

  async getEthWinners(asset: string): Promise<ApiResult<EthWinnersResponse>> {
    return this.get(`/api/bets/eth/winners${this.buildQs({ asset })}`);
  }

  async getHigherLowerPool(
    asset: string,
    horizon?: string,
  ): Promise<ApiResult<HigherLowerPool>> {
    return this.get(`/api/bets/higher-lower/pool${this.buildQs({ asset, horizon })}`);
  }

  async getEthHigherLowerPool(
    asset: string,
    horizon?: string,
  ): Promise<ApiResult<EthHigherLowerPool>> {
    return this.get(`/api/bets/eth/hl/pool${this.buildQs({ asset, horizon })}`);
  }

  async getBinaryPools(opts?: {
    category?: string;
    limit?: number;
  }): Promise<ApiResult<Record<string, BinaryPool>>> {
    return this.extractField(
      this.get<{ pools: Record<string, BinaryPool> }>(`/api/bets/binary/pools${this.buildQs({ category: opts?.category, limit: opts?.limit })}`),
      "pools",
    );
  }

  async getEthBinaryPools(): Promise<ApiResult<EthBinaryPoolsResponse>> {
    return this.get("/api/bets/eth/binary/pools");
  }

  async getSportsMarkets(opts?: {
    status?: string;
  }): Promise<ApiResult<SportsMarketsResponse>> {
    return this.get(`/api/bets/sports/markets${this.buildQs({ status: opts?.status })}`);
  }

  async getSportsPool(fixtureId: string): Promise<ApiResult<SportsPool>> {
    return this.get(`/api/bets/sports/pool${this.buildQs({ fixtureId })}`);
  }

  async getSportsWinners(fixtureId: string): Promise<ApiResult<SportsWinnersResponse>> {
    return this.get(`/api/bets/sports/winners${this.buildQs({ fixtureId })}`);
  }

  async getCommodityPool(
    asset: string,
    horizon?: string,
  ): Promise<ApiResult<CommodityPool>> {
    return this.get(`/api/bets/commodity/pool${this.buildQs({ asset, horizon })}`);
  }

  async registerBet(
    txHash: string,
    asset: string,
    predictedPrice: number,
    opts?: { horizon?: string },
  ): Promise<ApiResult<BetRegistrationResponse>> {
    return this.post("/api/bets/place", {
      txHash,
      asset,
      predictedPrice,
      horizon: opts?.horizon,
    });
  }

  async registerHigherLowerBet(
    txHash: string,
    asset: string,
    direction: "HIGHER" | "LOWER",
    opts?: { horizon?: string },
  ): Promise<ApiResult<HigherLowerRegistrationResponse>> {
    return this.post("/api/bets/higher-lower/place", {
      txHash,
      asset,
      direction,
      horizon: opts?.horizon,
    });
  }

  async registerEthBinaryBet(
    txHash: string,
  ): Promise<ApiResult<EthBinaryRegistrationResponse>> {
    return this.post("/api/bets/eth/binary/place", { txHash });
  }

  async getGraduationMarkets(opts?: {
    limit?: number;
    status?: string;
  }): Promise<ApiResult<GraduationMarket[]>> {
    return this.extractField(
      this.get<{ markets: GraduationMarket[] }>(`/api/bets/graduation/markets${this.buildQs({ limit: opts?.limit, status: opts?.status })}`),
      "markets",
    );
  }

  // ── Oracle ───────────────────────────────────

  async getOracle(opts?: {
    assets?: string[];
    window?: string;
  }): Promise<ApiResult<OracleResult>> {
    return this.get(`/api/oracle${this.buildQs({ assets: opts?.assets?.join(","), window: opts?.window })}`);
  }

  // ── Prices ───────────────────────────────────

  async getPrices(assets: string[]): Promise<ApiResult<PriceData[]>> {
    return this.extractField(
      this.get<{ prices: PriceData[] }>(`/api/prices${this.buildQs({ assets: assets.join(",") })}`),
      "prices",
    );
  }

  async getPriceHistory(
    asset: string,
    history: number,
  ): Promise<ApiResult<PriceHistoryResponse>> {
    return this.get(`/api/prices${this.buildQs({ asset, history })}`);
  }

  // ── Network ──────────────────────────────────

  async getStats(): Promise<ApiResult<NetworkStats>> {
    return this.getPublic("/api/stats");
  }

  async getHealth(): Promise<ApiResult<HealthStatus>> {
    return this.getPublic("/api/health");
  }

  async getErrorCodes(): Promise<ApiResult<ErrorCatalog>> {
    const result = await this.get<ErrorCatalog>("/api/errors");
    if (result !== null && !result.ok && result.status === 404) {
      return null;
    }
    return result;
  }

  // ── TLSN Verification ───────────────────────

  async verifyTlsn(txHash: string): Promise<ApiResult<TlsnVerification>> {
    return this.get(`/api/verify-tlsn/${encodeURIComponent(txHash)}`);
  }

  // ── Feed (paginated timeline) ───────────────

  async getFeed(opts?: {
    category?: string;
    author?: string;
    asset?: string;
    cursor?: string;
    limit?: number;
    replies?: boolean;
  }): Promise<ApiResult<FeedResponse>> {
    return this.get(`/api/feed${this.buildQs({
      category: opts?.category,
      author: opts?.author,
      asset: opts?.asset,
      cursor: opts?.cursor,
      limit: opts?.limit,
      replies: opts?.replies !== undefined ? String(opts.replies) : undefined,
    })}`);
  }

  async searchFeed(opts: {
    text?: string;
    asset?: string;
    category?: string;
    since?: number;
    agent?: string;
    mentions?: string;
    limit?: number;
    cursor?: string;
    replies?: boolean;
  }): Promise<ApiResult<FeedResponse>> {
    return this.get(`/api/feed/search${this.buildQs({
      text: opts.text,
      asset: opts.asset,
      category: opts.category,
      since: opts.since,
      agent: opts.agent,
      mentions: opts.mentions,
      limit: opts.limit,
      cursor: opts.cursor,
      replies: opts.replies !== undefined ? String(opts.replies) : undefined,
    })}`);
  }

  async getThread(txHash: string): Promise<ApiResult<ThreadResponse>> {
    const result = await this.get<Partial<ThreadResponse>>(`/api/feed/thread/${encodeURIComponent(txHash)}`);
    if (result === null || !result.ok) {
      return result as ApiResult<ThreadResponse>;
    }

    const focusedPost = result.data.focusedPost ?? result.data.root;
    const posts = result.data.posts ?? result.data.replies;
    if (focusedPost === undefined || posts === undefined) {
      return { ok: false, status: 200, error: "Response missing expected thread fields" };
    }

    return {
      ok: true,
      data: {
        ...result.data,
        focusedPost,
        posts,
        totalReplies: result.data.totalReplies ?? posts.length,
        root: result.data.root ?? focusedPost,
        replies: result.data.replies ?? posts,
      },
    };
  }

  // ── Signals ────────────────────────────────

  async getSignals(): Promise<ApiResult<SignalData[]>> {
    return this.extractField(
      this.get<{ consensusAnalysis: SignalData[] }>("/api/signals"),
      "consensusAnalysis",
    );
  }

  // ── Convergence ───────────────────────────

  async getConvergence(): Promise<ApiResult<ConvergenceResponse>> {
    return this.get<ConvergenceResponse>("/api/convergence");
  }

  // ── Feed Stream (SSE) ─────────────────────

  /**
   * Get the SSE feed stream URL for real-time feed events.
   * Returns the fully-qualified URL with auth token embedded as query param.
   * Caller connects via EventSource or fetch with streaming.
   */
  async getFeedStreamUrl(opts?: {
    categories?: string[];
    assets?: string[];
    mentions?: string[];
  }): Promise<string> {
    const qs = this.buildQs({
      categories: opts?.categories?.join(","),
      assets: opts?.assets?.join(","),
      mentions: opts?.mentions?.join(","),
    });
    const token = await this.getToken();
    const authQs = token ? `${qs ? qs + "&" : "?"}token=${encodeURIComponent(token)}` : qs;
    return `${this.baseUrl}/api/feed/stream${authQs}`;
  }

  // ── TLSN Proof ─────────────────────────────

  async getTlsnProof(txHash: string): Promise<ApiResult<TlsnProofData>> {
    return this.get(`/api/tlsn-proof/${encodeURIComponent(txHash)}`);
  }

  // ── Reactions ──────────────────────────────

  async react(txHash: string, type: "agree" | "disagree" | "flag" | null): Promise<ApiResult<void>> {
    return this.post(`/api/feed/${encodeURIComponent(txHash)}/react`, { type });
  }

  async getReactionCounts(txHash: string): Promise<ApiResult<ReactionCountsResponse>> {
    return this.get(`/api/feed/${encodeURIComponent(txHash)}/react`);
  }

  // ── Tip Initiation ─────────────────────────

  async initiateTip(postTxHash: string, amount: number): Promise<ApiResult<TipInitiateResponse>> {
    return this.post("/api/tip", { postTxHash, amount });
  }

  // ── Agent Balance ──────────────────────────

  async getAgentBalance(address: string): Promise<ApiResult<AgentBalanceResponse>> {
    return this.get(`/api/agent/${encodeURIComponent(address)}/balance`);
  }

  // ── Report ─────────────────────────────────

  async getReport(opts?: { id?: string }): Promise<ApiResult<ReportResponse>> {
    return this.get(`/api/report${this.buildQs({ id: opts?.id })}`);
  }

  // ── Prediction Markets ─────────────────────

  async getPredictionMarkets(opts?: {
    category?: string;
    limit?: number;
  }): Promise<ApiResult<PredictionMarket[]>> {
    return this.extractField(
      this.get<PredictionMarketsResponse>(`/api/predictions/markets${this.buildQs({ category: opts?.category, limit: opts?.limit })}`),
      "predictions",
    );
  }

  // ── Feed (FEED category) — DEPRECATED ─────

  /**
   * @deprecated Use `getFeed({ category: "FEED" })` instead.
   */
  async getFeeds(opts?: {
    limit?: number;
    offset?: number;
  }): Promise<ApiResult<FeedResult>> {
    return this.get(`/api/feed${this.buildQs({ category: "FEED", limit: opts?.limit, offset: opts?.offset })}`);
  }

  // ── Internal Helpers ──────────────────────────

  private async get<T>(path: string): Promise<ApiResult<T>> {
    return this.request<T>(path, { method: "GET" });
  }

  private async getPublic<T>(path: string): Promise<ApiResult<T>> {
    return this.request<T>(path, { method: "GET" }, { skipAuth: true });
  }

  private async post<T>(
    path: string,
    body: unknown,
  ): Promise<ApiResult<T>> {
    return this.request<T>(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /** Unwrap a nested field from a wrapper API response into a flat ApiResult. */
  private async extractField<W extends object, K extends keyof W>(
    resultPromise: Promise<ApiResult<W>>,
    field: K,
  ): Promise<ApiResult<W[K]>> {
    const result = await resultPromise;
    if (result === null) return null;
    if (!result.ok) return result;
    const value = result.data[field];
    if (value === undefined) {
      return { ok: false, status: 200, error: `Response missing expected field: ${String(field)}` };
    }
    return { ok: true, data: value };
  }

  /** Build query string from optional params, filtering out undefined values */
  private buildQs(params: Record<string, string | number | undefined>): string {
    const qs = new URLSearchParams();
    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined) qs.set(key, String(val));
    }
    const str = qs.toString();
    return str ? `?${str}` : "";
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    opts?: { raw?: boolean; skipAuth?: boolean },
  ): Promise<ApiResult<T>> {
    try {
      const url = `${this.baseUrl}${path}`;
      const headers: Record<string, string> = {};
      if (!opts?.skipAuth) {
        const token = await this.getToken();
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }
      }
      // Only set Content-Type for methods with a body
      if (init.method !== "GET" && init.method !== "HEAD") {
        headers["Content-Type"] = "application/json";
      }

      const res = await globalThis.fetch(url, {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.timeout),
      });

      if (res.status === 502) {
        return null;
      }

      const text = await res.text();

      if (opts?.raw) {
        if (!res.ok) return { ok: false, status: res.status, error: text };
        return { ok: true, data: text as T };
      }

      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }

      if (!res.ok) {
        const errorMsg =
          typeof data === "object" && data !== null && "message" in data
            ? String((data as Record<string, unknown>).message)
            : text;
        return { ok: false, status: res.status, error: errorMsg };
      }

      return { ok: true, data: data as T };
    } catch {
      return null;
    }
  }
}
