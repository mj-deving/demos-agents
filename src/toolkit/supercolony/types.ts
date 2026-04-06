/**
 * Shared SuperColony type definitions.
 *
 * These types reflect the official SuperColony skill spec and are used
 * across toolkit and strategy layers. Includes post categories, API response
 * types, and the ApiResult<T> generic for graceful degradation.
 */

// ── Post Categories ─────────────────────────────────

/** All post categories from the official SuperColony docs (supercolony.ai/docs) */
export type PostCategory =
  | "OBSERVATION"
  | "ANALYSIS"
  | "PREDICTION"
  | "ALERT"
  | "ACTION"
  | "SIGNAL"
  | "QUESTION"
  | "OPINION"
  | "FEED"
  | "VOTE";

export const POST_CATEGORIES: readonly PostCategory[] = [
  "OBSERVATION",
  "ANALYSIS",
  "PREDICTION",
  "ALERT",
  "ACTION",
  "SIGNAL",
  "QUESTION",
  "OPINION",
  "FEED",
  "VOTE",
] as const;

// ── Generic Result ──────────────────────────────────

/** Generic API result -- null means API was unreachable (graceful degradation) */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string }
  | null;

// ── Agent Identity ──────────────────────────────────

export interface AgentProfile {
  address: string;
  name: string;
  description: string;
  specialties: string[];
  postCount: number;
  lastActiveAt: number;
  displayName?: string;
  registeredAt?: number;
  lastSeen?: number;
  categoryBreakdown?: Record<string, number>;
  web2Identities?: Array<{ platform: string; username: string }>;
}

export interface AgentIdentities {
  web2Identities: Array<{ platform: string; username: string }>;
  xmIdentities: Array<{ chain: string; address: string }>;
}

// ── Identity Lookup ─────────────────────────────────

export interface IdentityResult {
  platform: string;
  username: string;
  accounts: Array<{ address: string; displayName: string }>;
  found: boolean;
}

export interface IdentitySearchResult {
  results: IdentityResult[];
}

// ── Predictions ─────────────────────────────────────

export interface Prediction {
  txHash: string;
  author: string;
  asset: string;
  predictedPrice: number;
  actualPrice?: number;
  accuracy?: number;
  status: "pending" | "correct" | "incorrect" | "expired" | "resolved";
  evidence?: string;
  resolvedAt?: number;
  resolvedBy?: string;
}

// ── Tipping ─────────────────────────────────────────

export interface TipStats {
  totalTips: number;
  totalDem: number;
  tippers: string[];
  topTip: number;
}

export interface AgentTipStats {
  tipsGiven: { count: number; totalDem: number };
  tipsReceived: { count: number; totalDem: number };
}

// ── Scoring & Leaderboard ───────────────────────────

export interface LeaderboardResult {
  agents: Array<{
    address: string;
    name: string;
    postCount: number;
    avgScore: number;
    bayesianScore: number;
    topScore: number;
    lowScore: number;
    lastActiveAt: number;
  }>;
  count: number;
  globalAvg: number;
  confidenceThreshold: number;
}

export interface TopPostsResult {
  posts: Array<{
    txHash: string;
    author: string;
    category: string;
    text: string;
    score: number;
    timestamp: number;
    blockNumber: number;
    confidence?: number;
  }>;
  count: number;
}

// ── Verification ────────────────────────────────────

export interface DahrVerification {
  verified: boolean;
  attestations: Array<{
    url: string;
    responseHash: string;
    txHash: string;
    explorerUrl: string;
  }>;
}

// ── Webhooks ────────────────────────────────────────

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
}

// ── Feed ────────────────────────────────────────────

export interface PostDetail {
  post: { txHash: string; author: string; timestamp: number; payload: Record<string, unknown> };
  parent?: { txHash: string; author: string; timestamp: number; payload: Record<string, unknown> };
  replies: Array<{ txHash: string; author: string; timestamp: number; payload: Record<string, unknown> }>;
}

// ── Betting ─────────────────────────────────────────

export interface BettingPool {
  asset: string;
  horizon: string;
  totalBets: number;
  totalDem: number;
  poolAddress: string;
  roundEnd: number;
  bets: Array<{ txHash: string; bettor: string; predictedPrice: number; amount: number; roundEnd: number; horizon: string }>;
}

// ── Oracle ──────────────────────────────────────────

export interface OracleDivergence {
  type: string;           // e.g. "agents_vs_market"
  asset: string;
  description: string;
  severity: "low" | "medium" | "high";
  details?: {
    agentDirection?: string;
    marketDirection?: string;
    agentConfidence?: number;
    marketSignal?: string;
  };
}

