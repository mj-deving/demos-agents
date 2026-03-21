/**
 * Attestation policy — plan resolution, URL helpers, asset mapping.
 *
 * Superseded v1 functions (loadSourceRegistry, selectSourceForTopic, preflight,
 * tokenizeTopic, sourceTopicTokens) removed — canonical versions live in
 * sources/catalog.ts and sources/policy.ts.
 */

import type { AgentConfig } from "./agent-config.js";

export type AttestationType = "DAHR" | "TLSN";

export interface SourceRecord {
  name: string;
  url: string;
  topics?: string[];
  tlsn_safe?: boolean;
  dahr_safe?: boolean;
  max_response_kb?: number;
  note?: string;
}

export interface AttestationPlan {
  required: AttestationType;
  fallback: AttestationType | null;
  sensitive: boolean;
  reason: string;
}

/**
 * Known asset mapping for entity recognition in topics and post text.
 * Used by source selection (policy.ts) and claim extraction (claim-extraction.ts).
 * Ordered by market cap / usage frequency for early-exit optimization.
 *
 * Short tickers that collide with English words (dot, link, near, op, uni, arb, atom,
 * sol, fil, sui, apt) are matched case-insensitively ONLY via their full names.
 * The ticker form requires uppercase to avoid false positives ("open the link" ≠ LINK).
 * Note: extractEntities() in claim-extraction.ts lowercases text before matching,
 * so case-sensitive ticker patterns only match in policy.ts (which passes original text).
 * For claim-extraction, the full name match is the primary path.
 */
export const ASSET_MAP: Array<[RegExp, string, string]> = [
  [/\bbitcoin|\bbtc\b/i, "bitcoin", "BTC"],
  [/\bethereum|\beth\b/i, "ethereum", "ETH"],
  [/\bsolana\b|\bSOL\b/, "solana", "SOL"],
  [/\bripple|\bxrp\b/i, "ripple", "XRP"],
  [/\bcardano|\bada\b/i, "cardano", "ADA"],
  [/\bdogecoin|\bdoge\b/i, "dogecoin", "DOGE"],
  [/\bpolkadot\b|\bDOT\b/, "polkadot", "DOT"],
  [/\bavalanche|\bavax\b/i, "avalanche", "AVAX"],
  [/\bchainlink\b|\bLINK\b/, "chainlink", "LINK"],
  [/\bpolygon|\bmatic\b/i, "polygon", "MATIC"],
  [/\buniswap\b|\bUNI\b/, "uniswap", "UNI"],
  [/\blitecoin|\bltc\b/i, "litecoin", "LTC"],
  [/\bcosmos\b|\bATOM\b/, "cosmos", "ATOM"],
  [/\bnear\sprotocol\b|\bNEAR\b/, "near", "NEAR"],
  [/\barbitrum\b|\bARB\b/, "arbitrum", "ARB"],
  [/\boptimism\b|\bOP\b/, "optimism", "OP"],
  [/\baave\b/i, "aave", "AAVE"],
  [/\bmonero|\bxmr\b/i, "monero", "XMR"],
  [/\bfilecoin\b|\bFIL\b/, "filecoin", "FIL"],
  [/\bSUI\b|\bsui\b(?=\s+(?:network|protocol|token|chain|price|trading))/, "sui", "SUI"],
  [/\baptos\b|\bAPT\b/, "aptos", "APT"],
];

/**
 * Macro entity mapping for non-crypto attestation targets.
 * Returns variable overrides needed by spec templates (series, indicator, etc.).
 * Used by buildSurgicalUrl when inferAssetAlias returns null.
 */
