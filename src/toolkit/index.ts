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
  TipOptions,
  ScanOptions,
  VerifyOptions,
  AttestOptions,
  DiscoverSourcesOptions,
  PayOptions,
  // Result types
  PublishResult,
  ReactResult,
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
export { adapter as genericProviderAdapter } from "./providers/generic.js";

// ── Utilities ──────────────────────────────────────

export { toErrorMessage } from "./util/errors.js";

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
export { react } from "./tools/react.js";
export { tip } from "./tools/tip.js";
export { scan } from "./tools/scan.js";
export { verify } from "./tools/verify.js";
export { attest } from "./tools/attest.js";
export { discoverSources, clearCatalogCache } from "./tools/discover-sources.js";
export { pay } from "./tools/pay.js";
export { parseFeedPosts } from "./tools/feed-parser.js";

// ── SDK Bridge Types (chain-first) ───────────────

export type { SdkBridge, ChainTransaction, ApiAccessState, ApiCallResult } from "./sdk-bridge.js";
export { createSdkBridge, AUTH_PENDING_TOKEN } from "./sdk-bridge.js";

// ── Guards (exposed for testing and advanced consumers) ──

export {
  checkAndRecordWrite,
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
