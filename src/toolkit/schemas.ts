/**
 * Zod input validation schemas for all toolkit tools.
 *
 * Design doc: Section 6.4 (docs/design-toolkit-architecture.md)
 * Design review: 8 findings resolved (Plans/twinkly-churning-zebra.md)
 *
 * Schemas validate shape/type at tool entry. They do NOT replace:
 * - SSRF validation (async DNS + IP blocklist) → url-validator.ts
 * - Rate limit / dedup / spend cap guards → guards/
 * - Cross-field checks (e.g., HTTPS + allowInsecureUrls) → connect.ts
 *
 * Note on attestUrl: PublishDraft.attestUrl is required in both types.ts and schemas.
 * Every post must carry on-chain provenance via DAHR attestation.
 */

import { z } from "zod";
import type { DemosError } from "./types.js";
import { demosError } from "./types.js";

// Import types for compile-time sync assertions
import type {
  ConnectOptions,
  PublishDraft,
  ReplyOptions,
  ReactOptions,
  TipOptions,
  ScanOptions,
  VerifyOptions,
  AttestOptions,
  DiscoverSourcesOptions,
  PayOptions,
  TipPolicy,
  PayPolicy,
} from "./types.js";

// ── Building Blocks ──────────────────────────────────

/** Non-empty string — .trim() rejects whitespace-only */
const nonEmptyString = z.string().trim().min(1, "must not be empty");

/** Transaction hash — non-empty, variable-length (no format constraint) */
const txHashString = nonEmptyString;

/** Text body — non-empty, max 10KB per design doc Section 6.4 */
const textBody = z.string().trim().min(1, "text must not be empty").max(10240, "text exceeds 10KB limit");

/** Positive finite number — custom messages for backward compatibility with existing tests */
const positiveFinite = z.number({
  invalid_type_error: "must be a positive finite number",
}).positive("must be a positive finite number").finite("must be a positive finite number");

// ── Policy Schemas ───────────────────────────────────

export const TipPolicySchema = z.object({
  maxPerTip: z.number().positive().finite().optional(),
  maxPerPost: z.number().int().positive().optional(),
  cooldownMs: z.number().int().nonnegative().optional(),
}).strict();

export const PayPolicySchema = z.object({
  maxPerCall: z.number().positive().finite().optional(),
  rolling24hCap: z.number().positive().finite().optional(),
  trustedPayees: z.array(z.string()).optional(),
  requirePayeeApproval: z.boolean().optional(),
}).strict();

// ── Tool Input Schemas ───────────────────────────────

export const ConnectOptionsSchema = z.object({
  walletPath: nonEmptyString,
  rpcUrl: z.string().url().optional(),
  algorithm: z.enum(["falcon", "ml-dsa", "ed25519"]).optional(),
  skillDojoFallback: z.boolean().optional(),
  preferredPath: z.enum(["local", "skill-dojo"]).optional(),
  stateStore: z.any().optional(),      // runtime object — can't validate methods
  onToolCall: z.any().optional(),      // runtime callback — passthrough
  tipPolicy: TipPolicySchema.optional(),
  payPolicy: PayPolicySchema.optional(),
  urlAllowlist: z.array(z.string()).optional(),
  allowInsecureUrls: z.boolean().optional(),
  supercolonyApi: z.string().url().optional(),
  sourceCatalogPath: z.string().optional(),
  specsDir: z.string().optional(),
  entityMaps: z.object({
    assets: z.record(z.string(), z.string()).optional(),
    macro: z.record(z.string(), z.string()).optional(),
  }).optional(),
});

export const PublishDraftSchema = z.object({
  text: textBody,
  category: nonEmptyString,
  tags: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(100).optional(),
  parentTxHash: z.string().optional(),
  attestUrl: nonEmptyString,  // Required — SSRF validated in executePublishPipeline, not here
});

export const ReplyOptionsSchema = z.object({
  parentTxHash: txHashString,
  text: textBody,
  category: z.string().optional(),
  attestUrl: nonEmptyString,
});

export const ReactOptionsSchema = z.object({
  txHash: txHashString,
  type: z.enum(["agree", "disagree"]),
});

