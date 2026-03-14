/**
 * Kraken provider adapter — public market data from the Kraken REST API.
 *
 * Endpoints:
 *   - ticker: api.kraken.com/0/public/Ticker?pair=
 *   - assets: api.kraken.com/0/public/Assets
 *   - ohlc:   api.kraken.com/0/public/OHLC?pair=
 *
 * Kraken wraps all responses in `{ error: [], result: { ... } }`.
 * The `error` array is non-empty on failure.
 *
 * TLSN rule: single pair, small count for OHLC.
 * DAHR rule: JSON endpoints OK for all operations.
 *
 * Kraken uses non-standard pair naming: BTC is XBT, pairs are
 * prefixed with X/Z for crypto/fiat (e.g., XXBTZUSD).
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

const KRAKEN_BASE = "https://api.kraken.com/0/public";

/** Map common asset names to Kraken pair identifiers. */
const PAIR_MAP: Record<string, string> = {
  bitcoin: "XXBTZUSD",
  btc: "XXBTZUSD",
  xbt: "XXBTZUSD",
  ethereum: "XETHZUSD",
  eth: "XETHZUSD",
  solana: "SOLUSD",
  sol: "SOLUSD",
  xrp: "XXRPZUSD",
  cardano: "ADAUSD",
  ada: "ADAUSD",
  dogecoin: "XDGZUSD",
  doge: "XDGZUSD",
  polkadot: "DOTUSD",
  dot: "DOTUSD",
  avalanche: "AVAXUSD",
  avax: "AVAXUSD",
  litecoin: "XLTCZUSD",
  ltc: "XLTCZUSD",
};

/** Resolve an asset variable to a Kraken pair. */
function resolvePair(asset: string): string {
  const lower = asset.toLowerCase().trim();
  if (PAIR_MAP[lower]) return PAIR_MAP[lower];
  // If already looks like a Kraken pair, use as-is
  const upper = asset.toUpperCase().trim();
  if (upper.length >= 6) return upper;
  // Default: append USD
  return upper + "USD";
}

/** Infer operation from URL when adapter.operation is not set. */
function inferOperation(url: string): "ticker" | "assets" | "ohlc" {
  if (url.includes("/Ticker")) return "ticker";
  if (url.includes("/Assets")) return "assets";
  if (url.includes("/OHLC")) return "ohlc";
  return "ticker";
}

