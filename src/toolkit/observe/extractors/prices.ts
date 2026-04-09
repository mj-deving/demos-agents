/**
 * Prices evidence extractor.
 * Maps price data to AvailableEvidence.
 */
import type { Toolkit } from "../../primitives/types.js";
import type { AvailableEvidence } from "../../colony/available-evidence.js";
import type { PrefetchedData } from "../observe-router.js";
import { capRichness } from "./helpers.js";

export async function extractPrices(toolkit: Toolkit, prefetched?: PrefetchedData): Promise<AvailableEvidence[]> {
  const result = prefetched?.prices ?? await toolkit.prices.get(["BTC", "ETH"]);
  if (!result || !result.ok) return [];
  if (!Array.isArray(result.data)) return [];

  return result.data.map((price) => {
    const age = Date.now() - price.fetchedAt;

    return {
      sourceId: `price-${price.ticker}`,
      subject: price.ticker,
      metrics: [
        `usd:${price.priceUsd}`,
        `change24h:${price.change24h ?? 0}`,
        `source:${price.source}`,
      ],
      richness: capRichness(price.volume24h ? 70 : 40),
      freshness: Math.floor(age / 1000),
      stale: age > 300_000, // price data stale after 5 minutes
    };
  });
}
