export type ActionType = "ENGAGE" | "REPLY" | "PUBLISH" | "TIP" | "VOTE" | "BET";

export type TargetType = "post" | "agent";

export interface StrategyAction {
  type: ActionType;
  priority: number;
  target?: string;
  /** Discriminates target semantics: "post" = txHash, "agent" = wallet address. */
  targetType?: TargetType;
  evidence?: string[];
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface StrategyRule {
  name: string;
  type: ActionType;
  priority: number;
  conditions: string[];
  enabled: boolean;
}

export interface StrategyConfig {
  rules: StrategyRule[];
  rateLimits: {
    postsPerDay: number;
    postsPerHour: number;
    reactionsPerSession: number;
    maxTipAmount: number;
    /** Phase 8: Max VOTE/BET actions per day (default: 3). */
    betsPerDay?: number;
  };
  performance: {
    engagement: number;
    discussion: number;
    replyBase: number;
    replyDeep: number;
    threadDepth: number;
    economic: number;
    tipBase: number;
    tipCap: number;
    tipMultiplier: number;
    controversy: number;
    ageHalfLife: number;
  };
  // TODO(phase-3b): Wire topicWeights into publish/engage priority scoring
  topicWeights: Record<string, number>;
  /** Phase 6: Enrichment thresholds — all optional with defaults */
  enrichment: {
    /** Minimum agents on a signal for publish_signal_aligned (default: 2) */
    minSignalAgents: number;
    /** Minimum confidence for consensus participation (default: 40) */
    minConfidence: number;
  };
  /** Phase 17b: Evidence categories from ADR-0020 — optional, for compiler-generated templates. */
  evidence?: {
    categories?: {
      core?: string[];
      domain?: string[];
      meta?: string[];
    };
  };
  /** Phase C: V3 loop operational limits — all optional with defaults matching current hardcoded values. */
  limits?: LoopLimitsConfig;
  /** Phase 7: Priority boost for topics mentioned in colony briefing (default: 10). */
  briefingBoost?: number;
  /** Phase 7: Leaderboard-based priority adjustment (optional). */
  leaderboardAdjustment?: LeaderboardAdjustmentConfig;
}

/** Phase 7: Dynamic priority adjustment based on leaderboard rank. */
export interface LeaderboardAdjustmentConfig {
  enabled: boolean;
  /** Priority boost for ENGAGE/TIP when in top quartile (default: 15) */
  topBoostEngagement: number;
  /** Priority adjustment for PUBLISH when in top quartile (default: -5) */
  topAdjustPublish: number;
  /** Priority boost for PUBLISH when in bottom quartile (default: 15) */
  bottomBoostPublish: number;
  /** Priority adjustment for ENGAGE/TIP when in bottom quartile (default: -5) */
  bottomAdjustEngagement: number;
}

/** API enrichment data — optional, populated from SuperColony API during sense phase. */
export interface ApiEnrichmentData {
  agentCount?: number;
  leaderboard?: import("../supercolony/types.js").LeaderboardResult;
  oracle?: import("../supercolony/types.js").OracleResult;
  prices?: import("../supercolony/types.js").PriceData[];
  /** @deprecated Ballot endpoints return 410. Use bettingPool instead. */
  ballotAccuracy?: import("../supercolony/types.js").BallotAccuracy;
  /** Active betting pools discovered from tracked oracle assets. */
  bettingPools?: import("../supercolony/types.js").BettingPool[];
  /** @deprecated Use bettingPools. Retained as the first bettingPools entry for backward compatibility. */
  bettingPool?: import("../supercolony/types.js").BettingPool;
  signals?: import("../supercolony/types.js").SignalData[];
  /** Polymarket prediction odds from oracle response */
  polymarket?: Record<string, unknown>;
  /** Per-asset sentiment from oracle (colony consensus per ticker) */
  assetSentiments?: Array<{ ticker: string; direction: string; score: number; posts: number }>;
  /** DAHR-attested price tx hashes (proof chain for price data) */
  priceAttestations?: Array<{ ticker: string; dahrTxHash: string }>;
}

export interface DecisionContext {
  ourAddress: string;
  sessionReactionsUsed: number;
  /** Actual number of posts by this agent today. Required for accurate rate limiting. */
  postsToday: number;
  /** Actual number of posts by this agent in the current hour. Required for accurate rate limiting. */
  postsThisHour: number;
  now?: Date;
  /** API enrichment — consumed by enrichment-aware rules (Phase 6a). */
  apiEnrichment?: ApiEnrichmentData;
  /** Pre-computed intelligence from colony DB (Phase 6b). */
  intelligence?: {
    /** Addresses we've interacted with recently (all types), mapped to interaction count */
    recentInteractions?: Record<string, number>;
    /** Addresses we've tipped recently, mapped to tip count (subset of recentInteractions) */
    recentTips?: Record<string, number>;
    /** Agent profiles keyed by address */
    agentProfiles?: Record<string, {
      postCount: number;
      avgAgrees: number;
      avgDisagrees: number;
      topics: string[];
      /** Phase 7: Social handles from /api/identity enrichment. */
      socialHandles?: Array<{ platform: string; username: string }>;
    }>;
    /** Phase 8b: Contradictions found in claim ledger. */
    contradictions?: ContradictionEntry[];
    /** Phase 8c: Count of chain-verified posts per author. */
    verifiedPostCounts?: Record<string, number>;
    /** Phase 8d: Most recent claim timestamp per subject. */
    claimFreshness?: Record<string, string>;
    /** Phase 8d: Evidence quality score per sourceId (richness * freshness). */
    evidenceQuality?: Record<string, number>;
    /** Phase 8d: Colony-wide health metrics. */
    colonyHealth?: {
      postsLast24h: number;
      activeAgents: number;
      verifiedPostRatio: number;
      avgClaimsPerPost: number;
    };
  };
  /** Rolling calibration state (Phase 6d). */
  calibration?: CalibrationState;
  /** Phase 7: Colony briefing from /api/report — informs topic prioritization. */
  briefingContext?: string;
  /** Max publish actions to generate — prevents wasteful candidate generation beyond session cap. */
  maxPublishPerSession?: number;
}

/** Phase 8b: A detected contradiction in the claim ledger. */
export interface ContradictionEntry {
  subject: string;
  metric: string;
  claims: Array<{
    author: string;
    value: number | null;
    unit: string;
    postTxHash: string;
    claimedAt: string;
    verified: boolean;
  }>;
  /** The post to reply to (newest contradictory post by a different author). */
  targetPostTxHash: string;
  /** Which value our evidence supports (null if no evidence). */
  supportedValue: number | null;
}

/** Phase 8c: Attestation verification gate for engagement decisions. */
export type VerificationGate = "verified" | "unresolved" | "failed" | "no_attestation";

export interface DecisionLog {
  timestamp: string;
  considered: Array<{ action: StrategyAction; rule: string }>;
  selected: StrategyAction[];
  rejected: Array<{ action: StrategyAction; rule: string; reason: string }>;
  rateLimitState: {
    dailyRemaining: number;
    hourlyRemaining: number;
    reactionsRemaining: number;
  };
}

/** Rolling calibration state — replaces static calibrationOffset JSON file. */
export interface CalibrationState {
  /** Average raw score of our posts */
  ourAvgScore: number;
  /** Median raw score across colony */
  colonyMedianScore: number;
  /** Calibration offset (our - colony). Positive = outperforming. */
  offset: number;
  /** Number of our posts used for computation */
  postCount: number;
  /** ISO timestamp of computation */
  computedAt: string;
}

export interface PostPerformance {
  txHash: string;
  timestamp: string;
  rawScore: number;
  decayedScore: number;
  breakdown: {
    engagement: number;
    discussion: number;
    economic: number;
    controversy: number;
  };
}

/** Phase C: Operational limits for the V3 loop — all configurable via agent YAML. */
export interface LoopLimitsConfig {
  /** Max recent posts to fetch per loop iteration (default: 500) */
  recentPostsFetchLimit: number;
  /** Concurrent proof ingestion workers (default: 5) */
  proofIngestionConcurrency: number;
  /** Max proofs to ingest per iteration (default: 20) */
  proofIngestionLimit: number;
  /** Max sources per intent (default: 5) */
  sourcesPerIntent: number;
  /** Concurrent source fetch workers (default: 3) */
  sourceFetchConcurrency: number;
  /** Wall-clock budget for source fetches in ms (default: 15000) */
  sourceFetchBudgetMs: number;
  /** SSE feed timeout in ms (default: 5000) */
  sseTimeoutMs: number;
  /** SSE max events per iteration (default: 100) */
  sseMaxEvents: number;
  /** Leaderboard fetch limit (default: 20) */
  leaderboardLimit: number;
  /** Oracle time window — "6h", "24h" (default), "7d" */
  oracleWindow?: string;
  /** Subprocess timeout in ms (default: 180000) */
  subprocessTimeoutMs: number;
  /** Max publish drafts per session — LLM drafting is ~60-90s each (default: 2) */
  maxPublishPerSession: number;
  /** Per-phase time budgets in ms */
  phaseBudgets: {
    senseMs: number;
    actMs: number;
    confirmMs: number;
  };
}
