/**
 * Generic provider adapter — catch-all for sources that don't match any
 * specialized provider. Only handles quarantined sources as a safety net.
 *
 * This adapter does simple URL template filling and best-effort JSON parsing.
 * It does not understand any API-specific response format.
 *
 * IMPORTANT: supports() returns true ONLY for quarantined sources.
 * Active sources without a dedicated adapter should get one written,
 * not fall through to generic.
 */

import type { SourceRecordV2 } from "../sources/catalog.js";
import type {
  ProviderAdapter,
  BuildCandidatesContext,
  CandidateRequest,
  CandidateValidation,
  FetchedResponse,
  ParsedAdapterResponse,
  EvidenceEntry,
} from "../../lib/sources/providers/types.js";

/**
 * Fill template variables in a URL string.
 * Replaces `{varName}` with the corresponding value from vars.
 * Unknown variables are replaced with empty string.
 */
function fillTemplate(url: string, vars: Record<string, string>): string {
  return url.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = vars[key.trim()];
    return value != null ? encodeURIComponent(value) : "";
  });
}

/**
 * Find the first array value in an object (for best-effort data extraction).
 * Searches top-level keys only — no deep traversal.
 */
function findFirstArray(obj: Record<string, unknown>): unknown[] | null {
  for (const key of Object.keys(obj)) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  return null;
}

export const adapter: ProviderAdapter = {
  provider: "generic",
  domains: [],
  rateLimit: { bucket: "generic", maxPerMinute: 30 },

  supports(source: SourceRecordV2): boolean {
    // Only handle quarantined sources — everything else should have a real adapter
    return source.status === "quarantined";
  },

  buildCandidates(ctx: BuildCandidatesContext): CandidateRequest[] {
    const { source, tokens, vars, attestation, maxCandidates } = ctx;

    const url = fillTemplate(source.url, vars);

    // Skip if template filling left the URL with empty segments
    if (url.includes("//") && !url.startsWith("http")) {
      return [];
    }

    const candidates: CandidateRequest[] = [
      {
        sourceId: source.id,
        provider: "generic",
        operation: source.adapter?.operation ?? "fetch",
        method: "GET",
        url,
        attestation,
        estimatedSizeKb: source.max_response_kb ?? 10,
        matchHints: tokens.slice(0, 5),
      },
    ];

    return candidates.slice(0, maxCandidates);
  },

  validateCandidate(_candidate: CandidateRequest): CandidateValidation {
    // Generic adapter always validates — we don't know enough to reject
    return { ok: true };
  },

  parseResponse(_source: SourceRecordV2, response: FetchedResponse): ParsedAdapterResponse {
    const entries: EvidenceEntry[] = [];

    // Try JSON parse first
    try {
      const data = JSON.parse(response.bodyText);

      if (Array.isArray(data)) {
        // Top-level array — each element is an entry
        for (let i = 0; i < data.length; i++) {
          const item = data[i];
          entries.push({
            id: String(item?.id ?? item?.name ?? `item-${i}`),
            title: item?.title ?? item?.name ?? undefined,
            summary: item?.description ?? item?.summary ?? undefined,
            bodyText: typeof item === "string" ? item : JSON.stringify(item),
            topics: [],
            raw: item,
          });
        }
      } else if (typeof data === "object" && data !== null) {
        // Object — look for an array inside it
        const arr = findFirstArray(data as Record<string, unknown>);
        if (arr && arr.length > 0) {
          for (let i = 0; i < arr.length; i++) {
            const item = arr[i];
            const obj = typeof item === "object" && item !== null
              ? item as Record<string, unknown>
              : null;
            entries.push({
              id: String(obj?.id ?? obj?.name ?? `item-${i}`),
              title: obj?.title != null ? String(obj.title) : undefined,
              summary: obj?.description != null ? String(obj.description) : undefined,
              bodyText: typeof item === "string" ? item : JSON.stringify(item),
              topics: [],
              raw: item,
            });
          }
        } else {
          // Simple object — single entry
          entries.push({
            id: String((data as Record<string, unknown>).id ?? "result"),
            title: (data as Record<string, unknown>).title != null
              ? String((data as Record<string, unknown>).title)
              : undefined,
            bodyText: JSON.stringify(data),
            topics: [],
            raw: data,
          });
        }
      }

      return { entries, normalized: data };
    } catch {
      // Not JSON — return raw text as single entry
      if (response.bodyText.trim().length > 0) {
        entries.push({
          id: "raw-text",
          bodyText: response.bodyText,
          topics: [],
          raw: response.bodyText,
        });
      }
      return { entries };
    }
  },
};
