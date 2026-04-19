import {
  buildMinimalAttestationPlan,
  buildMinimalAttestationPlanFromUrls,
  type MinimalAttestationPlan,
} from "./minimal-attestation-plan.js";

export interface MarketSignalInput {
  topic: string | null;
  confidence: number | null;
  direction: string | null;
  assets?: string[];
}

export interface MarketPostInput {
  txHash: string | null;
  category: string | null;
  text: string;
  author: string | null;
  timestamp: number | null;
}

export interface MarketPriceInput {
  ticker: string;
  priceUsd: number;
  change24h: number | null;
  source: string | null;
  fetchedAt: number | null;
}

export interface MarketOracleDivergenceInput {
  asset: string;
  severity: "low" | "medium" | "high";
  type: string;
  description: string;
  details?: {
    agentDirection?: string;
    marketDirection?: string;
    agentConfidence?: number;
    marketSignal?: string;
  };
}

export interface DeriveMarketOpportunitiesOptions {
  signals: MarketSignalInput[];
  divergences: MarketOracleDivergenceInput[];
  prices: MarketPriceInput[];
  posts: MarketPostInput[];
  nowMs?: number;
  staleAfterMs?: number;
  recentAssets?: string[];
  lastAsset?: string | null;
  recentAssetPenalty?: number;
  minPriceMismatch?: number;
}

export interface MarketOpportunity {
  kind: "oracle_divergence" | "signal_price_mismatch" | "stale_divergence";
  asset: string;
  score: number;
  rationale: string;
  divergence: MarketOracleDivergenceInput | null;
  matchedSignal: MarketSignalInput | null;
  priceSnapshot: MarketPriceInput | null;
  matchingFeedPosts: MarketPostInput[];
  lastSeenAt: number | null;
  attestationPlan: MinimalAttestationPlan;
  recommendedDirection: "higher" | "lower" | null;
}

const DEFAULT_STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const DEFAULT_RECENT_ASSET_PENALTY = 15;
const DEFAULT_MIN_PRICE_MISMATCH = 3;

export function deriveMarketOpportunities(
  opts: DeriveMarketOpportunitiesOptions,
): MarketOpportunity[] {
  const nowMs = opts.nowMs ?? Date.now();
  const staleAfterMs = opts.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const recentAssetPenalty = opts.recentAssetPenalty ?? DEFAULT_RECENT_ASSET_PENALTY;
  const minPriceMismatch = opts.minPriceMismatch ?? DEFAULT_MIN_PRICE_MISMATCH;
  const recentAssets = new Set((opts.recentAssets ?? []).map(normalizeAsset).filter(Boolean));
  const lastAsset = normalizeAsset(opts.lastAsset);
  const opportunities: MarketOpportunity[] = [];

  const assets = new Set<string>();
  for (const divergence of opts.divergences) assets.add(normalizeAsset(divergence.asset));
  for (const price of opts.prices) assets.add(normalizeAsset(price.ticker));
  for (const signal of opts.signals) {
    for (const asset of signal.assets ?? []) {
      assets.add(normalizeAsset(asset));
    }
    const topicAsset = extractAssetFromTopic(signal.topic);
    if (topicAsset) assets.add(topicAsset);
  }

  for (const asset of assets) {
    if (!asset || asset === lastAsset) continue;

    const divergence = selectBestDivergence(opts.divergences, asset);
    const matchedSignal = selectSignal(opts.signals, asset);
    const priceSnapshot = selectPrice(opts.prices, asset);
    const matchingFeedPosts = opts.posts.filter((post) => mentionsAsset(post.text, asset));
    const lastSeenAt = matchingFeedPosts.reduce<number | null>((latest, post) => {
      if (typeof post.timestamp !== "number") return latest;
      return latest == null || post.timestamp > latest ? post.timestamp : latest;
    }, null);
    const attestationPlan = buildMarketAttestationPlan(asset);
    const supportingBonus = attestationPlan.supporting.length * 3;
    const attestationPenalty = attestationPlan.ready ? 0 : 20;
    const repeatedAssetPenalty = recentAssets.has(asset) ? recentAssetPenalty : 0;

    if (divergence) {
      opportunities.push({
        kind: "oracle_divergence",
        asset,
        score: severityScore(divergence.severity)
          + signalBonus(matchedSignal?.confidence ?? null)
          + supportingBonus
          - attestationPenalty
          - repeatedAssetPenalty,
        rationale: `${asset} shows a fresh ${divergence.severity} sentiment-price dislocation that is worth monitoring with attested price context.`,
        divergence,
        matchedSignal,
        priceSnapshot,
        matchingFeedPosts,
        lastSeenAt,
        attestationPlan,
        recommendedDirection: inferDirection(divergence, matchedSignal, priceSnapshot),
      });
    }

    if (
      matchedSignal
      && priceSnapshot
      && isSignalPriceMismatch(matchedSignal.direction, priceSnapshot.change24h, minPriceMismatch)
    ) {
      opportunities.push({
        kind: "signal_price_mismatch",
        asset,
        score: 72
          + signalBonus(matchedSignal.confidence)
          + supportingBonus
          - attestationPenalty
          - repeatedAssetPenalty,
        rationale: `${asset} signal direction and live 24h price change are pulling in opposite directions, creating a publishable mismatch.`,
        divergence,
        matchedSignal,
        priceSnapshot,
        matchingFeedPosts,
        lastSeenAt,
        attestationPlan,
        recommendedDirection: inferDirection(divergence, matchedSignal, priceSnapshot),
      });
    }

    if (divergence && lastSeenAt != null && nowMs - lastSeenAt > staleAfterMs) {
      opportunities.push({
        kind: "stale_divergence",
        asset,
        score: severityScore(divergence.severity) - 8 + supportingBonus - attestationPenalty - repeatedAssetPenalty,
        rationale: `${asset} still shows a sentiment-price dislocation, but the feed has gone stale on the topic and needs a fresh evidence-bound update.`,
        divergence,
        matchedSignal,
        priceSnapshot,
        matchingFeedPosts,
        lastSeenAt,
        attestationPlan,
        recommendedDirection: inferDirection(divergence, matchedSignal, priceSnapshot),
      });
    }
  }

  opportunities.sort((left, right) => right.score - left.score);
  return opportunities;
}

