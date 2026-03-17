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
export { loadDeclarativeProviderAdapters, loadDeclarativeProviderAdaptersSync } from "../tools/lib/sources/providers/declarative-engine.js";
export type { DeclarativeProviderSpec } from "../tools/lib/sources/providers/declarative-engine.js";
export type { ProviderAdapter, FetchedResponse } from "../tools/lib/sources/providers/types.js";

// Source lifecycle
export {
  evaluateTransition,
  updateRating,
  applyTransitions,
} from "../tools/lib/sources/lifecycle.js";

// LLM provider abstraction
export { resolveProvider } from "../tools/lib/llm-provider.js";
export type { LLMProvider } from "../tools/lib/llm-provider.js";

// Extension hook dispatcher
export {
  registerHook,
  runBeforeSense,
  runBeforePublishDraft,
  runAfterPublishDraft,
  runAfterAct,
  runAfterConfirm,
} from "../tools/lib/extensions.js";

// Source catalog
export {
  loadCatalog,
  loadAgentSourceView,
  tokenizeTopic,
  sourceTopicTokens,
} from "../tools/lib/sources/catalog.js";
export type { SourceRecordV2, AgentSourceView, AgentName } from "../tools/lib/sources/catalog.js";

// Source fetch & rate limiting
export { fetchSource } from "../tools/lib/sources/fetch.js";
export { acquireRateLimitToken, recordRateLimitResponse, resetRateLimits } from "../tools/lib/sources/rate-limit.js";

// Source health testing
export { testSource, filterSources } from "../tools/lib/sources/health.js";

// Source matching
export { match } from "../tools/lib/sources/matcher.js";
export type { MatchInput, MatchResult } from "../tools/lib/sources/matcher.js";

// Observation logger
export { observe, initObserver, setObserverPhase } from "../tools/lib/observe.js";
export type { ObservationType, Observation } from "../tools/lib/observe.js";

// Session log
export { readSessionLog, appendSessionLog, writeSessionLog, rotateSessionLog, resolveLogPath } from "../tools/lib/log.js";

// Subprocess runner
export { runTool, ToolError } from "../tools/lib/subprocess.js";

// Agent config
export { loadAgentConfig, resolveAgentName } from "../tools/lib/agent-config.js";
export type { AgentConfig } from "../tools/lib/agent-config.js";

// Scoring formula
export {
  calculateExpectedScore,
  SCORE_BASE, SCORE_ATTESTATION, SCORE_CONFIDENCE, SCORE_LONG_TEXT,
  SCORE_ENGAGEMENT_T1, SCORE_ENGAGEMENT_T2, SCORE_MAX,
  ENGAGEMENT_T1_THRESHOLD, ENGAGEMENT_T2_THRESHOLD, LONG_TEXT_MIN_CHARS,
} from "../tools/lib/scoring.js";

// Attestation policy (plan resolution, URL helpers)
export {
  resolveAttestationPlan,
  inferAssetAlias,
  extractTopicVars,
  fillUrlTemplate,
  unresolvedPlaceholders,
  isHighSensitivityTopic,
} from "../tools/lib/attestation-policy.js";
export type { AttestationType, AttestationPlan } from "../tools/lib/attestation-policy.js";
