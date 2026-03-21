/**
 * Structured claim extraction from post text.
 *
 * Extracts typed claims (price, metric, event, etc.) with entities, values,
 * and units. Used by the attestation planner to construct surgical URLs that
 * prove specific facts in the post.
 *
 * Rules-first extraction handles numeric claims (prices, percentages, amounts).
 * LLM fallback for complex claims (trends, comparisons) when rules produce 0 claims.
 *
 * This is intentionally separate from matcher.ts extractClaims() — that function
 * returns string[] for fuzzy text matching. This returns structured ExtractedClaim[]
 * for attestation planning. Both modules share LLM constants from llm-claim-config.ts.
 */

import { ASSET_MAP } from "./attestation-policy.js";
import type { LLMProvider } from "./llm-provider.js";
import { LLM_CLAIM_TIMEOUT_MS, truncateForLLM, cleanLLMJson } from "./llm-claim-config.js";

// ── Types ─────────────────────────────────────────

export type ClaimType = "price" | "metric" | "event" | "statistic" | "trend" | "quote";

export interface ExtractedClaim {
  /** The factual assertion from the post text */
  text: string;
  /** Data type classification */
  type: ClaimType;
  /** Key entities (asset names, tickers, protocol names) */
  entities: string[];
  /** Numeric value if present (for price/metric verification) */
  value?: number;
  /** Unit if present (USD, %, TVL, gwei, etc.) */
  unit?: string;
}

// ── Constants ─────────────────────────────────────

/** Multiplier suffixes for shorthand amounts ($1.2B, $500M, $10K) */
const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  m: 1_000_000,
  b: 1_000_000_000,
  t: 1_000_000_000_000,
};

/** Pre-compiled domain unit patterns for extraction (avoids per-call regex compilation) */
const DOMAIN_UNIT_PATTERNS: Array<{ unit: string; regex: RegExp }> = [
  "gwei", "sats", "satoshis", "dem", "wei", "lamports",
  "tvl", "volume", "mcap", "market cap",
].map((unit) => ({
  unit,
  regex: new RegExp(`(\\d+(?:\\.\\d+)?)\\s+${unit}\\b`, "gi"),
}));

/** Entity proximity window (chars before/after a match to search for entities) */
const ENTITY_PROXIMITY = 60;

/** Context snippet window (chars before/after a match for the claim text) */
const CONTEXT_WINDOW = 40;

// ── Extraction Pattern Engine ─────────────────────

interface ExtractionRule {
  regex: RegExp;
  type: ClaimType;
  /** Parse the regex match into a numeric value */
  parseValue: (match: RegExpMatchArray) => number | null;
  /** Determine the unit from the match */
  getUnit: (match: RegExpMatchArray) => string;
  /** Whether the regex is stateful (has 'g' flag) and needs lastIndex reset */
  stateful?: boolean;
}

/** Pre-compiled extraction rules applied in order */
const EXTRACTION_RULES: ExtractionRule[] = [
  // $64,231.50 or $64,231 or $0.50 (negative lookahead excludes shorthand like $2.3B)
  {
    regex: /\$(\d{1,3}(?:,\d{3})*(?:\.\d+)?)(?!\s*[BMKTbmkt]\b)/g,
    type: "price",
    parseValue: (m) => {
      const v = parseFloat(m[1].replace(/,/g, ""));
      return isNaN(v) ? null : v;
    },
    getUnit: () => "USD",
  },
  // $1.2B / $500M / $10K / $1.5T
  {
    regex: /\$(\d+(?:\.\d+)?)\s*([BMKTbmkt])\b/g,
    type: "metric",
    parseValue: (m) => {
      const base = parseFloat(m[1]);
      const mult = MULTIPLIERS[m[2].toLowerCase()];
      return (!mult || isNaN(base)) ? null : base * mult;
    },
    getUnit: () => "USD",
  },
  // 45% or 12.5%
  {
    regex: /(\d+(?:\.\d+)?)\s*%/g,
    type: "metric",
    parseValue: (m) => {
      const v = parseFloat(m[1]);
      return isNaN(v) ? null : v;
    },
    getUnit: () => "%",
  },
  // Domain unit patterns (gwei, sats, etc.) — added dynamically below
];

