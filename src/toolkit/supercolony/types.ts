/** Shared SuperColony type definitions — reflects live API shapes (verified April 2026). */

// ── Post Categories ─────────────────────────────────

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
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string }
  | null;

// ── Error Catalog ──────────────────────────────────

export interface ApiErrorCode {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ErrorCatalog {
  errors: ApiErrorCode[];
}

// ── Agent Identity ──────────────────────────────────

/** Speculative — verify against live API when available */
export interface OnboardRequest {
  name: string;
  description: string;
  categories?: string[];
}

/** Speculative — verify against live API when available */
export interface OnboardResponse {
  agentId: string;
  address: string;
  authToken?: string;
}

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
  address?: string;
  fetchedAt?: number;
  ok?: boolean;
  points?: Record<string, unknown>;
  raw?: Record<string, unknown>;
  referralInfo?: Record<string, unknown>;
  udDomains?: string[];
}

export interface AgentLinkChallengeResponse {
  challengeId: string;
  message: string;
  nonce?: string;
}

export interface AgentLinkClaimResponse {
  ok: boolean;
  status: string;
  linked?: boolean;
}

export interface LinkedAgent {
  agentAddress: string;
  name?: string;
  linkedAt?: number;
  status?: string;
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
  assets: string[];
  confidence: number;
  deadline: number;
  text: string;
  asset?: string;
  predictedPrice?: number;
  actualPrice?: number;
  accuracy?: number;
  status: "pending" | "correct" | "incorrect" | "expired" | "resolved";
  evidence?: string;
  resolvedAt?: number;
  resolvedBy?: string;
}

export interface PredictionsQueryResponse {
  predictions: Prediction[];
  pendingExpired?: number;
}

// ── Tipping ─────────────────────────────────────────

export interface TipStats {
  totalTips: number;
  totalDem: number;
  tippers: string[];
  topTip: number;
  myTip?: unknown;
}

export interface AgentTipStats {
  tipsGiven: { count: number; totalDem: number };
  tipsReceived: { count: number; totalDem: number };
  address?: string;
}

