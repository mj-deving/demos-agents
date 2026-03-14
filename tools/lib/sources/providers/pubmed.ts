/**
 * PubMed/NCBI provider adapter — biomedical literature search and
 * summary retrieval via the Entrez E-utilities API.
 *
 * Endpoints:
 *   - esearch:  eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json
 *   - esummary: eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json
 *
 * TLSN rule: cap retmax to 3 for esearch (compact response).
 * DAHR rule: JSON endpoints OK (must enforce retmode=json).
 *
 * Rate limit: 3/sec without API key. We declare 10/min as a
 * conservative budget since adapters don't own throttling.
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

const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

/** Infer operation from URL when adapter.operation is not set. */
function inferOperation(url: string): "esearch" | "esummary" {
  if (url.includes("esummary")) return "esummary";
  return "esearch";
}

export const adapter: ProviderAdapter = {
  provider: "pubmed",
  domains: ["biotech", "medical", "pharma", "health"],
  rateLimit: { bucket: "pubmed", maxPerMinute: 10 },

  supports(source: SourceRecordV2): boolean {
    return source.provider === "pubmed";
  },

  buildCandidates(ctx: BuildCandidatesContext): CandidateRequest[] {
    const { source, topic, tokens, vars, attestation, maxCandidates } = ctx;
    const operation = source.adapter?.operation ?? inferOperation(source.url);
    const candidates: CandidateRequest[] = [];

    if (operation === "esearch") {
      const term = vars.query || vars.term || topic;
      const retmax = attestation === "TLSN" ? 3 : 20;
      const url =
        `${EUTILS_BASE}/esearch.fcgi?db=pubmed&retmode=json` +
        `&term=${encodeURIComponent(term)}&retmax=${retmax}`;
      candidates.push({
        sourceId: source.id,
        provider: "pubmed",
        operation: "esearch",
        method: "GET",
        url,
        attestation,
        estimatedSizeKb: attestation === "TLSN" ? 3 : 8,
        matchHints: tokens.slice(0, 5),
      });
    } else {
      // esummary — requires PMIDs
      const ids = vars.ids || vars.id || "";
      if (!ids) {
        // Cannot build esummary without IDs
        return [];
      }
      const url =
        `${EUTILS_BASE}/esummary.fcgi?db=pubmed&retmode=json` +
        `&id=${encodeURIComponent(ids)}`;
      candidates.push({
        sourceId: source.id,
        provider: "pubmed",
        operation: "esummary",
        method: "GET",
        url,
        attestation,
        estimatedSizeKb: 6,
        matchHints: ids.split(",").slice(0, 3),
      });
    }

    return candidates.slice(0, maxCandidates);
  },

  validateCandidate(candidate: CandidateRequest): CandidateValidation {
    try {
      const parsed = new URL(candidate.url);
      let rewritten = false;

      // Enforce retmode=json on all requests
      if (parsed.searchParams.get("retmode") !== "json") {
        parsed.searchParams.set("retmode", "json");
        rewritten = true;
      }

      // TLSN: cap retmax to 3 for esearch
      if (candidate.attestation === "TLSN" && candidate.operation === "esearch") {
        const retmax = parseInt(parsed.searchParams.get("retmax") || "20", 10);
        if (retmax > 3) {
          parsed.searchParams.set("retmax", "3");
          rewritten = true;
        }
      }

      if (rewritten) {
        return { ok: true, rewrittenUrl: parsed.toString() };
      }
    } catch {
      return { ok: false, reason: "Malformed PubMed URL" };
    }

    return { ok: true };
  },

  parseResponse(source: SourceRecordV2, response: FetchedResponse): ParsedAdapterResponse {
    const operation = source.adapter?.operation ?? inferOperation(response.url);
    const entries: EvidenceEntry[] = [];

    try {
      const data = JSON.parse(response.bodyText);

      if (operation === "esearch") {
        const result = data?.esearchresult;
        if (result && Array.isArray(result.idlist)) {
          for (const pmid of result.idlist) {
            entries.push({
              id: String(pmid),
              title: `PMID:${pmid}`,
              bodyText: `PubMed article ${pmid}`,
              canonicalUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
              topics: [],
              metrics: {
                count: result.count ?? 0,
                retmax: result.retmax ?? 0,
              },
              raw: pmid,
            });
          }
        }
      } else {
        // esummary — result is keyed by PMID (plus a "uids" array)
        const result = data?.result;
        if (result && typeof result === "object") {
          const uids: string[] = Array.isArray(result.uids) ? result.uids : Object.keys(result).filter((k) => k !== "uids");
          for (const uid of uids) {
            const article = result[uid];
            if (!article || typeof article !== "object") continue;

            const authors = Array.isArray(article.authors)
              ? article.authors.map((a: { name?: string }) => a.name || "").filter(Boolean)
              : [];

            entries.push({
              id: String(uid),
              title: article.title ?? undefined,
              summary: article.sorttitle ?? undefined,
              bodyText: [
                article.title ?? "",
                article.source ?? "",
                authors.join(", "),
              ]
                .filter(Boolean)
                .join(" | "),
              canonicalUrl: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
              publishedAt: article.pubdate ?? article.sortpubdate ?? undefined,
              topics: [],
              metrics: {
                pmcrefcount: article.pmcrefcount ?? 0,
                source: article.source ?? "",
              },
              raw: article,
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
