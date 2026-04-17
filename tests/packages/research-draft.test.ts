import { describe, expect, it, vi } from "vitest";
import { buildResearchDraft } from "../../packages/omniweb-toolkit/src/research-draft.js";
import type { ResearchOpportunity } from "../../packages/omniweb-toolkit/src/research-opportunities.js";

function makeOpportunity(): ResearchOpportunity {
  return {
    kind: "coverage_gap",
    topic: "btc sentiment vs funding",
    score: 99,
    rationale: "High-confidence signal is not covered in the recent feed.",
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

describe("buildResearchDraft", () => {
  it("requires a real LLM provider for Phase 2 drafting", async () => {
    const result = await buildResearchDraft({
      opportunity: makeOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
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
        "Funding pressure on BTC is worth watching here because a softer premium reading would signal long conviction fading while price still looks stable. " +
        "CoinGecko Simple Price frames the spot backdrop, and Blockchain.com Ticker is the cross-check if this starts turning from positioning stress into real downside follow-through. " +
        "The next premium-index read is the invalidation point: a rebound weakens the bearish read, while further compression would strengthen it."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      llmProvider: provider,
      minTextLength: 300,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.promptPacket.archetype).toBe("research-agent");
    expect(result.promptPacket.input).not.toHaveProperty("opportunityScore");
    expect(result.promptPacket.input).not.toHaveProperty("rationale");
    expect(result.promptPacket.input).not.toHaveProperty("leaderboardCount");
    expect(result.promptPacket.input).not.toHaveProperty("balanceDem");
    expect(result.promptPacket.instruction).toContain("standalone ANALYSIS post grounded in the input evidence");
    expect(result.promptPacket.constraints.join(" ")).toContain("Do not mention internal scoring");
    expect(result.promptPacket.edge[0]).toContain("Depth over speed");
    expect(result.promptPacket.output.confidenceStyle).toContain("calibrated and evidence-led");
    expect(result.promptPacket.output.successCriteria[0]).toContain("original research");
  });

  it("accepts LLM output only when it clears the quality gate", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "BTC funding pressure is the real thing to watch here because weak premium readings while price stays firm usually mean longs are losing conviction before spot actually rolls over. " +
        "CoinGecko Simple Price sets the spot backdrop, and Blockchain.com Ticker is the clean cross-check if this starts becoming a broader risk-off move instead of a contained positioning wobble. " +
        "Watch the next premium-index read closely: a rebound would weaken the bearish setup, while further compression would confirm downside pressure is building."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      llmProvider: provider,
      minTextLength: 300,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.draftSource).toBe("llm");
    expect(result.qualityGate.pass).toBe(true);
    expect(result.text).not.toContain("opportunity score");
    expect(result.text).not.toContain("coverage gap");
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
      llmProvider: provider,
      minTextLength: 300,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("draft_quality_gate_failed");
    expect(result.qualityGate.checks.find((check) => check.name === "no-internal-reasoning-leak")?.pass).toBe(false);
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
      llmProvider: provider,
      minTextLength: 300,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("draft_quality_gate_failed");
    expect(result.notes[0]).toContain("llm_output_failed");
  });
});
