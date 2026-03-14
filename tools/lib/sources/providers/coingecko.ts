/**
 * CoinGecko provider adapter — crypto market data via free API.
 *
 * Endpoints:
 *   - simple-price: api.coingecko.com/api/v3/simple/price?ids=X&vs_currencies=usd
 *   - trending: api.coingecko.com/api/v3/search/trending
 *   - coin-detail: api.coingecko.com/api/v3/coins/X
 *   - market-chart: api.coingecko.com/api/v3/coins/X/market_chart
 *   - categories: api.coingecko.com/api/v3/coins/categories
 *
 * Rate limits: 30/min, 500/day (free tier, no auth).
 *
 * TLSN constraint: only compact endpoints (simple-price, trending) are safe.
 * market-chart can be large — limit days param for TLSN.
 * coin-detail and categories are DAHR-only (response too large for 16KB).
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

const BASE_URL = "https://api.coingecko.com/api/v3";

type CgOperation = "simple-price" | "trending" | "coin-detail" | "market-chart" | "categories";

const VALID_OPERATIONS: CgOperation[] = [
  "simple-price",
  "trending",
  "coin-detail",
  "market-chart",
  "categories",
];

/** Operations safe for TLSN (compact JSON responses) */
const TLSN_SAFE_OPS: CgOperation[] = ["simple-price", "trending"];

/** Max days for market-chart under TLSN (keeps response small) */
const TLSN_MARKET_CHART_MAX_DAYS = 1;

/**
 * Infer operation from source record URL or adapter config.
 */
function inferOperation(source: SourceRecordV2): CgOperation {
  const op = source.adapter?.operation;
  if (op && VALID_OPERATIONS.includes(op as CgOperation)) {
    return op as CgOperation;
  }
  const url = source.url.toLowerCase();
  if (url.includes("simple/price")) return "simple-price";
  if (url.includes("search/trending")) return "trending";
  if (url.includes("market_chart")) return "market-chart";
  if (url.includes("coins/categories")) return "categories";
  if (url.includes("/coins/")) return "coin-detail";
  return "simple-price";
}

/**
 * Build the URL for a given operation and asset identifier.
 */
function buildUrl(operation: CgOperation, asset: string, opts?: { days?: number }): string {
  switch (operation) {
    case "simple-price":
      return `${BASE_URL}/simple/price?ids=${encodeURIComponent(asset)}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true`;
    case "trending":
      return `${BASE_URL}/search/trending`;
    case "coin-detail":
      return `${BASE_URL}/coins/${encodeURIComponent(asset)}?localization=false&tickers=false&community_data=false&developer_data=false`;
    case "market-chart":
      return `${BASE_URL}/coins/${encodeURIComponent(asset)}/market_chart?vs_currency=usd&days=${opts?.days ?? 7}`;
    case "categories":
      return `${BASE_URL}/coins/categories`;
  }
}