function buildMarketAttestationPlan(asset: string): MinimalAttestationPlan {
  const topicPlan = buildMinimalAttestationPlan({
      topic: `${asset} crypto prices`,
      agent: "sentinel",
      minSupportingSources: 1,
    });

  if (topicPlan.ready) {
    return topicPlan;
  }

  return buildMinimalAttestationPlanFromUrls({
    topic: `${asset} crypto prices`,
    urls: defaultMarketSourceUrls(asset),
    minSupportingSources: 1,
  });
}

function defaultMarketSourceUrls(asset: string): string[] {
  const id = asset === "BTC" ? "bitcoin" : asset === "ETH" ? "ethereum" : asset === "SOL" ? "solana" : asset.toLowerCase();
  return [
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
    `https://api.binance.com/api/v3/ticker/price?symbol=${asset}USDT`,
  ];
}

function selectBestDivergence(
  divergences: MarketOracleDivergenceInput[],
  asset: string,
): MarketOracleDivergenceInput | null {
  const matches = divergences.filter((divergence) => normalizeAsset(divergence.asset) === asset);
  if (matches.length === 0) return null;
  matches.sort((left, right) => severityRank(right.severity) - severityRank(left.severity));
  return matches[0];
}

function selectSignal(signals: MarketSignalInput[], asset: string): MarketSignalInput | null {
  const matches = signals.filter((signal) => signalMatchesAsset(signal, asset));
  if (matches.length === 0) return null;
  matches.sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0));
  return matches[0];
}

function selectPrice(prices: MarketPriceInput[], asset: string): MarketPriceInput | null {
  const match = prices.find((price) => normalizeAsset(price.ticker) === asset);
  return match ?? null;
}

function signalMatchesAsset(signal: MarketSignalInput, asset: string): boolean {
  if ((signal.assets ?? []).some((candidate) => normalizeAsset(candidate) === asset)) {
    return true;
  }

  const topic = normalizeText(signal.topic);
  return topic.includes(asset.toLowerCase());
}

function mentionsAsset(text: string, asset: string): boolean {
  const normalized = normalizeText(text);
  return normalized.includes(asset.toLowerCase()) || normalized.includes(assetName(asset));
}

function isSignalPriceMismatch(
  direction: string | null | undefined,
  change24h: number | null,
  minPriceMismatch: number,
): boolean {
  if (typeof change24h !== "number") return false;
  if (Math.abs(change24h) < minPriceMismatch) return false;

  const normalizedDirection = normalizeText(direction);
  if (["bullish", "higher", "up", "long", "positive"].includes(normalizedDirection)) {
    return change24h < 0;
  }
  if (["bearish", "lower", "down", "short", "negative"].includes(normalizedDirection)) {
    return change24h > 0;
  }
  return false;
}

function inferDirection(
  divergence: MarketOracleDivergenceInput | null,
  signal: MarketSignalInput | null,
  price: MarketPriceInput | null,
): "higher" | "lower" | null {
  const candidates = [
    divergence?.details?.agentDirection,
    divergence?.details?.marketDirection,
    signal?.direction,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeText(candidate);
    if (["bullish", "higher", "up", "long", "positive"].includes(normalized)) return "higher";
    if (["bearish", "lower", "down", "short", "negative"].includes(normalized)) return "lower";
  }

  if (typeof price?.change24h === "number") {
    if (price.change24h > 0) return "higher";
    if (price.change24h < 0) return "lower";
  }

  return null;
}

function severityScore(severity: MarketOracleDivergenceInput["severity"]): number {
  switch (severity) {
    case "high":
      return 85;
    case "medium":
      return 74;
    default:
      return 60;
  }
}

function severityRank(severity: MarketOracleDivergenceInput["severity"]): number {
  switch (severity) {
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
}

function signalBonus(confidence: number | null): number {
  const value = typeof confidence === "number" ? confidence : 50;
  return Math.max(0, Math.round((value - 50) / 2));
}

function extractAssetFromTopic(topic: string | null): string | null {
  const normalized = normalizeText(topic);
  if (normalized.includes("btc") || normalized.includes("bitcoin")) return "BTC";
  if (normalized.includes("eth") || normalized.includes("ethereum")) return "ETH";
  if (normalized.includes("sol") || normalized.includes("solana")) return "SOL";
  return null;
}

function assetName(asset: string): string {
  switch (asset) {
    case "BTC":
      return "bitcoin";
    case "ETH":
      return "ethereum";
    case "SOL":
      return "solana";
    default:
      return asset.toLowerCase();
  }
}

function normalizeAsset(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase();
}

function normalizeText(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}
