import { fetchWithTimeout } from "../../../src/toolkit/network/fetch-with-timeout.js";
import { fetchSource } from "../../../src/toolkit/sources/fetch.js";
import type { FetchedResponse } from "../../../src/toolkit/providers/types.js";
import { inferAssetAlias } from "../../../src/toolkit/chain/asset-helpers.js";
import type { MinimalAttestationCandidate } from "./minimal-attestation-plan.js";

const DEFAULT_RESEARCH_EVIDENCE_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_VALUES = 5;

export interface ResearchEvidenceSummary {
  source: string;
  url: string;
  fetchedAt: string;
  values: Record<string, string>;
  derivedMetrics: Record<string, string>;
  semanticClass?: ResearchEvidenceSemanticClass;
}

export interface FetchResearchEvidenceSummarySuccess {
  ok: true;
  summary: ResearchEvidenceSummary;
  prefetchedResponse?: FetchedResponse;
}

export interface FetchResearchEvidenceSummaryFailure {
  ok: false;
  reason: "fetch_failed" | "unexpected_status" | "invalid_json" | "no_usable_values";
  note: string;
  status?: number;
}

export type FetchResearchEvidenceSummaryResult =
  | FetchResearchEvidenceSummarySuccess
  | FetchResearchEvidenceSummaryFailure;

export interface FetchResearchEvidenceSummaryOptions {
  source: MinimalAttestationCandidate;
  topic?: string;
  timeoutMs?: number;
  maxValues?: number;
}

type ResearchEvidenceSourceKind =
  | "binance-premium-index"
  | "binance-open-interest"
  | "coingecko-market-chart"
  | "coingecko-simple-price"
  | "btcetfdata-current"
  | "defillama-stablecoins"
  | "treasury-interest-rates"
  | "cboe-vix-history"
  | "generic";

export type ResearchEvidenceSemanticClass =
  | "market"
  | "macro"
  | "liquidity"
  | "metadata"
  | "generic";

export async function fetchResearchEvidenceSummary(
  opts: FetchResearchEvidenceSummaryOptions,
): Promise<FetchResearchEvidenceSummaryResult> {
  try {
    const prefetched = await fetchResearchEvidence(opts);
    if (!prefetched.ok) {
      return prefetched;
    }

    const contentType = prefetched.response.headers["content-type"] ?? "";
    const rawText = prefetched.response.bodyText;
    const sourceKind = classifyResearchEvidenceSource(opts.source);
    const payload = parseResearchEvidencePayload(opts.source, sourceKind, contentType, rawText);
    const values = extractResearchEvidenceValues(
      opts.source,
      sourceKind,
      payload,
      opts.maxValues ?? DEFAULT_MAX_VALUES,
      opts.topic,
    );

    if (Object.keys(values).length === 0) {
      return {
        ok: false,
        reason: "no_usable_values",
        note: `Source fetch succeeded for ${opts.source.name}, but no usable numeric values were extracted.`,
      };
    }

    const derivedMetrics = deriveResearchMetrics(opts.source, sourceKind, payload, values, opts.topic);

    return {
      ok: true,
      prefetchedResponse: prefetched.response,
      summary: {
        source: opts.source.name,
        url: opts.source.url,
        fetchedAt: new Date().toISOString(),
        values,
        derivedMetrics,
        semanticClass: classifyResearchEvidenceSemanticClass(
          sourceKind,
          values,
          derivedMetrics,
        ),
      },
    };
  } catch (error) {
    const note = error instanceof SyntaxError
      ? `Source fetch returned invalid JSON for ${opts.source.name}.`
      : `Source fetch failed for ${opts.source.name}: ${String(error)}`;
    return {
      ok: false,
      reason: error instanceof SyntaxError ? "invalid_json" : "fetch_failed",
      note,
    };
  }
}