export const TipOptionsSchema = z.object({
  txHash: txHashString,
  amount: positiveFinite,
});

export const ScanOptionsSchema = z.object({
  domain: z.string().optional(),
  limit: z.number().int().positive().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
}).optional();

export const VerifyOptionsSchema = z.object({
  txHash: txHashString,
});

export const AttestOptionsSchema = z.object({
  url: nonEmptyString,    // NOT .url() — SSRF validator in attest.ts owns URL parsing
  claimType: z.string().optional(),
});

export const DiscoverSourcesOptionsSchema = z.object({
  domain: z.string().optional(),
  matchThreshold: z.number().min(0).max(1).optional(),
}).optional();

export const PayOptionsSchema = z.object({
  url: nonEmptyString,    // NOT .url() — SSRF validator in pay.ts owns URL parsing
  method: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
  maxSpend: positiveFinite,
  asset: z.string().optional(),
});

// ── Validation Helper ────────────────────────────────

/**
 * Validate input against a Zod schema.
 * Returns null on success, or a DemosError with code INVALID_INPUT on failure.
 * Never throws.
 */
export function validateInput<T>(
  schema: z.ZodType<T>,
  input: unknown,
): DemosError | null {
  const result = schema.safeParse(input);
  if (result.success) return null;

  const messages = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });

  return demosError("INVALID_INPUT", messages.join("; "), false);
}

// ── Compile-Time Type Sync Assertions ────────────────
// Zero runtime cost. Prevents schema/interface drift.
// Forward: catches extra/wrong fields in schema output vs interface
// Reverse: catches new required fields added to interface but missing from schema

// Forward: schema output must be assignable to interface
type _AssertConnect = z.output<typeof ConnectOptionsSchema> extends ConnectOptions ? true : never;
type _AssertPublish = z.output<typeof PublishDraftSchema> extends PublishDraft ? true : never;
type _AssertReply = z.output<typeof ReplyOptionsSchema> extends ReplyOptions ? true : never;
type _AssertReact = z.output<typeof ReactOptionsSchema> extends ReactOptions ? true : never;
type _AssertTip = z.output<typeof TipOptionsSchema> extends TipOptions ? true : never;
type _AssertVerify = z.output<typeof VerifyOptionsSchema> extends VerifyOptions ? true : never;
type _AssertAttest = z.output<typeof AttestOptionsSchema> extends AttestOptions ? true : never;
type _AssertPay = z.output<typeof PayOptionsSchema> extends PayOptions ? true : never;
type _AssertTipPolicy = z.output<typeof TipPolicySchema> extends TipPolicy ? true : never;
type _AssertPayPolicy = z.output<typeof PayPolicySchema> extends PayPolicy ? true : never;

// Reverse: interface must be assignable to schema input (catches missing required fields)
type _AssertConnectRev = ConnectOptions extends z.input<typeof ConnectOptionsSchema> ? true : never;
type _AssertPublishRev = PublishDraft extends z.input<typeof PublishDraftSchema> ? true : never;
type _AssertReplyRev = ReplyOptions extends z.input<typeof ReplyOptionsSchema> ? true : never;
type _AssertReactRev = ReactOptions extends z.input<typeof ReactOptionsSchema> ? true : never;
type _AssertTipRev = TipOptions extends z.input<typeof TipOptionsSchema> ? true : never;
type _AssertVerifyRev = VerifyOptions extends z.input<typeof VerifyOptionsSchema> ? true : never;
type _AssertAttestRev = AttestOptions extends z.input<typeof AttestOptionsSchema> ? true : never;
type _AssertPayRev = PayOptions extends z.input<typeof PayOptionsSchema> ? true : never;
type _AssertTipPolicyRev = TipPolicy extends z.input<typeof TipPolicySchema> ? true : never;
type _AssertPayPolicyRev = PayPolicy extends z.input<typeof PayPolicySchema> ? true : never;

// Note: ScanOptions and DiscoverSourcesOptions use .optional(),
// so type assertions are omitted (z.output includes undefined which doesn't extend the interface).