// Append domain unit rules
for (const { unit, regex } of DOMAIN_UNIT_PATTERNS) {
  EXTRACTION_RULES.push({
    regex,
    type: "price",
    parseValue: (m) => {
      const v = parseFloat(m[1]);
      return isNaN(v) ? null : v;
    },
    getUnit: () => unit.toLowerCase(),
    stateful: true,
  });
}

/**
 * Build a dedup key for a claim. Uses toPrecision to avoid
 * floating-point representation drift (e.g., 1.2e9 vs 1200000000.0000001).
 */
function dedupKey(type: ClaimType, value: number, unit: string): string {
  // toPrecision(10) normalizes floats: 1200000000.0000001 → "1200000000"
  return `${type}|${value.toPrecision(10)}|${unit}`;
}

// ── Rule-Based Extraction ─────────────────────────

/**
 * Extract structured claims from post text using regex rules.
 *
 * Handles:
 * - Price patterns: $64,231 / $1.2B / $0.50
 * - Percentage patterns: 45% / 12.5%
 * - Domain units: 3 gwei / 100 sats / 50 DEM
 * - Entity recognition via ASSET_MAP (Bitcoin→BTC, Ethereum→ETH, Solana→SOL, etc.)
 * - Capitalized phrases as fallback entity names
 */
export function extractStructuredClaims(postText: string): ExtractedClaim[] {
  if (!postText || !postText.trim()) return [];

  const claims: ExtractedClaim[] = [];
  const seen = new Set<string>();

  // Context entities for the whole post (used to enrich individual claims)
  const postEntities = extractEntities(postText);

  // Apply all extraction rules through a unified loop
  for (const rule of EXTRACTION_RULES) {
    if (rule.stateful) rule.regex.lastIndex = 0;
    for (const m of postText.matchAll(rule.regex)) {
      const value = rule.parseValue(m);
      if (value === null) continue;

      const unit = rule.getUnit(m);
      const key = dedupKey(rule.type, value, unit);
      if (seen.has(key)) continue;
      seen.add(key);

      claims.push({
        text: extractContext(postText, m.index!, m[0].length),
        type: rule.type,
        entities: resolveEntities(postText, m.index!, postEntities),
        value,
        unit,
      });
    }
  }

  // Entity-only claims when no numeric claims were found
  if (claims.length === 0 && postEntities.length > 0) {
    for (const entity of postEntities) {
      claims.push({
        text: postText.slice(0, 80),
        type: "event",
        entities: [entity.asset, entity.symbol],
      });
    }
  }

  return claims;
}

// ── Entity Extraction ─────────────────────────────

interface EntityMatch {
  asset: string;
  symbol: string;
  index: number;
}

/**
 * Find all known entities in text using ASSET_MAP.
 * Matches against both original text (for case-sensitive ticker patterns like \bSOL\b)
 * and lowercased text (for case-insensitive full name patterns like \bsolana\b).
 */
function extractEntities(text: string): EntityMatch[] {
  const entities: EntityMatch[] = [];
  const lower = text.toLowerCase();

  for (const [rx, asset, symbol] of ASSET_MAP) {
    // Try original text first (catches case-sensitive tickers like SOL, DOT)
    // then lowercase (catches full names like "solana", "polkadot")
    rx.lastIndex = 0;
    let match = rx.exec(text);
    if (!match) {
      rx.lastIndex = 0;
      match = rx.exec(lower);
    }
    if (match) {
      entities.push({ asset, symbol, index: match.index });
    }
  }

  return entities;
}

/**
 * Resolve entities near a match position. Prefers nearby entities (within ENTITY_PROXIMITY),
 * falls back to post-level entities, then to capitalized phrases.
 */