export function classifyResearchEvidenceSemanticClass(
  sourceKind: ResearchEvidenceSourceKind,
  values: Record<string, string>,
  derivedMetrics: Record<string, string>,
): ResearchEvidenceSemanticClass {
  if (
    sourceKind === "binance-premium-index"
    || sourceKind === "binance-open-interest"
    || sourceKind === "coingecko-market-chart"
    || sourceKind === "coingecko-simple-price"
    || sourceKind === "btcetfdata-current"
    || sourceKind === "cboe-vix-history"
  ) {
    return "market";
  }

  if (sourceKind === "treasury-interest-rates") {
    return "macro";
  }

  if (sourceKind === "defillama-stablecoins") {
    return "liquidity";
  }

  const keys = Object.keys(values).concat(Object.keys(derivedMetrics)).map((key) => key.toLowerCase());
  const has = (patterns: RegExp[]) => patterns.some((pattern) => keys.some((key) => pattern.test(key)));

  if (has([/price/, /volume/, /funding/, /openinterest/, /holdings/, /flow/, /vix/, /high/, /low/, /spread/])) {
    return "market";
  }

  if (has([/rate/, /yield/, /treasury/, /bill/, /note/, /curve/])) {
    return "macro";
  }

  if (has([/supply/, /circulating/, /peg/, /stablecoin/, /deviation/])) {
    return "liquidity";
  }

  const metadataPatterns = [/nbhits/, /nbpages/, /page$/, /hitsperpage/, /processingtimems/, /query/, /count$/, /total$/];
  if (keys.length > 0 && keys.every((key) => metadataPatterns.some((pattern) => pattern.test(key)))) {
    return "metadata";
  }

  return "generic";
}

async function fetchResearchEvidence(
  opts: FetchResearchEvidenceSummaryOptions,
): Promise<
  | { ok: true; response: FetchedResponse }
  | FetchResearchEvidenceSummaryFailure
> {
  if (opts.source.sourceRecord) {
    const fetched = await fetchSource(
      opts.source.url,
      opts.source.sourceRecord,
      {
        timeoutMs: opts.timeoutMs ?? DEFAULT_RESEARCH_EVIDENCE_TIMEOUT_MS,
      },
    );

    if (!fetched.ok || !fetched.response) {
      return {
        ok: false,
        reason: "fetch_failed",
        note: `Source fetch failed for ${opts.source.name}: ${fetched.error ?? "unknown fetch error"}`,
      };
    }

    if (fetched.response.status < 200 || fetched.response.status >= 400) {
      return {
        ok: false,
        reason: "unexpected_status",
        status: fetched.response.status,
        note: `Source fetch returned HTTP ${fetched.response.status} for ${opts.source.name}.`,
      };
    }

    return {
      ok: true,
      response: fetched.response,
    };
  }

  const response = await fetchWithTimeout(
    opts.source.url,
    opts.timeoutMs ?? DEFAULT_RESEARCH_EVIDENCE_TIMEOUT_MS,
    {
      headers: {
        accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    return {
      ok: false,
      reason: "unexpected_status",
      status: response.status,
      note: `Source fetch returned HTTP ${response.status} for ${opts.source.name}.`,
    };
  }

  const bodyText = await response.text();
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  return {
    ok: true,
    response: {
      url: opts.source.url,
      status: response.status,
      headers,
      bodyText,
    },
  };
}

function extractResearchEvidenceValues(
  source: MinimalAttestationCandidate,
  sourceKind: ResearchEvidenceSourceKind,
  payload: unknown,
  maxValues: number,
  topic?: string,
): Record<string, string> {
  if (sourceKind === "binance-premium-index") {
    const premiumValues = extractBinancePremiumValues(payload);
    if (Object.keys(premiumValues).length > 0) {
      return premiumValues;
    }
  }

  if (sourceKind === "binance-open-interest") {
    const openInterestValues = extractBinanceOpenInterestValues(payload);
    if (Object.keys(openInterestValues).length > 0) {
      return openInterestValues;
    }
  }

  if (sourceKind === "coingecko-market-chart") {
    const marketValues = extractCoinGeckoMarketChartValues(payload);
    if (Object.keys(marketValues).length > 0) {
      return marketValues;
    }
  }

  if (sourceKind === "coingecko-simple-price") {
    const simplePriceValues = extractCoinGeckoSimplePriceValues(payload);
    if (Object.keys(simplePriceValues).length > 0) {
      return simplePriceValues;
    }
  }

  if (sourceKind === "btcetfdata-current") {
    const etfValues = extractBtcEtfFlowValues(payload);
    if (Object.keys(etfValues).length > 0) {
      return etfValues;
    }
  }

  if (sourceKind === "defillama-stablecoins") {
    const stablecoinValues = extractDefiLlamaStablecoinValues(payload, topic);
    if (Object.keys(stablecoinValues).length > 0) {
      return stablecoinValues;
    }
  }

  if (sourceKind === "treasury-interest-rates") {
    const treasuryValues = extractTreasuryInterestRateValues(payload);
    if (Object.keys(treasuryValues).length > 0) {
      return treasuryValues;
    }
  }

  if (sourceKind === "cboe-vix-history") {
    const vixValues = extractVixValues(payload);
    if (Object.keys(vixValues).length > 0) {
      return vixValues;
    }
  }

  if (source.provider !== "generic" || !isRecord(payload)) {
    return {};
  }

  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(payload)) {
    const normalized = normalizeScalarValue(value);
    if (!normalized) continue;
    entries.push([key, normalized]);
    if (entries.length >= maxValues) break;
  }

  return Object.fromEntries(entries);
}

function isBinancePremiumIndexUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "fapi.binance.com" && parsed.pathname.includes("/premiumIndex");
  } catch {
    return false;
  }
}

function isBinanceOpenInterestUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "fapi.binance.com" && parsed.pathname.includes("/openInterest");
  } catch {
    return false;
  }
}

function isCoinGeckoMarketChartUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "api.coingecko.com" && parsed.pathname.includes("/market_chart");
  } catch {
    return false;
  }
}

function isCoinGeckoSimplePriceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "api.coingecko.com" && parsed.pathname.includes("/simple/price");
  } catch {
    return false;
  }
}

function isBtcEtfDataCurrentUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.hostname === "www.btcetfdata.com" || parsed.hostname === "btcetfdata.com")
      && parsed.pathname === "/v1/current.json";
  } catch {
    return false;
  }
}

function isDefiLlamaStablecoinsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "stablecoins.llama.fi" && parsed.pathname === "/stablecoins";
  } catch {
    return false;
  }
}

function isTreasuryRatesUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "api.fiscaldata.treasury.gov" && parsed.pathname.includes("/avg_interest_rates");
  } catch {
    return false;
  }
}

function isCboeVixUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "cdn.cboe.com"
      && (
        parsed.pathname.endsWith("/VIX_History.csv")
        || parsed.pathname.endsWith("/delayed_quotes/quotes/_VIX.json")
      );
  } catch {
    return false;
  }
}

function extractBinancePremiumValues(payload: unknown): Record<string, string> {
  if (!isRecord(payload)) {
    return {};
  }

  const preferredKeys = [
    "markPrice",
    "indexPrice",
    "lastFundingRate",
    "interestRate",
  ] as const;

  const values: Array<[string, string]> = [];
  for (const key of preferredKeys) {
    const normalized = normalizeScalarValue(payload[key]);
    if (!normalized) continue;
    values.push([key, normalized]);
  }

  return Object.fromEntries(values);
}

function extractBinanceOpenInterestValues(payload: unknown): Record<string, string> {
  if (!isRecord(payload)) {
    return {};
  }

  const preferredKeys = [
    "openInterest",
  ] as const;

  const values: Array<[string, string]> = [];
  for (const key of preferredKeys) {
    const normalized = normalizeScalarValue(payload[key]);
    if (!normalized) continue;
    values.push([key, normalized]);
  }

  return Object.fromEntries(values);
}

function extractCoinGeckoMarketChartValues(payload: unknown): Record<string, string> {
  if (!isRecord(payload)) {
    return {};
  }

  const prices = extractSeries(payload.prices);
  const volumes = extractSeries(payload.total_volumes);
  const marketCaps = extractSeries(payload.market_caps);
  const latestPrice = prices.at(-1)?.[1];
  const firstPrice = prices[0]?.[1];
  const high7d = maxValue(prices);
  const low7d = minValue(prices);
  const latestVolume = volumes.at(-1)?.[1];
  const latestMarketCap = marketCaps.at(-1)?.[1];

  const values: Array<[string, string | null]> = [
    ["currentPriceUsd", formatNumber(latestPrice)],
    ["startingPriceUsd", formatNumber(firstPrice)],
    ["high7d", formatNumber(high7d)],
    ["low7d", formatNumber(low7d)],
    ["latestVolumeUsd", formatNumber(latestVolume)],
    ["latestMarketCapUsd", formatNumber(latestMarketCap)],
  ];

  return Object.fromEntries(values.filter((entry): entry is [string, string] => entry[1] != null));
}

