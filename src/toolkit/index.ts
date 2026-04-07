/**
 * Demos Toolkit — framework-agnostic tools for the Demos Network.
 *
 * Public API surface:
 * - connect/disconnect: session lifecycle
 * - publish, reply, react, tip: SuperColony posting
 * - scan: feed analysis
 * - verify: on-chain confirmation
 * - attest: DAHR attestation
 * - discoverSources: source catalog browsing
 * - pay: D402 HTTP micropayments
 *
 * All tools accept a DemosSession handle and return typed ToolResult<T>.
 */

// ── Core Types ──────────────────────────────────────

export type {
  DemosError,
  DemosErrorCode,
  ToolResult,
  Provenance,
  ProvenancePath,
  StateStore,
  Unlock,
  ConnectOptions,
  TipPolicy,
  PayPolicy,
  ToolCallEvent,
  // Tool-specific types
  PublishDraft,
  ReplyOptions,
  ReactOptions,
  ReactionType,
  TipOptions,
  ScanOptions,
  VerifyOptions,
  AttestOptions,
  DiscoverSourcesOptions,
  PayOptions,
  // Result types
  PublishResult,
  ReactResult,
  ReactionCounts,
  TipResult,
  ScanResult,
  ScanPost,
  ScanOpportunity,
  VerifyResult,
  AttestResult,
  DiscoverSourcesResult,
  // Chain analytics types
  HiveReaction,
  Source,
  SourceStatus,
  PayResult,
} from "./types.js";
export type { LLMProvider } from "../lib/llm/llm-provider.js";

export { ok, err, demosError, isDemosError } from "./types.js";

// ── Session ─────────────────────────────────────────

export { DemosSession } from "./session.js";

// ── State Store ─────────────────────────────────────

export { FileStateStore } from "./state-store.js";

// ── Sources and Providers ──────────────────────────

export type {
  SourceRecordV2,
  SourceRecordV1,
  SourceCatalogFileV2,
  SourceIndex,
  AgentName,
  AgentSourceConfig,
  AgentSourceView,
  SourceRegistryMode,
} from "./sources/catalog.js";

export type { FetchSourceOptions, FetchSourceResult } from "./sources/fetch.js";
export type {
  SourceTestStatus,
  SourceTestResult,
  FilterOptions,
} from "./sources/health.js";

export { ALL_AGENT_NAMES } from "./sources/catalog.js";
export {
  loadCatalog,
  loadYamlRegistry,
  loadAgentSourceView,
  buildSourceIndex,
  normalizeSourceRecord,
  tokenizeTopic,
  sourceTopicTokens,
  normalizeUrlPattern,
  inferProvider,
  generateSourceId,
  isValidSourceRecord,
} from "./sources/catalog.js";
export { fetchSource } from "./sources/fetch.js";
export {
  DEFAULT_TEST_VARS,
  resolveTestUrl,
  filterSources,
  testSource,
} from "./sources/health.js";
export {
  acquireRateLimitToken,
  recordRateLimitResponse,
  isRateLimited,
  resetRateLimits,
} from "./sources/rate-limit.js";

// Phase 12a: source matching, policy, lifecycle — moved from src/lib/sources/
export type { MatchInput, MatchResult } from "./sources/matcher.js";
export { match, extractClaims, scoreMatch } from "./sources/matcher.js";
export type { PreflightCandidate, PreflightResult, SourceSelectionResult } from "./sources/policy.js";
export { preflight, selectSourceForTopicV2 } from "./sources/policy.js";
export type { TransitionResult, LifecycleReport, SourceHealthSummary } from "./sources/lifecycle.js";
export {
  sampleSources,
  updateRating,
  evaluateTransition,
  applyTransitions,
  getSourceHealthSummary,
  filterHealthySources,
} from "./sources/lifecycle.js";
export { adapter as genericProviderAdapter } from "./providers/generic.js";
export type {
  AttestationMethod as ProviderAttestationMethod,
  ProviderAdapter,
  BuildCandidatesContext,
  CandidateRequest,
  CandidateValidation,
  FetchedResponse,
  EvidenceEntry,
  ParsedAdapterResponse,
  SurgicalCandidate,
} from "./providers/types.js";
export type { DeclarativeProviderSpec } from "./providers/declarative-engine.js";
export {
  loadDeclarativeProviderAdapters,
  loadDeclarativeProviderAdaptersSync,
} from "./providers/declarative-engine.js";

// ── Phase 9: Toolkit Primitives ───────────────────────

export { createToolkit } from "./primitives/index.js";
export type { Toolkit, ToolkitDeps } from "./primitives/types.js";
export { ApiDataSource, ChainDataSource, AutoDataSource } from "./data-source.js";
export type { DataSource } from "./data-source.js";

// ── Utilities ──────────────────────────────────────

export { toErrorMessage } from "./util/errors.js";
export { runSubprocessSafe } from "./util/subprocess.js";
export type { SubprocessOptions, SubprocessResult } from "./util/subprocess.js";
export { withBudget } from "./util/timed-phase.js";
export type { TimedResult } from "./util/timed-phase.js";

// ── Network ────────────────────────────────────────

export type {
  StorageClientConfig,
  AgentStateProgram,
  StorageClient,
} from "./network/storage-client.js";
export { fetchWithTimeout } from "./network/fetch-with-timeout.js";
export { createStorageClient } from "./network/storage-client.js";

// ── Tools ───────────────────────────────────────────

