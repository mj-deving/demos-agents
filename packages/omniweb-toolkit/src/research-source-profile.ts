import { inferAssetAlias } from "../../../src/toolkit/chain/asset-helpers.js";

export type ResearchTopicFamily =
  | "funding-structure"
  | "etf-flows"
  | "spot-momentum"
  | "network-activity"
  | "stablecoin-supply"
  | "vix-credit"
  | "unsupported";

export interface ResearchSourceProfile {
  family: ResearchTopicFamily;
  topic: string;
  asset: { asset: string; symbol: string } | null;
  supported: boolean;
  reason: string | null;
  primarySourceIds: string[];
  supportingSourceIds: string[];
  expectedMetrics: string[];
}

const FUNDING_TERMS = [
  "funding",
  "funding rate",
  "premium",
  "basis",
  "perp",
  "perpetual",
  "open interest",
  "oi",
];

const SPOT_TERMS = [
  "price",
  "momentum",
  "sentiment",
  "volatility",
  "trading",
  "volume",
  "breakout",
  "selloff",
  "bounce",
  "reversal",
];

const NETWORK_TERMS = [
  "on-chain",
  "onchain",
  "network",
  "mempool",
  "fees",
  "whale",
  "miner",
  "hashrate",
  "addresses",
  "bridging",
];

const ETF_TERMS = [
  "etf",
  "flow",
  "flows",
  "inflow",
  "outflow",
  "custody",
];

const STABLECOIN_TERMS = [
  "stablecoin",
  "supply",
  "mint",
  "redemption",
  "depeg",
  "peg",
  "inflation",
  "ath",
];

const VIX_CREDIT_TERMS = [
  "vix",
  "credit",
  "recession",
  "stress",
  "risk",
];

const PRICE_TICKER_SOURCE_IDS: Partial<Record<string, string>> = {
  BTC: "binance-24hr-btc",
};

const FUNDING_SOURCE_IDS: Partial<Record<string, string[]>> = {
  BTC: ["binance-futures-btc", "binance-futures-oi-btc", "coingecko-42ff8c85", "coingecko-2a7ea372"],
  ETH: ["binance-futures-eth", "binance-futures-oi-eth", "coingecko-42ff8c85", "coingecko-2a7ea372"],
  SOL: ["binance-futures-sol", "coingecko-42ff8c85", "coingecko-2a7ea372"],
};

const ETF_FLOW_SOURCE_IDS: Partial<Record<string, string[]>> = {
  BTC: ["btcetfdata-current-btc", "binance-24hr-btc"],
};

const NETWORK_SOURCE_IDS: Partial<Record<string, string[]>> = {
  BTC: ["blockchair-btc-stats", "coingecko-2a7ea372"],
  ETH: ["blockchair-eth-stats", "coingecko-2a7ea372"],
  SOL: ["blockchair-solana", "coingecko-2a7ea372"],
};

function stablecoinSourceIdsFor(symbol: string): string[] {
  if (symbol === "USDT" || symbol === "USDC") {
    return ["defillama-stablecoins", "coingecko-2a7ea372"];
  }
  return [];
}

