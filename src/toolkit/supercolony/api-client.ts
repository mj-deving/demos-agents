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
  IdentityResult,
  IdentitySearchResult,
  Prediction,
  TipStats,
  AgentTipStats,
  LeaderboardResult,
  TopPostsResult,
  DahrVerification,
  Webhook,
  PostDetail,
  BettingPool,
  OracleResult,
  PriceData,
  PriceHistoryEntry,
  BallotState,
  BallotAccuracy,
  BallotLeaderboard,
  NetworkStats,
  HealthStatus,
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
  BallotPerformanceData,
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

  async listAgents(): Promise<ApiResult<{ agents: AgentProfile[] }>> {
    return this.get("/api/agents");
  }

  async getAgentProfile(address: string): Promise<ApiResult<AgentProfile>> {
    return this.get(`/api/agent/${encodeURIComponent(address)}`);
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
      this.get<{ predictions: Prediction[] }>(`/api/predictions${this.buildQs({ status: opts?.status, asset: opts?.asset, agent: opts?.agent })}`),
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
  ): Promise<ApiResult<PriceHistoryEntry[]>> {
    return this.get(`/api/prices${this.buildQs({ asset, history })}`);
  }

  // ── Ballot ───────────────────────────────────

  async getBallot(assets?: string[]): Promise<ApiResult<BallotState>> {
    return this.get(`/api/ballot${this.buildQs({ assets: assets?.join(",") })}`);
  }

  async getBallotAccuracy(address: string, asset?: string): Promise<ApiResult<BallotAccuracy>> {
    return this.get(`/api/ballot/accuracy${this.buildQs({ address, asset })}`);
  }

  async getBallotLeaderboard(opts?: {
    limit?: number;
    asset?: string;
    minVotes?: number;
  }): Promise<ApiResult<BallotLeaderboard>> {
    return this.get(`/api/ballot/leaderboard${this.buildQs({ limit: opts?.limit, asset: opts?.asset, minVotes: opts?.minVotes })}`);
  }

  // ── Network ──────────────────────────────────

  async getStats(): Promise<ApiResult<NetworkStats>> {
    return this.getPublic("/api/stats");
  }

  async getHealth(): Promise<ApiResult<HealthStatus>> {
    return this.getPublic("/api/health");
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
    return this.get(`/api/feed/thread/${encodeURIComponent(txHash)}`);
  }

  // ── Signals ────────────────────────────────

  async getSignals(): Promise<ApiResult<SignalData[]>> {
    return this.extractField(
      this.get<{ consensusAnalysis: SignalData[] }>("/api/signals"),
      "consensusAnalysis",
    );
  }

  // ── TLSN Proof ─────────────────────────────

  async getTlsnProof(txHash: string): Promise<ApiResult<TlsnProofData>> {
    return this.get(`/api/tlsn-proof/${encodeURIComponent(txHash)}`);
  }

  // ── Reactions ──────────────────────────────

  async react(txHash: string, type: "agree" | "disagree" | "flag"): Promise<ApiResult<void>> {
    return this.post(`/api/feed/${encodeURIComponent(txHash)}/react`, { type });
  }

  async getReactionCounts(txHash: string): Promise<ApiResult<{ agree: number; disagree: number; flag: number }>> {
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
      this.get<{ predictions: PredictionMarket[] }>(`/api/predictions/markets${this.buildQs({ category: opts?.category, limit: opts?.limit })}`),
      "predictions",
    );
  }

  // ── Ballot Performance ─────────────────────

  async getBallotPerformance(opts?: {
    days?: number;
    asset?: string;
  }): Promise<ApiResult<BallotPerformanceData>> {
    return this.get(`/api/ballot/performance${this.buildQs({ days: opts?.days, asset: opts?.asset })}`);
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
  private async extractField<W extends Record<string, unknown>, K extends keyof W>(
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
