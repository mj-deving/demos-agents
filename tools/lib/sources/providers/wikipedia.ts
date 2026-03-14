/**
 * Wikipedia provider adapter — summary and search operations against
 * the MediaWiki REST API and Action API.
 *
 * Endpoints:
 *   - summary: en.wikipedia.org/api/rest_v1/page/summary/{TITLE}
 *   - search:  en.wikipedia.org/w/api.php?action=query&list=search&format=json
 *
 * TLSN rule: srlimit<=2 for search (keeps response under 16KB).
 * DAHR rule: JSON endpoints OK for both operations.
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

/** Infer operation from a URL when adapter.operation is not set. */
function inferOperation(url: string): "summary" | "search" {
  if (url.includes("/api/rest_v1/page/summary")) return "summary";
  if (url.includes("api.php") && url.includes("list=search")) return "search";
  // Default to search — broader utility
  return "search";
}

/** Encode a topic string as a Wikipedia-safe title slug. */
function toWikiTitle(topic: string): string {
  return topic
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_\-().]/g, "");
}

export const adapter: ProviderAdapter = {
  provider: "wikipedia",
  domains: ["general", "knowledge", "encyclopedia", "history"],
  rateLimit: { bucket: "wikipedia", maxPerMinute: 200 },

  supports(source: SourceRecordV2): boolean {
    return source.provider === "wikipedia";
  },

  buildCandidates(ctx: BuildCandidatesContext): CandidateRequest[] {
    const { source, topic, tokens, vars, attestation, maxCandidates } = ctx;
    const operation = source.adapter?.operation ?? inferOperation(source.url);
    const candidates: CandidateRequest[] = [];
    const query = vars.query || topic;

    if (operation === "summary") {
      const title = vars.title || toWikiTitle(query);
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      candidates.push({
        sourceId: source.id,
        provider: "wikipedia",
        operation: "summary",
        method: "GET",
        url,
        attestation,
        estimatedSizeKb: 4,
        matchHints: tokens.slice(0, 5),
      });
    } else {
      // search operation
      const srlimit = attestation === "TLSN" ? 2 : 5;
      const url =
        `https://en.wikipedia.org/w/api.php?action=query&list=search` +
        `&srsearch=${encodeURIComponent(query)}&srlimit=${srlimit}&format=json`;
      candidates.push({
        sourceId: source.id,
        provider: "wikipedia",
        operation: "search",
        method: "GET",
        url,
        attestation,
        estimatedSizeKb: attestation === "TLSN" ? 8 : 14,
        matchHints: tokens.slice(0, 5),
      });
    }

    return candidates.slice(0, maxCandidates);
  },

  validateCandidate(candidate: CandidateRequest): CandidateValidation {
    if (candidate.attestation === "TLSN" && candidate.operation === "search") {
      try {
        const parsed = new URL(candidate.url);
        const srlimit = parseInt(parsed.searchParams.get("srlimit") || "10", 10);
        if (srlimit > 2) {
          parsed.searchParams.set("srlimit", "2");
          return { ok: true, rewrittenUrl: parsed.toString() };
        }
      } catch {
        return { ok: false, reason: "Malformed search URL" };
      }
    }
    return { ok: true };
  },

  parseResponse(source: SourceRecordV2, response: FetchedResponse): ParsedAdapterResponse {
    const operation = source.adapter?.operation ?? inferOperation(response.url);
    const entries: EvidenceEntry[] = [];

    try {
      const data = JSON.parse(response.bodyText);

      if (operation === "summary") {
        if (data && typeof data.title === "string") {
          entries.push({
            id: String(data.pageid ?? data.title),
            title: data.title,
            summary: data.description ?? undefined,
            bodyText: data.extract ?? data.extract_html ?? "",
            canonicalUrl: data.content_urls?.desktop?.page ?? undefined,
            topics: (data.categories ?? []).map((c: unknown) => String(c)),
            metrics: data.coordinates
              ? { lat: data.coordinates.lat, lon: data.coordinates.lon }
              : undefined,
            raw: data,
          });
        }
      } else {
        // search — entries live in query.search[]
        const results = data?.query?.search;
        if (Array.isArray(results)) {
          for (const item of results) {
            entries.push({
              id: String(item.pageid ?? item.title ?? ""),
              title: item.title ?? undefined,
              summary: item.snippet ? item.snippet.replace(/<[^>]*>/g, "") : undefined,
              bodyText: item.snippet ? item.snippet.replace(/<[^>]*>/g, "") : "",
              canonicalUrl: item.title
                ? `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/\s/g, "_"))}`
                : undefined,
              publishedAt: item.timestamp ?? undefined,
              topics: [],
              metrics: item.wordcount != null ? { wordcount: item.wordcount } : undefined,
              raw: item,
            });
          }
        }
      }
    } catch {
      // Malformed JSON — return empty
    }

    return { entries, normalized: entries.length > 0 ? JSON.parse(response.bodyText) : undefined };
  },
};
