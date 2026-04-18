import { describe, expect, it } from "vitest";
import { extractTopicVars } from "../../../src/toolkit/chain/url-helpers.ts";

describe("extractTopicVars", () => {
  it("uses inferred asset aliases instead of the first token for crypto topics", () => {
    expect(extractTopicVars("BTC Sentiment Divergence Bear")).toMatchObject({
      asset: "bitcoin",
      symbol: "BTC",
    });

    expect(extractTopicVars("ETH ETF Flows")).toMatchObject({
      asset: "ethereum",
      symbol: "ETH",
    });
  });

  it("still falls back to the first token when no asset alias is inferred", () => {
    expect(extractTopicVars("Hormuz Oil Risk Mispricing")).toMatchObject({
      asset: "hormuz",
      symbol: "",
    });
  });
});
