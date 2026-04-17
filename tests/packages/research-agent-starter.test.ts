import { describe, expect, it } from "vitest";
import { observe } from "../../packages/omniweb-toolkit/assets/research-agent-starter.ts";

function makeOmni(): any {
  return {
    colony: {
      getFeed: async () => ({
        ok: true,
        data: {
          posts: [
            {
              txHash: "0xfeed1",
              payload: {
                cat: "FEED",
                text: "ETH dominates the macro conversation again.",
              },
              author: "0xabc",
              timestamp: Date.UTC(2026, 3, 17, 14, 0, 0),
            },
          ],
        },
      }),
      getSignals: async () => ({
        ok: true,
        data: [
          {
            shortTopic: "BTC Sentiment vs Funding",
            confidence: 76,
            direction: "bearish",
          },
        ],
      }),
      getLeaderboard: async () => ({
        ok: true,
        data: [{ address: "0x1" }, { address: "0x2" }],
      }),
      getBalance: async () => ({
        ok: true,
        data: { balance: 25 },
      }),
    },
    runtime: {
      llmProvider: {
        name: "test-provider",
        complete: async () =>
          "BTC Sentiment vs Funding is still undercovered even though the colony packet carries a 76-confidence bearish signal and recent feed coverage keeps drifting elsewhere. " +
          "That combination makes the gap durable rather than accidental, especially with the latest sampled posts failing to engage it directly. " +
          "A live publish should anchor on CoinGecko Simple Price and cross-check Blockchain.com Ticker before pushing beyond this scoped claim, and the next attested fetch should confirm whether sentiment, funding, and price action are actually converging or still pulling apart.",
      },
    },
  };
}

describe("research-agent starter", () => {
  it("skips when the one-hour publish cooldown is still active", async () => {
    const result = await observe({
      omni: makeOmni(),
      cycle: {
        id: "cycle-1",
        iteration: 2,
        startedAt: "2026-04-17T15:00:00.000Z",
        stateDir: "/tmp/research-starter-test",
        dryRun: true,
      },
      memory: {
        state: {
          lastCoverageTopic: "older-topic",
          lastPublishedAt: "2026-04-17T14:20:00.000Z",
        },
        lastCycle: null,
      },
    });

    expect(result.kind).toBe("skip");
    if (result.kind !== "skip") throw new Error("expected skip");
    expect(result.reason).toBe("published_within_last_hour");
    expect(result.audit?.promptPacket).toBeDefined();
  });
});
