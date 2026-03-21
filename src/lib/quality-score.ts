/**
 * Hybrid quality scoring — rule-based, measurable signals.
 *
 * Replaces LLM-predicted-reactions as quality gate. Every signal is
 * objectively measurable with no LLM guessing.
 *
 * Based on analysis of n=34 published posts:
 * - Replies outperform top-level 66% (13.6 vs 8.2rx)
 * - Posts with attestation score higher (DAHR +40 on-chain)
 * - Numeric claims correlate with engagement
 * - LLM prediction error averages 6.9rx (unreliable)
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface QualitySignals {
  /** Post text contains at least one numeric value with unit (e.g., "$67,432", "3.2%") */
  hasNumericClaim: boolean;
  /** Post references another agent's analysis (mentions agent name or replies) */
  referencesAgent: boolean;
  /** Post is a reply to another post (replies avg 13.6rx vs 8.2rx top-level) */
  isReply: boolean;
  /** Post has attestation proof (DAHR or TLSN) — HARD GATE, not scored */
  hasAttestation: boolean;
  /** Post text exceeds 400 chars (higher engagement) */
  isLongForm: boolean;
  /** Post contains generic/vague filler phrases */
  hasGenericLanguage: boolean;
}

export interface QualityResult {
  /** Quality score from soft signals (0 to maxScore) */
  score: number;
  maxScore: number;
  /** Hard gate: attestation required — if false, post must not publish */
  attestationGate: boolean;
  signals: QualitySignals;
  breakdown: Record<string, number>;
}

// ── Signal Weights ──────────────────────────────

const WEIGHTS = {
  hasNumericClaim: 2,
  referencesAgent: 2,
  isReply: 2,
  isLongForm: 1,
  hasGenericLanguage: -2,
} as const;

const MAX_SCORE = Object.values(WEIGHTS).filter((v) => v > 0).reduce((a, b) => a + b, 0); // 7

// ── Generic Language Patterns ───────────────────

const GENERIC_PATTERNS = [
  /\binteresting to see\b/i,
  /\btime will tell\b/i,
  /\bonly time will tell\b/i,
  /\bstay tuned\b/i,
  /\bwatch this space\b/i,
  /\bfood for thought\b/i,
  /\bit remains to be seen\b/i,
  /\bthis is huge\b/i,
  /\blet that sink in\b/i,
  /\bnot financial advice\b/i,
  /\bdyor\b/i,
];

// ── Numeric Claim Detection ─────────────────────

const NUMERIC_PATTERNS = [
  /\$\d{1,3}(?:,\d{3})*(?:\.\d+)?/,        // $64,231.50
  /\$\d+(?:\.\d+)?[BMKTbmkt]/,               // $1.2B, $500M
  /\d+(?:\.\d+)?%/,                           // 45%, 3.2%
  /\d+(?:\.\d+)?\s*(?:gwei|sats?|eth|btc|sol|dem)/i, // 14 gwei, 100 sats
  /\d{1,3}(?:,\d{3})+/,                      // 1,234,567 (large numbers)
];

// ── Scorer ──────────────────────────────────────

export function calculateQualityScore(input: {
  text: string;
  isReply?: boolean;
  hasAttestation?: boolean;
  agentsReferenced?: string[];
}): QualityResult {
  const { text } = input;

  const signals: QualitySignals = {
    hasNumericClaim: NUMERIC_PATTERNS.some((p) => p.test(text)),
    referencesAgent: (input.agentsReferenced?.length ?? 0) > 0,
    isReply: input.isReply ?? false,
    hasAttestation: input.hasAttestation ?? false,
    isLongForm: text.length > 400,
    hasGenericLanguage: GENERIC_PATTERNS.some((p) => p.test(text)),
  };

  const breakdown: Record<string, number> = {};
  let score = 0;

  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const signalValue = signals[key as keyof QualitySignals];
    const points = signalValue ? weight : 0;
    breakdown[key] = points;
    score += points;
  }

  return {
    score: Math.max(0, score),
    maxScore: MAX_SCORE,
    attestationGate: signals.hasAttestation,
    signals,
    breakdown,
  };
}

// ── Quality Data Logger ──────────────────────

export interface QualityDataEntry {
  timestamp: string;
  agent: string;
  topic: string;
  category: string;
  quality_score: number;
  quality_max: number;
  quality_breakdown: Record<string, number>;
  predicted_reactions: number;
  confidence: number;
  text_length: number;
  isReply: boolean;
  hasAttestation: boolean;
}

/**
 * Append a quality data entry to the agent-scoped JSONL file.
 * Non-blocking — logs errors but never throws.
 */
export function logQualityData(entry: QualityDataEntry): void {
  try {
    const dir = join(process.env.HOME || "~", ".config", "demos");
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `quality-data-${entry.agent}.jsonl`);
    appendFileSync(filePath, JSON.stringify(entry) + "\n", { mode: 0o600 });
  } catch {
    // Non-blocking — never fail the publish pipeline for logging
  }
}
