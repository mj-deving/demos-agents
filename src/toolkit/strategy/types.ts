export type ActionType = "ENGAGE" | "REPLY" | "PUBLISH" | "TIP";

export interface StrategyAction {
  type: ActionType;
  priority: number;
  target?: string;
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
    /** Oracle divergence threshold percentage to trigger publish_on_divergence (default: 10) */
    divergenceThreshold: number;
    /** Minimum ballot accuracy to enable publish_prediction (default: 0.5) */
    minBallotAccuracy: number;
    /** Minimum agents on a signal for publish_signal_aligned (default: 2) */
    minSignalAgents: number;
    /** Minimum confidence for consensus participation (default: 40) */
    minConfidence: number;
  };
}

/** API enrichment data — optional, populated from SuperColony API during sense phase. */
export interface ApiEnrichmentData {
  agentCount?: number;
  leaderboard?: import("../supercolony/types.js").LeaderboardResult;
  oracle?: import("../supercolony/types.js").OracleResult;
  prices?: import("../supercolony/types.js").PriceData[];
  ballotAccuracy?: import("../supercolony/types.js").BallotAccuracy;
  signals?: import("../supercolony/types.js").SignalData[];
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
    /** Addresses we've interacted with recently, mapped to interaction count */
    recentInteractions?: Record<string, number>;
    /** Agent profiles keyed by address */
    agentProfiles?: Record<string, { postCount: number; avgAgrees: number; avgDisagrees: number; topics: string[] }>;
  };
  /** Rolling calibration state (Phase 6d). */
  calibration?: CalibrationState;
}

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
