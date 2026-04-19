/**
 * Agent loop re-exports for supercolony-toolkit/agent subpath.
 *
 * Keeps the legacy runAgentLoop exports available while promoting the
 * upstream-style minimal observe() runtime as the default fresh-consumer path.
 */

export {
  getDefaultMinimalStateDir,
  runMinimalAgentCycle,
  runMinimalAgentLoop,
} from "./minimal-agent.js";
export { buildMinimalAttestationPlan } from "./minimal-attestation-plan.js";
export { buildMinimalAttestationPlanFromUrls } from "./minimal-attestation-plan.js";
export { deriveEngagementOpportunities } from "./engagement-opportunities.js";
export { buildEngagementDraft } from "./engagement-draft.js";
export { deriveMarketOpportunities } from "./market-opportunities.js";
export { buildMarketDraft } from "./market-draft.js";
export { deriveResearchOpportunities } from "./research-opportunities.js";
export { deriveResearchSourceProfile } from "./research-source-profile.js";
export {
  createTopicFamilyRegistry,
  defineTopicFamilyContract,
  getTopicFamilyContract,
} from "./topic-family-contract.js";
export { buildResearchColonySubstrate } from "./research-colony-substrate.js";
export { fetchResearchEvidenceSummary } from "./research-evidence.js";
export { buildResearchSelfHistory } from "./research-self-history.js";
export { buildResearchEvidenceDelta, summarizeResearchEvidenceDelta } from "./research-evidence-delta.js";
export {
  defineResearchTopicFamilyContract,
  getResearchTopicFamilyContract,
} from "./research-family-contracts.js";
export { buildResearchDraft } from "./research-draft.js";
export { toPreflightCandidates } from "./minimal-attestation-plan.js";
export { matchResearchDraftToPlan } from "./research-source-match.js";
export type {
  MinimalAgentState,
  MinimalAuditSection,
  MinimalAuditPayload,
  MinimalAgentMemory,
  MinimalCycleSummary,
  MinimalCycleContext,
  MinimalObserveContext,
  SkipDecision,
  PublishDecision,
  ReplyDecision,
  MinimalObserveResult,
  MinimalObserveFn,
  MinimalCycleStatus,
  MinimalErrorStage,
  MinimalVerificationOptions,
  RunMinimalAgentCycleOptions,
  RunMinimalAgentLoopOptions,
  MinimalCycleRecord,
} from "./minimal-agent.js";
export type {
  MinimalAttestationCandidate,
  MinimalAttestationPlan,
  BuildMinimalAttestationPlanOptions,
  BuildMinimalAttestationPlanFromUrlsOptions,
} from "./minimal-attestation-plan.js";
export type {
  EngagementPostInput,
  EngagementLeaderboardInput,
  DeriveEngagementOpportunitiesOptions,
  EngagementOpportunity,
} from "./engagement-opportunities.js";
export type {
  BuildEngagementDraftOptions,
  EngagementPromptPacket,
  EngagementDraftSuccess,
  EngagementDraftFailure,
  EngagementDraftResult,
} from "./engagement-draft.js";
export type {
  MarketSignalInput,
  MarketPostInput,
  MarketPriceInput,
  MarketOracleDivergenceInput,
  DeriveMarketOpportunitiesOptions,
  MarketOpportunity,
} from "./market-opportunities.js";
export type {
  BuildMarketDraftOptions,
  MarketPromptPacket,
  MarketDraftSuccess,
  MarketDraftFailure,
  MarketDraftResult,
} from "./market-draft.js";
export type {
  ResearchEvidenceSummary,
  FetchResearchEvidenceSummaryOptions,
  FetchResearchEvidenceSummaryResult,
} from "./research-evidence.js";
export type {
  ResearchPublishHistoryEntry,
  ResearchSelfHistoryPostSummary,
  ResearchSelfHistoryDelta,
  ResearchSelfHistorySummary,
  BuildResearchSelfHistoryOptions,
} from "./research-self-history.js";
export type {
  ResearchEvidenceDeltaEntry,
  ResearchEvidenceDeltaSummary,
} from "./research-evidence-delta.js";
export type {
  MatchResearchDraftToPlanOptions,
  MatchResearchDraftToPlanResult,
} from "./research-source-match.js";
export type {
  ResearchSignalInput,
  ResearchPostInput,
  ResearchSignalSourcePost,
  ResearchSignalCrossReference,
  ResearchSignalReactionSummary,
  ResearchSignalDivergence,
  DeriveResearchOpportunitiesOptions,
  ResearchOpportunity,
} from "./research-opportunities.js";
export type {
  ResearchColonySignalSummary,
  ResearchColonyTake,
  ResearchRecentContextPost,
  ResearchColonySubstrate,
  BuildResearchColonySubstrateOptions,
} from "./research-colony-substrate.js";
export type {
  ResearchTopicFamily,
  ResearchSourceProfile,
} from "./research-source-profile.js";
export type {
  TopicMetricSemantic,
  TopicClaimRequirement,
  TopicClaimBounds,
  TopicQualitySlipPattern,
  TopicFamilySourcePlan,
  TopicFamilyPromptDoctrine,
  TopicFamilyQualityContract,
  TopicFamilyContract,
  TopicFamilyRegistry,
} from "./topic-family-contract.js";
export type {
  SupportedResearchTopicFamily,
  ResearchTopicFamilyContract,
} from "./research-family-contracts.js";
export type {
  BuildResearchDraftOptions,
  ResearchPromptPacket,
  ResearchDraftSuccess,
  ResearchDraftFailure,
  ResearchDraftResult,
} from "./research-draft.js";
export { runAgentLoop, defaultObserve, buildColonyStateFromFeed } from "../../../src/toolkit/agent-loop.js";
export type { ObserveFn, ObserveResult, AgentLoopOptions } from "../../../src/toolkit/agent-loop.js";
