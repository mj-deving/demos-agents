/**
 * Pure URL template helpers for source URL resolution.
 *
 * Extracted from attestation-policy.ts during Phase 12a boundary move.
 * Zero strategy dependencies — safe for toolkit consumption.
 */

/**
 * Find unresolved `{placeholder}` variables in a URL template.
 */
export function unresolvedPlaceholders(url: string): string[] {
  const matches = url.match(/\{([^}]+)\}/g) || [];
  return matches.map((m) => m.slice(1, -1));
}

/**
 * Extract topic variables for URL template substitution.
 * Returns a record of common variable names (asset, symbol, query, date, etc.).
 */
export function extractTopicVars(topic: string): Record<string, string> {
  const t = topic.toLowerCase();
  const firstWord = (t.match(/[a-z0-9-]+/)?.[0] || "topic").replace(/[^a-z0-9-]/g, "");
  const today = new Date().toISOString().slice(0, 10);
  return {
    asset: firstWord,
    symbol: "",
    query: topic,
    protocol: firstWord,
    package: firstWord,
    title: firstWord,
    name: firstWord,
    date: today,
    base: "USD",
    lang: "en",
  };
}

/**
 * Fill `{variable}` placeholders in a URL template with provided values.
 * Unmatched placeholders are left as-is (use unresolvedPlaceholders to check).
 */
export function fillUrlTemplate(url: string, vars: Record<string, string>): string {
  return url.replace(/\{([^}]+)\}/g, (match, key: string) => {
    if (key in vars) return encodeURIComponent(vars[key]);
    return match;
  });
}
