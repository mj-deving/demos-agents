/**
 * Binance provider adapter — spot market data from the Binance public API.
 *
 * Endpoints:
 *   - ticker-price: api.binance.com/api/v3/ticker/price?symbol=
 *   - ticker-24hr:  api.binance.com/api/v3/ticker/24hr?symbol=
 *   - klines:       api.binance.com/api/v3/klines?symbol=&interval=
 *
 * TLSN rule: single symbol, small result count (limit<=5 for klines).
 * DAHR rule: JSON endpoints OK for all operations.
 *
 * Rate limit: 1200/min IP-based weight limit. Individual ticker endpoints
 * cost 1-2 weight each, so practical throughput is very high.
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

const BINANCE_BASE = "https://api.binance.com/api/v3";

/** Map common asset names to Binance trading pair symbols. */
const SYMBOL_MAP: Record<string, string> = {
  bitcoin: "BTCUSDT",
  btc: "BTCUSDT",
  ethereum: "ETHUSDT",
  eth: "ETHUSDT",
  solana: "SOLUSDT",
  sol: "SOLUSDT",
  bnb: "BNBUSDT",
  xrp: "XRPUSDT",
  cardano: "ADAUSDT",
  ada: "ADAUSDT",
  dogecoin: "DOGEUSDT",
  doge: "DOGEUSDT",
  polkadot: "DOTUSDT",
  dot: "DOTUSDT",
  avalanche: "AVAXUSDT",
  avax: "AVAXUSDT",
};

/** Resolve an asset variable to a Binance symbol. */
function resolveSymbol(asset: string): string {
  const lower = asset.toLowerCase().trim();
  if (SYMBOL_MAP[lower]) return SYMBOL_MAP[lower];
  // If already looks like a symbol (uppercase, ends with USDT/BTC/etc), use as-is
  const upper = asset.toUpperCase().trim();
  if (/^[A-Z]{2,10}(USDT|BTC|ETH|BNB|BUSD)$/.test(upper)) return upper;
  // Default: append USDT
  return upper + "USDT";
}

/** Infer operation from URL when adapter.operation is not set. */
function inferOperation(url: string): "ticker-price" | "ticker-24hr" | "klines" {
  if (url.includes("/ticker/price")) return "ticker-price";
  if (url.includes("/ticker/24hr")) return "ticker-24hr";
  if (url.includes("/klines")) return "klines";
  return "ticker-price";
}

