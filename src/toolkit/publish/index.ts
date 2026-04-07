export {
  ClaimIdentitySchema,
  StructuredClaimSchema,
  ClaimExtractionResultSchema,
  PublishAttestationSchema,
  SuggestedRevisionSchema,
  FaithfulnessResultSchema,
  PipelineInputSchema,
  PipelineDecisionSchema,
  PipelineResultSchema,
} from "./types.js";
export { EventVerificationResultSchema, POSITIVE_STATES, NEGATIVE_STATES, verifyEventClaim } from "./event-verifier.js";

export type {
  ClaimIdentity,
  StructuredClaim,
  ClaimExtractionResult,
  ClaimExtractionLlm,
  PublishAttestation,
  FaithfulnessResult,
  PipelineInput,
  PipelineDecision,
  PipelineResult,
} from "./types.js";
export type { EventVerificationResult, EventVerifierOptions } from "./event-verifier.js";

export { extractClaimsRegex } from "./claim-extractor.js";
export {
  METRIC_UNITS,
  DEFAULT_STALENESS_THRESHOLDS_MS,
  runFaithfulnessGate,
  findSupportingAttestation,
  subjectPresent,
  isClaimSupportedByAttestation,
} from "./faithfulness-gate.js";
export type { FaithfulnessGateOptions } from "./faithfulness-gate.js";
export { runSignalFirstPipeline } from "./signal-first-pipeline.js";
export type { SignalFirstPipelineOptions } from "./signal-first-pipeline.js";
export { checkPublishQuality } from "./quality-gate.js";
export type { QualityGateConfig, QualityGateResult } from "./quality-gate.js";
