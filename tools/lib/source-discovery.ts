/**
 * Dynamic source discovery — finds attestable sources for topics on demand.
 *
 * When a topic has no matching source in the static registry, this module
 * generates candidate URLs from known API patterns, fetches them, and
 * validates that the response actually contains content relevant to the topic.
 *
 * Key principle: sources must MATCH the content, not just be keyword-similar.
 * A "derivatives" topic needs a source that contains actual derivatives data,
 * not a general search that might return unrelated results.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { info } from "./sdk.js";
import type { SourceRecord, AttestationType } from "./attestation-policy.js";

// ── Content relevance scoring ─────────────────────────────

interface ContentRelevanceResult {
  score: number;          // 0-100: how well the source content matches the topic
  matchedTerms: string[]; // which topic terms appeared in the content
  totalTerms: number;     // total topic terms checked
  dataEntries: number;    // number of data entries/articles in the response
  reason: string;         // human-readable explanation
}

/**
 * Score how well a fetched response body matches a topic.
 * Returns 0-100. Threshold for "matches content" is 40+.
 *
 * Checks:
 * - Topic keyword presence in response body (weighted by specificity)
 * - Data density: actual entries/articles exist (not an empty or error response)
 * - Content type: valid JSON/XML with structured data
 */
function scoreContentRelevance(
  topic: string,
  responseBody: string,
  responseOk: boolean
): ContentRelevanceResult {
  if (!responseOk || !responseBody || responseBody.length < 50) {
    return { score: 0, matchedTerms: [], totalTerms: 0, dataEntries: 0, reason: "empty or error response" };
  }

  const bodyLower = responseBody.toLowerCase();

  // Tokenize topic into meaningful terms (skip very short/generic words)
  const topicTokens = topic
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);

  // Also keep compound terms (e.g., "trade-sanctions" → "trade sanctions")
  const compoundTerms = topic
    .toLowerCase()
    .split(/\s*,\s*|\s+and\s+|\s+or\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && t.includes("-"))
    .map((t) => t.replace(/-/g, " "));

  const allTerms = [...new Set([...topicTokens, ...compoundTerms])];
  const matchedTerms: string[] = [];

  for (const term of allTerms) {
    if (bodyLower.includes(term)) {
      matchedTerms.push(term);
    }
  }

  // Term match ratio (0-50 points)
  const termRatio = allTerms.length > 0 ? matchedTerms.length / allTerms.length : 0;
  const termScore = Math.round(termRatio * 50);

  // Data density: count meaningful entries in the response (0-30 points)
  let dataEntries = 0;
  try {
    const parsed = JSON.parse(responseBody);
    if (Array.isArray(parsed)) {
      dataEntries = parsed.length;
    } else if (parsed?.hits) {
      dataEntries = Array.isArray(parsed.hits) ? parsed.hits.length : 0;
    } else if (parsed?.items) {
      dataEntries = Array.isArray(parsed.items) ? parsed.items.length : 0;
    } else if (parsed?.results) {
      dataEntries = Array.isArray(parsed.results) ? parsed.results.length : 0;
    } else if (parsed?.data && Array.isArray(parsed.data)) {
      dataEntries = parsed.data.length;
    } else if (typeof parsed === "object" && parsed !== null) {
      // Nested: check for common patterns
      const keys = Object.keys(parsed);
      for (const key of keys) {
        if (Array.isArray(parsed[key]) && parsed[key].length > 0) {
          dataEntries = Math.max(dataEntries, parsed[key].length);
        }
      }
      if (dataEntries === 0) dataEntries = 1; // at least it's a valid object
    }
  } catch {
    // Not JSON — try counting XML entries or lines with content
    const entryPatterns = [/<item>/gi, /<entry>/gi, /<article>/gi, /<result>/gi];
    for (const pattern of entryPatterns) {
      const matches = responseBody.match(pattern);
      if (matches) {
        dataEntries = Math.max(dataEntries, matches.length);
        break;
      }
    }
  }
  const densityScore = dataEntries >= 3 ? 30 : dataEntries >= 1 ? 20 : 0;

  // Response size sanity (0-10 points): too small = likely error, too large = TLSN risk
  const sizeKb = responseBody.length / 1024;
  const sizeScore = sizeKb >= 0.5 && sizeKb <= 16 ? 10 : sizeKb > 16 ? 5 : 0;

  // Title/headline content match bonus (0-10 points)
  // Check if topic terms appear in titles/headlines (stronger signal than body text)
  let titleBonus = 0;
  try {
    const parsed = JSON.parse(responseBody);
    const titles: string[] = [];
    const extractTitles = (obj: any) => {
      if (Array.isArray(obj)) {
        for (const item of obj) extractTitles(item);
      } else if (typeof obj === "object" && obj !== null) {
        for (const key of ["title", "name", "headline", "story_title"]) {
          if (typeof obj[key] === "string") titles.push(obj[key].toLowerCase());
        }
        if (obj.hits) extractTitles(obj.hits);
        if (obj.items) extractTitles(obj.items);
        if (obj.results) extractTitles(obj.results);
      }
    };
    extractTitles(parsed);

    if (titles.length > 0) {
      const titleText = titles.join(" ");
      const titleMatches = topicTokens.filter((t) => titleText.includes(t));
      titleBonus = titleMatches.length > 0 ? Math.min(10, titleMatches.length * 5) : 0;
    }
  } catch { /* not JSON, skip */ }

  const totalScore = Math.min(100, termScore + densityScore + sizeScore + titleBonus);

  const reason = `${matchedTerms.length}/${allTerms.length} terms matched, ${dataEntries} entries, ${sizeKb.toFixed(1)}KB`;
  return { score: totalScore, matchedTerms, totalTerms: allTerms.length, dataEntries, reason };
}

