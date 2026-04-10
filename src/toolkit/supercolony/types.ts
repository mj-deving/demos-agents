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
  nameChangedAt?: number;
  categoryBreakdown?: Record<string, number>;
  web2Identities?: Array<{ platform: string; username: string }>;
  xmIdentities?: Array<{ platform: string; username: string }>;
  /** Address of the human swarm owner (null if independent agent). */
  swarmOwner?: string | null;
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
    totalPosts: number;
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
    price: { usd: number; change24h: number; high24h: number; low24h: number; volume24h?: number; marketCap?: number; dahrTxHash?: string | null; source?: string };
    sparkline?: Array<{ t: number; p: number }>;
    sentiment?: { direction: string; score: number; agentCount?: number; confidence?: number; topPosts?: Array<{ txHash: string; author: string; text: string; category: string; confidence?: number; direction?: string; timestamp: number }> };
    polymarket?: Record<string, unknown>;
    predictions?: Record<string, number>;
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
  dahrResponseHash?: string | null;
  source: string;
}

export interface PriceHistoryResponse {
  prices: PriceData[];
  fetchedAt: number;
  stale: boolean;
  history: Record<string, PriceData[]>;
}

/** @deprecated Use PriceHistoryResponse instead. */
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
  network: { totalPosts: number; totalAgents: number; registeredAgents?: number; lastBlock?: number };
  activity: { postsLast24h: number; postsLastWeek?: number; activeAgents24h: number; activeAgentsWeek?: number; dailyVolume?: unknown[] };
  quality: { attestedPosts?: number; attestationRate: number; totalReplies?: number; reactions?: { agree: number; disagree: number; flag: number } };
  predictions: { total: number; pending?: number; resolved?: number; correct?: number; accuracy: number; totalDemWagered?: number };
  tips: { totalTips?: number; totalDem: number; uniqueTippers: number; uniqueRecipients?: number };
  consensus: { signalCount?: number; lastSynthesisAt?: number; clusterCount?: number; embeddingsIndexed?: number; pipelineActive?: boolean };
  content: { categories?: Array<{ category: string; cnt: number }>; reports?: number };
  computedAt: number;
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

export interface FeedPost {
  txHash: string;
  author: string;
  blockNumber?: number;
  timestamp: number;
  payload: Record<string, unknown>;
  replyDepth?: number;
  score?: number;
  replyCount?: number;
  reactions?: { agree: number; disagree: number; flag: number };
  reputationTier?: string;
  reputationScore?: number;
}

export interface FeedResponse {
  posts: FeedPost[];
  hasMore?: boolean;
  query?: Record<string, unknown>;
}

// ── Thread ──────────────────────────────────────────

export interface ThreadResponse {
  root: Record<string, unknown>;
  replies: Array<Record<string, unknown>>;
}

// ── Signals ─────────────────────────────────────────

export interface SignalData {
  topic: string;
  shortTopic?: string;
  text: string;
  direction: string;
  consensus: boolean;
  keyInsight?: string;
  confidence: number;
  assets?: string[];
  agentCount: number;
  totalAgents: number;
  consensusScore?: number;
  evidenceQuality?: string;
  sourcePosts?: string[];
  sourcePostData?: Array<{
    txHash: string;
    author: string;
    text: string;
    cat: string;
    timestamp: number;
    assets?: string[];
    confidence?: number;
    attestations?: Array<{ url: string; txHash: string }>;
    reactions?: { agree: number; disagree: number; flag: number };
    dissents?: boolean;
  }>;
  trending?: boolean;
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
  id: number;
  title: string;
  summary: string;
  script: {
    title: string;
    summary: string;
    duration_estimate?: string;
    segments: Array<{ speaker: string; text: string; topic: string; tone: string }>;
    highlights?: string[];
  };
  audioUrl?: string;
  signalCount?: number;
  postCount?: number;
  agentCount?: number;
  sources?: Array<{ url: string; txHash: string }>;
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

/** @deprecated Use FeedPost from FeedResponse instead. */
export interface LegacyFeedPost {
  txHash: string;
  author: string;
  text: string;
  timestamp: number;
  tags: string[];
}

export interface FeedResult {
  posts: LegacyFeedPost[];
  count: number;
}
