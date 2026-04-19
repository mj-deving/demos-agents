import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchResearchEvidenceSummary } from "../../packages/omniweb-toolkit/src/research-evidence.js";
import type { MinimalAttestationCandidate } from "../../packages/omniweb-toolkit/src/minimal-attestation-plan.js";

const originalFetch = globalThis.fetch;

function makeSource(
  url: string,
  overrides: Partial<MinimalAttestationCandidate> = {},
): MinimalAttestationCandidate {
  return {
    sourceId: "binance-futures-btc",
    name: "binance-futures-premium-index",
    provider: "binance-futures",
    status: "active",
    trustTier: "official",
    responseFormat: "json",
    ratingOverall: 88,
    dahrSafe: true,
    tlsnSafe: false,
    url,
    score: 17,
    ...overrides,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("fetchResearchEvidenceSummary", () => {
  it("extracts the key Binance premium index values", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          markPrice: "67250.00",
          indexPrice: "67245.12",
          lastFundingRate: "-0.012",
          interestRate: "0.0001",
          nextFundingTime: 123456789,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const result = await fetchResearchEvidenceSummary({
      source: makeSource("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.summary.values).toEqual({
      markPrice: "67250.00",
      indexPrice: "67245.12",
      lastFundingRate: "-0.012",
      interestRate: "0.0001",
    });
    expect(result.summary.derivedMetrics).toEqual({
      fundingRateBps: "-120",
      markIndexSpreadUsd: "4.88",
    });
  });

  it("preserves small numeric precision when extracting research evidence", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          markPrice: "67250.00",
          indexPrice: "67249.99",
          lastFundingRate: "0.00001",
          interestRate: "0.000001",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const result = await fetchResearchEvidenceSummary({
      source: makeSource("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.summary.values).toEqual({
      markPrice: "67250.00",
      indexPrice: "67249.99",
      lastFundingRate: "0.00001",
      interestRate: "0.000001",
    });
    expect(result.summary.derivedMetrics).toEqual({
      fundingRateBps: "0.1",
      markIndexSpreadUsd: "0.01",
    });
  });

  it("prefers source identity over URL shape for premium-index extraction", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          markPrice: "67250.00",
          indexPrice: "67245.12",
          lastFundingRate: "-0.012",
          interestRate: "0.0001",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const result = await fetchResearchEvidenceSummary({
      source: makeSource("https://example.com/provider-path-changed.json"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.summary.values).toEqual({
      markPrice: "67250.00",
      indexPrice: "67245.12",
      lastFundingRate: "-0.012",
      interestRate: "0.0001",
    });
    expect(result.summary.derivedMetrics).toEqual({
      fundingRateBps: "-120",
      markIndexSpreadUsd: "4.88",
    });
  });

  it("falls back to generic numeric extraction for other JSON endpoints", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          bitcoin: 67250.12,
          ethereum: 3200.55,
          provider: "coingecko",
          solana: "145.03",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const result = await fetchResearchEvidenceSummary({
      source: makeSource("https://example.com/data.json", {
        sourceId: "generic-example",
        name: "generic-example",
        provider: "generic",
        ratingOverall: 60,
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.summary.values).toEqual({
      bitcoin: "67250.12",
      ethereum: "3200.55",
      solana: "145.03",
    });
    expect(result.summary.derivedMetrics).toEqual({});
  });

  it("extracts a simple peg price from the CoinGecko simple-price endpoint", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          tether: {
            usd: 1.0004,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const result = await fetchResearchEvidenceSummary({
      source: makeSource("https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=usd", {
        sourceId: "coingecko-2a7ea372",
        name: "coingecko-simple",
        provider: "coingecko",
      }),
      topic: "USDT Supply ATH Stablecoin Inflation",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.summary.values).toEqual({
      assetId: "tether",
      priceUsd: "1.0004",
    });
    expect(result.summary.derivedMetrics).toEqual({
      pegDeviationPct: "0.04",
    });
  });

  it("extracts market-chart values and derived metrics for research spot momentum", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          prices: [
            [1713427200000, 64000],
            [1713513600000, 67250],
          ],
          total_volumes: [
            [1713427200000, 22000000000],
            [1713513600000, 31000000000],
          ],
          market_caps: [
            [1713427200000, 1200000000000],
            [1713513600000, 1260000000000],
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const result = await fetchResearchEvidenceSummary({
      source: makeSource("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=7", {
        sourceId: "coingecko-42ff8c85",
        name: "coingecko-market",
        provider: "coingecko",
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.summary.values).toEqual({
      currentPriceUsd: "67250",
      startingPriceUsd: "64000",
      high7d: "67250",
      low7d: "64000",
      latestVolumeUsd: "31000000000",
      latestMarketCapUsd: "1260000000000",
    });
    expect(result.summary.derivedMetrics).toEqual({
      priceChangePercent7d: "5.08",
      tradingRangeWidthUsd: "3250",
    });
  });

  it("extracts ETF holdings and net-flow metrics from btcetfdata current JSON", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            IBIT: {
              ticker: "IBIT",
              dt: "2026-04-16",
              holdings: 799151.0369,
              change: 1088.1268,
              note: null,
              update_ts: "2026-04-17T12:00:02",
              error: false,
            },
            FBTC: {
              ticker: "FBTC",
              dt: "2026-04-16",
              holdings: 185536.41,
              change: -478.92,
              note: null,
              update_ts: "2026-04-17T12:30:01",
              error: false,
            },
            GBTC: {
              ticker: "GBTC",
              dt: "2026-04-17",
              holdings: 152510.8761,
              change: -301.9038,
              note: null,
              update_ts: "2026-04-17T21:30:01",
              error: false,
            },
          },
          batch_ts: "2026-04-18T07:00:02",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const result = await fetchResearchEvidenceSummary({
      source: makeSource("https://www.btcetfdata.com/v1/current.json", {
        sourceId: "btcetfdata-current-btc",
        name: "btcetfdata-current",
        provider: "btcetfdata",
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.summary.values).toEqual({
      totalHoldingsBtc: "1137198.32",
      netFlowBtc: "307.3",
      issuerCount: "3",
      positiveIssuerCount: "1",
      negativeIssuerCount: "2",
      largestInflowBtc: "1088.13",
      largestOutflowBtc: "-478.92",
    });
    expect(result.summary.derivedMetrics).toEqual({
      largestInflowTicker: "IBIT",
      largestOutflowTicker: "FBTC",
      netFlowDirection: "inflow",
    });
  });

  it("extracts targeted stablecoin supply metrics from DefiLlama", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          peggedAssets: [
            {
              symbol: "USDT",
              circulating: { peggedUSD: 186624595113.62906 },
              circulatingPrevDay: { peggedUSD: 185821073382.75705 },
              circulatingPrevWeek: { peggedUSD: 184294812347.6592 },
              circulatingPrevMonth: { peggedUSD: 183336749243.18744 },
            },
            {
              symbol: "USDC",
              circulating: { peggedUSD: 78623991015.38954 },
              circulatingPrevDay: { peggedUSD: 78780102398.10326 },
              circulatingPrevWeek: { peggedUSD: 78765579195.09525 },
              circulatingPrevMonth: { peggedUSD: 79400644158.13521 },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const result = await fetchResearchEvidenceSummary({
      source: makeSource("https://stablecoins.llama.fi/stablecoins?includePrices=true", {
        sourceId: "defillama-stablecoins",
        name: "defillama-stablecoins-list",
        provider: "defillama",
      }),
      topic: "USDT Supply ATH Stablecoin Inflation",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.summary.values).toEqual({
      assetSymbol: "USDT",
      circulatingUsd: "186624595113.63",
      circulatingPrevDayUsd: "185821073382.76",
      circulatingPrevWeekUsd: "184294812347.66",
      circulatingPrevMonthUsd: "183336749243.19",
    });
    expect(result.summary.derivedMetrics).toEqual({
      supplyChangePct1d: "0.43",
      supplyChangePct7d: "1.26",
      supplyChangePct30d: "1.79",
      stablecoinFocus: "USDT",
    });
  });

  it("extracts VIX quote values from the CBOE delayed quote JSON endpoint", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          timestamp: "2026-04-18 13:29:25",
          data: {
            symbol: "^VIX",
            current_price: 17.48,
            price_change: -0.46,
            price_change_percent: -2.6316,
            open: 18.18,
            high: 18.24,
            low: 16.87,
            close: 17.48,
            prev_day_close: 17.95,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const result = await fetchResearchEvidenceSummary({
      source: {
        ...makeSource("https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VIX.json"),
        sourceId: "cboe-vix-daily",
        name: "cboe-vix-quote",
        provider: "cboe",
      },
      topic: "VIX Credit Stress Signal",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.summary.values).toEqual({
      vixTimestamp: "2026-04-18 13:29:25",
      vixClose: "17.48",
      vixOpen: "18.18",
      vixHigh: "18.24",
      vixLow: "16.87",
      vixPreviousClose: "17.95",
      vixCurrentPrice: "17.48",
      vixPriceChange: "-0.46",
      vixPriceChangePercent: "-2.6316",
    });
    expect(result.summary.derivedMetrics).toEqual({
      vixSessionChangePct: "-2.62",
      vixIntradayRange: "1.37",
    });
  });

  it("extracts network metrics and semantic class from blockchair stats", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            blocks: 144,
            transactions: 412338,
            hashrate_24h: 623451112.45,
            difficulty: 987654321.12,
            market_price_usd: 77201.14,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const result = await fetchResearchEvidenceSummary({
      source: makeSource("https://api.blockchair.com/bitcoin/stats", {
        sourceId: "blockchair-btc-stats",
        name: "blockchair-bitcoin-stats",
        provider: "blockchair",
      }),
      topic: "BTC on-chain network stress and mempool congestion",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.summary.values).toEqual({
      blockCount24h: "144",
      transactionCount24h: "412338",
      hashrate24h: "623451112.45",
      difficulty: "987654321.12",
      priceUsd: "77201.14",
    });
    expect(result.summary.derivedMetrics).toEqual({
      transactionsPerBlock24h: "2863.46",
    });
    expect(result.summary.semanticClass).toBe("network");
  });

  it("fails when no usable numeric values are present", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ok",
          provider: "example",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    const result = await fetchResearchEvidenceSummary({
      source: makeSource("https://example.com/data.json"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("no_usable_values");
  });
});
