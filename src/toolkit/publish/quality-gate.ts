/**
 * Pre-publish quality validation gate.
 *
 * Pure function that checks draft content against configurable quality
 * thresholds before publishing. Returns per-check results for observability.
 *
 * Toolkit-layer primitive — no imports from cli/ or src/lib/.
 */

// ── Types ──────────────────────────────────────────

export interface QualityGateConfig {
  minTextLength?: number;
  minPredictedReactions?: number;
  requireQuestionMark?: boolean;
}

export interface QualityGateResult {
  pass: boolean;
  reason?: string;
  checks: Array<{ name: string; pass: boolean; detail?: string }>;
}

// ── Defaults ───────────────────────────────────────

const DEFAULT_MIN_TEXT_LENGTH = 200;
const DEFAULT_MIN_PREDICTED_REACTIONS = 0;

// ── Core ───────────────────────────────────────────

/**
 * Validate a draft against quality thresholds.
 *
 * Checks:
 * 1. text-length — text must meet minimum character count
 * 2. predicted-reactions — if configured (> 0), reactions must meet minimum
 * 3. question-mark — QUESTION category drafts must contain "?"
 *
 * Returns individual check results for pipeline observability.
 */
export function checkPublishQuality(
  draft: { text: string; category?: string; predicted_reactions?: number },
  config?: QualityGateConfig,
): QualityGateResult {
  const minTextLength = config?.minTextLength ?? DEFAULT_MIN_TEXT_LENGTH;
  const minReactions = config?.minPredictedReactions ?? DEFAULT_MIN_PREDICTED_REACTIONS;
  const requireQuestion = config?.requireQuestionMark ?? true;

  const checks: Array<{ name: string; pass: boolean; detail?: string }> = [];

  // 1. Text length
  const textLen = draft.text.length;
  checks.push({
    name: "text-length",
    pass: textLen >= minTextLength,
    detail: `${textLen}/${minTextLength} chars`,
  });

  // 2. Predicted reactions (only when minReactions > 0)
  if (minReactions > 0) {
    const reactions = draft.predicted_reactions ?? 0;
    checks.push({
      name: "predicted-reactions",
      pass: reactions >= minReactions,
      detail: `${reactions}/${minReactions} predicted`,
    });
  }

  // 3. Question mark for QUESTION category
  if (requireQuestion && draft.category === "QUESTION") {
    checks.push({
      name: "question-mark",
      pass: draft.text.includes("?"),
      detail: draft.text.includes("?") ? "contains ?" : "missing ? in QUESTION post",
    });
  }

  // Aggregate
  const firstFailing = checks.find((c) => !c.pass);
  return {
    pass: !firstFailing,
    reason: firstFailing ? `failed: ${firstFailing.name} — ${firstFailing.detail}` : undefined,
    checks,
  };
}
