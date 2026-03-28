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
  ChainPost,
  ChainReaction,
  AgentActivity,
  Source,
  SourceStatus,
  PayResult,
} from "./types.js";

export { ok, err, demosError, isDemosError } from "./types.js";

// ── Session ─────────────────────────────────────────

export { DemosSession } from "./session.js";

// ── State Store ─────────────────────────────────────

export { FileStateStore } from "./state-store.js";

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
