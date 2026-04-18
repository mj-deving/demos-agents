import { describe, expect, it, vi } from "vitest";
import { buildResearchDraft } from "../../packages/omniweb-toolkit/src/research-draft.js";
import type { ResearchEvidenceSummary } from "../../packages/omniweb-toolkit/src/research-evidence.js";
import type { ResearchOpportunity } from "../../packages/omniweb-toolkit/src/research-opportunities.js";
import type { ResearchSourceProfile } from "../../packages/omniweb-toolkit/src/research-source-profile.js";

function makeOpportunity(): ResearchOpportunity {
  const sourceProfile: ResearchSourceProfile = {
    family: "funding-structure",
    topic: "btc sentiment vs funding",
    asset: { asset: "bitcoin", symbol: "BTC" },
    supported: true,
    reason: null,
    primarySourceIds: ["binance-futures-btc"],
    supportingSourceIds: ["binance-futures-oi-btc", "coingecko-42ff8c85"],
    expectedMetrics: ["markPrice", "indexPrice", "lastFundingRate", "openInterest"],
  };
  return {
    kind: "coverage_gap",
    topic: "btc sentiment vs funding",
    score: 99,
    rationale: "High-confidence signal is not covered in the recent feed.",
    sourceProfile,
    matchedSignal: {
      topic: "btc sentiment vs funding",
      confidence: 76,
      direction: "bearish",
    },
    matchingFeedPosts: [],
    lastSeenAt: null,
    attestationPlan: {
      topic: "btc sentiment vs funding",
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
          sourceId: "blockchain-info-ticker",
          name: "Blockchain.com Ticker",
          provider: "blockchain",
          status: "active",
          trustTier: "market",
          responseFormat: "json",
          ratingOverall: 74,
          dahrSafe: true,
          tlsnSafe: false,
          url: "https://blockchain.info/ticker",
          score: 12,
        },
      ],
      fallbacks: [],
      warnings: [],
    },
  };
}

function makeEvidenceSummary(): ResearchEvidenceSummary {
  return {
    source: "Binance Futures Premium Index",
    url: "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT",
    fetchedAt: "2026-04-18T08:00:00.000Z",
    values: {
      markPrice: "67250.00",
      indexPrice: "67245.12",
      lastFundingRate: "-0.012",
      interestRate: "0.0001",
    },
    derivedMetrics: {
      fundingRateBps: "-120",
      markIndexSpreadUsd: "4.88",
    },
  };
}

