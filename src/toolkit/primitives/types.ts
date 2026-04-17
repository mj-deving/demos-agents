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
  BettingPool,
  DahrVerification,
  FeedResponse,
  HealthStatus,
  IdentityResult,
  IdentitySearchResult,
  LeaderboardResult,
  LinkedAgent,
  NetworkStats,
  OracleResult,
  Prediction,
  PredictionLeaderboardResult,
  PredictionScoreResult,
  PredictionMarket,
  PriceData,
  ReportResponse,
  SignalData,
  ThreadResponse,
  TipInitiateResponse,
  TlsnVerification,
  AgentBalanceResponse,
  AgentTipStats,
  TipStats,
  Webhook,
} from "../supercolony/types.js";

// ── Dependencies ───────────────────────────────

export interface ToolkitDeps {
  apiClient: SuperColonyApiClient;
  dataSource: DataSource;
  /** Required for chain operations (tip transfer, verification fallback). */
  transferDem?: (to: string, amount: number, memo: string) => Promise<{ txHash: string }>;
  /** RPC URL for TX simulation (eth_call). Required for simulation gate. */
  rpcUrl?: string;
  /** Sender address for TX simulation. */
  fromAddress?: string;
}

// ── Domain interfaces ──────────────────────────

export interface FeedPrimitives {
  getRecent(opts?: { limit?: number; category?: string; cursor?: string; author?: string; asset?: string; replies?: boolean }): Promise<ApiResult<FeedResponse>>;
  search(opts: { text?: string; category?: string; agent?: string; limit?: number; cursor?: string; asset?: string; since?: number; mentions?: string; replies?: boolean }): Promise<ApiResult<FeedResponse>>;
  getPost(txHash: string): Promise<ScanPost | null>;
  getThread(txHash: string): Promise<{ root: ScanPost; replies: ScanPost[] } | null>;
  /** Full post detail with parent context and replies (richer than getThread) */
  getPostDetail(txHash: string): Promise<ApiResult<import("../supercolony/types.js").PostDetail>>;
  /** RSS feed output (XML string) */
  getRss(): Promise<ApiResult<string>>;
}

export interface IntelligencePrimitives {
  getSignals(): Promise<ApiResult<SignalData[]>>;
  getConvergence(): Promise<ApiResult<import("../supercolony/types.js").ConvergenceResponse>>;
  getReport(opts?: { id?: string }): Promise<ApiResult<ReportResponse>>;
  getPredictionIntelligence(opts?: { limit?: number; stats?: boolean }): Promise<ApiResult<import("../supercolony/types.js").PredictionIntelligenceResponse>>;
  getPredictionRecommendations(userAddress: string): Promise<ApiResult<import("../supercolony/types.js").PredictionRecommendationsResponse>>;
}

export interface ScoresPrimitives {
  getLeaderboard(opts?: { limit?: number; offset?: number; sortBy?: string; minPosts?: number }): Promise<ApiResult<LeaderboardResult>>;
  /** Top-scored posts filtered by category and/or minimum score */
  getTopPosts(opts?: { category?: string; minScore?: number; limit?: number }): Promise<ApiResult<import("../supercolony/types.js").TopPostsResult>>;
  getPredictionLeaderboard(opts?: { limit?: number }): Promise<ApiResult<PredictionLeaderboardResult>>;
  getPredictionScore(address: string): Promise<ApiResult<PredictionScoreResult>>;
}

export interface AgentsPrimitives {
  list(): Promise<ApiResult<{ agents: AgentProfile[] }>>;
  getProfile(address: string): Promise<ApiResult<AgentProfile>>;
  getIdentities(address: string): Promise<ApiResult<AgentIdentities>>;
  /** Register agent profile (name, description, specialties) */
  register(opts: { name: string; description: string; specialties: string[] }): Promise<ApiResult<void>>;
  createLinkChallenge(agentAddress: string): Promise<ApiResult<import("../supercolony/types.js").AgentLinkChallengeResponse>>;
  claimLink(opts: { challenge?: string; challengeId?: string; agentAddress: string; signature: string }): Promise<ApiResult<import("../supercolony/types.js").AgentLinkClaimResponse>>;
  approveLink(opts: { challenge?: string; challengeId?: string; agentAddress: string; action: "approve" | "reject" }): Promise<ApiResult<import("../supercolony/types.js").AgentLinkClaimResponse>>;
  listLinked(): Promise<ApiResult<{ agents: LinkedAgent[] }>>;
  unlink(agentAddress: string): Promise<ApiResult<void>>;
}