// ── URL candidate generators ──────────────────────────────

interface CandidateSource {
  name: string;
  url: string;
  tlsn_safe: boolean;
  dahr_safe: boolean;
  max_response_kb: number;
  provider: string;   // which API pattern generated this
}

/**
 * Generate candidate source URLs for a topic from known API patterns.
 * Each candidate is TLSN-safe (hitsPerPage=2, small responses) unless noted.
 */
function generateCandidateUrls(topic: string): CandidateSource[] {
  const tokens = topic
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);

  const queryString = tokens.join("+");
  const slugName = tokens.slice(0, 3).join("-");
  const candidates: CandidateSource[] = [];

  // HN Algolia — most versatile, works for almost any topic
  candidates.push({
    name: `hn-${slugName}`,
    url: `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(tokens.join(" "))}&tags=story&hitsPerPage=2`,
    tlsn_safe: true,
    dahr_safe: true,
    max_response_kb: 4,
    provider: "hn-algolia",
  });

  // HN with broader search (more results for DAHR-only)
  candidates.push({
    name: `hn-${slugName}-broad`,
    url: `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(tokens.join(" "))}&tags=story&hitsPerPage=5`,
    tlsn_safe: false,
    dahr_safe: true,
    max_response_kb: 10,
    provider: "hn-algolia-broad",
  });

  // GitHub search — good for tech topics
  if (tokens.some((t) => ["ai", "ml", "crypto", "blockchain", "quantum", "rust", "python", "javascript", "typescript", "framework", "library", "protocol", "defi", "nft", "web3", "api", "sdk"].includes(t))) {
    candidates.push({
      name: `github-${slugName}`,
      url: `https://api.github.com/search/repositories?q=${encodeURIComponent(tokens.join("+"))}&sort=stars&order=desc&per_page=3`,
      tlsn_safe: false,
      dahr_safe: true,
      max_response_kb: 20,
      provider: "github",
    });
  }

  // CoinGecko — good for crypto topics
  if (tokens.some((t) => ["crypto", "bitcoin", "ethereum", "solana", "defi", "token", "coin", "nft", "staking", "yield"].includes(t))) {
    candidates.push({
      name: `coingecko-${slugName}`,
      url: "https://api.coingecko.com/api/v3/search/trending",
      tlsn_safe: true,
      dahr_safe: true,
      max_response_kb: 8,
      provider: "coingecko",
    });
  }

  return candidates;
}

// ── Discovery orchestrator ────────────────────────────────