function resolveEntities(
  text: string,
  matchIndex: number,
  allEntities: EntityMatch[]
): string[] {
  const nearby = allEntities.filter(
    (e) => e.index >= matchIndex - ENTITY_PROXIMITY && e.index <= matchIndex + ENTITY_PROXIMITY
  );

  if (nearby.length > 0) {
    return [...new Set(nearby.flatMap((e) => [e.asset, e.symbol]))];
  }

  if (allEntities.length > 0) {
    return [...new Set(allEntities.flatMap((e) => [e.asset, e.symbol]))];
  }

  // Fallback: capitalized phrases near the match
  const before = text.slice(Math.max(0, matchIndex - ENTITY_PROXIMITY), matchIndex);
  const caps = before.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g);
  if (caps && caps.length > 0) {
    return [caps[caps.length - 1].toLowerCase()];
  }

  return [];
}

/**
 * Extract surrounding context (up to ~80 chars) around a match position.
 */
function extractContext(text: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - CONTEXT_WINDOW);
  const end = Math.min(text.length, index + matchLength + CONTEXT_WINDOW);
  let snippet = text.slice(start, end).trim();
  if (start > 0) snippet = "…" + snippet;
  if (end < text.length) snippet = snippet + "…";
  return snippet;
}

// ── LLM-Assisted Extraction ──────────────────────

/**
 * Extract structured claims using an LLM provider.
 * Returns ExtractedClaim[] with typed claims.
 * Falls back to empty array on any failure (LLM unavailable, parse error, timeout).
 */
export async function extractStructuredClaimsWithLLM(
  postText: string,
  llm: LLMProvider,
): Promise<ExtractedClaim[]> {
  const truncated = truncateForLLM(postText);

  const prompt = `Extract factual claims from this text. Return ONLY a JSON array of objects.

Each object must have:
- "text": the claim text (short phrase)
- "type": one of "price", "metric", "event", "statistic", "trend", "quote"
- "entities": array of entity names (assets, protocols, organizations)
- "value": numeric value if present (number, not string), or omit
- "unit": unit string if present ("USD", "%", "gwei", "TVL"), or omit

Text: "${truncated}"

Return ONLY the JSON array. Example:
[{"text":"BTC at $64,231","type":"price","entities":["bitcoin","BTC"],"value":64231,"unit":"USD"}]`;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      llm.complete(prompt, { maxTokens: 512, modelTier: "fast" }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("LLM claim extraction timeout")), LLM_CLAIM_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timeoutId);

    const cleaned = cleanLLMJson(response);
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item: any): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && typeof item.text === "string" && typeof item.type === "string"
      )
      .map((item: any): ExtractedClaim => ({
        text: String(item.text),
        type: validateClaimType(item.type),
        entities: Array.isArray(item.entities)
          ? item.entities.filter((e: unknown): e is string => typeof e === "string")
          : [],
        ...(typeof item.value === "number" ? { value: item.value } : {}),
        ...(typeof item.unit === "string" ? { unit: item.unit } : {}),
      }));
  } catch {
    return [];
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

const VALID_CLAIM_TYPES: Set<string> = new Set(["price", "metric", "event", "statistic", "trend", "quote"]);

function validateClaimType(type: string): ClaimType {
  return VALID_CLAIM_TYPES.has(type) ? (type as ClaimType) : "event";
}

// ── Auto Extraction ──────────────────────────────

/**
 * Extract structured claims — rules first, LLM fallback when rules produce 0 claims.
 */
export async function extractStructuredClaimsAuto(
  postText: string,
  llm?: LLMProvider | null,
): Promise<ExtractedClaim[]> {
  const ruleClaims = extractStructuredClaims(postText);

  if (ruleClaims.length > 0) return ruleClaims;

  if (llm) {
    return extractStructuredClaimsWithLLM(postText, llm);
  }

  return [];
}
