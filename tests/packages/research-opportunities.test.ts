import { describe, expect, it } from "vitest";
import { deriveResearchOpportunities } from "../../packages/omniweb-toolkit/src/research-opportunities.js";

describe("deriveResearchOpportunities", () => {
  it("ranks contradiction opportunities ahead of simple coverage gaps", () => {
    const nowMs = Date.UTC(2026, 3, 17, 15, 0, 0);
    const opportunities = deriveResearchOpportunities({
      nowMs,
      signals: [
        { topic: "BTC Sentiment vs Funding", confidence: 76, direction: "bearish" },
        { topic: "USDT Supply ATH Stablecoin Inflation", confidence: 74, direction: "mixed" },
      ],
      posts: [
        {
          txHash: "0x1",
          category: "ANALYSIS",
          text: "BTC Sentiment vs Funding now looks bullish and higher into the next session.",
          author: "0xa",
          timestamp: nowMs - 30 * 60 * 1000,
        },
        {
          txHash: "0x2",
          category: "ANALYSIS",
          text: "BTC Sentiment vs Funding stays bearish and lower despite the last bounce.",
          author: "0xb",
          timestamp: nowMs - 25 * 60 * 1000,
        },
      ],
    });

    expect(opportunities[0].kind).toBe("contradiction");
    expect(opportunities[0].topic).toBe("btc sentiment vs funding");
    expect(opportunities[0].contradictionSignals).toEqual(["bearish", "bullish", "higher", "lower"]);
    expect(opportunities[1].kind).toBe("coverage_gap");
  });

  it("ranks uncovered high-confidence signals ahead of stale lower-confidence topics", () => {
    const nowMs = Date.UTC(2026, 3, 17, 15, 0, 0);
    const opportunities = deriveResearchOpportunities({
      nowMs,
      signals: [
        { topic: "BTC Sentiment vs Funding", confidence: 76, direction: "bearish" },
        { topic: "USDT Supply ATH Stablecoin Inflation", confidence: 72, direction: "mixed" },
      ],
      posts: [
        {
          txHash: "0xold",
          category: "ANALYSIS",
          text: "USDT Supply ATH Stablecoin Inflation remains unresolved.",
          author: "0x1",
          timestamp: nowMs - 8 * 60 * 60 * 1000,
        },
      ],
      lastCoverageTopic: "already-used-topic",
    });

    expect(opportunities).toHaveLength(2);
    expect(opportunities[0].topic).toBe("btc sentiment vs funding");
    expect(opportunities[0].kind).toBe("coverage_gap");
    expect(opportunities[1].topic).toBe("usdt supply ath stablecoin inflation");
    expect(opportunities[1].kind).toBe("stale_topic");
  });

  it("uses a conservative confidence floor by default", () => {
    const opportunities = deriveResearchOpportunities({
      signals: [
        { topic: "Lower Confidence Topic", confidence: 69, direction: "mixed" },
      ],
      posts: [],
    });

    expect(opportunities).toEqual([]);
  });

  it("downgrades recently covered topics using topic history", () => {
    const opportunities = deriveResearchOpportunities({
      signals: [
        { topic: "BTC Sentiment vs Funding", confidence: 76, direction: "bearish" },
        { topic: "USDT Supply ATH Stablecoin Inflation", confidence: 75, direction: "bullish" },
      ],
      posts: [],
      recentCoverageTopics: ["btc sentiment vs funding"],
      recentCoveragePenalty: 30,
    });

    expect(opportunities).toHaveLength(2);
    expect(opportunities[0].topic).toBe("usdt supply ath stablecoin inflation");
    expect(opportunities[1].topic).toBe("btc sentiment vs funding");
    expect(opportunities[0].score).toBeGreaterThan(opportunities[1].score);
  });

  it("softly downgrades recently covered families without suppressing distinct topics", () => {
    const opportunities = deriveResearchOpportunities({
      signals: [
        { topic: "Private Credit Yield Premium", confidence: 76, direction: "bearish" },
        { topic: "USDT Supply ATH Stablecoin Inflation", confidence: 74, direction: "mixed" },
      ],
      posts: [],
      recentCoverageFamilies: ["vix-credit"],
      recentFamilyCoveragePenalty: 10,
    });

    expect(opportunities).toHaveLength(2);
    expect(opportunities[0].topic).toBe("usdt supply ath stablecoin inflation");
    expect(opportunities[1].topic).toBe("private credit yield premium");
    expect(opportunities[1].sourceProfile.family).toBe("vix-credit");
  });

  it("rewards richer colony substrate when opportunities are otherwise close", () => {
    const opportunities = deriveResearchOpportunities({
      signals: [
        {
          topic: "BTC Sentiment vs Funding",
          confidence: 74,
          direction: "bearish",
          keyInsight: "Funding is staying soft while sentiment rebounds.",
          consensus: true,
          agentCount: 6,
          sourcePostData: [
            { txHash: "0x1", author: "0xa", text: "one", category: "ANALYSIS", timestamp: 1 },
            { txHash: "0x2", author: "0xb", text: "two", category: "ANALYSIS", timestamp: 2 },
          ],
          crossReferences: [
            { type: "market", description: "Funding drift", assets: ["BTC"] },
          ],
        },
        {
          topic: "USDT Supply ATH Stablecoin Inflation",
          confidence: 78,
          direction: "mixed",
        },
      ],
      posts: [],
    });

    expect(opportunities).toHaveLength(2);
    expect(opportunities[0].topic).toBe("btc sentiment vs funding");
    expect(opportunities[0].score).toBeGreaterThan(opportunities[1].score);
  });

  it("suppresses the previously covered topic", () => {
    const opportunities = deriveResearchOpportunities({
      signals: [
        { topic: "BTC Sentiment vs Funding", confidence: 76, direction: "bearish" },
      ],
      posts: [],
      lastCoverageTopic: "btc sentiment vs funding",
    });

    expect(opportunities).toEqual([]);
  });

  it("drops unsupported research families before they enter the opportunity queue", () => {
    const opportunities = deriveResearchOpportunities({
      signals: [
        { topic: "Strait of Hormuz Geopolitical Risk and Oil Price Mispricing", confidence: 88, direction: "alert" },
        { topic: "BTC Sentiment vs Funding", confidence: 76, direction: "bearish" },
      ],
      posts: [],
    });

    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].topic).toBe("btc sentiment vs funding");
    expect(opportunities[0].sourceProfile.family).toBe("funding-structure");
  });

  it("routes divergence-backed signals into the oracle-divergence family instead of spot-momentum", () => {
    const opportunities = deriveResearchOpportunities({
      signals: [
        {
          topic: "BTC Sentiment vs Reality",
          confidence: 78,
          direction: "bearish",
          divergence: {
            direction: "bullish",
            reasoning: "Spot is holding firmer than the colony's bearish read implies.",
          },
        },
      ],
      posts: [],
    });

    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].topic).toBe("btc sentiment vs reality");
    expect(opportunities[0].sourceProfile.family).toBe("oracle-divergence");
    expect(opportunities[0].sourceProfile.primarySourceIds).toEqual(["coingecko-42ff8c85"]);
  });
});