export interface ActionsPrimitives {
  tip(postTxHash: string, amount: number): Promise<ApiResult<{ txHash: string; validated: boolean }>>;
  react(txHash: string, type: "agree" | "disagree" | "flag" | null): Promise<ApiResult<void>>;
  getReactions(txHash: string): Promise<ApiResult<{ agree: number; disagree: number; flag: number }>>;
  getTipStats(postTxHash: string): Promise<ApiResult<TipStats>>;
  getAgentTipStats(address: string): Promise<ApiResult<AgentTipStats>>;
  placeBet(asset: string, price: number, opts?: { horizon?: string }): Promise<ApiResult<import("../supercolony/types.js").RegisteredTransferResult>>;
  placeHL(
    asset: string,
    direction: "higher" | "lower",
    opts?: { amount?: number; horizon?: string },
  ): Promise<ApiResult<import("../supercolony/types.js").RegisteredTransferResult>>;
  registerBet(
    txHash: string,
    asset: string,
    predictedPrice: number,
    opts?: { horizon?: string },
  ): Promise<ApiResult<import("../supercolony/types.js").BetRegistrationResponse>>;
  registerHL(
    txHash: string,
    asset: string,
    direction: "higher" | "lower",
    opts?: { horizon?: string },
  ): Promise<ApiResult<import("../supercolony/types.js").HigherLowerRegistrationResponse>>;
  registerEthBinaryBet(
    txHash: string,
  ): Promise<ApiResult<import("../supercolony/types.js").EthBinaryRegistrationResponse>>;
  /** Initiate a tip via API (validates recipient before chain transfer) */
  initiateTip(postTxHash: string, amount: number): Promise<ApiResult<import("../supercolony/types.js").TipInitiateResponse>>;
}

export interface OraclePrimitives {
  get(opts?: { assets?: string[]; window?: string }): Promise<ApiResult<OracleResult>>;
}

export interface PricesPrimitives {
  get(assets: string[]): Promise<ApiResult<PriceData[]>>;
  /** Historical price data for a single asset — returns snapshots from the history field */
  getHistory(asset: string, periods: number): Promise<ApiResult<import("../supercolony/types.js").PriceData[]>>;
}

export interface VerificationPrimitives {
  verifyDahr(txHash: string): Promise<ApiResult<DahrVerification>>;
  verifyTlsn(txHash: string): Promise<ApiResult<TlsnVerification>>;
  /** Raw TLSN proof data for a transaction */
  getTlsnProof(txHash: string): Promise<ApiResult<import("../supercolony/types.js").TlsnProofData>>;
}

export interface PredictionsPrimitives {
  query(opts?: { status?: string; asset?: string; agent?: string }): Promise<ApiResult<Prediction[]>>;
  resolve(txHash: string, outcome: string, evidence: string): Promise<ApiResult<void>>;
  markets(opts?: { category?: string; limit?: number }): Promise<ApiResult<PredictionMarket[]>>;
}

export interface BallotPrimitives {
  /** Active betting pool. Uses /api/bets/pool. */
  getPool(opts?: { asset?: string; horizon?: string }): Promise<ApiResult<BettingPool>>;
  /** Active higher-lower pool. Uses /api/bets/higher-lower/pool. */
  getHigherLowerPool(opts?: { asset?: string; horizon?: string }): Promise<ApiResult<import("../supercolony/types.js").HigherLowerPool>>;
  /** DEM binary pools keyed by marketId. Uses /api/bets/binary/pools. */
  getBinaryPools(opts?: { category?: string; limit?: number }): Promise<ApiResult<Record<string, import("../supercolony/types.js").BinaryPool>>>;
  /** ETH-denominated betting pool. Uses /api/bets/eth/pool. */
  getEthPool(opts?: { asset?: string; horizon?: string }): Promise<ApiResult<import("../supercolony/types.js").EthBettingPool>>;
  /** Recent ETH winners. Uses /api/bets/eth/winners. */
  getEthWinners(opts?: { asset?: string }): Promise<ApiResult<import("../supercolony/types.js").EthWinnersResponse>>;
  /** ETH-denominated higher-lower pool. Uses /api/bets/eth/hl/pool. */
  getEthHigherLowerPool(opts?: { asset?: string; horizon?: string }): Promise<ApiResult<import("../supercolony/types.js").EthHigherLowerPool>>;
  /** ETH binary pools keyed by market id with enablement metadata. */
  getEthBinaryPools(): Promise<ApiResult<import("../supercolony/types.js").EthBinaryPoolsResponse>>;
  /** Sports fixture markets and aggregate sports pool address. */
  getSportsMarkets(opts?: { status?: string }): Promise<ApiResult<import("../supercolony/types.js").SportsMarketsResponse>>;
  /** Sports pool state for a specific fixture. */
  getSportsPool(fixtureId: string): Promise<ApiResult<import("../supercolony/types.js").SportsPool>>;
  /** Sports winners envelope for a specific fixture. */
  getSportsWinners(fixtureId: string): Promise<ApiResult<import("../supercolony/types.js").SportsWinnersResponse>>;
  /** Commodity-denominated betting pool. */
  getCommodityPool(opts?: { asset?: string; horizon?: string }): Promise<ApiResult<import("../supercolony/types.js").CommodityPool>>;
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
  requestFaucet(address: string): Promise<{ ok: true } | { ok: false; error: string }>;
  ensureMinimum(address: string, threshold: bigint): Promise<{ ok: true; topped: boolean; balance: bigint } | { ok: false; error: string }>;
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
