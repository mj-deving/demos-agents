/**
 * Core module — portable, framework-agnostic components.
 *
 * These modules have ZERO platform-specific (SuperColony/Demos) imports.
 * Import lint rules enforce this boundary — core/ must never import from
 * platform/ or agents/.
 *
 * Portable gems:
 * - Declarative provider engine (YAML spec → data fetcher)
 * - Source lifecycle state machine (health, transitions, ratings)
 * - LLM provider abstraction (provider-agnostic complete() interface)
 * - Extension hook dispatcher (typed lifecycle hooks)
 * - Session loop orchestrator (phase machine)
 * - Source catalog system (unified index, agent views)
 */

// Declarative provider engine
export { loadDeclarativeProviderAdapters, loadDeclarativeProviderAdaptersSync } from "./lib/sources/providers/declarative-engine.js";
export type { DeclarativeProviderSpec } from "./lib/sources/providers/declarative-engine.js";
export type { ProviderAdapter, FetchedResponse, SurgicalCandidate } from "./lib/sources/providers/types.js";

// Source lifecycle
export {
  evaluateTransition,
  updateRating,
  applyTransitions,
} from "./lib/sources/lifecycle.js";

// LLM provider abstraction
export { resolveProvider } from "./lib/llm-provider.js";
export type { LLMProvider } from "./lib/llm-provider.js";

// Extension hook dispatcher
export {
  loadExtensions,
  runBeforeSense,
  runBeforePublishDraft,
  runAfterPublishDraft,
  runAfterAct,
  runAfterConfirm,
} from "./lib/extensions.js";
export type { ExtensionHookRegistry } from "./lib/extensions.js";

// Source catalog
export {
  loadCatalog,
  loadAgentSourceView,
  tokenizeTopic,
  sourceTopicTokens,
} from "./lib/sources/catalog.js";
export type { SourceRecordV2, AgentSourceView, AgentName } from "./lib/sources/catalog.js";

// Source fetch & rate limiting
export { fetchSource } from "./lib/sources/fetch.js";
export { acquireRateLimitToken, recordRateLimitResponse, resetRateLimits } from "./lib/sources/rate-limit.js";

// Source health testing
export { testSource, filterSources } from "./lib/sources/health.js";

// Source matching
export { match } from "./lib/sources/matcher.js";
export type { MatchInput, MatchResult } from "./lib/sources/matcher.js";

// Observation logger
export { observe, initObserver, setObserverPhase } from "./lib/observe.js";
export type { ObservationType, Observation } from "./lib/observe.js";

// Session log
export { readSessionLog, appendSessionLog, writeSessionLog, rotateSessionLog, resolveLogPath } from "./lib/log.js";

// Subprocess runner
export { runTool, ToolError } from "./lib/subprocess.js";

// Agent config
export { loadAgentConfig, resolveAgentName } from "./lib/agent-config.js";
export type { AgentConfig } from "./lib/agent-config.js";

// Scoring formula
export {
  calculateExpectedScore,
  SCORE_BASE, SCORE_ATTESTATION, SCORE_CONFIDENCE, SCORE_LONG_TEXT,
  SCORE_ENGAGEMENT_T1, SCORE_ENGAGEMENT_T2, SCORE_MAX,
  ENGAGEMENT_T1_THRESHOLD, ENGAGEMENT_T2_THRESHOLD, LONG_TEXT_MIN_CHARS,
} from "./lib/scoring.js";

// Attestation policy (plan resolution, URL helpers)
export {
  resolveAttestationPlan,
  inferAssetAlias,
  extractTopicVars,
  fillUrlTemplate,
  unresolvedPlaceholders,
  isHighSensitivityTopic,
} from "./lib/attestation-policy.js";
export type { AttestationType, AttestationPlan } from "./lib/attestation-policy.js";

// Claim extraction (claim-driven attestation Phase 1)
export {
  extractStructuredClaims,
  extractStructuredClaimsWithLLM,
  extractStructuredClaimsAuto,
} from "./lib/claim-extraction.js";
export type { ExtractedClaim, ClaimType } from "./lib/claim-extraction.js";

// Attestation planner + verifier (claim-driven attestation Phases 3-4, portable)
export {
  buildAttestationPlan,
  resolveAttestationBudget,
  verifyAttestedValues,
  createUsageTracker,
  scoreSurgicalCandidate,
  recordSourceUsage,
} from "./lib/attestation-planner.js";
export type {
  AttestationBudget,
  AttestationPlan,
  VerificationResult,
  SourceUsageTracker,
} from "./lib/attestation-planner.js";

// Note: executeAttestationPlan is NOT exported here — it's platform-bound
// (src/actions/attestation-executor.ts). Import directly when needed.
