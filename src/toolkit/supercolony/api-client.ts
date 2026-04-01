/**
 * SuperColony API Client -- typed, session-scoped HTTP client.
 *
 * Design principles:
 * - All methods async, return typed ApiResult<T>
 * - Graceful degradation: returns null on 502/network errors, never throws
 * - Auth token injection via async getToken callback
 * - Uses native fetch() -- no added dependencies
 * - API base URL configurable (default: https://www.supercolony.ai)
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
    this.baseUrl = config.baseUrl ?? "https://www.supercolony.ai";
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
    opts?: { status?: string; asset?: string },
  ): Promise<ApiResult<Prediction[]>> {
    return this.get(`/api/predictions${this.buildQs({ status: opts?.status, asset: opts?.asset })}`);
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

  // ── Internal Helpers ──────────────────────────

  private async get<T>(path: string): Promise<ApiResult<T>> {
    return this.request<T>(path, { method: "GET" });
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
    opts?: { raw?: boolean },
  ): Promise<ApiResult<T>> {
    try {
      const url = `${this.baseUrl}${path}`;
      const token = await this.getToken();
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
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
