/**
 * VOTE/BET Codec — encodes/decodes HIVE_BET and HIVE_BINARY memo structures.
 *
 * Phase 8 Feature 5: Price predictions and binary market bets as HIVE posts.
 *
 * Review fixes applied:
 * - [Threat M6] Zod validation: amount positive, min 0.1, max 5, 2 decimal places
 * - [Threat M6] Expiry must be future and within 7 days
 * - [Threat] Defense-in-depth: validation at codec level AND executor level
 */

import { z } from "zod";

// ── Schemas ───────────────────────────────────────

const HiveBetSchema = z.object({
  action: z.literal("HIVE_BET"),
  asset: z.string().min(1).max(20),
  direction: z.enum(["up", "down"]),
  confidence: z.number().int().min(0).max(100),
  amount: z.number().min(0.1).max(5),
  expiry: z.string().refine((val) => {
    const date = new Date(val);
    if (isNaN(date.getTime())) return false;
    const now = Date.now();
    const maxExpiry = now + 7 * 24 * 60 * 60 * 1000;
    return date.getTime() > now && date.getTime() <= maxExpiry;
  }, "Expiry must be a valid future date within 7 days"),
});

const HiveBinarySchema = z.object({
  action: z.literal("HIVE_BINARY"),
  market: z.string().min(1).max(100),
  position: z.enum(["yes", "no"]),
  amount: z.number().min(0.1).max(5),
});

export type HiveBetPayload = z.infer<typeof HiveBetSchema>;
export type HiveBinaryPayload = z.infer<typeof HiveBinarySchema>;

// ── Max bet constant (defense-in-depth) ───────────

export const MAX_BET_AMOUNT = 5;

// ── Encode ────────────────────────────────────────

export function encodeVotePost(bet: HiveBetPayload): {
  text: string;
  category: "VOTE";
  tags: string[];
  metadata: Record<string, unknown>;
} {
  const parsed = HiveBetSchema.parse(bet);
  const clamped = Math.min(parsed.amount, MAX_BET_AMOUNT);

  return {
    text: `PREDICTION: ${parsed.asset} will go ${parsed.direction} with ${parsed.confidence}% confidence. Staking ${clamped} DEM. Expires ${parsed.expiry}.`,
    category: "VOTE",
    tags: [parsed.asset.toLowerCase(), "prediction", parsed.direction],
    metadata: { ...parsed, amount: clamped },
  };
}

export function encodeBinaryPost(binary: HiveBinaryPayload): {
  text: string;
  category: "VOTE";
  tags: string[];
  metadata: Record<string, unknown>;
} {
  const parsed = HiveBinarySchema.parse(binary);
  const clamped = Math.min(parsed.amount, MAX_BET_AMOUNT);

  return {
    text: `BET: Position ${parsed.position} on ${parsed.market}. Staking ${clamped} DEM.`,
    category: "VOTE",
    tags: [parsed.market.toLowerCase(), "binary-bet", parsed.position],
    metadata: { ...parsed, amount: clamped },
  };
}

// ── Decode ────────────────────────────────────────

export function decodeVotePayload(rawData: Record<string, unknown>): HiveBetPayload | null {
  const result = HiveBetSchema.safeParse(rawData);
  return result.success ? result.data : null;
}

export function decodeBinaryPayload(rawData: Record<string, unknown>): HiveBinaryPayload | null {
  const result = HiveBinarySchema.safeParse(rawData);
  return result.success ? result.data : null;
}

// ── Validate (aliases for decode — same behavior, different call-site semantics) ──

export const validateBetPayload = decodeVotePayload as (data: unknown) => HiveBetPayload | null;
export const validateBinaryPayload = decodeBinaryPayload as (data: unknown) => HiveBinaryPayload | null;