function extractCoinGeckoSimplePriceValues(payload: unknown): Record<string, string> {
  if (!isRecord(payload)) {
    return {};
  }

  const [assetId, quoteMap] = Object.entries(payload)[0] ?? [];
  if (typeof assetId !== "string" || !isRecord(quoteMap)) {
    return {};
  }

  const usd = normalizeScalarValue(quoteMap.usd);
  if (!usd) {
    return {};
  }

  return {
    assetId,
    priceUsd: usd,
  };
}

function extractBtcEtfFlowValues(payload: unknown): Record<string, string> {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    return {};
  }

  const entries = Object.values(payload.data)
    .filter(isRecord)
    .map((entry) => ({
      ticker: typeof entry.ticker === "string" ? entry.ticker : null,
      holdings: numericValue(entry.holdings),
      change: numericValue(entry.change),
      error: entry.error === true,
    }))
    .filter((entry) => entry.ticker != null && entry.holdings != null && entry.change != null && !entry.error);

  if (entries.length === 0) {
    return {};
  }

  const totalHoldings = entries.reduce((sum, entry) => sum + (entry.holdings ?? 0), 0);
  const netFlow = entries.reduce((sum, entry) => sum + (entry.change ?? 0), 0);
  const positive = entries.filter((entry) => (entry.change ?? 0) > 0);
  const negative = entries.filter((entry) => (entry.change ?? 0) < 0);
  const largestInflow = [...positive].sort((a, b) => (b.change ?? 0) - (a.change ?? 0))[0] ?? null;
  const largestOutflow = [...negative].sort((a, b) => (a.change ?? 0) - (b.change ?? 0))[0] ?? null;

  return compactMetrics({
    totalHoldingsBtc: formatNumber(totalHoldings),
    netFlowBtc: formatNumber(netFlow),
    issuerCount: formatNumber(entries.length),
    positiveIssuerCount: formatNumber(positive.length),
    negativeIssuerCount: formatNumber(negative.length),
    largestInflowBtc: formatNumber(largestInflow?.change ?? null),
    largestOutflowBtc: formatNumber(largestOutflow?.change ?? null),
  });
}

function extractDefiLlamaStablecoinValues(payload: unknown, topic?: string): Record<string, string> {
  if (!isRecord(payload) || !Array.isArray(payload.peggedAssets)) {
    return {};
  }

  const targetSymbol = inferAssetAlias(topic ?? "")?.symbol ?? null;
  const assets = payload.peggedAssets.filter(isRecord);
  const matching = targetSymbol
    ? assets.find((entry) => typeof entry.symbol === "string" && entry.symbol.toUpperCase() === targetSymbol)
    : assets[0];

  if (!matching) {
    return {};
  }

  return compactMetrics({
    assetSymbol: typeof matching.symbol === "string" ? matching.symbol.toUpperCase() : null,
    circulatingUsd: formatNestedMetric(matching.circulating),
    circulatingPrevDayUsd: formatNestedMetric(matching.circulatingPrevDay),
    circulatingPrevWeekUsd: formatNestedMetric(matching.circulatingPrevWeek),
    circulatingPrevMonthUsd: formatNestedMetric(matching.circulatingPrevMonth),
  });
}

function extractTreasuryInterestRateValues(payload: unknown): Record<string, string> {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    return {};
  }

  const rows = payload.data.filter(isRecord);
  const marketable = rows.find((entry) => entry.security_type_desc === "Marketable");
  const bills = rows.find((entry) => entry.security_desc === "Treasury Bills");
  const notes = rows.find((entry) => entry.security_desc === "Treasury Notes");

  return compactMetrics({
    marketableAvgRatePct: normalizeScalarValue(marketable?.avg_interest_rate_amt),
    treasuryBillsAvgRatePct: normalizeScalarValue(bills?.avg_interest_rate_amt),
    treasuryNotesAvgRatePct: normalizeScalarValue(notes?.avg_interest_rate_amt),
    recordDate: typeof marketable?.record_date === "string" ? marketable.record_date : null,
  });
}

