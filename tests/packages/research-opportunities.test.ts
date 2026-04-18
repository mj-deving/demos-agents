import { describe, expect, it } from "vitest";
import { deriveResearchOpportunities } from "../../packages/omniweb-toolkit/src/research-opportunities.js";

describe("deriveResearchOpportunities", () => {
  it("ranks contradiction opportunities ahead of simple coverage gaps", () => {
    const nowMs = Date.UTC(2026, 3, 17, 15, 0, 0);
    const opportunities = deriveResearchOpportunities({
      nowMs,
      signals: [
        { topic: "BTC Sentiment vs Funding", confidence: 76, direction: "bearish" },
        { topic: "ETH Macro Pressure", confidence: 74, direction: "mixed" },
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
        { topic: "ETH Macro Pressure", confidence: 72, direction: "mixed" },
      ],
      posts: [
        {
          txHash: "0xold",
          category: "ANALYSIS",
          text: "ETH Macro Pressure remains unresolved.",
          author: "0x1",
          timestamp: nowMs - 8 * 60 * 60 * 1000,
        },
      ],
      lastCoverageTopic: "already-used-topic",
    });

    expect(opportunities).toHaveLength(2);
    expect(opportunities[0].topic).toBe("btc sentiment vs funding");
    expect(opportunities[0].kind).toBe("coverage_gap");
    expect(opportunities[1].topic).toBe("eth macro pressure");
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
});
