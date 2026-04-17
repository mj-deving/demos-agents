import { describe, expect, it } from "vitest";

import {
  chooseFixedBetProbe,
  chooseHigherLowerProbe,
  fixedBetReadbackSatisfied,
  higherLowerReadbackSatisfied,
} from "../../packages/omniweb-toolkit/scripts/_market-write-shared";

describe("market-write proof helpers", () => {
  it("chooses an active higher-lower probe from oracle sentiment and crowd skew", () => {
    const plan = chooseHigherLowerProbe(
      [
        {
          asset: "BTC",
          horizon: "24h",
          totalHigher: 30,
          totalLower: 0,
          totalDem: 30,
          higherCount: 6,
          lowerCount: 0,
          referencePrice: 72696,
          currentPrice: 72696,
        },
      ],
      [{ ticker: "BTC", sentimentScore: -36, currentPrice: 72696 }],
      5,
    );

    expect(plan).toMatchObject({
      asset: "BTC",
      horizon: "24h",
      direction: "lower",
      amount: 5,
      sentimentScore: -36,
    });
    expect(plan?.reason).toContain("contrarian");
  });

  it("chooses a fixed-price probe using the strongest active sentiment", () => {
    const plan = chooseFixedBetProbe(
      [
        {
          asset: "BTC",
          horizon: "30m",
          totalBets: 1,
          totalDem: 5,
          bets: [{ txHash: "tx-1", predictedPrice: 74905, amount: 5 }],
        },
      ],
      [{ ticker: "BTC", sentimentScore: -36, currentPrice: 72696 }],
    );

    expect(plan).toMatchObject({
      asset: "BTC",
      horizon: "30m",
      predictedPrice: 71969,
      sentimentScore: -36,
    });
  });

  it("accepts higher-lower readback via count or DEM deltas", () => {
    const before = {
      asset: "BTC",
      horizon: "24h",
      totalHigher: 30,
      totalLower: 0,
      totalDem: 30,
      higherCount: 6,
      lowerCount: 0,
      referencePrice: 72696,
      currentPrice: 72696,
    };
    const after = { ...before, totalLower: 5, totalDem: 35, lowerCount: 1 };
    expect(higherLowerReadbackSatisfied(before, after, "lower", 5)).toBe(true);
  });

  it("accepts fixed-bet readback via tx hash or aggregate deltas", () => {
    const before = {
      asset: "BTC",
      horizon: "30m",
      totalBets: 1,
      totalDem: 5,
      bets: [{ txHash: "tx-1", predictedPrice: 74905, amount: 5 }],
    };
    const after = {
      ...before,
      totalBets: 2,
      totalDem: 10,
      bets: [...before.bets, { txHash: "tx-2", predictedPrice: 71969, amount: 5 }],
    };
    expect(fixedBetReadbackSatisfied(before, after, "tx-2")).toBe(true);
  });
});
