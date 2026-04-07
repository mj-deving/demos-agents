/**
 * Generic-to-specific topic mapping.
 * Pure function — no side effects, no imports.
 */

const DEFAULT_EXPANSIONS: Record<string, string[]> = {
  ai: ["ai-infrastructure", "ai-safety", "ai-regulation"],
  defi: ["defi-lending", "defi-yield", "defi-governance"],
  crypto: ["bitcoin", "ethereum", "stablecoins"],
  macro: ["monetary-policy", "inflation", "trade-policy"],
  security: ["smart-contract-security", "protocol-exploits", "audit-findings"],
};

/**
 * Expand a generic topic into specific sub-topics.
 * Returns the expanded array if a match is found, otherwise [topic].
 *
 * Custom expansions are checked first, then defaults.
 */
export function expandTopic(
  topic: string,
  expansions?: Record<string, string[]>,
): string[] {
  const key = topic.toLowerCase();

  // Check custom expansions first (lowercased keys)
  if (expansions) {
    for (const [k, v] of Object.entries(expansions)) {
      if (k.toLowerCase() === key) return v;
    }
  }

  // Fall back to defaults
  if (key in DEFAULT_EXPANSIONS) return DEFAULT_EXPANSIONS[key];

  return [topic];
}
