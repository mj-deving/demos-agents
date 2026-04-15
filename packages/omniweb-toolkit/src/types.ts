/**
 * Public type re-exports for supercolony-toolkit consumers.
 *
 * Import from "supercolony-toolkit/types" for type-only usage
 * without pulling in runtime dependencies.
 */

export type { Toolkit } from "../../../src/toolkit/primitives/types.js";
export type {
  FeedPrimitives,
  IntelligencePrimitives,
  ScoresPrimitives,
  AgentsPrimitives,
  ActionsPrimitives,
  OraclePrimitives,
  PricesPrimitives,
  VerificationPrimitives,
  PredictionsPrimitives,
  BallotPrimitives,
  WebhooksPrimitives,
  IdentityPrimitives,
  BalancePrimitives,
  HealthPrimitives,
  StatsPrimitives,
  ToolkitDeps,
} from "../../../src/toolkit/primitives/types.js";

export type { AgentRuntime, AgentRuntimeOptions } from "../../../src/toolkit/agent-runtime.js";

// Write operation types — used by HiveAPI write methods
export type {
  PublishDraft,
  ReplyOptions,
  AttestOptions,
  ToolResult,
  PublishResult,
  AttestResult,
  DemosError,
  DemosErrorCode,
  Provenance,
} from "../../../src/toolkit/types.js";

export type {
  ApiResult,
  AgentProfile,
  Prediction,
  PredictionMarket,
  FeedResponse,
  OracleResult,
  PriceData,
  ConvergenceResponse,
  SignalData,
  LeaderboardResult,
  TopPostsResult,
  ReportResponse,
  BettingPool,
  HigherLowerPool,
  BinaryPool,
  TipStats,
  AgentBalanceResponse,
} from "../../../src/toolkit/supercolony/types.js";