export const adapter: ProviderAdapter = {
  provider: "binance",
  domains: ["crypto", "trading", "exchange"],
  rateLimit: { bucket: "binance", maxPerMinute: 1200 },

  supports(source: SourceRecordV2): boolean {
    return source.provider === "binance";
  },

  buildCandidates(ctx: BuildCandidatesContext): CandidateRequest[] {
    const { source, tokens, vars, attestation, maxCandidates } = ctx;
    const operation = source.adapter?.operation ?? inferOperation(source.url);
    const candidates: CandidateRequest[] = [];

    const asset = vars.asset || vars.symbol || tokens[0] || "BTC";
    const symbol = resolveSymbol(asset);

    if (operation === "ticker-price") {
      candidates.push({
        sourceId: source.id,
        provider: "binance",
        operation: "ticker-price",
        method: "GET",
        url: `${BINANCE_BASE}/ticker/price?symbol=${symbol}`,
        attestation,
        estimatedSizeKb: 1,
        matchHints: [symbol.toLowerCase(), asset.toLowerCase()],
      });
    } else if (operation === "ticker-24hr") {
      candidates.push({
        sourceId: source.id,
        provider: "binance",
        operation: "ticker-24hr",
        method: "GET",
        url: `${BINANCE_BASE}/ticker/24hr?symbol=${symbol}`,
        attestation,
        estimatedSizeKb: 2,
        matchHints: [symbol.toLowerCase(), asset.toLowerCase()],
      });
    } else {
      // klines
      const interval = vars.interval || "1h";
      const limit = attestation === "TLSN" ? 5 : 100;
      candidates.push({
        sourceId: source.id,
        provider: "binance",
        operation: "klines",
        method: "GET",
        url: `${BINANCE_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
        attestation,
        estimatedSizeKb: attestation === "TLSN" ? 3 : 12,
        matchHints: [symbol.toLowerCase(), asset.toLowerCase(), interval],
      });
    }

    return candidates.slice(0, maxCandidates);
  },

  validateCandidate(candidate: CandidateRequest): CandidateValidation {
    try {
      const parsed = new URL(candidate.url);

      // Must have a symbol parameter
      if (!parsed.searchParams.get("symbol")) {
        return { ok: false, reason: "Missing symbol parameter" };
      }

      // TLSN: enforce small kline limit
      if (candidate.attestation === "TLSN" && candidate.operation === "klines") {
        const limit = parseInt(parsed.searchParams.get("limit") || "100", 10);
        if (limit > 5) {
          parsed.searchParams.set("limit", "5");
          return { ok: true, rewrittenUrl: parsed.toString() };
        }
      }
    } catch {
      return { ok: false, reason: "Malformed Binance URL" };
    }

    return { ok: true };
  },

  parseResponse(source: SourceRecordV2, response: FetchedResponse): ParsedAdapterResponse {
    const operation = source.adapter?.operation ?? inferOperation(response.url);
    const entries: EvidenceEntry[] = [];

    try {
      const data = JSON.parse(response.bodyText);

      if (operation === "ticker-price") {
        if (data && typeof data.symbol === "string") {
          entries.push({
            id: data.symbol,
            title: `${data.symbol} Price`,
            bodyText: `${data.symbol}: ${data.price}`,
            topics: [data.symbol.toLowerCase()],
            metrics: { symbol: data.symbol, price: data.price },
            raw: data,
          });
        }
      } else if (operation === "ticker-24hr") {
        if (data && typeof data.symbol === "string") {
          entries.push({
            id: data.symbol,
            title: `${data.symbol} 24h Stats`,
            summary: `Price: ${data.lastPrice}, Change: ${data.priceChangePercent}%`,
            bodyText: [
              `${data.symbol}`,
              `Last: ${data.lastPrice}`,
              `Change: ${data.priceChange} (${data.priceChangePercent}%)`,
              `High: ${data.highPrice}`,
              `Low: ${data.lowPrice}`,
              `Volume: ${data.volume}`,
            ].join(" | "),
            topics: [data.symbol.toLowerCase()],
            metrics: {
              lastPrice: data.lastPrice ?? "",
              priceChange: data.priceChange ?? "",
              priceChangePercent: data.priceChangePercent ?? "",
              highPrice: data.highPrice ?? "",
              lowPrice: data.lowPrice ?? "",
              volume: data.volume ?? "",
              quoteVolume: data.quoteVolume ?? "",
              weightedAvgPrice: data.weightedAvgPrice ?? "",
            },
            raw: data,
          });
        }
      } else {
        // klines — each candle is an array:
        // [openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, ...]
        if (Array.isArray(data)) {
          for (const candle of data) {
            if (!Array.isArray(candle) || candle.length < 7) continue;
            const openTime = candle[0];
            const isoTime = typeof openTime === "number"
              ? new Date(openTime).toISOString()
              : undefined;

            entries.push({
              id: `kline-${openTime}`,
              title: `Candle ${isoTime ?? openTime}`,
              bodyText: `O:${candle[1]} H:${candle[2]} L:${candle[3]} C:${candle[4]} V:${candle[5]}`,
              publishedAt: isoTime,
              topics: [],
              metrics: {
                open: candle[1],
                high: candle[2],
                low: candle[3],
                close: candle[4],
                volume: candle[5],
                quoteVolume: candle[7] ?? "",
                trades: candle[8] ?? 0,
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
