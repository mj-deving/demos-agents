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
  Source,
  SourceStatus,
  PayResult,
} from "./types.js";

export { ok, err, demosError } from "./types.js";

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
export { discoverSources } from "./tools/discover-sources.js";
export { pay } from "./tools/pay.js";

// ── Guards (exposed for testing and advanced consumers) ──
// @deprecated — check/record pairs scheduled for removal in v2.0.
// Use checkAndAppend() unified API from state-helpers instead.

export {
  checkWriteRateLimit,
  recordWrite,
  getWriteRateRemaining,
} from "./guards/write-rate-limit.js";

export {
  checkTipSpendCap,
  recordTip,
} from "./guards/tip-spend-cap.js";

export {
  checkPaySpendCap,
  recordPayment,
} from "./guards/pay-spend-cap.js";

export {
  checkDedup,
  recordPublish,
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
} from "./schemas.js";
