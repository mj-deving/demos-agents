import { describe, expect, it } from "vitest";
import { deriveMarketOpportunities } from "../../packages/omniweb-toolkit/src/market-opportunities.js";

describe("deriveMarketOpportunities", () => {
  it("prioritizes fresh high-severity oracle divergence opportunities", () => {
    const opportunities = deriveMarketOpportunities({
      signals: [
        {
          topic: "BTC funding setup",
          confidence: 76,
          direction: "bearish",
          assets: ["BTC"],
        },
      ],
      divergences: [
        {
          asset: "BTC",
          severity: "high",
          type: "agents_vs_market",
          description: "Agents lean bearish while spot and funding remain elevated.",
          details: {
            agentDirection: "bearish",
            marketDirection: "higher",
          },
        },
      ],
      prices: [
        {
          ticker: "BTC",
          priceUsd: 67250,
          change24h: -4.2,
          source: "coingecko",
          fetchedAt: Date.UTC(2026, 3, 17, 12, 0, 0),
        },
      ],
      posts: [],
    });

    expect(opportunities[0]?.kind).toBe("oracle_divergence");
    expect(opportunities[0]?.asset).toBe("BTC");
    expect(opportunities[0]?.attestationPlan.ready).toBe(true);
    expect(opportunities[0]?.relatedSignals).toHaveLength(1);
  });

  it("detects signal-price mismatches when direction and price move conflict", () => {
    const opportunities = deriveMarketOpportunities({
      signals: [
        {
          topic: "ETH breakout setup",
          confidence: 72,
          direction: "bullish",
          assets: ["ETH"],
        },
      ],
      divergences: [],
      prices: [
        {
          ticker: "ETH",
          priceUsd: 3150,
          change24h: -5.4,
          source: "coingecko",
          fetchedAt: Date.UTC(2026, 3, 17, 12, 0, 0),
        },
      ],
      posts: [],
    });

    expect(opportunities[0]?.kind).toBe("signal_price_mismatch");
    expect(opportunities[0]?.recommendedDirection).toBe("higher");
    expect(opportunities[0]?.relatedSignals).toHaveLength(1);
  });

  it("penalizes recently covered assets", () => {
    const opportunities = deriveMarketOpportunities({
      signals: [
        {
          topic: "BTC setup",
          confidence: 80,
          direction: "bullish",
          assets: ["BTC"],
        },
        {
          topic: "ETH setup",
          confidence: 80,
          direction: "bullish",
          assets: ["ETH"],
        },
      ],
      divergences: [
        {
          asset: "BTC",
          severity: "high",
          type: "agents_vs_market",
          description: "BTC divergence",
        },
        {
          asset: "ETH",
          severity: "high",
          type: "agents_vs_market",
          description: "ETH divergence",
        },
      ],
      prices: [
        {
          ticker: "BTC",
          priceUsd: 67000,
          change24h: 2.1,
          source: "coingecko",
          fetchedAt: Date.UTC(2026, 3, 17, 12, 0, 0),
        },
        {
          ticker: "ETH",
          priceUsd: 3100,
          change24h: 2.1,
          source: "coingecko",
          fetchedAt: Date.UTC(2026, 3, 17, 12, 0, 0),
        },
      ],
      posts: [],
      recentAssets: ["BTC"],
    });

    expect(opportunities[0]?.asset).toBe("ETH");
    expect(opportunities[0]?.relatedSignals[0]?.topic).toBe("ETH setup");
  });
});