export { connect, disconnect } from "./tools/connect.js";
export { publish, reply } from "./tools/publish.js";
export { react, getReactionCounts } from "./tools/react.js";
export { tip } from "./tools/tip.js";
export { scan } from "./tools/scan.js";
export { verify } from "./tools/verify.js";
export { attest } from "./tools/attest.js";
export { discoverSources, clearCatalogCache } from "./tools/discover-sources.js";
export { pay } from "./tools/pay.js";
export { parseFeedPosts } from "./tools/feed-parser.js";
// ── Signal-First Publish Pipeline (V3 Phase 1) ──
export {
  extractClaimsRegex,
  runFaithfulnessGate,
  runSignalFirstPipeline,
  findSupportingAttestation,
  subjectPresent,
  isClaimSupportedByAttestation,
  METRIC_UNITS,
  DEFAULT_STALENESS_THRESHOLDS_MS,
  ClaimIdentitySchema,
  StructuredClaimSchema,
  ClaimExtractionResultSchema,
  PublishAttestationSchema,
  FaithfulnessResultSchema,
  PipelineInputSchema,
  PipelineDecisionSchema,
  PipelineResultSchema,
  EventVerificationResultSchema,
  POSITIVE_STATES,
  NEGATIVE_STATES,
  verifyEventClaim,
} from "./publish/index.js";
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
  FaithfulnessGateOptions,
  SignalFirstPipelineOptions,
  EventVerificationResult,
  EventVerifierOptions,
} from "./publish/index.js";

// ── SDK Bridge Types (chain-first) ───────────────

export type { SdkBridge, ChainTransaction, ApiAccessState, ApiCallResult } from "./sdk-bridge.js";
export { createSdkBridge, AUTH_PENDING_TOKEN } from "./sdk-bridge.js";

// ── Guards (exposed for testing and advanced consumers) ──

export {
  checkAndRecordWrite,
  rollbackWriteRecord,
  getWriteRateRemaining,
} from "./guards/write-rate-limit.js";

export {
  checkAndRecordTip,
} from "./guards/tip-spend-cap.js";

export {
  reservePaySpend,
} from "./guards/pay-spend-cap.js";

export {
  checkAndRecordDedup,
} from "./guards/dedup-guard.js";

export { withBackoff } from "./guards/backoff.js";

export { checkAndAppend, appendEntry, safeParse } from "./guards/state-helpers.js";

export {
  makeIdempotencyKey,
  checkPayReceipt,
  recordPayReceipt,
} from "./guards/pay-receipt-log.js";

export type { PayReceipt } from "./guards/pay-receipt-log.js";

// ── Schemas (Zod validation) ─────────────────────────

export {
  validateInput,
  ConnectOptionsSchema,
  PublishDraftSchema,
  ReplyOptionsSchema,
  ReactOptionsSchema,
  TipOptionsSchema,
  ScanOptionsSchema,
  VerifyOptionsSchema,
  AttestOptionsSchema,
  DiscoverSourcesOptionsSchema,
  PayOptionsSchema,
  TipPolicySchema,
  PayPolicySchema,
  D402RequirementSchema,
  CatalogEntrySchema,
} from "./schemas.js";

export type { CatalogEntry } from "./schemas.js";

// ── Reactive Primitives ──────────────────────────────

export type {
  AgentEvent,
  EventAction,
  EventActionLike,
  EventHandler,
  EventSource,
  OmniwebAction,
  OmniwebActionType,
  SCAction,
  SCActionType,
  WatermarkStore,
} from "./reactive/types.js";
export type {
  AdaptiveInterval,
  EventLoop,
  EventLoopConfig,
  EventLoopStats,
  SourceRegistration,
} from "./reactive/event-loop.js";
export { nextInterval, startEventLoop } from "./reactive/event-loop.js";
export {
  createFileWatermarkStore,
  createMemoryWatermarkStore,
  watermarkPath,
} from "./reactive/watermark-store.js";

// ── Math Primitives ─────────────────────────────────

export type {
  BaselineChange,
  BaselineEntry,
  BaselineObservation,
  BaselineStore,
  BaselineWindowKey,
  DetectBaselineChangeOptions,
  MetricWindows,
} from "./math/baseline.js";
export {
  calculateMAD,
  calculateZScore,
  detectChangeAgainstBaseline,
  getBaselineMedian,
  getBaselineObservations,
  getBaselineSampleCount,
  recordBaselineValue,
  winsorize,
  RingBuffer,
} from "./math/baseline.js";

// ── Chain Primitives ────────────────────────────────

export { unresolvedPlaceholders, extractTopicVars, fillUrlTemplate } from "./chain/url-helpers.js";
export type { ChainTxResult, ChainTxStages } from "./chain/tx-pipeline.js";
export { executeChainTx } from "./chain/tx-pipeline.js";
export type {
  ChainId,
  ChainReadResult,
  ChainProvenance,
  ChainAdapter,
  ChainFamily,
  ChainEndpoint,
  MockChainAdapterOptions,
  MockChainAdapterReadCall,
  ContractEntry,
  MetricDefinition,
  MetricDerivation,
  ProtocolEntry,
  ChainVerificationResult,
  ChainVerifierOptions,
} from "./chain/index.js";
export {
  MockChainAdapter,
  CONTRACT_REGISTRY,
  resolveChainSource,
  deriveValue,
  verifyClaimOnChain,
} from "./chain/index.js";
