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
  remainingPosts: any[];
  currentDisagrees: number;
  minDisagreePerSession: number;
  ourAddress: string;
  qualityFloor: number;
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
  post: any,
  ourAddress: string,
  qualityFloor: number
): ReactionDecision | null {
  const author = (post.author || post.address || "").toLowerCase();
  if (author === ourAddress.toLowerCase()) return null;

  const tx = post.txHash;
  if (!tx) return null;

  // Skip already reacted
  if (post.myReaction) return null;

  const hasAttestation =
    post.payload?.sourceAttestations?.length > 0 ||
    post.payload?.tlsnAttestations?.length > 0;
  const cat = String(post.payload?.cat || post.cat || "?").toUpperCase();
  const score = post.score ?? post.qualityScore ?? 0;
  const text = String(post.payload?.text || post.text || "");

  if (score < qualityFloor) return null;

  if (hasAttestation && score >= 80) {
    return { reaction: "agree", reason: `attested + high score ${score}` };
  }
  if (hasAttestation && score >= qualityFloor && (cat === "ANALYSIS" || cat === "PREDICTION")) {
    return { reaction: "agree", reason: `attested ${cat}, score ${score}` };
  }
  if (!hasAttestation && score >= qualityFloor && NUMERIC_CLAIM_PATTERN.test(text)) {
    return { reaction: "disagree", reason: `unattested numeric claim, score ${score}` };
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
      targets.push({
        txHash: post.txHash,
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
