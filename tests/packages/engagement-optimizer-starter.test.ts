import { describe, expect, it } from "vitest";
import { observe } from "../../packages/omniweb-toolkit/assets/engagement-optimizer-starter.ts";

function makeOmni(): any {
  return {
    colony: {
      getFeed: async () => ({
        ok: true,
        data: {
          posts: [
            {
              txHash: "0xpost",
              payload: {
                cat: "ANALYSIS",
                text: "A careful attested research post about BTC funding and price pressure.",
                sourceAttestations: [
                  {
                    url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
                    txHash: "0xattest",
                  },
                ],
              },
              author: "0xauthor",
              timestamp: Date.UTC(2026, 3, 17, 14, 0, 0),
              score: 84,
              reputationTier: "established",
              replyCount: 0,
              reactions: {
                agree: 1,
                disagree: 0,
                flag: 0,
              },
            },
          ],
        },
      }),
      getLeaderboard: async () => ({
        ok: true,
        data: {
          agents: [
            {
              address: "0xauthor",
              name: "alpha",
              avgScore: 79,
              bayesianScore: 82,
              totalPosts: 14,
            },
          ],
        },
      }),
      getBalance: async () => ({
        ok: true,
        data: { balance: 25 },
      }),
      getReactions: async () => ({
        ok: true,
        data: { agree: 1, disagree: 0, flag: 0 },
      }),
    },
    runtime: {
      llmProvider: {
        name: "test-provider",
        complete: async () =>
          "An attested BTC funding post is being missed even though it carries an 84 score and only one total reaction, which is exactly the kind of quality gap a curator should surface. " +
          "The author is already ranking with a bayesian score above 80, so the engagement lag is not a signal that the work is weak so much as a sign that the colony moved past it too quickly. " +
          "The post already points back to an attested CoinGecko source, which is enough to justify a focused curation note while leaving room for the next cycle to decide whether direct reactions or tips are warranted.",
      },
    },
  };
}

describe("engagement-optimizer starter", () => {
  it("skips when the two-hour publish cooldown is still active", async () => {
    const result = await observe({
      omni: makeOmni(),
      cycle: {
        id: "cycle-1",
        iteration: 2,
        startedAt: "2026-04-17T15:00:00.000Z",
        stateDir: "/tmp/engagement-starter-test",
        dryRun: true,
      },
      memory: {
        state: {
          lastCandidateTxHash: "0xolder",
          lastPublishedAt: "2026-04-17T14:00:00.000Z",
        },
        lastCycle: null,
      },
    });

    expect(result.kind).toBe("skip");
    if (result.kind !== "skip") throw new Error("expected skip");
    expect(result.reason).toBe("published_within_last_2h");
    expect(result.audit?.promptPacket).toBeDefined();
  });
});
