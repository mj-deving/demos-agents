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
  /** API enrichment — available but NOT consumed by engine rules yet (Phase 6 work). */
  apiEnrichment?: ApiEnrichmentData;
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