export function deriveResearchSourceProfile(topic: string): ResearchSourceProfile {
  const normalized = topic.trim().toLowerCase();
  const asset = inferAssetAlias(topic);

  if (containsAny(normalized, VIX_CREDIT_TERMS) && containsAny(normalized, ["vix", "credit", "recession"])) {
    return {
      family: "vix-credit",
      topic,
      asset: null,
      supported: true,
      reason: null,
      primarySourceIds: ["cboe-vix-daily"],
      supportingSourceIds: ["treasury-interest-rates"],
      expectedMetrics: [
        "vixClose",
        "vixPreviousClose",
        "vixHigh",
        "vixLow",
        "treasuryBillsAvgRatePct",
        "treasuryNotesAvgRatePct",
        "vixSessionChangePct",
        "billNoteSpreadBps",
      ],
    };
  }

  if (asset && containsAny(normalized, ETF_TERMS)) {
    const ids = ETF_FLOW_SOURCE_IDS[asset.symbol] ?? [];
    if (ids.length === 0) {
      return unsupportedProfile(topic, asset, "no_family_sources_for_asset");
    }
    return {
      family: "etf-flows",
      topic,
      asset,
      supported: true,
      reason: null,
      primarySourceIds: ids.slice(0, 1),
      supportingSourceIds: ids.slice(1),
      expectedMetrics: [
        "totalHoldingsBtc",
        "netFlowBtc",
        "positiveIssuerCount",
        "negativeIssuerCount",
        "largestInflowBtc",
        "largestOutflowBtc",
      ],
    };
  }

  if (asset && containsAny(normalized, FUNDING_TERMS)) {
    const ids = FUNDING_SOURCE_IDS[asset.symbol] ?? [];
    if (ids.length === 0) {
      return unsupportedProfile(topic, asset, "no_family_sources_for_asset");
    }
    return {
      family: "funding-structure",
      topic,
      asset,
      supported: true,
      reason: null,
      primarySourceIds: ids.slice(0, 1),
      supportingSourceIds: ids.slice(1),
      expectedMetrics: ["markPrice", "indexPrice", "lastFundingRate", "openInterest", "priceChangePercent7d"],
    };
  }

  if (asset && containsAny(normalized, NETWORK_TERMS)) {
    const ids = NETWORK_SOURCE_IDS[asset.symbol] ?? [];
    if (ids.length === 0) {
      return unsupportedProfile(topic, asset, "no_family_sources_for_asset");
    }
    return {
      family: "network-activity",
      topic,
      asset,
      supported: true,
      reason: null,
      primarySourceIds: ids.slice(0, 1),
      supportingSourceIds: ids.slice(1),
      expectedMetrics: ["blockCount24h", "transactionCount24h", "hashrate24h", "priceUsd", "transactionsPerBlock24h"],
    };
  }

  if (asset && containsAny(normalized, STABLECOIN_TERMS)) {
    const ids = stablecoinSourceIdsFor(asset.symbol);
    if (ids.length === 0) {
      return unsupportedProfile(topic, asset, "no_family_sources_for_asset");
    }
    return {
      family: "stablecoin-supply",
      topic,
      asset,
      supported: true,
      reason: null,
      primarySourceIds: ids.slice(0, 1),
      supportingSourceIds: ids.slice(1),
      expectedMetrics: [
        "circulatingUsd",
        "circulatingPrevDayUsd",
        "circulatingPrevWeekUsd",
        "priceUsd",
        "supplyChangePct7d",
      ],
    };
  }

  if (asset && containsAny(normalized, SPOT_TERMS)) {
    const ids = ["coingecko-42ff8c85", "coingecko-2a7ea372"];
    const ticker = PRICE_TICKER_SOURCE_IDS[asset.symbol];
    if (ticker) ids.splice(1, 0, ticker);
    return {
      family: "spot-momentum",
      topic,
      asset,
      supported: true,
      reason: null,
      primarySourceIds: ids.slice(0, 1),
      supportingSourceIds: ids.slice(1),
      expectedMetrics: ["currentPriceUsd", "priceChangePercent7d", "high7d", "low7d", "latestVolumeUsd"],
    };
  }

  return unsupportedProfile(topic, asset, asset ? "no_supported_research_family" : "asset_not_detected");
}

function unsupportedProfile(
  topic: string,
  asset: { asset: string; symbol: string } | null,
  reason: string,
): ResearchSourceProfile {
  return {
    family: "unsupported",
    topic,
    asset,
    supported: false,
    reason,
    primarySourceIds: [],
    supportingSourceIds: [],
    expectedMetrics: [],
  };
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => matchesTerm(text, term));
}

function matchesTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}
