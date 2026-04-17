import { describe, expect, it } from "vitest";
import { observe } from "../../packages/omniweb-toolkit/assets/market-analyst-starter.ts";

function makeOmni(): any {
  return {
    colony: {
      getSignals: async () => ({
        ok: true,
        data: [
          {
            shortTopic: "BTC funding split",
            confidence: 76,
            direction: "bearish",
            assets: ["BTC"],
          },
        ],
      }),
      getOracle: async () => ({
        ok: true,
        data: {
          assets: [{ ticker: "BTC" }],
          divergences: [
            {
              asset: "BTC",
              severity: "high",
              type: "agents_vs_market",
              description: "Agents lean bearish while the market side is higher.",
              details: {
                agentDirection: "bearish",
                marketDirection: "higher",
              },
            },
          ],
        },
      }),
      getPrices: async () => ({
        ok: true,
        data: [
          {
            ticker: "BTC",
            priceUsd: 67250,
            change24h: -4.2,
            source: "coingecko",
            fetchedAt: Date.UTC(2026, 3, 17, 14, 0, 0),
          },
        ],
      }),
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
      getBalance: async () => ({
        ok: true,
        data: { balance: 25 },
      }),
    },
    runtime: {
      llmProvider: {
        name: "test-provider",
        complete: async () =>
          "BTC has a live high-severity oracle divergence because the packet still shows agents leaning bearish while the market side is pricing a higher move. " +
          "The observed BTC price is 67,250 dollars with a negative 4.2 percent 24-hour move, which makes the disagreement measurable instead of vague. " +
          "A live publish should anchor on CoinGecko Simple Price, cross-check Binance BTC Ticker, and keep conviction measured until the next attested fetch confirms whether bearish positioning or market momentum resolves the split.",
      },
    },
  };
}

describe("market-analyst starter", () => {
  it("skips when the 30-minute publish cooldown is still active", async () => {
    const result = await observe({
      omni: makeOmni(),
      cycle: {
        id: "cycle-1",
        iteration: 2,
        startedAt: "2026-04-17T15:00:00.000Z",
        stateDir: "/tmp/market-starter-test",
        dryRun: true,
      },
      memory: {
        state: {
          lastAsset: "ETH",
          lastOpportunityKind: "oracle_divergence",
          lastPublishedAt: "2026-04-17T14:40:00.000Z",
        },
        lastCycle: null,
      },
    });

    expect(result.kind).toBe("skip");
    if (result.kind !== "skip") throw new Error("expected skip");
    expect(result.reason).toBe("published_within_last_30m");
    expect(result.audit?.promptPacket).toBeDefined();
  });
});
