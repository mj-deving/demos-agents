/**
 * Source matcher — post-generation source verification.
 *
 * After LLM generates a post draft, `match()` verifies that a source from the
 * catalog actually substantiates the post's claims. This is the second pass of
 * the two-pass matching system (preflight → generate → match).
 *
 * Phase 4: match() is now async — fetches candidate URLs via fetchSource and
 * parses responses via adapter.parseResponse for evidence-based scoring.
 * Falls back to metadata-only scoring when fetch/parse fails.
 *
 * Threshold: 50 (canonical, from unified-loop-architecture-v2.md)
 *
 * Import graph:
 *   matcher.ts → ./catalog.ts (types, tokenizeTopic, sourceTopicTokens)
 *   matcher.ts → ./fetch.ts (fetchSource)
 *   matcher.ts → ./providers/index.ts (getProviderAdapter)
 *   session-runner.ts → ./index.ts → matcher.ts
 */

import type { AttestationType } from "../attestation-policy.js";
import type { AgentSourceView, SourceRecordV2 } from "./catalog.js";
import { tokenizeTopic, sourceTopicTokens } from "./catalog.js";
import type { PreflightCandidate } from "./policy.js";
import { fetchSource } from "./fetch.js";
import { getProviderAdapter } from "./providers/index.js";
import type { EvidenceEntry } from "./providers/types.js";

// ── Constants ───────────────────────────────────────

/** Canonical match threshold from unified plan */
const MATCH_THRESHOLD = 50;

/** Stopwords excluded from claim extraction */
const STOPWORDS = new Set([
  "this", "that", "with", "from", "have", "been", "will", "would", "could",
  "should", "their", "there", "these", "those", "about", "which", "when",
  "what", "more", "than", "very", "most", "also", "just", "into", "over",
  "such", "only", "some", "other", "each", "much", "between", "through",
  "after", "before", "while", "still", "might", "being", "does", "here",
]);

// ── Types ───────────────────────────────────────────

export interface MatchInput {
  topic: string;
  postText: string;
  postTags: string[];
  candidates: PreflightCandidate[];
  sourceView: AgentSourceView;
}

export interface MatchResult {
  pass: boolean;
  reason: string;
  reasonCode: "PASS" | "NO_POST_MATCH" | "MATCH_FETCH_FAILED" | "MATCH_THRESHOLD_NOT_MET";
  best?: {
    sourceId: string;
    method: AttestationType;
    url: string;
    score: number;
    matchedClaims: string[];
    evidence: string[];
  };
  considered: Array<{ sourceId: string; score?: number; error?: string }>;
}

// ── Claim Extraction ────────────────────────────────

/**
 * Extract key claims/terms from post text for source matching.
 * Uses token-based extraction (v1 — LLM-assisted in Phase 5).
 */
export function extractClaims(postText: string, postTags: string[]): string[] {
  const claims: string[] = [];

  // Extract capitalized phrases (potential named entities)
  const capitalizedPhrases = postText.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g) || [];
  for (const phrase of capitalizedPhrases) {
    if (phrase.length >= 4) claims.push(phrase.toLowerCase());
  }

  // Extract numbers with context (e.g., "$1.2B", "45%", "2024")
  const numberContexts = postText.match(/\$[\d,.]+[BMKTbmkt]?|\d+(?:\.\d+)?%|\b\d{4}\b/g) || [];
  for (const nc of numberContexts) {
    claims.push(nc.toLowerCase());
  }

  // Extract significant tokens from text (>= 4 chars, not stopwords)
  const textTokens = postText
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));

  // Deduplicate and add unique tokens
  const seen = new Set(claims);
  for (const token of textTokens) {
    if (!seen.has(token)) {
      claims.push(token);
      seen.add(token);
    }
  }

  // Add post tags as claims
  for (const tag of postTags) {
    const lower = tag.toLowerCase();
    if (!seen.has(lower)) {
      claims.push(lower);
      seen.add(lower);
    }
  }

  return claims;
}

// ── Evidence-Based Scoring ──────────────────────────

