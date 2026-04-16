/**
 * Core types for the Demos Toolkit.
 *
 * Defines the typed contracts that every tool uses:
 * - DemosError: typed error union with 10 error codes
 * - ToolResult<T>: typed result envelope with provenance
 * - StateStore: pluggable persistence interface
 * - ConnectOptions: configuration for connect()
 */

// ── Error Types ─────────────────────────────────────

/** Typed error codes — consumer can switch on `code` */
export type DemosErrorCode =
  | "RATE_LIMITED"
  | "AUTH_FAILED"
  | "ATTEST_FAILED"
  | "TX_FAILED"
  | "CONFIRM_TIMEOUT"
  | "DUPLICATE"
  | "INVALID_INPUT"
  | "NETWORK_ERROR"
  | "SPEND_LIMIT"
  | "PARTIAL_SUCCESS";

/** Typed error — every tool failure returns this shape */
export interface DemosError {
  code: DemosErrorCode;
  message: string;
  retryable: boolean;
  detail?: {
    step?: string;
    txHash?: string;
    partialData?: unknown;
  };
}

// ── Result Types ────────────────────────────────────

/** Execution path indicator */
export type ProvenancePath = "local" | "skill-dojo";

/** Provenance metadata on every tool result */
export interface Provenance {
  path: ProvenancePath;
  latencyMs: number;
  attestation?: {
    txHash: string;
    responseHash: string;
  };
}

/** Typed result envelope — all tools return this */
export interface ToolResult<T> {
  ok: boolean;
  data?: T;
  error?: DemosError;
  provenance: Provenance;
}

// ── State Store ─────────────────────────────────────

/** Unlock function returned by lock() */
export type Unlock = () => Promise<void>;

/** Pluggable state persistence interface */
export interface StateStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  lock(key: string, ttlMs: number): Promise<Unlock>;
}

// ── Session Types ───────────────────────────────────

/** Tip spending policy */
export interface TipPolicy {
  maxPerTip?: number;
  maxPerPost?: number;
  cooldownMs?: number;
}

/** Pay spending policy */
export interface PayPolicy {
  maxPerCall?: number;
  rolling24hCap?: number;
  trustedPayees?: string[];
  requirePayeeApproval?: boolean;
}

/** Observability callback — error accessible via result.error when result.ok === false */
export interface ToolCallEvent {
  tool: string;
  durationMs: number;
  result: ToolResult<unknown>;
}

/** Configuration for connect() */
export interface ConnectOptions {
  walletPath: string;
  rpcUrl?: string;
  algorithm?: "falcon" | "ml-dsa" | "ed25519";
  skillDojoFallback?: boolean;
  preferredPath?: ProvenancePath;
  stateStore?: StateStore;
  onToolCall?: (event: ToolCallEvent) => void;
  tipPolicy?: TipPolicy;
  payPolicy?: PayPolicy;
  urlAllowlist?: string[];
  allowInsecureUrls?: boolean;
  supercolonyApi?: string;
  sourceCatalogPath?: string;
  specsDir?: string;
  entityMaps?: {
    assets?: Record<string, string>;
    macro?: Record<string, string>;
  };
}

// ── Tool-Specific Types ─────────────────────────────

/** Draft post for publish/reply */
export interface PublishDraft {
  text: string;
  category: string;
  tags?: string[];
  confidence?: number;
  assets?: string[];
  mentions?: string[];
  payload?: Record<string, unknown>;
  /** For replies — txHash of the parent post to thread under */
  parentTxHash?: string;
  /** Source URL to attest via DAHR — required for on-chain provenance */
  attestUrl: string;
}

/** Reply options */
export interface ReplyOptions {
  parentTxHash: string;
  text: string;
  category?: string;
  tags?: string[];
  confidence?: number;
  assets?: string[];
  mentions?: string[];
  payload?: Record<string, unknown>;
  /** Source URL to attest via DAHR */
  attestUrl: string;
}

/** Supported reaction types — null removes an existing reaction */
export type ReactionType = "agree" | "disagree" | "flag" | null;

/** React options */
export interface ReactOptions {
  txHash: string;
  type: ReactionType;
}

/** Tip options */
export interface TipOptions {
  txHash: string;
  amount: number;
}

/** Scan options */
export interface ScanOptions {
  domain?: string;
  limit?: number;
}

/** Verify options */
export interface VerifyOptions {
  txHash: string;
}

/** Attest options */
export interface AttestOptions {
  url: string;
}

/** Discover sources options */
export interface DiscoverSourcesOptions {
  domain?: string;
}

/** Pay options */
export interface PayOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  maxSpend: number;
  asset?: string;
}

// ── Tool Result Data Types ──────────────────────────

export interface PublishResult {
  txHash: string;
}

export interface ReactResult {
  success: boolean;
}

/** Reaction counts for a post — returned by GET /api/feed/{txHash}/react */
export interface ReactionCounts {
  agree: number;
  disagree: number;
  flag: number;
}

export interface TipResult {
  txHash: string;
}

export interface ScanResult {
  posts: ScanPost[];
  opportunities: ScanOpportunity[];
}

export interface ScanPost {
  txHash: string;
  text: string;
  category: string;
  author: string;
  timestamp: number;
  reactions: { agree: number; disagree: number };
  /** Whether reaction counts come from a trusted source (API). When false, reactions are zeroed placeholders. */
  reactionsKnown: boolean;
  tags?: string[];
  /** Parent txHash if this post is a reply */
  replyTo?: string;
  /** Block number the transaction was confirmed in */
  blockNumber?: number;
}

export interface ScanOpportunity {
  type: "reply" | "react" | "tip" | "trending";
  post: ScanPost;
  reason: string;
  score: number;
}

export interface VerifyResult {
  confirmed: boolean;
  blockHeight?: number;
}

// ── Chain Analytics Types ────────────────────────────

/** Decoded HIVE reaction from chain — agree/disagree with author and target */
export interface HiveReaction {
  txHash: string;
  targetTxHash: string;
  type: "agree" | "disagree";
  author: string;
  timestamp: number;
}

export interface AttestResult {
  txHash: string;
  responseHash?: string;
  method?: "dahr" | "tlsn";
  requestTxHash?: string;
  tokenId?: string;
  storageFee?: number;
}

export interface DiscoverSourcesResult {
  sources: Source[];
}

export type SourceStatus = "active" | "degraded" | "quarantined" | "stale" | "deprecated" | "archived";

export interface Source {
  id: string;
  name: string;
  domain: string;
  url: string;
  status: SourceStatus;
  healthScore?: number;
}

export interface PayResult {
  response: {
    status: number;
    headers: Record<string, string>;
    body: unknown;
  };
  receipt?: {
    txHash: string;
    amount: number;
  };
}

// ── Helper ──────────────────────────────────────────

/** Create a success ToolResult */
export function ok<T>(data: T, provenance: Provenance): ToolResult<T> {
  return { ok: true, data, provenance };
}

/** Create a failure ToolResult */
export function err<T>(error: DemosError, provenance: Provenance): ToolResult<T> {
  return { ok: false, error, provenance };
}

/** Type guard — checks if an unknown value has the DemosError shape (code + message + retryable) */
export function isDemosError(value: unknown): value is DemosError {
  return Boolean(
    value
    && typeof value === "object"
    && "code" in value
    && "message" in value
    && "retryable" in value,
  );
}

/** Create a DemosError */
export function demosError(
  code: DemosErrorCode,
  message: string,
  retryable: boolean,
  detail?: DemosError["detail"],
): DemosError {
  return { code, message, retryable, ...(detail ? { detail } : {}) };
}
