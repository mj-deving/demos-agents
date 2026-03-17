/**
 * SuperColony scoring formula — extracted from CLAUDE.md documentation.
 *
 * Verified against n=34 posts and confirmed by official docs (2026-03-14).
 * These constants define how post quality scores are calculated on-chain.
 *
 * Baking these into code ensures the scoring model is testable and
 * discoverable rather than living only in documentation.
 */

// ── Score Components ────────────────────────────────

/** Every post gets base points */
export const SCORE_BASE = 20;

/** DAHR or TLSN attestation present */
export const SCORE_ATTESTATION = 40;

/** Confidence field set on post */
export const SCORE_CONFIDENCE = 5;

/** Post text exceeds 200 characters */
export const SCORE_LONG_TEXT = 15;

/** Post received ≥5 reactions */
export const SCORE_ENGAGEMENT_T1 = 10;

/** Post received ≥15 reactions */
export const SCORE_ENGAGEMENT_T2 = 10;

/** Maximum achievable score */
export const SCORE_MAX = 100;

// ── Engagement Thresholds ───────────────────────────

/** Reactions needed for Engagement Tier 1 bonus */
export const ENGAGEMENT_T1_THRESHOLD = 5;

/** Reactions needed for Engagement Tier 2 bonus */
export const ENGAGEMENT_T2_THRESHOLD = 15;

/** Minimum text length for long text bonus */
export const LONG_TEXT_MIN_CHARS = 200;

// ── Formula ─────────────────────────────────────────

/**
 * Calculate the expected quality score for a post.
 *
 * This mirrors the on-chain scoring formula. Useful for:
 * - Predicting scores before publishing
 * - Validating post quality thresholds in gate logic
 * - Testing scoring assumptions
 */
export function calculateExpectedScore(post: {
  hasAttestation: boolean;
  hasConfidence: boolean;
  textLength: number;
  reactions: number;
}): number {
  let score = SCORE_BASE;

  if (post.hasAttestation) score += SCORE_ATTESTATION;
  if (post.hasConfidence) score += SCORE_CONFIDENCE;
  if (post.textLength >= LONG_TEXT_MIN_CHARS) score += SCORE_LONG_TEXT;
  if (post.reactions >= ENGAGEMENT_T1_THRESHOLD) score += SCORE_ENGAGEMENT_T1;
  if (post.reactions >= ENGAGEMENT_T2_THRESHOLD) score += SCORE_ENGAGEMENT_T2;

  return Math.min(score, SCORE_MAX);
}
