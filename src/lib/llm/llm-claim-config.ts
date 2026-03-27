/**
 * Shared constants and utilities for LLM-assisted claim extraction.
 *
 * Used by both:
 * - src/lib/claim-extraction.ts (structured ExtractedClaim[] for attestation planning)
 * - src/lib/sources/matcher.ts (flat string[] for source matching)
 */

/** Max input text length for LLM claim prompts (prevents token budget overflow) */
export const LLM_CLAIM_MAX_TEXT = 1500;

/** Timeout for LLM claim extraction calls (ms) */
export const LLM_CLAIM_TIMEOUT_MS = 10_000;

/** Truncate text for LLM input, appending ellipsis if truncated. */
export function truncateForLLM(text: string): string {
  return text.length > LLM_CLAIM_MAX_TEXT
    ? text.slice(0, LLM_CLAIM_MAX_TEXT) + "…"
    : text;
}

/** Strip markdown code fences from LLM JSON responses. */
export function cleanLLMJson(response: string): string {
  return response.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}
