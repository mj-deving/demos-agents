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

/**
 * Expand a set of topic tokens into source domain tags using the vocabulary.
 * Returns the union of all matched domains. Unknown tokens are passed through
 * as potential domain tags (the source index may match them directly).
 */
export function expandTopicToDomains(topicTokens: string[]): string[] {
  const domains = new Set<string>();
  for (const token of topicTokens) {
    const lower = token.toLowerCase();
    const mapped = TOPIC_DOMAIN_VOCABULARY[lower];
    if (mapped) {
      for (const d of mapped) domains.add(d);
    }
    // Also pass through the token itself as a potential domain tag
    domains.add(lower);
  }
  return [...domains];
}
