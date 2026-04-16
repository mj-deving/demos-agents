/**
 * omniweb-toolkit — main entry point.
 *
 * Usage:
 *   import { connect } from "omniweb-toolkit";
 *   const omni = await connect();
 *
 *   // SuperColony social layer
 *   const feed = await omni.colony.getFeed({ limit: 10 });
 *
 *   // Demos identity
 *   await omni.identity.link("twitter", tweetUrl);
 *
 *   // Escrow (tip by social handle)
 *   await omni.escrow.sendToIdentity("twitter", "alice", 5);
 *
 *   // On-chain storage
 *   const data = await omni.storage.read(addr);
 *
 *   // Chain core
 *   await omni.chain.transfer(to, amount);
 */

export { connect } from "./connect.js";
export {
  buildBetMemo,
  buildHigherLowerMemo,
  buildBinaryBetMemo,
  VALID_BET_HORIZONS,
} from "../../../src/toolkit/supercolony/bet-memos.js";
export type { OmniWeb, Colony, ConnectOptions } from "./colony.js";
export type { HiveAPI } from "./hive.js";
export type { IdentityAPI } from "./identity-api.js";
export type { EscrowAPI } from "./escrow-api.js";
export type { StorageAPI } from "./storage-api.js";
export type { IPFSAPI } from "./ipfs-api.js";
export type { ChainAPI } from "./chain-api.js";
export type { Toolkit } from "../../../src/toolkit/primitives/types.js";
export type {
  PublishDraft,
  ReplyOptions,
  AttestOptions,
  ToolResult,
  PublishResult,
  AttestResult,
} from "../../../src/toolkit/types.js";
export type {
  Prediction,
  PredictionLeaderboardAgent,
  PredictionLeaderboardResult,
  PredictionMarket,
  PredictionScoreBreakdown,
  PredictionScoreResult,
  PredictionIntelligenceScore,
  PredictionWeightStat,
  PredictionIntelligenceWeights,
  PredictionIntelligenceStats,
  PredictionIntelligenceResponse,
  PredictionRecommendationBetPayload,
  PredictionRecommendation,
  PredictionRecommendationsResponse,
  ConvergenceResponse,
  TopPostsResult,
  ReportResponse,
  AgentLinkChallengeResponse,
  AgentLinkClaimResponse,
  LinkedAgent,
  HigherLowerPool,
  BinaryPool,
  EthBettingPool,
  EthWinner,
  EthWinnersResponse,
  EthHigherLowerPool,
  EthBinaryPool,
  EthBinaryPoolsResponse,
  SportsFixture,
  SportsWinnerPool,
  SportsScorePool,
  SportsMarket,
  SportsMarketsResponse,
  SportsPool,
  SportsWinner,
  SportsWinnersResponse,
  CommodityPool,
  BettingHorizon,
  BetWriteDirection,
  BetBinaryPosition,
  BetRegistrationResponse,
  HigherLowerRegistrationResponse,
  EthBinaryRegistrationResponse,
  RegisteredTransferResult,
} from "../../../src/toolkit/supercolony/types.js";
