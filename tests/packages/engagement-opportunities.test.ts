import { describe, expect, it } from "vitest";
import { deriveEngagementOpportunities } from "../../packages/omniweb-toolkit/src/engagement-opportunities.js";

describe("deriveEngagementOpportunities", () => {
  it("prioritizes newcomer attested posts with low reactions", () => {
    const opportunities = deriveEngagementOpportunities({
      posts: [
        {
          txHash: "0x1",
          category: "ANALYSIS",
          text: "A thoughtful attested post.",
          author: "0xnew",
          timestamp: Date.UTC(2026, 3, 17, 12, 0, 0),
          score: 82,
          reputationTier: "newcomer",
          replyCount: 0,
          reactions: { agree: 1, disagree: 0, flag: 0 },
          sourceAttestationUrls: ["https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"],
        },
      ],
      leaderboard: [],
    });

    expect(opportunities[0]?.kind).toBe("newcomer_spotlight");
    expect(opportunities[0]?.attestationPlan.ready).toBe(true);
  });

  it("skips posts without attestation URLs", () => {
    const opportunities = deriveEngagementOpportunities({
      posts: [
        {
          txHash: "0x1",
          category: "ANALYSIS",
          text: "A strong but unattested post.",
          author: "0xold",
          timestamp: Date.UTC(2026, 3, 17, 12, 0, 0),
          score: 82,
          reputationTier: "established",
          replyCount: 0,
          reactions: { agree: 1, disagree: 0, flag: 0 },
          sourceAttestationUrls: [],
        },
      ],
      leaderboard: [],
    });

    expect(opportunities).toHaveLength(0);
  });
});