/**
 * Score how well structured evidence entries match the post's claims.
 * Phase 4 upgrade: uses EvidenceEntry fields for deeper matching.
 *
 * Scoring breakdown (0-100):
 * - Evidence title match (0-25): post claims found in entry titles
 * - Evidence body match (0-25): post claims found in entry bodyText
 * - Evidence topic overlap (0-20): entry topics intersect with post tags
 * - Evidence metrics overlap (0-15): numeric claims found in metrics
 * - Source metadata match (0-15): topic/domain overlap (from Phase 3)
 */
function scoreEvidence(
  claims: string[],
  entries: EvidenceEntry[],
  source: SourceRecordV2,
  postTags: string[]
): { score: number; matchedClaims: string[]; evidence: string[] } {
  const matched: string[] = [];
  const evidenceNotes: string[] = [];
  let score = 0;

  if (entries.length === 0) {
    // No entries — fall back to metadata-only scoring
    return scoreMetadataOnly(claims, source, postTags);
  }

  const claimSet = new Set(claims.map((c) => c.toLowerCase()));

  // Evidence title match (0-25)
  let titleMatches = 0;
  for (const entry of entries) {
    if (!entry.title) continue;
    const titleLower = entry.title.toLowerCase();
    for (const claim of claimSet) {
      if (claim.length >= 4 && titleLower.includes(claim)) {
        titleMatches++;
        matched.push(claim);
      }
    }
  }
  const titleScore = Math.min(25, Math.round((titleMatches / Math.max(claimSet.size, 1)) * 25));
  score += titleScore;
  if (titleMatches > 0) evidenceNotes.push(`${titleMatches} title match(es)`);

  // Evidence body match (0-25)
  let bodyMatches = 0;
  for (const entry of entries) {
    const bodyLower = entry.bodyText.toLowerCase();
    for (const claim of claimSet) {
      if (claim.length >= 4 && bodyLower.includes(claim)) {
        bodyMatches++;
        if (!matched.includes(claim)) matched.push(claim);
      }
    }
  }
  const bodyScore = Math.min(25, Math.round((bodyMatches / Math.max(claimSet.size, 1)) * 25));
  score += bodyScore;
  if (bodyMatches > 0) evidenceNotes.push(`${bodyMatches} body match(es)`);

  // Evidence topic overlap (0-20)
  const entryTopics = new Set<string>();
  for (const entry of entries) {
    for (const t of entry.topics) entryTopics.add(t.toLowerCase());
  }
  let topicOverlap = 0;
  for (const tag of postTags) {
    if (entryTopics.has(tag.toLowerCase())) topicOverlap++;
  }
  const topicScore = Math.min(20, topicOverlap * 5);
  score += topicScore;
  if (topicOverlap > 0) evidenceNotes.push(`${topicOverlap} topic overlap(s)`);

  // Evidence metrics overlap (0-15)
  let metricsMatches = 0;
  for (const entry of entries) {
    if (!entry.metrics) continue;
    const metricsStr = JSON.stringify(entry.metrics).toLowerCase();
    for (const claim of claimSet) {
      if (/^\$?[\d,.]+[%bmkt]?$/.test(claim) && metricsStr.includes(claim.replace(/[$,]/g, ""))) {
        metricsMatches++;
      }
    }
  }
  const metricsScore = Math.min(15, metricsMatches * 5);
  score += metricsScore;
  if (metricsMatches > 0) evidenceNotes.push(`${metricsMatches} metrics match(es)`);

  // Source metadata match (0-15)
  const sourceTokens = sourceTopicTokens(source);
  let metadataOverlap = 0;
  for (const claim of claimSet) {
    if (sourceTokens.has(claim)) metadataOverlap++;
  }
  const metadataScore = Math.min(15, metadataOverlap * 3);
  score += metadataScore;
  if (metadataOverlap > 0) evidenceNotes.push(`${metadataOverlap} source metadata match(es)`);

  return {
    score: Math.min(100, score),
    matchedClaims: [...new Set(matched)],
    evidence: evidenceNotes,
  };
}

// ── Metadata-Only Scoring (Fallback) ────────────────

/**
 * Metadata-only scoring when fetch/parse fails or no adapter exists.
 * This is the Phase 3 scoring logic preserved as a fallback.
 */
