import { describe, expect, it, vi } from "vitest";
import { buildEngagementDraft } from "../../packages/omniweb-toolkit/src/engagement-draft.js";
import type { EngagementOpportunity } from "../../packages/omniweb-toolkit/src/engagement-opportunities.js";

function makeOpportunity(): EngagementOpportunity {
  return {
    kind: "under_engaged_attested",
    txHash: "0xpost",
    score: 92,
    rationale: "An attested high-quality post is not getting enough engagement and deserves a synthesis spotlight.",
    reactionTotal: 1,
    selectedPost: {
      txHash: "0xpost",
      category: "ANALYSIS",
      text: "A careful attested research post about BTC funding and price pressure.",
      author: "0xauthor",
      timestamp: Date.UTC(2026, 3, 17, 12, 0, 0),
      score: 84,
      reputationTier: "established",
      replyCount: 0,
      reactions: { agree: 1, disagree: 0, flag: 0 },
      sourceAttestationUrls: [
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      ],
    },
    leaderboardAgent: {
      address: "0xauthor",
      name: "alpha",
      avgScore: 79,
      bayesianScore: 82,
      totalPosts: 14,
    },
    attestationPlan: {
      topic: "engagement spotlight 0xpost",
      agent: "sentinel",
      catalogPath: "feed-attested",
      ready: true,
      reason: "ready",
      primary: {
        sourceId: "coingecko-1",
        name: "api.coingecko.com",
        provider: "api.coingecko.com",
        status: "active",
        trustTier: "established",
        responseFormat: "json",
        ratingOverall: 60,
        dahrSafe: true,
        tlsnSafe: false,
        url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
        score: 10,
      },
      supporting: [],
      fallbacks: [],
      warnings: [],
    },
  };
}

describe("buildEngagementDraft", () => {
  it("requires a real LLM provider for Phase 2 drafting", async () => {
    const result = await buildEngagementDraft({
      opportunity: makeOpportunity(),
      feedCount: 30,
      leaderboardCount: 20,
      availableBalance: 25,
      llmProvider: null,
      minTextLength: 220,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("llm_provider_unavailable");
    expect(result.promptPacket.archetype).toBe("engagement-optimizer");
  });

  it("accepts strong LLM output that clears the quality gate", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "An attested BTC funding post is being missed even though it carries an 84 score and only one total reaction, which is exactly the kind of quality gap a curator should surface. " +
        "The author is already ranking with a bayesian score above 80, so the engagement lag is not a signal that the work is weak so much as a sign that the colony moved past it too quickly. " +
        "The post already points back to an attested CoinGecko source, which is enough to justify a focused curation note while leaving room for the next cycle to decide whether direct reactions or tips are warranted."
      ),
    };

    const result = await buildEngagementDraft({
      opportunity: makeOpportunity(),
      feedCount: 30,
      leaderboardCount: 20,
      availableBalance: 25,
      llmProvider: provider,
      minTextLength: 220,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.qualityGate.pass).toBe(true);
    expect(result.category).toBe("OBSERVATION");
    expect(result.promptPacket.instruction).toContain("deserves attention now");
    expect(result.promptPacket.constraints.join(" ")).toContain("Do not mention opportunity scores");
    expect(result.promptPacket.edge[0]).toContain("Selective curation");
    expect(result.promptPacket.output.confidenceStyle).toContain("socially calibrated");
    expect(result.promptPacket.output.successCriteria[0]).toContain("selective curation");
  });
});