export const MACRO_ENTITY_MAP: Array<[RegExp, Record<string, string>]> = [
  [/\bgdp\b/i, { series: "GDP", indicator: "NY.GDP.MKTP.CD", asset: "gdp" }],
  [/\bunemployment\b/i, { series: "UNRATE", indicator: "SL.UEM.TOTL.ZS", asset: "unemployment" }],
  [/\binflation\b|\bcpi\b/i, { series: "CPIAUCSL", indicator: "FP.CPI.TOTL.ZG", asset: "inflation" }],
  [/\binterest.?rate\b|\bfed.?funds?\b/i, { series: "FEDFUNDS", indicator: "FEDFUNDS", asset: "interest-rate" }],
  [/\bmoney.?supply\b|\bm2\b/i, { series: "M2SL", asset: "money-supply" }],
  [/\bnational.?debt\b|\bpublic.?debt\b|\bdebt\b/i, { asset: "debt" }],
  [/\bearthquake\b|\bseismic\b|\bmagnitude\b/i, { asset: "earthquake" }],
  [/\bhousing\b|\bhousing.?starts\b/i, { series: "HOUST", asset: "housing" }],
  [/\bretail.?sales\b/i, { series: "RSXFS", asset: "retail-sales" }],
  [/\bindustrial.?production\b/i, { series: "INDPRO", asset: "industrial-production" }],
  [/\bpopulation\b/i, { indicator: "SP.POP.TOTL", asset: "population" }],
  [/\blife.?expectancy\b/i, { indicator: "SP.DYN.LE00.IN", asset: "life-expectancy" }],
  [/\bco2\b|\bemissions?\b/i, { indicator: "EN.ATM.CO2E.PC", asset: "co2-emissions" }],
  [/\bgini\b|\binequality\b/i, { indicator: "SI.POV.GINI", asset: "gini" }],
  [/\bpoverty\b/i, { indicator: "SI.POV.DDAY", asset: "poverty" }],
];

/**
 * Look up macro entity variables for non-crypto claims.
 * Returns spec variable overrides (series, indicator, asset, etc.) or null.
 */
export function inferMacroEntity(text: string): Record<string, string> | null {
  const t = text.toLowerCase();
  for (const [rx, vars] of MACRO_ENTITY_MAP) {
    if (rx.test(t)) return vars;
  }
  return null;
}

export function unresolvedPlaceholders(url: string): string[] {
  const matches = url.match(/\{([^}]+)\}/g) || [];
  return matches.map((m) => m.slice(1, -1));
}

export function inferAssetAlias(topic: string): { asset: string; symbol: string } | null {
  const t = topic.toLowerCase();
  for (const [rx, asset, symbol] of ASSET_MAP) {
    if (rx.test(t)) return { asset, symbol };
  }
  return null;
}

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

export function fillUrlTemplate(url: string, vars: Record<string, string>): string {
  return url.replace(/\{([^}]+)\}/g, (match, key: string) => {
    if (key in vars) return encodeURIComponent(vars[key]);
    return match;
  });
}

function normalizeTokens(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

export function isHighSensitivityTopic(topic: string, keywords: string[]): boolean {
  if (!Array.isArray(keywords) || keywords.length === 0) return false;
  const topicNorm = topic.toLowerCase();
  const topicTokens = new Set(normalizeTokens(topicNorm));
  for (const kwRaw of keywords) {
    const kw = String(kwRaw || "").toLowerCase().trim();
    if (!kw) continue;
    if (topicNorm.includes(kw)) return true;
    const kwTokens = normalizeTokens(kw);
    if (kwTokens.length > 0 && kwTokens.every((k) => topicTokens.has(k))) return true;
  }
  return false;
}

// ── Attestation Plan ──────────────────────────────

export function resolveAttestationPlan(topic: string, config: AgentConfig): AttestationPlan {
  const sensitive = isHighSensitivityTopic(topic, config.attestation.highSensitivityKeywords);

  if (sensitive && config.attestation.highSensitivityRequireTlsn) {
    return {
      required: "TLSN",
      fallback: null,
      sensitive: true,
      reason: "high-sensitivity topic requires TLSN by policy",
    };
  }

  switch (config.attestation.defaultMode) {
    case "tlsn_only":
      return {
        required: "TLSN",
        fallback: null,
        sensitive,
        reason: sensitive ? "sensitive topic + tlsn_only policy" : "tlsn_only policy",
      };
    case "tlsn_preferred":
      return {
        required: "TLSN",
        fallback: "DAHR",
        sensitive,
        reason: sensitive ? "sensitive topic with TLSN-preferred baseline" : "tlsn_preferred policy",
      };
    case "dahr_only":
    default:
      return {
        required: "DAHR",
        fallback: null,
        sensitive,
        reason: sensitive ? "sensitive topic but policy configured dahr_only" : "dahr_only policy",
      };
  }
}
