/**
 * arXiv provider adapter — academic paper search via Atom XML API.
 *
 * Endpoint:
 *   - search: export.arxiv.org/api/query?search_query=X
 *
 * Rate limits: 3/sec (conservative — arXiv asks for politeness).
 *
 * TLSN constraint: force max_results <= 3, MUST use https://.
 * DAHR constraint: NO DAHR support in Phase 4. arXiv returns Atom XML,
 * which the attestation pipeline rejects (JSON-only for DAHR).
 *
 * parseResponse uses regex to extract entries from Atom XML since we
 * don't want a full XML parser dependency for a single provider.
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

const BASE_URL = "https://export.arxiv.org/api/query";

/** Max results for TLSN to stay under 16KB */
const TLSN_MAX_RESULTS = 3;
/** Default max_results for non-TLSN (not used in Phase 4 since DAHR is blocked) */
const DEFAULT_MAX_RESULTS = 10;

/**
 * Build a search URL for the arXiv API.
 * Always uses https:// per TLSN requirement.
 */
function buildSearchUrl(query: string, maxResults: number): string {
  return `${BASE_URL}?search_query=${encodeURIComponent(query)}&max_results=${maxResults}&sortBy=submittedDate&sortOrder=descending`;
}

/**
 * Extract max_results from a URL query parameter.
 */
function extractMaxResults(url: string): number | undefined {
  try {
    const parsed = new URL(url);
    const val = parsed.searchParams.get("max_results");
    if (val !== null && /^\d+$/.test(val)) return Number(val);
  } catch {
    // malformed URL
  }
  return undefined;
}

/**
 * Extract text content between XML tags using regex.
 * Returns empty string if tag not found.
 */
function xmlText(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? match[1].trim() : "";
}

/**
 * Extract all values of a self-closing tag attribute.
 * Used for <category term="cs.AI"/> patterns.
 */
function xmlAttributes(xml: string, tag: string, attr: string): string[] {
  const results: string[] = [];
  const regex = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"[^>]*/?>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1]);
  }
  return results;
}

/**
 * Parse a single <entry> block from Atom XML into an EvidenceEntry.
 */
function parseEntry(entryXml: string): EvidenceEntry | null {
  const id = xmlText(entryXml, "id");
  if (!id) return null;

  const title = xmlText(entryXml, "title").replace(/\s+/g, " ");
  const summary = xmlText(entryXml, "summary").replace(/\s+/g, " ");
  const published = xmlText(entryXml, "published");
  const categories = xmlAttributes(entryXml, "category", "term");

  // The <id> tag contains the canonical arXiv URL (e.g., http://arxiv.org/abs/2301.12345v1)
  const canonicalUrl = id.startsWith("http") ? id : `https://arxiv.org/abs/${id}`;

  // Extract authors: <author><name>...</name></author>
  const authorNames: string[] = [];
  const authorRegex = /<author>\s*<name>([^<]*)<\/name>/gi;
  let authorMatch: RegExpExecArray | null;
  while ((authorMatch = authorRegex.exec(entryXml)) !== null) {
    authorNames.push(authorMatch[1].trim());
  }

  return {
    id: id.replace(/^https?:\/\/arxiv\.org\/abs\//, ""),
    title: title || undefined,
    summary: summary ? summary.slice(0, 500) : undefined,
    bodyText: summary || title || "(no content)",
    canonicalUrl,
    publishedAt: published || undefined,
    topics: categories.length > 0 ? categories : ["arxiv"],
    metrics: {
      authors: authorNames.length,
      ...(authorNames.length > 0 ? { first_author: authorNames[0] } : {}),
    },
    raw: entryXml,
  };
}

export const adapter: ProviderAdapter = {
  provider: "arxiv",
  domains: ["science", "ai", "quantum", "physics", "math"],
  rateLimit: { bucket: "arxiv", maxPerMinute: 180 },

  supports(source: SourceRecordV2): boolean {
    return (
      source.provider === "arxiv" ||
      source.url.toLowerCase().includes("arxiv.org")
    );
  },

  buildCandidates(ctx: BuildCandidatesContext): CandidateRequest[] {
    // DAHR is NOT supported for arXiv in Phase 4 (XML response, pipeline rejects XML)
    if (ctx.attestation === "DAHR") {
      return [];
    }

    const query = ctx.vars.query || ctx.topic;
    const maxResults = ctx.attestation === "TLSN" ? TLSN_MAX_RESULTS : DEFAULT_MAX_RESULTS;
    const url = buildSearchUrl(query, maxResults);

    return [
      {
        sourceId: ctx.source.id,
        provider: "arxiv",
        operation: "search",
        method: "GET" as const,
        url,
        attestation: ctx.attestation,
        estimatedSizeKb: maxResults * 3,
        matchHints: ctx.tokens.slice(0, 5),
      },
    ].slice(0, ctx.maxCandidates);
  },

  validateCandidate(candidate: CandidateRequest): CandidateValidation {
    // Reject DAHR entirely
    if (candidate.attestation === "DAHR") {
      return {
        ok: false,
        reason: "arXiv returns Atom XML — DAHR attestation pipeline rejects non-JSON responses",
      };
    }

    // Ensure https://
    if (!candidate.url.startsWith("https://")) {
      const httpsUrl = candidate.url.replace(/^http:\/\//, "https://");
      return {
        ok: true,
        reason: "Rewritten to HTTPS (required for TLSN)",
        rewrittenUrl: httpsUrl,
      };
    }

    // Enforce max_results for TLSN
    if (candidate.attestation === "TLSN") {
      const maxResults = extractMaxResults(candidate.url);
      if (maxResults !== undefined && maxResults > TLSN_MAX_RESULTS) {
        try {
          const parsed = new URL(candidate.url);
          parsed.searchParams.set("max_results", String(TLSN_MAX_RESULTS));
          return {
            ok: true,
            reason: `max_results ${maxResults} exceeds TLSN limit ${TLSN_MAX_RESULTS} — rewritten`,
            rewrittenUrl: parsed.toString(),
          };
        } catch {
          return { ok: false, reason: "Malformed arXiv URL" };
        }
      }
    }

    return { ok: true };
  },

  parseResponse(source: SourceRecordV2, response: FetchedResponse): ParsedAdapterResponse {
    if (response.status !== 200) {
      return { entries: [] };
    }

    const xml = response.bodyText;
    if (!xml || !xml.includes("<entry>")) {
      return { entries: [] };
    }

    // Split XML into <entry>...</entry> blocks
    const entryBlocks: string[] = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
    let match: RegExpExecArray | null;
    while ((match = entryRegex.exec(xml)) !== null) {
      entryBlocks.push(match[1]);
    }

    const entries: EvidenceEntry[] = [];
    for (const block of entryBlocks) {
      const entry = parseEntry(block);
      if (entry) entries.push(entry);
    }

    // No normalized field — arXiv is TLSN-only, no DAHR normalization needed
    return { entries };
  },
};