function extractVixValues(payload: unknown): Record<string, string> {
  if (isRecord(payload) && isRecord(payload.data)) {
    return compactMetrics({
      vixTimestamp: typeof payload.timestamp === "string" ? payload.timestamp : null,
      vixClose: normalizeScalarValue(payload.data.close),
      vixOpen: normalizeScalarValue(payload.data.open),
      vixHigh: normalizeScalarValue(payload.data.high),
      vixLow: normalizeScalarValue(payload.data.low),
      vixPreviousClose: normalizeScalarValue(payload.data.prev_day_close),
      vixCurrentPrice: normalizeScalarValue(payload.data.current_price),
      vixPriceChange: normalizeScalarValue(payload.data.price_change),
      vixPriceChangePercent: normalizeScalarValue(payload.data.price_change_percent),
    });
  }

  if (!Array.isArray(payload) || payload.length === 0) {
    return {};
  }

  const latest = payload.at(-1);
  const previous = payload.length > 1 ? payload.at(-2) : null;
  if (!isRecord(latest)) {
    return {};
  }

  return compactMetrics({
    vixDate: typeof latest.DATE === "string" ? latest.DATE : null,
    vixClose: normalizeScalarValue(latest.CLOSE),
    vixOpen: normalizeScalarValue(latest.OPEN),
    vixHigh: normalizeScalarValue(latest.HIGH),
    vixLow: normalizeScalarValue(latest.LOW),
    vixPreviousClose: previous && isRecord(previous) ? normalizeScalarValue(previous.CLOSE) : null,
  });
}

function deriveResearchMetrics(
  source: MinimalAttestationCandidate,
  sourceKind: ResearchEvidenceSourceKind,
  payload: unknown,
  values: Record<string, string>,
  topic?: string,
): Record<string, string> {
  if (sourceKind === "binance-premium-index") {
    return deriveBinancePremiumMetrics(values);
  }

  if (sourceKind === "binance-open-interest") {
    return deriveBinanceOpenInterestMetrics(values);
  }

  if (sourceKind === "coingecko-market-chart") {
    return deriveCoinGeckoMarketMetrics(values);
  }

  if (sourceKind === "btcetfdata-current") {
    return deriveBtcEtfFlowMetrics(payload, values);
  }

  if (sourceKind === "coingecko-simple-price") {
    return deriveCoinGeckoSimplePriceMetrics(values);
  }

  if (sourceKind === "defillama-stablecoins") {
    return deriveStablecoinSupplyMetrics(values, topic);
  }

  if (sourceKind === "treasury-interest-rates") {
    return deriveTreasuryRateMetrics(values);
  }

  if (sourceKind === "cboe-vix-history") {
    return deriveVixMetrics(values);
  }

  if (source.provider === "generic" && isRecord(payload)) {
    return {};
  }

  return {};
}

function deriveBinancePremiumMetrics(values: Record<string, string>): Record<string, string> {
  return compactMetrics({
    fundingRateBps: scaleValue(values.lastFundingRate, 10_000),
    markIndexSpreadUsd: subtractValues(values.markPrice, values.indexPrice),
  });
}

function deriveBinanceOpenInterestMetrics(values: Record<string, string>): Record<string, string> {
  return compactMetrics({
    openInterestContracts: values.openInterest ?? null,
  });
}

function deriveCoinGeckoMarketMetrics(values: Record<string, string>): Record<string, string> {
  const current = parseNumber(values.currentPriceUsd);
  const start = parseNumber(values.startingPriceUsd);
  let changePercent: string | null = null;
  if (current != null && start != null && start !== 0) {
    changePercent = String(Number((((current - start) / start) * 100).toFixed(2)));
  }

  return compactMetrics({
    priceChangePercent7d: changePercent,
    tradingRangeWidthUsd: subtractValues(values.high7d, values.low7d),
  });
}