export const adapter: ProviderAdapter = {
  provider: "coingecko",
  domains: ["crypto", "defi", "markets", "prices"],
  rateLimit: { bucket: "coingecko", maxPerMinute: 30, maxPerDay: 500 },

  supports(source: SourceRecordV2): boolean {
    return (
      source.provider === "coingecko" ||
      source.url.toLowerCase().includes("coingecko.com")
    );
  },

  buildCandidates(ctx: BuildCandidatesContext): CandidateRequest[] {
    const operation = inferOperation(ctx.source);
    const asset = ctx.vars.asset || ctx.topic.toLowerCase().replace(/\s+/g, "-");

    // TLSN safety: only allow compact endpoints
    if (ctx.attestation === "TLSN" && !TLSN_SAFE_OPS.includes(operation)) {
      // market-chart can be made safe with limited days
      if (operation === "market-chart") {
        const url = buildUrl(operation, asset, { days: TLSN_MARKET_CHART_MAX_DAYS });
        return [
          {
            sourceId: ctx.source.id,
            provider: "coingecko",
            operation,
            method: "GET" as const,
            url,
            attestation: "TLSN" as const,
            estimatedSizeKb: 6,
            matchHints: [asset, ...ctx.tokens.slice(0, 3)],
          },
        ].slice(0, ctx.maxCandidates);
      }
      // coin-detail and categories are too large for TLSN
      return [];
    }

    const url = buildUrl(operation, asset);

    return [
      {
        sourceId: ctx.source.id,
        provider: "coingecko",
        operation,
        method: "GET" as const,
        url,
        attestation: ctx.attestation,
        estimatedSizeKb: operation === "trending" ? 8 : operation === "simple-price" ? 1 : 12,
        matchHints: [asset, ...ctx.tokens.slice(0, 3)],
      },
    ].slice(0, ctx.maxCandidates);
  },

  validateCandidate(candidate: CandidateRequest): CandidateValidation {
    if (candidate.attestation === "TLSN") {
      const op = candidate.operation as CgOperation;
      if (!TLSN_SAFE_OPS.includes(op) && op !== "market-chart") {
        return { ok: false, reason: `Operation "${op}" response too large for TLSN` };
      }
      // For market-chart under TLSN, enforce max days
      if (op === "market-chart") {
        try {
          const parsed = new URL(candidate.url);
          const days = Number(parsed.searchParams.get("days") ?? "7");
          if (days > TLSN_MARKET_CHART_MAX_DAYS) {
            parsed.searchParams.set("days", String(TLSN_MARKET_CHART_MAX_DAYS));
            return {
              ok: true,
              reason: `market-chart days ${days} exceeds TLSN limit — rewritten to ${TLSN_MARKET_CHART_MAX_DAYS}`,
              rewrittenUrl: parsed.toString(),
            };
          }
        } catch {
          return { ok: false, reason: "Malformed market-chart URL" };
        }
      }
    }
    return { ok: true };
  },

  parseResponse(source: SourceRecordV2, response: FetchedResponse): ParsedAdapterResponse {
    if (response.status !== 200) {
      return { entries: [], normalized: null };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.bodyText);
    } catch {
      return { entries: [], normalized: null };
    }

    const operation = inferOperation(source);
    const entries: EvidenceEntry[] = [];

    switch (operation) {
      case "simple-price": {
        // Response shape: { "bitcoin": { "usd": 64000, "usd_market_cap": ..., "usd_24h_vol": ... } }
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          for (const [coinId, data] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof data !== "object" || data === null) continue;
            const d = data as Record<string, unknown>;
            entries.push({
              id: coinId,
              title: `${coinId} price`,
              bodyText: `${coinId}: $${d.usd ?? "unknown"}`,
              topics: ["crypto", "price", coinId],
              metrics: {
                price_usd: typeof d.usd === "number" ? d.usd : 0,
                market_cap: typeof d.usd_market_cap === "number" ? d.usd_market_cap : 0,
                volume_24h: typeof d.usd_24h_vol === "number" ? d.usd_24h_vol : 0,
              },
              raw: data,
            });
          }
        }
        break;
      }

      case "trending": {
        // Response shape: { coins: [{ item: { id, name, symbol, market_cap_rank, ... } }] }
        const trendingData = parsed as Record<string, unknown>;
        const coins = Array.isArray(trendingData?.coins) ? trendingData.coins : [];
        for (const wrapper of coins) {
          if (typeof wrapper !== "object" || wrapper === null) continue;
          const item = (wrapper as Record<string, unknown>).item;
          if (typeof item !== "object" || item === null) continue;
          const coin = item as Record<string, unknown>;
          entries.push({
            id: String(coin.id ?? ""),
            title: String(coin.name ?? ""),
            summary: `${coin.name} (${coin.symbol}) — rank #${coin.market_cap_rank ?? "?"}`,
            bodyText: `Trending: ${coin.name} (${coin.symbol})`,
            topics: ["crypto", "trending", String(coin.symbol ?? "").toLowerCase()],
            metrics: {
              market_cap_rank: typeof coin.market_cap_rank === "number" ? coin.market_cap_rank : 0,
              score: typeof coin.score === "number" ? coin.score : 0,
            },
            raw: item,
          });
        }
        break;
      }

      case "coin-detail": {
        // Single coin detail response
        const coin = parsed as Record<string, unknown>;
        if (typeof coin === "object" && coin !== null && coin.id) {
          const marketData = (coin.market_data as Record<string, unknown>) ?? {};
          const currentPrice =
            typeof marketData === "object" && marketData !== null
              ? (marketData.current_price as Record<string, unknown>)
              : {};
          entries.push({
            id: String(coin.id),
            title: String(coin.name ?? ""),
            summary: String((coin.description as Record<string, unknown>)?.en ?? "").slice(0, 500),
            bodyText: String((coin.description as Record<string, unknown>)?.en ?? coin.name ?? ""),
            canonicalUrl: `https://www.coingecko.com/en/coins/${coin.id}`,
            topics: ["crypto", String(coin.symbol ?? "").toLowerCase()],
            metrics: {
              price_usd: typeof currentPrice?.usd === "number" ? currentPrice.usd : 0,
              market_cap_rank: typeof coin.market_cap_rank === "number" ? coin.market_cap_rank : 0,
            },
            raw: coin,
          });
        }
        break;
      }

      case "market-chart": {
        // Response: { prices: [[ts, price], ...], market_caps: [...], total_volumes: [...] }
        const chart = parsed as Record<string, unknown>;
        const prices = Array.isArray(chart?.prices) ? chart.prices : [];
        if (prices.length > 0) {
          const latest = prices[prices.length - 1];
          const earliest = prices[0];
          entries.push({
            id: `chart-${source.id}`,
            title: `Price chart (${prices.length} data points)`,
            bodyText: `Price range: ${Array.isArray(earliest) ? earliest[1] : "?"} to ${Array.isArray(latest) ? latest[1] : "?"}`,
            topics: ["crypto", "chart", "price"],
            metrics: {
              data_points: prices.length,
              latest_price: Array.isArray(latest) && typeof latest[1] === "number" ? latest[1] : 0,
              earliest_price: Array.isArray(earliest) && typeof earliest[1] === "number" ? earliest[1] : 0,
            },
            raw: chart,
          });
        }
        break;
      }

      case "categories": {
        // Response: [{ id, name, market_cap, ... }]
        const cats = Array.isArray(parsed) ? parsed : [];
        for (const cat of cats.slice(0, 20)) {
          if (typeof cat !== "object" || cat === null) continue;
          const c = cat as Record<string, unknown>;
          entries.push({
            id: String(c.id ?? ""),
            title: String(c.name ?? ""),
            bodyText: `Category: ${c.name}`,
            topics: ["crypto", "category"],
            metrics: {
              market_cap: typeof c.market_cap === "number" ? c.market_cap : 0,
              market_cap_change_24h:
                typeof c.market_cap_change_24h === "number" ? c.market_cap_change_24h : 0,
            },
            raw: cat,
          });
        }
        break;
      }
    }

    return { entries, normalized: parsed };
  },
};