export function scoreMatch(
  claims: string[],
  source: SourceRecordV2,
  postTags: string[]
): { sourceId: string; source: SourceRecordV2; method: AttestationType; url: string; score: number; matchedClaims: string[]; evidence: string[] } {
  const result = scoreMetadataOnly(claims, source, postTags);
  return {
    sourceId: source.id,
    source,
    method: source.tlsn_safe ? "TLSN" : "DAHR",
    url: source.url,
    ...result,
  };
}

function scoreMetadataOnly(
  claims: string[],
  source: SourceRecordV2,
  postTags: string[]
): { score: number; matchedClaims: string[]; evidence: string[] } {
  const matched: string[] = [];
  const evidence: string[] = [];
  let score = 0;

  // Topic token overlap (0-40)
  const sourceTokens = sourceTopicTokens(source);
  const claimTokens = new Set(claims.map((c) => c.toLowerCase()));
  let topicOverlap = 0;
  for (const token of claimTokens) {
    if (sourceTokens.has(token)) {
      topicOverlap++;
      matched.push(token);
    }
  }
  const topicScore = claimTokens.size > 0
    ? Math.min(40, Math.round((topicOverlap / Math.min(claimTokens.size, 10)) * 40))
    : 0;
  score += topicScore;
  if (topicOverlap > 0) evidence.push(`${topicOverlap} topic token(s) matched`);

  // Domain tag overlap (0-20)
  const sourceDomainTags = new Set(source.domainTags.map((t) => t.toLowerCase()));
  let domainOverlap = 0;
  for (const tag of postTags) {
    if (sourceDomainTags.has(tag.toLowerCase())) {
      domainOverlap++;
      matched.push(tag.toLowerCase());
    }
  }
  const domainScore = Math.min(20, domainOverlap * 10);
  score += domainScore;
  if (domainOverlap > 0) evidence.push(`${domainOverlap} domain tag(s) matched`);

  // Provider relevance (0-20)
  const providerTerms: Record<string, string[]> = {
    "coingecko": ["crypto", "coin", "token", "market", "price"],
    "hn-algolia": ["tech", "software", "startup", "programming", "hacker"],
    "github": ["repository", "code", "open", "source", "developer"],
    "defillama": ["defi", "tvl", "protocol", "yield", "liquidity"],
    "binance": ["trading", "exchange", "pair", "volume"],
    "arxiv": ["paper", "research", "preprint", "study"],
    "wikipedia": ["encyclopedia", "article", "history"],
    "pubmed": ["biotech", "medical", "clinical", "study"],
    "worldbank": ["gdp", "indicator", "development", "poverty"],
    "kraken": ["trading", "exchange", "forex", "volume"],
  };
  const relevantTerms = providerTerms[source.provider] || [];
  let providerOverlap = 0;
  for (const term of relevantTerms) {
    if (claimTokens.has(term)) providerOverlap++;
  }
  const providerScore = Math.min(20, providerOverlap * 5);
  score += providerScore;
  if (providerOverlap > 0) evidence.push(`${providerOverlap} provider-relevant term(s)`);

  // Source name match (0-10)
  const sourceName = source.name.toLowerCase();
  let nameMatch = 0;
  for (const claim of claims) {
    if (claim.length >= 4 && sourceName.includes(claim)) nameMatch++;
  }
  const nameScore = Math.min(10, nameMatch * 5);
  score += nameScore;
  if (nameMatch > 0) evidence.push(`${nameMatch} name match(es)`);

  // Alias match bonus (0-10)
  const aliasTokens = new Set<string>();
  for (const alias of source.topicAliases || []) {
    for (const tok of alias.toLowerCase().split(/[^a-z0-9]+/)) {
      if (tok.length >= 2) aliasTokens.add(tok);
    }
  }
  let aliasOverlap = 0;
  for (const token of claimTokens) {
    if (aliasTokens.has(token)) aliasOverlap++;
  }
  const aliasScore = Math.min(10, aliasOverlap * 5);
  score += aliasScore;
  if (aliasOverlap > 0) evidence.push(`${aliasOverlap} alias match(es)`);

  return {
    score: Math.min(100, score),
    matchedClaims: matched,
    evidence,
  };
}