export const adapter: ProviderAdapter = {
  provider: "kraken",
  domains: ["crypto", "fx", "exchange"],
  rateLimit: { bucket: "kraken", maxPerMinute: 900 },

  supports(source: SourceRecordV2): boolean {
    return source.provider === "kraken";
  },

  buildCandidates(ctx: BuildCandidatesContext): CandidateRequest[] {
    const { source, tokens, vars, attestation, maxCandidates } = ctx;
    const operation = source.adapter?.operation ?? inferOperation(source.url);
    const candidates: CandidateRequest[] = [];

    if (operation === "assets") {
      // Assets endpoint needs no pair — lists all assets
      candidates.push({
        sourceId: source.id,
        provider: "kraken",
        operation: "assets",
        method: "GET",
        url: `${KRAKEN_BASE}/Assets`,
        attestation,
        estimatedSizeKb: attestation === "TLSN" ? 14 : 50,
        matchHints: tokens.slice(0, 3),
      });
    } else {
      const asset = vars.asset || vars.pair || tokens[0] || "BTC";
      const pair = resolvePair(asset);

      if (operation === "ticker") {
        candidates.push({
          sourceId: source.id,
          provider: "kraken",
          operation: "ticker",
          method: "GET",
          url: `${KRAKEN_BASE}/Ticker?pair=${pair}`,
          attestation,
          estimatedSizeKb: 2,
          matchHints: [pair.toLowerCase(), asset.toLowerCase()],
        });
      } else {
        // ohlc
        const interval = vars.interval || "60"; // Kraken uses minutes (1, 5, 15, 30, 60, 240, 1440, 10080, 21600)
        const url = attestation === "TLSN"
          ? `${KRAKEN_BASE}/OHLC?pair=${pair}&interval=${interval}&since=${Math.floor(Date.now() / 1000) - 3600 * 5}`
          : `${KRAKEN_BASE}/OHLC?pair=${pair}&interval=${interval}`;
        candidates.push({
          sourceId: source.id,
          provider: "kraken",
          operation: "ohlc",
          method: "GET",
          url,
          attestation,
          estimatedSizeKb: attestation === "TLSN" ? 4 : 40,
          matchHints: [pair.toLowerCase(), asset.toLowerCase(), `${interval}m`],
        });
      }
    }

    return candidates.slice(0, maxCandidates);
  },

  validateCandidate(candidate: CandidateRequest): CandidateValidation {
    // Assets endpoint doesn't need pair validation
    if (candidate.operation === "assets") {
      // TLSN: assets response can be large — reject
      if (candidate.attestation === "TLSN") {
        return { ok: false, reason: "Assets endpoint too large for TLSN (>16KB)" };
      }
      return { ok: true };
    }

    try {
      const parsed = new URL(candidate.url);

      // Must have a pair parameter for ticker/ohlc
      if (!parsed.searchParams.get("pair")) {
        return { ok: false, reason: "Missing pair parameter" };
      }

      // TLSN: for OHLC, ensure 'since' is set to limit results
      if (candidate.attestation === "TLSN" && candidate.operation === "ohlc") {
        if (!parsed.searchParams.has("since")) {
          // Limit to last 5 hours of data
          parsed.searchParams.set("since", String(Math.floor(Date.now() / 1000) - 3600 * 5));
          return { ok: true, rewrittenUrl: parsed.toString() };
        }
      }
    } catch {
      return { ok: false, reason: "Malformed Kraken URL" };
    }

    return { ok: true };
  },

  parseResponse(source: SourceRecordV2, response: FetchedResponse): ParsedAdapterResponse {
    const operation = source.adapter?.operation ?? inferOperation(response.url);
    const entries: EvidenceEntry[] = [];

    try {
      const data = JSON.parse(response.bodyText);

      // Kraken wraps everything in { error: [], result: {} }
      if (data?.error && Array.isArray(data.error) && data.error.length > 0) {
        // API returned errors — return empty with normalized error
        return { entries, normalized: data };
      }

      const result = data?.result;
      if (!result || typeof result !== "object") {
        return { entries };
      }

      if (operation === "ticker") {
        for (const [pairKey, tickerData] of Object.entries(result)) {
          if (!tickerData || typeof tickerData !== "object") continue;
          const t = tickerData as Record<string, unknown>;

          // Kraken ticker fields: a=ask, b=bid, c=last, v=volume, p=vwap, t=trades, l=low, h=high, o=open
          const ask = Array.isArray(t.a) ? t.a[0] : "";
          const bid = Array.isArray(t.b) ? t.b[0] : "";
          const last = Array.isArray(t.c) ? t.c[0] : "";
          const volume = Array.isArray(t.v) ? t.v[1] : ""; // [1] = 24h volume
          const high = Array.isArray(t.h) ? t.h[1] : "";
          const low = Array.isArray(t.l) ? t.l[1] : "";
          const open = typeof t.o === "string" ? t.o : "";

          entries.push({
            id: pairKey,
            title: `${pairKey} Ticker`,
            summary: `Last: ${last}, Bid: ${bid}, Ask: ${ask}`,
            bodyText: `${pairKey} Last:${last} Bid:${bid} Ask:${ask} Vol:${volume} High:${high} Low:${low}`,
            topics: [pairKey.toLowerCase()],
            metrics: {
              ask: String(ask),
              bid: String(bid),
              last: String(last),
              volume: String(volume),
              high: String(high),
              low: String(low),
              open: String(open),
            },
            raw: tickerData,
          });
        }
      } else if (operation === "assets") {
        for (const [assetKey, assetData] of Object.entries(result)) {
          if (!assetData || typeof assetData !== "object") continue;
          const a = assetData as Record<string, unknown>;

          entries.push({
            id: assetKey,
            title: String(a.altname ?? assetKey),
            bodyText: `${assetKey} (${a.altname ?? ""}) — ${a.aclass ?? "currency"}`,
            topics: [assetKey.toLowerCase(), String(a.altname ?? "").toLowerCase()].filter(Boolean),
            metrics: {
              aclass: String(a.aclass ?? ""),
              decimals: String(a.decimals ?? ""),
              displayDecimals: String(a.display_decimals ?? ""),
            },
            raw: assetData,
          });
        }
      } else {
        // ohlc — result[pair] is an array of candles, result.last is the since value
        for (const [key, value] of Object.entries(result)) {
          if (key === "last") continue;
          if (!Array.isArray(value)) continue;

          for (const candle of value) {
            if (!Array.isArray(candle) || candle.length < 7) continue;
            // [time, open, high, low, close, vwap, volume, count]
            const time = candle[0];
            const isoTime = typeof time === "number"
              ? new Date(time * 1000).toISOString()
              : undefined;

            entries.push({
              id: `${key}-ohlc-${time}`,
              title: `${key} ${isoTime ?? time}`,
              bodyText: `O:${candle[1]} H:${candle[2]} L:${candle[3]} C:${candle[4]} VWAP:${candle[5]} V:${candle[6]}`,
              publishedAt: isoTime,
              topics: [key.toLowerCase()],
              metrics: {
                open: String(candle[1]),
                high: String(candle[2]),
                low: String(candle[3]),
                close: String(candle[4]),
                vwap: String(candle[5]),
                volume: String(candle[6]),
                count: candle[7] ?? 0,
              },
              raw: candle,
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
