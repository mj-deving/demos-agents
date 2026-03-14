/**
 * HN Algolia provider adapter — Hacker News search via Algolia API.
 *
 * Endpoints:
 *   - search: hn.algolia.com/api/v1/search?query=X
 *   - search_by_date: hn.algolia.com/api/v1/search_by_date?query=X
 *   - front_page: hn.algolia.com/api/v1/search?tags=front_page
 *
 * TLSN constraint: hitsPerPage MUST be <= 2 (responses with 5+ hits exceed
 * the 16KB WASM prover limit and crash). Enforced in both buildCandidates
 * and validateCandidate.
 */

import type { SourceRecordV2 } from "../catalog.js";
import type {
  ProviderAdapter,
  BuildCandidatesContext,
  CandidateRequest,
  CandidateValidation,
  FetchedResponse,
  ParsedAdapterResponse,
  EvidenceEntry,
} from "./types.js";

const BASE_URL = "https://hn.algolia.com/api/v1";

/** Max hitsPerPage for TLSN — 16KB prover limit */
const TLSN_MAX_HITS = 2;
/** Default hitsPerPage for DAHR */
const DAHR_DEFAULT_HITS = 5;

type HnOperation = "search" | "search_by_date" | "front_page";

const VALID_OPERATIONS: HnOperation[] = ["search", "search_by_date", "front_page"];

/**
 * Infer operation from a source record's URL or adapter config.
 */
function inferOperation(source: SourceRecordV2): HnOperation {
  const op = source.adapter?.operation;
  if (op && VALID_OPERATIONS.includes(op as HnOperation)) {
    return op as HnOperation;
  }
  const url = source.url.toLowerCase();
  if (url.includes("search_by_date")) return "search_by_date";
  if (url.includes("tags=front_page")) return "front_page";
  return "search";
}

/**
 * Build the search URL for a given operation, query, and hits limit.
 */
function buildUrl(operation: HnOperation, query: string, hitsPerPage: number): string {
  switch (operation) {
    case "search":
      return `${BASE_URL}/search?query=${encodeURIComponent(query)}&hitsPerPage=${hitsPerPage}`;
    case "search_by_date":
      return `${BASE_URL}/search_by_date?query=${encodeURIComponent(query)}&hitsPerPage=${hitsPerPage}`;
    case "front_page":
      return `${BASE_URL}/search?tags=front_page&hitsPerPage=${hitsPerPage}`;
  }
}

/**
 * Extract hitsPerPage from a URL's query parameters.
 * Returns undefined if not present.
 */
function extractHitsPerPage(url: string): number | undefined {
  try {
    const parsed = new URL(url);
    const val = parsed.searchParams.get("hitsPerPage");
    if (val !== null && /^\d+$/.test(val)) return Number(val);
  } catch {
    // malformed URL
  }
  return undefined;
}

/**
 * Force hitsPerPage to the given max in a URL.
 */
function enforceHitsPerPage(url: string, max: number): string {
  try {
    const parsed = new URL(url);
    const current = parsed.searchParams.get("hitsPerPage");
    if (current !== null && Number(current) > max) {
      parsed.searchParams.set("hitsPerPage", String(max));
      return parsed.toString();
    }
    if (current === null) {
      parsed.searchParams.set("hitsPerPage", String(max));
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

/**
 * Parse a single HN hit into an EvidenceEntry.
 */
function parseHit(hit: Record<string, unknown>): EvidenceEntry | null {
  const objectID = String(hit.objectID ?? "");
  if (!objectID) return null;

  const title = String(hit.title ?? "");
  const storyText = hit.story_text != null ? String(hit.story_text) : "";
  const hitUrl = hit.url != null ? String(hit.url) : undefined;
  const author = hit.author != null ? String(hit.author) : undefined;
  const createdAt = hit.created_at != null ? String(hit.created_at) : undefined;
  const points = typeof hit.points === "number" ? hit.points : 0;
  const numComments = typeof hit.num_comments === "number" ? hit.num_comments : 0;

  // Tags may be string[] — extract as topics
  const rawTags = Array.isArray(hit._tags) ? hit._tags : [];
  const topics = rawTags.filter((t: unknown) => typeof t === "string") as string[];

  return {
    id: objectID,
    title: title || undefined,
    bodyText: storyText || title || "(no content)",
    canonicalUrl: hitUrl,
    publishedAt: createdAt,
    topics,
    metrics: { points, num_comments: numComments, ...(author ? { author } : {}) },
    raw: hit,
  };
}

export const adapter: ProviderAdapter = {
  provider: "hn-algolia",
  domains: ["tech", "startup", "ai", "programming"],
  rateLimit: { bucket: "hn-algolia", maxPerDay: 10000 },

  supports(source: SourceRecordV2): boolean {
    return (
      source.provider === "hn-algolia" ||
      source.url.toLowerCase().includes("hn.algolia.com")
    );
  },

  buildCandidates(ctx: BuildCandidatesContext): CandidateRequest[] {
    const operation = inferOperation(ctx.source);
    const query = ctx.vars.query || ctx.topic;
    const hitsPerPage = ctx.attestation === "TLSN" ? TLSN_MAX_HITS : DAHR_DEFAULT_HITS;

    const url = buildUrl(operation, query, hitsPerPage);

    const candidates: CandidateRequest[] = [
      {
        sourceId: ctx.source.id,
        provider: "hn-algolia",
        operation,
        method: "GET" as const,
        url,
        attestation: ctx.attestation,
        estimatedSizeKb: ctx.attestation === "TLSN" ? 8 : 14,
        matchHints: ctx.tokens.slice(0, 5),
      },
    ];

    return candidates.slice(0, ctx.maxCandidates);
  },

  validateCandidate(candidate: CandidateRequest): CandidateValidation {
    const hits = extractHitsPerPage(candidate.url);

    if (candidate.attestation === "TLSN") {
      if (hits !== undefined && hits > TLSN_MAX_HITS) {
        return {
          ok: true,
          reason: `hitsPerPage ${hits} exceeds TLSN limit ${TLSN_MAX_HITS} — rewritten`,
          rewrittenUrl: enforceHitsPerPage(candidate.url, TLSN_MAX_HITS),
        };
      }
      if (hits === undefined) {
        return {
          ok: true,
          reason: `hitsPerPage not set — enforcing TLSN limit ${TLSN_MAX_HITS}`,
          rewrittenUrl: enforceHitsPerPage(candidate.url, TLSN_MAX_HITS),
        };
      }
    }

    return { ok: true };
  },

  parseResponse(source: SourceRecordV2, response: FetchedResponse): ParsedAdapterResponse {
    if (response.status !== 200) {
      return { entries: [], normalized: null };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(response.bodyText);
    } catch {
      return { entries: [], normalized: null };
    }

    const hits = Array.isArray(parsed.hits) ? parsed.hits : [];
    const entries: EvidenceEntry[] = [];

    for (const hit of hits) {
      if (typeof hit !== "object" || hit === null) continue;
      const entry = parseHit(hit as Record<string, unknown>);
      if (entry) entries.push(entry);
    }

    return { entries, normalized: parsed };
  },
};
