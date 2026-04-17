import { describe, expect, it, vi } from "vitest";
import { buildMarketDraft } from "../../packages/omniweb-toolkit/src/market-draft.js";
import type { MarketOpportunity } from "../../packages/omniweb-toolkit/src/market-opportunities.js";

function makeOpportunity(): MarketOpportunity {
  return {
    kind: "oracle_divergence",
    asset: "BTC",
    score: 88,
    rationale: "BTC has a fresh high-severity oracle divergence that exceeds the publish threshold.",
    divergence: {
      asset: "BTC",
      severity: "high",
      type: "agents_vs_market",
      description: "Agents are leaning bearish while the market is pricing a higher move.",
      details: {
        agentDirection: "bearish",
        marketDirection: "higher",
      },
    },
    matchedSignal: {
      topic: "BTC funding setup",
      confidence: 76,
      direction: "bearish",
      assets: ["BTC"],
    },
    priceSnapshot: {
      ticker: "BTC",
      priceUsd: 67250,
      change24h: -4.2,
      source: "coingecko",
      fetchedAt: Date.UTC(2026, 3, 17, 12, 0, 0),
    },
    matchingFeedPosts: [],
    lastSeenAt: null,
    recommendedDirection: "lower",
    attestationPlan: {
      topic: "BTC crypto prices",
      agent: "sentinel",
      catalogPath: "/tmp/catalog.json",
      ready: true,
      reason: "ready",
      primary: {
        sourceId: "coingecko-price",
        name: "CoinGecko Simple Price",
        provider: "coingecko",
        status: "active",
        trustTier: "official",
        responseFormat: "json",
        ratingOverall: 88,
        dahrSafe: true,
        tlsnSafe: false,
        url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
        score: 17,
      },
      supporting: [
        {
          sourceId: "binance-btc",
          name: "Binance BTC Ticker",
          provider: "binance",
          status: "active",
          trustTier: "market",
          responseFormat: "json",
          ratingOverall: 74,
          dahrSafe: true,
          tlsnSafe: false,
          url: "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
          score: 12,
        },
      ],
      fallbacks: [],
      warnings: [],
    },
  };
}

describe("buildMarketDraft", () => {
  it("requires a real LLM provider for Phase 2 drafting", async () => {
    const result = await buildMarketDraft({
      opportunity: makeOpportunity(),
      feedCount: 20,
      availableBalance: 25,
      oracleAssetCount: 2,
      llmProvider: null,
      minTextLength: 220,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("llm_provider_unavailable");
    expect(result.promptPacket.input.asset).toBe("BTC");
    expect(result.promptPacket.archetype).toBe("market-analyst");
  });

  it("accepts LLM output only when it clears the quality gate", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "BTC has a live high-severity oracle divergence because the packet still shows agents leaning bearish while the market side is pricing a higher move. " +
        "The observed BTC price is 67,250 dollars with a negative 4.2 percent 24-hour move, which makes the disagreement measurable instead of vague. " +
        "A live publish should anchor on CoinGecko Simple Price, cross-check Binance BTC Ticker, and keep conviction measured until the next attested fetch confirms whether bearish positioning or market momentum resolves the split."
      ),
    };

    const result = await buildMarketDraft({
      opportunity: makeOpportunity(),
      feedCount: 20,
      availableBalance: 25,
      oracleAssetCount: 2,
      llmProvider: provider,
      minTextLength: 220,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.draftSource).toBe("llm");
    expect(result.qualityGate.pass).toBe(true);
    expect(result.text).toContain("67,250");
    expect(result.promptPacket.instruction).toContain("Lead with the edge");
    expect(result.promptPacket.constraints.join(" ")).toContain("Do not mention internal opportunity scores");
    expect(result.promptPacket.edge[0]).toContain("Speed and precision");
    expect(result.promptPacket.output.confidenceStyle).toContain("fast but measured");
    expect(result.promptPacket.output.successCriteria[0]).toContain("trader's edge summary");
  });

  it("skips short low-quality output instead of publishing a template fallback", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue("BTC divergence exists."),
    };

    const result = await buildMarketDraft({
      opportunity: makeOpportunity(),
      feedCount: 20,
      availableBalance: 25,
      oracleAssetCount: 2,
      llmProvider: provider,
      minTextLength: 220,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("draft_quality_gate_failed");
  });
});
