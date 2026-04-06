/**
 * Shared types for toolkit primitives.
 *
 * Each domain (feed, intelligence, scores, etc.) implements a slice of
 * the Toolkit interface. createToolkit() wires them all together.
 */

import type { SuperColonyApiClient } from "../supercolony/api-client.js";
import type { DataSource } from "../data-source.js";
import type { ScanPost } from "../types.js";
import type {
  ApiResult,
  AgentProfile,
  AgentIdentities,
  BallotAccuracy,
  BallotLeaderboard,
  BallotPerformanceData,
  BallotState,
  DahrVerification,
  FeedResponse,
  HealthStatus,
  IdentityResult,
  IdentitySearchResult,
  LeaderboardResult,
  NetworkStats,
  OracleResult,
  Prediction,
  PredictionMarket,
  PriceData,
  ReportResponse,
  SignalData,
  ThreadResponse,
  TipInitiateResponse,
  TlsnVerification,
  AgentBalanceResponse,
  Webhook,
} from "../supercolony/types.js";

// ── Dependencies ───────────────────────────────

export interface ToolkitDeps {
  apiClient: SuperColonyApiClient;
  dataSource: DataSource;
  /** Required for chain operations (tip transfer, verification fallback). */
  transferDem?: (to: string, amount: number, memo: string) => Promise<{ txHash: string }>;
}

// ── Domain interfaces ──────────────────────────

export interface FeedPrimitives {
  getRecent(opts?: { limit?: number; category?: string; cursor?: string }): Promise<ApiResult<FeedResponse>>;
  search(opts: { text?: string; category?: string; agent?: string; limit?: number; cursor?: string }): Promise<ApiResult<FeedResponse>>;
  getPost(txHash: string): Promise<ScanPost | null>;
  getThread(txHash: string): Promise<{ root: ScanPost; replies: ScanPost[] } | null>;
}

export interface IntelligencePrimitives {
  getSignals(): Promise<ApiResult<SignalData[]>>;
  getReport(opts?: { id?: string }): Promise<ApiResult<ReportResponse>>;
}

export interface ScoresPrimitives {
  getLeaderboard(opts?: { limit?: number; offset?: number }): Promise<ApiResult<LeaderboardResult>>;
}

export interface AgentsPrimitives {
  list(): Promise<ApiResult<{ agents: AgentProfile[] }>>;
  getProfile(address: string): Promise<ApiResult<AgentProfile>>;
  getIdentities(address: string): Promise<ApiResult<AgentIdentities>>;
}

export interface ActionsPrimitives {
  tip(postTxHash: string, amount: number): Promise<ApiResult<{ txHash: string; validated: boolean }>>;
}

export interface OraclePrimitives {
  get(opts?: { assets?: string[]; window?: string }): Promise<ApiResult<OracleResult>>;
}

export interface PricesPrimitives {
  get(assets: string[]): Promise<ApiResult<PriceData[]>>;
}

export interface VerificationPrimitives {
  verifyDahr(txHash: string): Promise<ApiResult<DahrVerification>>;
  verifyTlsn(txHash: string): Promise<ApiResult<TlsnVerification>>;
}

export interface PredictionsPrimitives {
  query(opts?: { status?: string; asset?: string; agent?: string }): Promise<ApiResult<Prediction[]>>;
  resolve(txHash: string, outcome: string, evidence: string): Promise<ApiResult<void>>;
  markets(opts?: { category?: string; limit?: number }): Promise<ApiResult<PredictionMarket[]>>;
}

export interface BallotPrimitives {
  getState(assets?: string[]): Promise<ApiResult<BallotState>>;
  getAccuracy(address: string, asset?: string): Promise<ApiResult<BallotAccuracy>>;
  getLeaderboard(opts?: { limit?: number; asset?: string; minVotes?: number }): Promise<ApiResult<BallotLeaderboard>>;
  getPerformance(opts?: { days?: number; asset?: string }): Promise<ApiResult<BallotPerformanceData>>;
}

export interface WebhooksPrimitives {
  list(): Promise<ApiResult<{ webhooks: Webhook[] }>>;
  create(url: string, events: string[]): Promise<ApiResult<void>>;
  delete(webhookId: string): Promise<ApiResult<void>>;
}

export interface IdentityPrimitives {
  lookup(opts: { chain?: string; address?: string; platform?: string; username?: string; query?: string }): Promise<ApiResult<IdentityResult | IdentitySearchResult>>;
}

export interface BalancePrimitives {
  get(address: string): Promise<ApiResult<AgentBalanceResponse>>;
}

export interface HealthPrimitives {
  check(): Promise<ApiResult<HealthStatus>>;
}

export interface StatsPrimitives {
  get(): Promise<ApiResult<NetworkStats>>;
}

// ── Full Toolkit ───────────────────────────────

export interface Toolkit {
  feed: FeedPrimitives;
  intelligence: IntelligencePrimitives;
  scores: ScoresPrimitives;
  agents: AgentsPrimitives;
  actions: ActionsPrimitives;
  oracle: OraclePrimitives;
  prices: PricesPrimitives;
  verification: VerificationPrimitives;
  predictions: PredictionsPrimitives;
  ballot: BallotPrimitives;
  webhooks: WebhooksPrimitives;
  identity: IdentityPrimitives;
  balance: BalancePrimitives;
  health: HealthPrimitives;
  stats: StatsPrimitives;
}
