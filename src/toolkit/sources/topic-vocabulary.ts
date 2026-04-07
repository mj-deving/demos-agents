/**
 * Topic-to-domain vocabulary — bridges colony signal language to source domain tags.
 *
 * Colony signals use natural language ("PBOC Yuan Defense", "DXY USD Liquidity
 * Tightening") while the source catalog uses domain tags ("macro", "forex",
 * "currency"). This vocabulary maps signal tokens to their relevant domain tags
 * so that selectSourcesByIntent can find the right sources.
 *
 * Toolkit-layer module — no cli/ or src/lib/ imports.
 */

/** Maps signal/topic terms to source domain tags they should match. */
export const TOPIC_DOMAIN_VOCABULARY: Record<string, string[]> = {
  // Central banks & monetary policy
  "pboc": ["macro", "forex", "currency", "economics"],
  "fed": ["macro", "fed", "economics", "treasury"],
  "ecb": ["macro", "forex", "currency", "economics"],
  "boj": ["macro", "forex", "currency"],
  "central-bank": ["macro", "fed", "economics"],
  "monetary": ["macro", "economics", "fed"],
  "interest-rate": ["macro", "economics", "treasury"],
  "inflation": ["macro", "economics"],
  "quantitative": ["macro", "economics", "fed"],

  // Currencies & FX
  "yuan": ["forex", "currency", "macro"],
  "dollar": ["forex", "currency", "macro"],
  "dxy": ["forex", "currency", "macro"],
  "usd": ["forex", "currency"],
  "eur": ["forex", "currency"],
  "forex": ["forex", "currency", "macro"],
  "currency": ["forex", "currency"],

  // Regulation
  "mica": ["regulation", "crypto", "cross-domain"],
  "cftc": ["regulation", "derivatives", "crypto"],
  "sec": ["regulation", "crypto"],
  "regulation": ["regulation", "cross-domain"],
  "regulatory": ["regulation", "cross-domain"],
  "compliance": ["regulation"],

  // Macro indicators
  "gdp": ["macro", "economics"],
  "unemployment": ["macro", "economics", "labor"],
  "cpi": ["macro", "economics"],
  "trade": ["macro", "economics"],
  "fiscal": ["macro", "economics", "treasury"],
  "deficit": ["macro", "economics", "treasury"],
  "liquidity": ["macro", "economics", "defi"],
  "tightening": ["macro", "economics", "fed"],

  // Geopolitics
  "geopolitics": ["macro", "cross-domain", "news"],
  "geopolitical": ["macro", "cross-domain", "news"],
  "sanctions": ["macro", "cross-domain", "regulation"],
  "tariff": ["macro", "economics", "trade"],

  // Crypto-specific
  "defi": ["defi", "tvl", "crypto"],
  "aave": ["defi", "tvl"],
  "compound": ["defi", "tvl"],
  "lending": ["defi", "tvl"],
  "yield": ["defi", "derivatives"],
  "staking": ["crypto", "on-chain"],
  "nft": ["crypto", "dex"],
  "vc": ["crypto", "finance", "news"],
  "funding": ["crypto", "finance", "vc"],

  // Markets
  "derivatives": ["derivatives", "futures", "crypto"],
  "futures": ["derivatives", "futures"],
  "options": ["derivatives"],
  "premium": ["derivatives", "futures"],
  "funding-rate": ["derivatives", "futures"],
  "basis": ["derivatives", "futures"],
};

/** Common suffixes to strip for fuzzy stem matching. */
const STRIP_SUFFIXES = ["ing", "tion", "ation", "ment", "ive", "ity", "al", "ous", "ness", "ical", "ized"];

/**
 * Fuzzy-match a token against a set of known domain tags.
 * Strips common suffixes and checks prefix overlap (min 4 chars).
 * "geopolitical" matches "geopolitics", "regulatory" matches "regulation".
 */
export function fuzzyMatchDomainTags(token: string, knownTags: Set<string>): string[] {
  if (token.length < 4) return [];
  const matches: string[] = [];

  // Try stripping suffixes to get a stem
  let stem = token;
  for (const suffix of STRIP_SUFFIXES) {
    if (token.endsWith(suffix) && token.length > suffix.length + 3) {
      stem = token.slice(0, -suffix.length);
      break;
    }
  }

  for (const tag of knownTags) {
    // Prefix match: stem matches start of tag or tag matches start of stem
    if (stem.length >= 4 && (tag.startsWith(stem) || stem.startsWith(tag.slice(0, Math.max(4, stem.length))))) {
      matches.push(tag);
    }
  }
  return matches;
}

/**
 * Expand topic tokens into source domain tags using 3 layers:
 * 1. Direct match — token IS a domain tag
 * 2. Curated vocabulary — known signal term → domain tags
 * 3. Fuzzy fallback — stem/prefix matching against all known domain tags
 *
 * @param topicTokens - tokens extracted from a signal topic string
 * @param knownDomainTags - optional set of all domain tags in the source index (enables layer 3)
 */
export function expandTopicToDomains(topicTokens: string[], knownDomainTags?: Set<string>): string[] {
  const domains = new Set<string>();
  for (const token of topicTokens) {
    const lower = token.toLowerCase();

    // Layer 1: direct match — pass through as potential domain tag
    domains.add(lower);

    // Layer 2: curated vocabulary
    const mapped = TOPIC_DOMAIN_VOCABULARY[lower];
    if (mapped) {
      for (const d of mapped) domains.add(d);
    }

    // Layer 3: fuzzy fallback — for tokens not directly matching a domain tag
    if (knownDomainTags && !knownDomainTags.has(lower)) {
      const fuzzy = fuzzyMatchDomainTags(lower, knownDomainTags);
      for (const d of fuzzy) domains.add(d);
    }
  }
  return [...domains];
}