function deriveBtcEtfFlowMetrics(payload: unknown, values: Record<string, string>): Record<string, string> {
  const entries = isRecord(payload) && isRecord(payload.data)
    ? Object.values(payload.data).filter(isRecord)
    : [];
  const parsedEntries = entries.map((entry) => ({
    ticker: typeof entry.ticker === "string" ? entry.ticker : null,
    change: numericValue(entry.change),
  }));
  const largestInflow = parsedEntries
    .filter((entry) => entry.ticker && entry.change != null && entry.change > 0)
    .sort((a, b) => (b.change ?? 0) - (a.change ?? 0))[0];
  const largestOutflow = parsedEntries
    .filter((entry) => entry.ticker && entry.change != null && entry.change < 0)
    .sort((a, b) => (a.change ?? 0) - (b.change ?? 0))[0];

  return compactMetrics({
    largestInflowTicker: largestInflow?.ticker ?? null,
    largestOutflowTicker: largestOutflow?.ticker ?? null,
    netFlowDirection: deriveNetFlowDirection(values.netFlowBtc),
  });
}

function deriveCoinGeckoSimplePriceMetrics(values: Record<string, string>): Record<string, string> {
  const price = parseNumber(values.priceUsd);
  if (price == null) {
    return {};
  }

  const pegDeviation = Math.abs(price - 1) * 100;
  return compactMetrics({
    pegDeviationPct: String(Number(pegDeviation.toFixed(4))),
  });
}

function deriveStablecoinSupplyMetrics(values: Record<string, string>, topic?: string): Record<string, string> {
  return compactMetrics({
    supplyChangePct1d: percentChange(values.circulatingUsd, values.circulatingPrevDayUsd),
    supplyChangePct7d: percentChange(values.circulatingUsd, values.circulatingPrevWeekUsd),
    supplyChangePct30d: percentChange(values.circulatingUsd, values.circulatingPrevMonthUsd),
    stablecoinFocus: inferAssetAlias(topic ?? "")?.symbol ?? values.assetSymbol ?? null,
  });
}

function deriveTreasuryRateMetrics(values: Record<string, string>): Record<string, string> {
  return compactMetrics({
    billNoteSpreadBps: basisPointSpread(values.treasuryBillsAvgRatePct, values.treasuryNotesAvgRatePct),
  });
}

function deriveVixMetrics(values: Record<string, string>): Record<string, string> {
  return compactMetrics({
    vixSessionChangePct: percentChange(values.vixClose, values.vixPreviousClose),
    vixIntradayRange: subtractValues(values.vixHigh, values.vixLow),
  });
}

function parseResearchEvidencePayload(
  source: MinimalAttestationCandidate,
  _sourceKind: ResearchEvidenceSourceKind,
  contentType: string,
  body: string,
): unknown {
  if (
    source.responseFormat === "csv"
    || contentType.includes("text/csv")
    || source.url.toLowerCase().endsWith(".csv")
  ) {
    return parseCsv(body);
  }

  return JSON.parse(body) as unknown;
}