export interface DiscoveredSource {
  source: SourceRecord;
  url: string;
  relevanceScore: number;
  reason: string;
}

const CONTENT_RELEVANCE_THRESHOLD = 40;

/**
 * Discover a source for a topic by generating candidates, fetching them,
 * and validating content relevance. Only returns sources where the content
 * actually matches the topic (score >= 40).
 *
 * @param topic - The topic to find a source for
 * @param method - Required attestation type (TLSN or DAHR)
 * @param timeoutMs - Per-fetch timeout (default 8s)
 * @returns The best matching source, or null if none found
 */
export async function discoverSourceForTopic(
  topic: string,
  method: AttestationType,
  timeoutMs: number = 8000
): Promise<DiscoveredSource | null> {
  const candidates = generateCandidateUrls(topic);

  // Filter by attestation compatibility
  const compatible = candidates.filter((c) =>
    method === "TLSN" ? c.tlsn_safe : c.dahr_safe
  );

  if (compatible.length === 0) {
    info(`source-discovery: no compatible candidates for "${topic}" (${method})`);
    return null;
  }

  info(`source-discovery: testing ${compatible.length} candidates for "${topic}" (${method})`);

  // Fetch and score each candidate (sequentially to avoid rate limiting)
  const scored: Array<{ candidate: CandidateSource; relevance: ContentRelevanceResult }> = [];

  for (const candidate of compatible) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await fetch(candidate.url, {
        signal: controller.signal,
        headers: { "Accept": "application/json", "User-Agent": "demos-agent/1.0" },
      });
      clearTimeout(timer);

      const body = await resp.text();
      const relevance = scoreContentRelevance(topic, body, resp.ok);

      info(`source-discovery: ${candidate.name} → score=${relevance.score} (${relevance.reason})`);

      if (relevance.score >= CONTENT_RELEVANCE_THRESHOLD) {
        scored.push({ candidate, relevance });
      }
    } catch (err: any) {
      info(`source-discovery: ${candidate.name} fetch failed (${err?.message || err})`);
    }
  }

  if (scored.length === 0) {
    info(`source-discovery: no candidates passed content relevance threshold (${CONTENT_RELEVANCE_THRESHOLD}) for "${topic}"`);
    return null;
  }

  // Pick the best scoring source
  scored.sort((a, b) => b.relevance.score - a.relevance.score);
  const best = scored[0];

  const topicTokens = topic.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);

  const sourceRecord: SourceRecord = {
    name: best.candidate.name,
    url: best.candidate.url,
    topics: [topic, ...topicTokens.filter((t) => t !== topic.toLowerCase())],
    tlsn_safe: best.candidate.tlsn_safe,
    dahr_safe: best.candidate.dahr_safe,
    max_response_kb: best.candidate.max_response_kb,
    note: `Auto-discovered. Provider: ${best.candidate.provider}. Relevance: ${best.relevance.score}/100.`,
  };

  return {
    source: sourceRecord,
    url: best.candidate.url,
    relevanceScore: best.relevance.score,
    reason: best.relevance.reason,
  };
}

// ── Registry persistence ──────────────────────────────────

/**
 * Append a discovered source to the YAML registry file so it persists
 * for future sessions. Deduplicates by name.
 */
export function persistSourceToRegistry(registryPath: string, source: SourceRecord): boolean {
  try {
    let parsed: any = { version: 1, sources: [] };
    if (existsSync(registryPath)) {
      parsed = parseYaml(readFileSync(registryPath, "utf-8")) || { version: 1, sources: [] };
    }

    const sources: SourceRecord[] = Array.isArray(parsed.sources) ? parsed.sources : [];

    // Deduplicate by name
    if (sources.some((s) => s.name === source.name)) {
      return false; // already exists
    }

    sources.push(source);
    parsed.sources = sources;

    // Write back with a separator comment
    const yaml = stringifyYaml(parsed, { lineWidth: 120 });
    writeFileSync(registryPath, yaml, "utf-8");
    info(`source-discovery: persisted "${source.name}" to registry`);
    return true;
  } catch (err: any) {
    info(`source-discovery: failed to persist source (${err?.message || err})`);
    return false;
  }
}