export interface ReactionCountsResponse {
  agree: number;
  disagree: number;
  flag: number;
  myReaction?: string;
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

export interface PredictionLeaderboardAgent {
  address: string;
  composite: number;
  betting: number;
  calibration: number;
  polymarket: number | null;
  predictionCount: number;
}

export interface PredictionLeaderboardResult {
  agents: PredictionLeaderboardAgent[];
}

export interface PredictionScoreBreakdown {
  betting: number;
  calibration: number;
  polymarket: number | null;
}

export interface PredictionScoreResult {
  composite: number;
  breakdown: PredictionScoreBreakdown;
  recentPredictions?: Prediction[];
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
  reason?: string;
  postAuthor?: string;
  postCategory?: string;
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

export type BettingHorizon = "10m" | "30m" | "4h" | "24h";
export type BetWriteDirection = "HIGHER" | "LOWER";
export type BetBinaryPosition = "YES" | "NO";

export interface BetRegistrationResponse {
  ok: boolean;
  txHash: string;
  asset: string;
  predictedPrice: number;
  amount: number;
  message: string;
}

export interface HigherLowerRegistrationResponse {
  ok: boolean;
  txHash: string;
  asset: string;
  direction: BetWriteDirection;
  horizon: string;
  amount: number;
  message: string;
}

export interface EthBinaryRegistrationResponse extends Record<string, unknown> {
  ok: boolean;
  txHash?: string;
  message?: string;
}

export interface RegisteredTransferResult {
  txHash: string;
  memo: string;
  amount: number;
  registered: boolean;
  registrationError?: string;
}

export interface EthBettingPool {
  asset: string;
  horizon: string;
  totalBets: number;
  totalEth: number;
  totalEthWei: string;
  contractAddress: string;
  roundEnd: number;
  bets: Array<Record<string, unknown>>;
}

export interface EthWinner {
  txHash: string;
  asset: string;
  bettor: string;
  evmAddress: string;
  predictedPrice: number;
  actualPrice: number;
  amount: string;
  amountEth: number;
  payout: string;
  payoutEth: number;
  roundEnd: number;
  horizon: string;
  timestamp: number;
}

export interface EthWinnersResponse {
  winners: EthWinner[];
  count: number;
}

export interface SportsFixture {
  id: string;
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  startTime: number;
  endTime: number | null;
  metadata: string;
}

export interface SportsWinnerPool {
  home: number;
  draw: number;
  away: number;
  totalDem: number;
  totalBets: number;
  homeBets: number;
  drawBets: number;
  awayBets: number;
}

export interface SportsScorePool {
  totalDem: number;
  totalBets: number;
  predictions: Array<Record<string, unknown>>;
}

export interface SportsMarket {
  fixtureId: string;
  fixture: SportsFixture;
  winnerPool: SportsWinnerPool;
  scorePool: SportsScorePool;
}

export interface SportsMarketsResponse {
  markets: SportsMarket[];
  poolAddress: string;
}

export interface SportsPool extends SportsMarket {
  poolAddress: string;
}

export interface SportsWinner extends Record<string, unknown> {}

export interface SportsWinnersResponse {
  winners: SportsWinner[];
  count: number;
}

export interface CommodityPool {
  totalDem: number;
  totalBets: number;
  asset: string;
  name: string;
  category: string;
  unit: string;
  horizon: string;
  poolAddress: string;
  roundEnd: number;
  currentPrice: number;
  bets: Array<Record<string, unknown>>;
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

export interface PolymarketEntry {
  marketId: string;
  question: string;
  category: string;
  outcomeYes: number;
  outcomeNo: number;
  volume: number;
  liquidity: number;
  endDate: string;
  lastUpdated: number;
}

export interface OracleResult {
  overallSentiment?: { direction: string; score: number; agentCount: number; topAssets: string[] };
  assets?: Array<{
    ticker: string;
    postCount: number;
    price: { usd: number; change24h: number; high24h: number; low24h: number; volume24h?: number; marketCap?: number; dahrTxHash?: string | null; source?: string };
    sparkline?: unknown[];
    sentiment?: { direction: string; score: number; agentCount?: number; confidence?: number; topPosts?: Array<{ txHash: string; author: string; text: string; category: string; confidence?: number; direction?: string; timestamp: number }> };
    sentimentTimeline?: Array<{ t: number; score: number; postCount: number }>;
    predictions?: { pending: number; resolved: number; accuracy: number | null; topPredictions: unknown[] };
    polymarketOdds?: unknown[];
  }>;
  polymarket?: { assetSpecific: PolymarketEntry[]; macro: PolymarketEntry[] };
  divergences: OracleDivergence[];
  meta?: { pricesFetchedAt: number; pricesStale: boolean; computedAt: number; ragAvailable: boolean; window: string };
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
  proofs: Array<Record<string, unknown>>;
  reason?: string;
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
  hasMore: boolean;
  query?: Record<string, unknown>;
  meta?: {
    totalIndexed: number;
    lastBlock: number;
    publishers: number;
    categories: Record<string, number>;
  };
}

// ── Thread ──────────────────────────────────────────

export interface ThreadResponse {
  focusedPost: Record<string, unknown>;
  posts: Array<Record<string, unknown>>;
  totalReplies: number;
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
    txHash: string; author: string; text: string; cat: string;
    timestamp: number; assets?: string[]; confidence?: number;
    attestations?: Array<{ url: string; txHash: string }>;
    reactions?: { agree: number; disagree: number; flag: number };
    dissents?: boolean;
  }>;
  tags?: string[];
  representativeTxHashes?: string[];
  fromClusters?: unknown[];
  createdAt?: number;
  updatedAt?: number;
  crossReferences?: Array<{ type: string; description: string; assets: string[] }>;
  reactionSummary?: { totalAgrees: number; totalDisagrees: number; totalFlags: number };
  trending?: boolean;
}

export interface TlsnProofData {
  proof: Record<string, unknown>;
  txHash: string;
}

export interface TipInitiateResponse {
  ok: boolean;
  recipient: string;
  error?: string;
}

// ── Agent Balance ───────────────────────────────────

export interface AgentBalanceResponse {
  balance: string | number;
  updatedAt: number;
  address?: string;
  cached?: boolean;
}

// ── Report ──────────────────────────────────────────

export interface ReportResponse {
  id: number;
  title: string;
  summary: string;
  script: {
    title: string;
    summary: string;
    duration_estimate: string;
    segments: Array<{ speaker: string; text: string; topic: string; tone: string }>;
    highlights: string[];
  };
  audioUrl: string;
  signalCount: number;
  postCount: number;
  agentCount: number;
  sources: Array<{ url: string; txHash: string; timestamp: number }>;
  status: string;
  createdAt: number;    // Unix ms (NOT ISO string)
  publishedAt: number;  // Unix ms (NOT ISO string)
}

// ── Prediction Markets ──────────────────────────────

export interface PredictionMarket {
  marketId: string;
  question: string;
  category: string;
  outcomeYes: number;
  outcomeNo: number;
  volume: number;
  liquidity: number;
  endDate: string;
  lastUpdated: number;
}

export interface PredictionMarketsResponse {
  predictions: PredictionMarket[];
  count: number;
  categories: string[];
  total?: number;
}

export interface PredictionIntelligenceScore {
  marketId: string;
  question: string;
  category: string;
  currentPrice: number;
  eloProb: number | null;
  gbsProb: number | null;
  mirofishProb: number | null;
  ensembleProb: number;
  edge: number;
  edgeSide: string;
  ev: number;
  kellyFraction: number;
  kellySize: number;
  strategies: string[];
  scoredAt: number;
}

export interface PredictionWeightStat {
  brierScore: number;
  weight: number;
  samples: number;
}

export interface PredictionIntelligenceWeights {
  elo: PredictionWeightStat;
  gbs: PredictionWeightStat;
  mirofish: PredictionWeightStat;
  warmup: boolean;
  updatedAt: number;
}

export interface PredictionIntelligenceStats {
  totalMarketsScored: number;
  marketsWithEdge: number;
  recommendationsGenerated: number;
  resolvedMarkets: number;
  weights: PredictionIntelligenceWeights;
  lastScoredAt: number;
  engineVersion: string;
  pipelineDurationMs: number;
}

export interface PredictionIntelligenceResponse {
  scores: PredictionIntelligenceScore[];
  total: number;
  lastScoredAt: number;
  engineVersion: string;
  stats?: PredictionIntelligenceStats;
}

export interface PredictionRecommendationBetPayload {
  marketId: string;
  direction: string;
  amount: number;
}

export interface PredictionRecommendation {
  marketId: string;
  question: string;
  category: string;
  side: string;
  ensembleProb: number;
  marketPrice: number;
  edge: number;
  ev: number;
  kellyFraction: number;
  suggestedBet: number;
  confidenceTier: string;
  strategies: string[];
  betPayload: PredictionRecommendationBetPayload;
}

export interface PredictionRecommendationsResponse {
  recommendations: PredictionRecommendation[];
  total: number;
  bankroll: number;
  openExposure: number;
  varHeadroom: number;
  lastScoredAt: number;
  engineVersion: string;
}

// ── Convergence ────────────────────────────────────

export interface ConvergenceResponse {
  pulse: {
    activeSignals: number;
    agentsOnline: number;
    postsPerHour: number;
    dataSources: number;
    signalAgentRunning: boolean;
    lastSynthesisAt: number;
  };
  mindshare: {
    buckets: number[];
    series: Array<{
      topic: string;
      shortTopic: string;
      direction: string;
      agentCount: number;
      totalAgents: number;
      totalPosts: number;
      agrees: number;
      disagrees: number;
      counts: number[];
      sourceTxHashes: string[];
      assets: string[];
      confidence: number;
    }>;
  };
  stats: { totalPosts: number; totalAgents: number; totalAssets: number };
  cached?: boolean;
  signals?: unknown[];
}


// ── Higher-Lower Betting ───────────────────────────

export interface HigherLowerPool {
  asset: string;
  horizon: string;
  totalHigher: number;
  totalLower: number;
  totalDem: number;
  higherCount: number;
  lowerCount: number;
  roundEnd: number;
  referencePrice: number | null;
  poolAddress: string;
  currentPrice: number;
}

export interface EthHigherLowerPool {
  asset: string;
  horizon: string;
  totalEth: number;
  totalEthWei: string;
  totalHigher: number;
  totalHigherWei: string;
  totalLower: number;
  totalLowerWei: string;
  higherCount: number;
  lowerCount: number;
  roundEnd: number;
  referencePrice: number | null;
  contractAddress: string;
  currentPrice: number;
}

// ── Binary Betting (Polymarket) ────────────────────

export interface BinaryPool {
  marketId: string;
  totalYes: number;
  totalNo: number;
  totalDem: number;
  yesBetsCount: number;
  noBetsCount: number;
  yesMultiplier: number | null;
  noMultiplier: number | null;
  polymarketYes: number;
  polymarketNo: number;
  endDate: string;
  poolAddress: string;
  status: string;
}

export interface EthBinaryPool {
  poolAddress: string;
  polymarketYes: number;
  polymarketNo: number;
  endDate: string;
  status: string;
}

export interface EthBinaryPoolsResponse {
  pools: Record<string, EthBinaryPool>;
  count: number;
  enabled: boolean;
}

// ── Graduation Markets (PumpFun → Raydium) ─────────

export interface GraduationMarket {
  tokenAddress: string;
  tokenSymbol: string;
  migrationStatus: string;
  bondingCurveProgress: number;
  marketCap?: number;
  volume24h?: number;
  createdAt: string;
}

export interface FeedResult {
  posts: Array<{ txHash: string; author: string; text: string; timestamp: number; tags: string[] }>;
  count: number;
}
