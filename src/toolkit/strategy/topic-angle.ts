/**
 * Topic angle rotation — generates alternative framings for dedup-blocked topics.
 *
 * Pure function, no side effects. Uses vocabulary from existing topic expansion
 * and oracle data to create novel angles without LLM involvement.
 */

export interface AngleContext {
  originalRule: string;
  divergence?: {
    asset: string;
    severity: string;
    agentDirection: string;
    marketDirection: string;
  };
  expansions?: Record<string, string[]>;
}

const TEMPORAL_FRAMES = [
  "weekly trend shift",
  "emerging pattern",
  "momentum change",
  "structural shift",
  "regime transition",
  "flow reversal",
  "positioning update",
  "cross-market impact",
];

const ANGLE_SUFFIXES = [
  "institutional implications",
  "liquidity dynamics",
  "risk-adjusted outlook",
  "supply-demand balance",
  "market microstructure",
  "capital flow analysis",
  "derivatives positioning",
  "on-chain signals",
];

/**
 * Generate an alternative angle for a topic that was dedup-blocked.
 * Returns null if the topic is too short or generic to meaningfully angle.
 */
export function generateTopicAngle(
  topic: string,
  context: AngleContext,
): string | null {
  const trimmed = topic.trim();
  const tokens = trimmed.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);

  // Too short to angle meaningfully
  if (tokens.length < 2) return null;

  // Strategy 1: Counter-angle from oracle divergence
  if (context.divergence) {
    const { asset, agentDirection, marketDirection } = context.divergence;
    return `${asset} divergence: ${agentDirection} agents vs ${marketDirection} market`;
  }

  // Strategy 2: Sub-topic from expansion map
  if (context.expansions) {
    for (const [key, subs] of Object.entries(context.expansions)) {
      if (tokens.includes(key.toLowerCase()) && subs.length > 0) {
        const pick = subs[deterministicIndex(trimmed, subs.length)];
        return `${trimmed}: ${pick} focus`;
      }
    }
  }

  // Strategy 3: Temporal framing — deterministic but varied
  const frame = TEMPORAL_FRAMES[deterministicIndex(trimmed, TEMPORAL_FRAMES.length)];
  const suffix = ANGLE_SUFFIXES[deterministicIndex(trimmed + "salt", ANGLE_SUFFIXES.length)];

  // Pick the one that shares fewer words with the original topic
  const frameOverlap = frame.split(/\s+/).filter((w) => tokens.includes(w)).length;
  const suffixOverlap = suffix.split(/\s+/).filter((w) => tokens.includes(w)).length;

  const chosen = frameOverlap <= suffixOverlap ? frame : suffix;
  return `${trimmed}: ${chosen}`;
}

/** Deterministic index from a string — consistent across calls for same input. */
function deterministicIndex(input: string, modulo: number): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % modulo;
}