// ── Scored Candidate ────────────────────────────────

interface ScoredCandidate {
  sourceId: string;
  source: SourceRecordV2;
  method: AttestationType;
  url: string;
  score: number;
  matchedClaims: string[];
  evidence: string[];
}

// ── Match ───────────────────────────────────────────

/**
 * Post-generation source matching — now async (Phase 4).
 *
 * Fetches candidate URLs in parallel via fetchSource and parses via
 * adapter.parseResponse for evidence-based scoring. Falls back to
 * metadata-only scoring when fetch/parse fails.
 *
 * If no candidate meets the threshold (50), returns pass=false with
 * reasonCode MATCH_THRESHOLD_NOT_MET.
 */
export async function match(input: MatchInput): Promise<MatchResult> {
  const { postText, postTags, candidates } = input;

  if (candidates.length === 0) {
    return {
      pass: false,
      reason: "No candidates from preflight",
      reasonCode: "NO_POST_MATCH",
      considered: [],
    };
  }

  // Extract claims from the generated post
  const claims = extractClaims(postText, postTags);
  if (claims.length === 0) {
    return {
      pass: false,
      reason: "No claims extracted from post text",
      reasonCode: "NO_POST_MATCH",
      considered: candidates.map((c) => ({ sourceId: c.sourceId })),
    };
  }

  // Fetch all candidates in parallel (network I/O is the bottleneck)
  const fetchResults = await Promise.all(
    candidates.map(async (candidate) => {
      const adapter = getProviderAdapter(candidate.source.provider);
      if (!adapter || !adapter.supports(candidate.source)) {
        return { candidate, entries: [] as EvidenceEntry[] };
      }
      try {
        const result = await fetchSource(candidate.url, candidate.source, {
          rateLimitBucket: adapter.rateLimit.bucket,
          rateLimitRpm: adapter.rateLimit.maxPerMinute,
          rateLimitRpd: adapter.rateLimit.maxPerDay,
        });
        if (result.ok && result.response) {
          try {
            const parsed = adapter.parseResponse(candidate.source, result.response);
            return { candidate, entries: parsed.entries };
          } catch {
            return { candidate, entries: [] as EvidenceEntry[] };
          }
        }
      } catch {
        // fetch failed — fall through to metadata-only
      }
      return { candidate, entries: [] as EvidenceEntry[] };
    })
  );

  // Score each candidate with fetched evidence
  const scored: ScoredCandidate[] = [];
  const considered: MatchResult["considered"] = [];

  for (const { candidate, entries } of fetchResults) {
    try {
      const scoreResult = entries.length > 0
        ? scoreEvidence(claims, entries, candidate.source, postTags)
        : scoreMetadataOnly(claims, candidate.source, postTags);

      scored.push({
        sourceId: candidate.sourceId,
        source: candidate.source,
        method: candidate.method,
        url: candidate.url,
        ...scoreResult,
      });
      considered.push({ sourceId: candidate.sourceId, score: scoreResult.score });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      considered.push({ sourceId: candidate.sourceId, error: msg });
    }
  }

  if (scored.length === 0) {
    return {
      pass: false,
      reason: "All candidates failed to score",
      reasonCode: "MATCH_FETCH_FAILED",
      considered,
    };
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  if (best.score >= MATCH_THRESHOLD) {
    return {
      pass: true,
      reason: `Source "${best.source.name}" matches with score ${best.score}`,
      reasonCode: "PASS",
      best: {
        sourceId: best.sourceId,
        method: best.method,
        url: best.url,
        score: best.score,
        matchedClaims: best.matchedClaims,
        evidence: best.evidence,
      },
      considered,
    };
  }

  return {
    pass: false,
    reason: `Best source "${best.source.name}" scored ${best.score} (threshold: ${MATCH_THRESHOLD})`,
    reasonCode: "MATCH_THRESHOLD_NOT_MET",
    best: {
      sourceId: best.sourceId,
      method: best.method,
      url: best.url,
      score: best.score,
      matchedClaims: best.matchedClaims,
      evidence: best.evidence,
    },
    considered,
  };
}
