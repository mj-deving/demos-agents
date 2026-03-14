/**
 * World Bank provider adapter — indicator and country data from the
 * World Bank Open Data API v2.
 *
 * Endpoints:
 *   - indicator: api.worldbank.org/v2/country/{CC}/indicator/{ID}?format=json
 *   - country:   api.worldbank.org/v2/country/{CC}?format=json
 *
 * Response shape: World Bank returns a `[meta, data[]]` tuple.
 * The first element is pagination metadata, the second is the data array.
 *
 * TLSN rule: small per_page, prefer mrv=1 to keep responses compact.
 * DAHR rule: JSON endpoints OK (must enforce format=json).
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

/** Common World Bank indicator codes mapped from human-readable names. */
const INDICATOR_MAP: Record<string, string> = {
  gdp: "NY.GDP.MKTP.CD",
  "gdp-per-capita": "NY.GDP.PCAP.CD",
  "gdp-growth": "NY.GDP.MKTP.KD.ZG",
  population: "SP.POP.TOTL",
  inflation: "FP.CPI.TOTL.ZG",
  poverty: "SI.POV.DDAY",
  unemployment: "SL.UEM.TOTL.ZS",
  "life-expectancy": "SP.DYN.LE00.IN",
  "co2-emissions": "EN.ATM.CO2E.PC",
  gini: "SI.POV.GINI",
};

/** Infer operation from URL when adapter.operation is not set. */
function inferOperation(url: string): "indicator" | "country" {
  if (url.includes("/indicator/")) return "indicator";
  return "country";
}

export const adapter: ProviderAdapter = {
  provider: "worldbank",
  domains: ["economics", "development", "gdp", "poverty"],
  rateLimit: { bucket: "worldbank", maxPerMinute: 60 },

  supports(source: SourceRecordV2): boolean {
    return source.provider === "worldbank";
  },

  buildCandidates(ctx: BuildCandidatesContext): CandidateRequest[] {
    const { source, topic, tokens, vars, attestation, maxCandidates } = ctx;
    const operation = source.adapter?.operation ?? inferOperation(source.url);
    const candidates: CandidateRequest[] = [];

    const country = (vars.country || "WLD").toUpperCase();
    const perPage = attestation === "TLSN" ? 5 : 50;

    if (operation === "indicator") {
      // Resolve indicator code from vars or topic tokens
      const rawIndicator = vars.indicator || vars.query || topic;
      const indicatorCode =
        INDICATOR_MAP[rawIndicator.toLowerCase()] || rawIndicator;

      const url =
        `https://api.worldbank.org/v2/country/${encodeURIComponent(country)}` +
        `/indicator/${encodeURIComponent(indicatorCode)}?format=json` +
        `&per_page=${perPage}&mrv=1`;
      candidates.push({
        sourceId: source.id,
        provider: "worldbank",
        operation: "indicator",
        method: "GET",
        url,
        attestation,
        estimatedSizeKb: attestation === "TLSN" ? 4 : 10,
        matchHints: [country.toLowerCase(), indicatorCode, ...tokens.slice(0, 3)],
      });
    } else {
      // country operation
      const url =
        `https://api.worldbank.org/v2/country/${encodeURIComponent(country)}?format=json` +
        `&per_page=${perPage}`;
      candidates.push({
        sourceId: source.id,
        provider: "worldbank",
        operation: "country",
        method: "GET",
        url,
        attestation,
        estimatedSizeKb: attestation === "TLSN" ? 3 : 8,
        matchHints: [country.toLowerCase(), ...tokens.slice(0, 4)],
      });
    }

    return candidates.slice(0, maxCandidates);
  },

  validateCandidate(candidate: CandidateRequest): CandidateValidation {
    try {
      const parsed = new URL(candidate.url);

      // Enforce format=json
      if (parsed.searchParams.get("format") !== "json") {
        parsed.searchParams.set("format", "json");
        return { ok: true, rewrittenUrl: parsed.toString() };
      }

      // TLSN: cap per_page and enforce mrv=1
      if (candidate.attestation === "TLSN") {
        let rewritten = false;
        const perPage = parseInt(parsed.searchParams.get("per_page") || "50", 10);
        if (perPage > 5) {
          parsed.searchParams.set("per_page", "5");
          rewritten = true;
        }
        if (candidate.operation === "indicator" && !parsed.searchParams.has("mrv")) {
          parsed.searchParams.set("mrv", "1");
          rewritten = true;
        }
        if (rewritten) {
          return { ok: true, rewrittenUrl: parsed.toString() };
        }
      }
    } catch {
      return { ok: false, reason: "Malformed World Bank URL" };
    }

    return { ok: true };
  },

  parseResponse(source: SourceRecordV2, response: FetchedResponse): ParsedAdapterResponse {
    const operation = source.adapter?.operation ?? inferOperation(response.url);
    const entries: EvidenceEntry[] = [];

    try {
      const parsed = JSON.parse(response.bodyText);

      // World Bank returns [meta, data[]] — data is always index 1
      if (!Array.isArray(parsed) || parsed.length < 2) {
        return { entries };
      }

      const dataArray = parsed[1];
      if (!Array.isArray(dataArray)) {
        return { entries };
      }

      if (operation === "indicator") {
        for (const item of dataArray) {
          if (!item) continue;
          const countryName = item.country?.value ?? item.countryiso3code ?? "";
          const indicatorName = item.indicator?.value ?? "";
          const value = item.value;
          const date = item.date ?? "";

          entries.push({
            id: `${item.countryiso3code ?? "UNK"}-${item.indicator?.id ?? "UNK"}-${date}`,
            title: `${countryName}: ${indicatorName} (${date})`,
            summary: value != null ? `${indicatorName}: ${value}` : `${indicatorName}: N/A`,
            bodyText: `${countryName} ${indicatorName} ${date}: ${value ?? "N/A"}`,
            topics: [indicatorName.toLowerCase(), countryName.toLowerCase()].filter(Boolean),
            metrics: value != null
              ? { value, date, countryCode: item.countryiso3code ?? "" }
              : { date, countryCode: item.countryiso3code ?? "" },
            raw: item,
          });
        }
      } else {
        // country operation
        for (const item of dataArray) {
          if (!item) continue;
          const name = item.name ?? item.iso2Code ?? "";

          entries.push({
            id: item.id ?? item.iso2Code ?? String(name),
            title: name,
            summary: `${name} (${item.region?.value ?? "Unknown region"})`,
            bodyText: [
              name,
              item.region?.value,
              item.incomeLevel?.value,
              item.capitalCity,
            ]
              .filter(Boolean)
              .join(" | "),
            topics: [
              item.region?.value?.toLowerCase(),
              item.incomeLevel?.value?.toLowerCase(),
            ].filter((t): t is string => typeof t === "string" && t.length > 0),
            metrics: {
              longitude: item.longitude ?? "",
              latitude: item.latitude ?? "",
              capitalCity: item.capitalCity ?? "",
              incomeLevel: item.incomeLevel?.value ?? "",
            },
            raw: item,
          });
        }
      }
    } catch {
      // Malformed JSON — return empty
    }

    return { entries, normalized: entries.length > 0 ? JSON.parse(response.bodyText) : undefined };
  },
};