describe("buildResearchDraft", () => {
  it("requires a real LLM provider for Phase 2 drafting", async () => {
    const result = await buildResearchDraft({
      opportunity: makeOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeEvidenceSummary(),
      llmProvider: null,
      minTextLength: 300,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("llm_provider_unavailable");
    expect(result.promptPacket.input.topic).toBe("btc sentiment vs funding");
  });

  it("builds a colony-facing prompt packet instead of exposing internal scoring data", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "BTC funding pressure is worth watching because the premium setup is leaning bearish while mark price still sits near 67,250 dollars instead of breaking lower. " +
        "A negative funding read around -0.012 would fit the idea that long conviction is fading before spot fully rolls over, which is why the premium signal matters more than a generic macro mood. " +
        "A rebound in the premium reading would weaken the bearish case, while further compression would confirm downside pressure is still building."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeEvidenceSummary(),
      llmProvider: provider,
      minTextLength: 300,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.promptPacket.archetype).toBe("research-agent");
    expect(result.promptPacket.input.analysisAngle).toContain("bearish read in colony signals");
    expect(result.promptPacket.input).not.toHaveProperty("opportunityScore");
    expect(result.promptPacket.input).not.toHaveProperty("rationale");
    expect(result.promptPacket.input).not.toHaveProperty("leaderboardCount");
    expect(result.promptPacket.input).not.toHaveProperty("balanceDem");
    expect(result.promptPacket.instruction).toContain("standalone ANALYSIS post grounded in the input evidence");
    expect(result.promptPacket.constraints.join(" ")).toContain("analysis angle");
    expect(result.promptPacket.constraints.join(" ")).toContain("Do not mention internal scoring");
    expect(result.promptPacket.edge[0]).toContain("Depth over speed");
    expect(result.promptPacket.output.confidenceStyle).toContain("calibrated and evidence-led");
    expect(result.promptPacket.output.successCriteria[0]).toContain("original research");
    expect(result.promptPacket.input.evidence.values.markPrice).toBe("67250.00");
    expect(result.promptPacket.input.evidence.derivedMetrics.fundingRateBps).toBe("-120");
  });

  it("accepts LLM output only when it clears the quality gate", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "BTC funding pressure is the real thing to watch here because weak premium readings while price stays firm near 67,250 dollars usually mean longs are losing conviction before spot actually rolls over. " +
        "A negative funding read around -0.012 turns that into a concrete bearish setup instead of a vague macro complaint, because positioning stress is visible in the fetched evidence itself. " +
        "Watch the next premium-index read closely: a rebound would weaken the bearish setup, while further compression would confirm downside pressure is building."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeEvidenceSummary(),
      llmProvider: provider,
      minTextLength: 300,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.draftSource).toBe("llm");
    expect(result.qualityGate.pass).toBe(true);
    expect(result.text).not.toContain("opportunity score");
    expect(result.text).not.toContain("coverage gap");
    expect(result.qualityGate.checks.find((check) => check.name === "research-angle-grounding")?.pass).toBe(true);
    expect(result.qualityGate.checks.find((check) => check.name === "research-style")?.pass).toBe(true);
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it("rejects LLM output that leaks internal reasoning into the post body", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "BTC funding-rate bear case deserves attention now because a 76-confidence signal is sitting in a coverage gap with zero matching posts. " +
        "The opportunity score is high enough to justify publishing. " +
        "The next live attested fetch should confirm whether the thesis holds."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeEvidenceSummary(),
      llmProvider: provider,
      minTextLength: 300,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("draft_quality_gate_failed");
    expect(result.qualityGate.checks.find((check) => check.name === "no-internal-reasoning-leak")?.pass).toBe(false);
  });

  it("rejects LLM output that never references fetched evidence values", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "BTC funding pressure still looks bearish because conviction is clearly fading even if spot is holding together for now. " +
        "The structure is negative enough to justify caution, and the broader setup still points to downside risk building under the surface. " +
        "A reversal in positioning would weaken the thesis, but until then the bear case still deserves close attention."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeEvidenceSummary(),
      llmProvider: provider,
      minTextLength: 300,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("draft_quality_gate_failed");
    expect(result.qualityGate.checks.find((check) => check.name === "evidence-value-overlap")?.pass).toBe(false);
  });

  it("rejects generic market commentary that ignores the divergence angle", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "Bitcoin has gained 5.8 percent this week and is now trading near 67,250 dollars inside a broad range with heavy volume. " +
        "The market still looks indecisive because price keeps oscillating between support and resistance without a clean breakout. " +
        "A move above the recent high would be constructive, while a move back toward the lower end of the range would turn the setup weaker."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeEvidenceSummary(),
      llmProvider: provider,
      minTextLength: 300,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("draft_quality_gate_failed");
    expect(result.qualityGate.checks.find((check) => check.name === "research-angle-grounding")?.pass).toBe(false);
  });

  it("rejects awkward colony-sentiment phrasing even when the numbers overlap", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "Bitcoin's 5.8% weekly move is quietly refuting the bearish half of colony sentiment because spot is still trading near 67,250 dollars rather than breaking lower. " +
        "The range structure still matters, but the phrase above captures the idea that the market is not yet validating the signal. " +
        "A reversal through the lower end of the range would restore the bear case."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeEvidenceSummary(),
      llmProvider: provider,
      minTextLength: 300,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("draft_quality_gate_failed");
    expect(result.qualityGate.checks.find((check) => check.name === "research-style")?.pass).toBe(false);
  });

  it("rejects mirrored rhetorical closes even when the analysis angle is present", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "The bearish read in colony signals is being contradicted by the tape because Bitcoin is up 5.8% this week at 67,250 dollars and still holding near the top of its range. " +
        "That mismatch matters because price and volume are leaning constructive instead of validating the breakdown thesis. " +
        "Until support breaks, the divergence is one of narrative lagging structure rather than structure lagging narrative."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeEvidenceSummary(),
      llmProvider: provider,
      minTextLength: 300,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("draft_quality_gate_failed");
    expect(result.qualityGate.checks.find((check) => check.name === "research-style")?.pass).toBe(false);
  });

  it("skips short low-quality LLM output instead of publishing a template fallback", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue("Too short to publish."),
    };

    const result = await buildResearchDraft({
      opportunity: makeOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeEvidenceSummary(),
      llmProvider: provider,
      minTextLength: 300,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("draft_quality_gate_failed");
    expect(result.notes[0]).toContain("llm_output_failed");
  });
});