function classifyResearchEvidenceSource(source: MinimalAttestationCandidate): ResearchEvidenceSourceKind {
  const sourceId = source.sourceId.toLowerCase();
  const provider = source.provider.toLowerCase();
  const name = source.name.toLowerCase();

  if (sourceId === "cboe-vix-daily" || provider === "cboe") {
    return "cboe-vix-history";
  }

  if (sourceId === "treasury-interest-rates" || (provider === "treasury" && name.includes("rates"))) {
    return "treasury-interest-rates";
  }

  if (sourceId === "defillama-stablecoins" || (provider === "defillama" && name.includes("stablecoins"))) {
    return "defillama-stablecoins";
  }

  if (sourceId.startsWith("btcetfdata-current") || provider === "btcetfdata") {
    return "btcetfdata-current";
  }

  if (sourceId === "coingecko-42ff8c85" || (provider === "coingecko" && name.includes("market"))) {
    return "coingecko-market-chart";
  }

  if (sourceId === "coingecko-2a7ea372" || (provider === "coingecko" && name.includes("simple"))) {
    return "coingecko-simple-price";
  }

  if (sourceId.startsWith("binance-futures-oi-") || (provider === "binance-futures" && name.includes("open-interest"))) {
    return "binance-open-interest";
  }

  if (sourceId.startsWith("binance-futures-") || (provider === "binance-futures" && name.includes("premium"))) {
    return "binance-premium-index";
  }

  // Compatibility fallback for feed-derived or older opaque candidates.
  if (isCboeVixUrl(source.url)) return "cboe-vix-history";
  if (isTreasuryRatesUrl(source.url)) return "treasury-interest-rates";
  if (isDefiLlamaStablecoinsUrl(source.url)) return "defillama-stablecoins";
  if (isBtcEtfDataCurrentUrl(source.url)) return "btcetfdata-current";
  if (isCoinGeckoMarketChartUrl(source.url)) return "coingecko-market-chart";
  if (isCoinGeckoSimplePriceUrl(source.url)) return "coingecko-simple-price";
  if (isBinanceOpenInterestUrl(source.url)) return "binance-open-interest";
  if (isBinancePremiumIndexUrl(source.url)) return "binance-premium-index";
  return "generic";
}

function parseCsv(body: string): Array<Record<string, string>> {
  const lines = body.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const [header, ...rows] = lines;
  if (!header) {
    return [];
  }

  const columns = header.split(",").map((value) => value.trim());
  return rows.map((row) => {
    const values = row.split(",").map((value) => value.trim());
    return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]));
  });
}

function formatNestedMetric(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const peggedUsd = value.peggedUSD;
  return typeof peggedUsd === "number" && Number.isFinite(peggedUsd)
    ? String(Number(peggedUsd.toFixed(2)))
    : null;
}

function normalizeScalarValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    if (isNumericString(trimmed)) return trimmed;
  }

  return null;
}

function isNumericString(value: string): boolean {
  return /^-?\d+(?:\.\d+)?$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractSeries(value: unknown): Array<[number, number]> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is [number, number] =>
      Array.isArray(entry)
      && entry.length >= 2
      && typeof entry[0] === "number"
      && typeof entry[1] === "number"
      && Number.isFinite(entry[0])
      && Number.isFinite(entry[1]))
    .map((entry) => [entry[0], entry[1]]);
}

function maxValue(series: Array<[number, number]>): number | null {
  if (series.length === 0) return null;
  return Math.max(...series.map((entry) => entry[1]));
}

function minValue(series: Array<[number, number]>): number | null {
  if (series.length === 0) return null;
  return Math.min(...series.map((entry) => entry[1]));
}

function formatNumber(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const absolute = Math.abs(value);
  const decimals = absolute >= 1 ? 2 : absolute >= 0.01 ? 4 : 8;
  return value.toFixed(decimals).replace(/\.?0+$/, "");
}

function parseNumber(value: string | undefined): number | null {
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function scaleValue(value: string | undefined, factor: number): string | null {
  const parsed = parseNumber(value);
  if (parsed == null) return null;
  return String(Number((parsed * factor).toFixed(2)));
}

function subtractValues(left: string | undefined, right: string | undefined): string | null {
  const a = parseNumber(left);
  const b = parseNumber(right);
  if (a == null || b == null) return null;
  return String(Number((a - b).toFixed(2)));
}

function percentChange(currentValue: string | undefined, previousValue: string | undefined): string | null {
  const current = parseNumber(currentValue);
  const previous = parseNumber(previousValue);
  if (current == null || previous == null || previous === 0) {
    return null;
  }
  return String(Number((((current - previous) / previous) * 100).toFixed(2)));
}

function basisPointSpread(left: string | undefined, right: string | undefined): string | null {
  const a = parseNumber(left);
  const b = parseNumber(right);
  if (a == null || b == null) {
    return null;
  }
  return String(Number(((a - b) * 100).toFixed(2)));
}

function compactMetrics(metrics: Record<string, string | null>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metrics).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0),
  );
}

function deriveNetFlowDirection(value: string | undefined): string | null {
  const parsed = parseNumber(value);
  if (parsed == null) return null;
  if (parsed > 0) return "inflow";
  if (parsed < 0) return "outflow";
  return "flat";
}