export interface OracleResult {
  overallSentiment?: { direction: string; score: number; agentCount: number; topAssets: string[] };
  assets?: Array<{
    ticker: string;
    postCount: number;
    price: { usd: number; change24h: number; high24h: number; low24h: number };
    sentiment?: { direction: string; score: number };
  }>;
  divergences: OracleDivergence[];
  polymarket?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  /** @deprecated Use divergences. Old shape kept for backward compat in tests. */
  priceDivergences?: Array<{ asset: string; cex: number; dex: number; spread: number }>;
  /** @deprecated Use overallSentiment. */
  sentiment?: Record<string, number>;
  /** @deprecated */
  polymarketOdds?: Array<{ market: string; outcome: string; probability: number }>;
  timestamp?: number;
}

// ── Prices ──────────────────────────────────────────

export interface PriceData {
  ticker: string;
  symbol?: string;
  priceUsd: number;
  change24h?: number;
  high24h?: number;
  low24h?: number;
  volume24h?: number;
  marketCap?: number;
  fetchedAt: number;
  dahrTxHash?: string | null;
  source: string;
}

export interface PriceHistoryEntry {
  price: number;
  timestamp: number;
}

// ── Ballot ──────────────────────────────────────────

export interface BallotState {
  votes: Array<{
    asset: string;
    direction: "up" | "down";
    agent: string;
    confidence: number;
    timestamp: number;
  }>;
  totalVotes: number;
}

export interface BallotAccuracy {
  address: string;
  totalVotes: number;
  correctVotes: number;
  accuracy: number;
  streak: number;
}

export interface BallotLeaderboardEntry {
  address: string;
  name?: string;
  accuracy: number;
  totalVotes: number;
  streak: number;
}

export interface BallotLeaderboard {
  entries: BallotLeaderboardEntry[];
  count: number;
}

// ── Network Stats ───────────────────────────────────

export interface NetworkStats {
  network: { totalPosts: number; totalAgents: number; totalTransactions: number };
  activity: { postsLast24h: number; activeAgentsLast24h: number; reactionsLast24h: number };
  quality: { avgScore: number; attestationRate: number };
  predictions: { total: number; accuracy: number };
  tips: { totalDem: number; uniqueTippers: number };
  consensus: { activeTopics: number; avgAgentsPerTopic: number };
  content: { categoryBreakdown: Record<string, number> };
  computedAt: string;
}

// ── Health ──────────────────────────────────────────

export interface HealthStatus {
  status: "ok" | "degraded" | "down";
  uptime: number;
  timestamp: number;
  memory?: { heapUsed: number; rss: number };
}

// ── TLSN Verification ──────────────────────────────

export interface TlsnVerification {
  verified: boolean;
  proof: Record<string, unknown>;
  txHash: string;
}

// ── Feed (paginated timeline) ────────────────────────

export interface FeedResponse {
  posts: Array<{ txHash: string; author: string; timestamp: number; payload: Record<string, unknown> }>;
  hasMore: boolean;
}

// ── Thread ──────────────────────────────────────────

export interface ThreadResponse {
  root: Record<string, unknown>;
  replies: Array<Record<string, unknown>>;
}

// ── Signals ─────────────────────────────────────────

export interface SignalData {
  topic: string;
  consensus: boolean;
  direction: string;
  agentCount: number;
  totalAgents: number;
  confidence: number;
  text: string;
  trending: boolean;
}

// ── TLSN Proof ──────────────────────────────────────

export interface TlsnProofData {
  proof: Record<string, unknown>;
  txHash: string;
}

// ── Tip Initiation ──────────────────────────────────

export interface TipInitiateResponse {
  ok: boolean;
  recipient: string;
  error?: string;
}

// ── Agent Balance ───────────────────────────────────

export interface AgentBalanceResponse {
  balance: number;
  updatedAt: number;
}

// ── Report ──────────────────────────────────────────

export interface ReportResponse {
  id: string;
  title: string;
  summary: string;
  script: string;
  audioUrl?: string;
  signalCount?: number;
  postCount?: number;
  agentCount?: number;
  sources?: string[];
  status: string;
  createdAt: string;
  publishedAt?: string;
}

// ── Prediction Markets ──────────────────────────────

export interface PredictionMarket {
  marketId: string;
  question: string;
  category: string;
  outcomeYes: number;
  outcomeNo: number;
  volume: string;
  liquidity?: string;
  endDate?: string;
}

// ── Ballot Performance ──────────────────────────────

export interface BallotPerformanceData {
  daily: Array<{ date: string; accuracy: number; votes: number }>;
  bestAsset: string;
  worstAsset: string;
}

// ── Feed (FEED category) — DEPRECATED ───────────────

export interface FeedPost {
  txHash: string;
  author: string;
  text: string;
  timestamp: number;
  tags: string[];
}

export interface FeedResult {
  posts: FeedPost[];
  count: number;
}
