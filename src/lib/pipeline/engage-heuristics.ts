/**
 * Engagement heuristics — extracted from cli/engage.ts for testability.
 *
 * Contains reaction selection logic and disagree-minimum enforcement.
 * The second-pass mechanism ensures minDisagreePerSession is met by
 * scanning remaining posts for disagree-eligible targets after the
 * main reaction loop.
 */

// Inline pattern to avoid SDK import chain from feed-filter.ts
// Kept in sync with NUMERIC_CLAIM_PATTERN in feed-filter.ts
const NUMERIC_CLAIM_PATTERN = /\d+(\.\d+)?%|\$\d+|\d+\.\d+\s*(bbl|usd|btc|eth)/i;

// ── Types ──────────────────────────────────────────

export interface ReactionDecision {
  reaction: "agree" | "disagree";
  reason: string;
}

export interface DisagreeTarget {
  txHash: string;
  reaction: "disagree";
  reason: string;
}

export interface EnforceDisagreeInput {
  remainingPosts: Record<string, unknown>[];
  currentDisagrees: number;
  minDisagreePerSession: number;
  ourAddress: string;
  qualityFloor: number;
}

interface EngageHeuristicPayload {
  sourceAttestations?: unknown[];
  tlsnAttestations?: unknown[];
  cat?: unknown;
  text?: unknown;
}

interface EngageHeuristicPostView {
  author: string;
  txHash: string;
  hasReaction: boolean;
  hasAttestation: boolean;
  category: string;
  score: number;
  text: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function getPayload(post: Record<string, unknown>): EngageHeuristicPayload {
  const payload = asRecord(post.payload);
  return payload ?? {};
}

function toPostView(post: Record<string, unknown>): EngageHeuristicPostView | null {
  const payload = getPayload(post);
  const txHash = typeof post.txHash === "string" ? post.txHash : "";
  if (!txHash) return null;

  const scoreValue =
    typeof post.score === "number"
      ? post.score
      : typeof post.qualityScore === "number"
        ? post.qualityScore
        : Number(post.score ?? post.qualityScore ?? 0);

  return {
    author: String(post.author ?? post.address ?? "").toLowerCase(),
    txHash,
    hasReaction: Boolean(post.myReaction),
    hasAttestation:
      Array.isArray(payload.sourceAttestations) && payload.sourceAttestations.length > 0 ||
      Array.isArray(payload.tlsnAttestations) && payload.tlsnAttestations.length > 0,
    category: String(payload.cat ?? post.cat ?? "?").toUpperCase(),
    score: Number.isFinite(scoreValue) ? scoreValue : 0,
    text: String(payload.text ?? post.text ?? ""),
  };
}

// ── Reaction Selection ─────────────────────────────

/**
 * Decide whether and how to react to a post.
 * Returns null if post should be skipped.
 *
 * Heuristics:
 *   - Skip own posts, already-reacted, no txHash, below quality floor
 *   - Agree: attested + high score (>=80), or attested + ANALYSIS/PREDICTION at floor
 *   - Disagree: unattested + numeric claim at floor
 */
export function selectReaction(
  post: Record<string, unknown>,
  ourAddress: string,
  qualityFloor: number
): ReactionDecision | null {
  const view = toPostView(post);
  if (!view) return null;
  if (view.author === ourAddress.toLowerCase()) return null;
  if (view.hasReaction) return null;

  if (view.score < qualityFloor) return null;

  if (view.hasAttestation && view.score >= 80) {
    return { reaction: "agree", reason: `attested + high score ${view.score}` };
  }
  if (view.hasAttestation && view.score >= qualityFloor && (view.category === "ANALYSIS" || view.category === "PREDICTION")) {
    return { reaction: "agree", reason: `attested ${view.category}, score ${view.score}` };
  }
  if (!view.hasAttestation && view.score >= qualityFloor && NUMERIC_CLAIM_PATTERN.test(view.text)) {
    return { reaction: "disagree", reason: `unattested numeric claim, score ${view.score}` };
  }

  return null;
}

// ── Disagree Minimum Enforcement ───────────────────

/**
 * Second-pass scanner: after main loop, if disagree count is below
 * minDisagreePerSession, scan remaining (unprocessed) posts for
 * disagree-eligible targets only.
 *
 * Returns additional disagree targets up to the deficit amount.
 * Logs a warning when no eligible posts are found.
 */
export function enforceDisagreeMinimum(input: EnforceDisagreeInput): DisagreeTarget[] {
  const { remainingPosts, currentDisagrees, minDisagreePerSession, ourAddress, qualityFloor } = input;

  const deficit = minDisagreePerSession - currentDisagrees;
  if (deficit <= 0) return [];

  const targets: DisagreeTarget[] = [];

  for (const post of remainingPosts) {
    if (targets.length >= deficit) break;

    const decision = selectReaction(post, ourAddress, qualityFloor);
    if (decision && decision.reaction === "disagree") {
      const view = toPostView(post);
      if (!view) continue;
      targets.push({
        txHash: view.txHash,
        reaction: "disagree",
        reason: `${decision.reason} (disagree-minimum enforcement)`,
      });
    }
  }

  if (targets.length < deficit) {
    console.warn(
      `[engage] Warning: disagree minimum not met — need ${deficit} but only found ${targets.length} eligible posts`
    );
  }

  return targets;
}
