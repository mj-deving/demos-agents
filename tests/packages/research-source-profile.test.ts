import { describe, expect, it } from "vitest";
import { deriveResearchSourceProfile } from "../../packages/omniweb-toolkit/src/research-source-profile.js";

describe("deriveResearchSourceProfile", () => {
  it("maps funding topics to the derivatives evidence family", () => {
    const profile = deriveResearchSourceProfile("BTC Sentiment vs Funding");

    expect(profile.family).toBe("funding-structure");
    expect(profile.supported).toBe(true);
    expect(profile.primarySourceIds).toEqual(["binance-futures-btc"]);
    expect(profile.supportingSourceIds).toContain("binance-futures-oi-btc");
  });

  it("maps momentum topics to price-and-chart evidence", () => {
    const profile = deriveResearchSourceProfile("ETH price momentum reversal");

    expect(profile.family).toBe("spot-momentum");
    expect(profile.supported).toBe(true);
    expect(profile.primarySourceIds).toEqual(["coingecko-42ff8c85"]);
    expect(profile.supportingSourceIds).toContain("coingecko-2a7ea372");
  });

  it("maps divergence topics to a dedicated oracle-divergence family when the signal carries divergence context", () => {
    const profile = deriveResearchSourceProfile("BTC sentiment vs reality", {
      divergence: {
        direction: "bullish",
        reasoning: "Spot still looks firmer than the colony read suggests.",
      },
    });

    expect(profile.family).toBe("oracle-divergence");
    expect(profile.supported).toBe(true);
    expect(profile.primarySourceIds).toEqual(["coingecko-42ff8c85"]);
    expect(profile.supportingSourceIds).toEqual(["coingecko-2a7ea372"]);
  });

  it("flags ETF flow topics as unsupported until the registry grows a matching family", () => {
    const profile = deriveResearchSourceProfile("BTC ETF flows");

    expect(profile.family).toBe("etf-flows");
    expect(profile.supported).toBe(true);
    expect(profile.primarySourceIds).toEqual(["btcetfdata-current-btc"]);
    expect(profile.supportingSourceIds).toContain("binance-24hr-btc");
  });

  it("still skips ETH ETF flows because only the BTC public family is registered", () => {
    const profile = deriveResearchSourceProfile("ETH ETF flows");

    expect(profile.family).toBe("unsupported");
    expect(profile.supported).toBe(false);
    expect(profile.reason).toBe("no_family_sources_for_asset");
  });

  it("maps stablecoin supply topics to stablecoin evidence plus a peg check", () => {
    const profile = deriveResearchSourceProfile("USDT Supply ATH Stablecoin Inflation");

    expect(profile.family).toBe("stablecoin-supply");
    expect(profile.supported).toBe(true);
    expect(profile.primarySourceIds).toEqual(["defillama-stablecoins"]);
    expect(profile.supportingSourceIds).toContain("coingecko-2a7ea372");
  });

  it("maps on-chain activity topics to the network evidence family", () => {
    const profile = deriveResearchSourceProfile("BTC on-chain network stress and mempool congestion");

    expect(profile.family).toBe("network-activity");
    expect(profile.supported).toBe(true);
    expect(profile.primarySourceIds).toEqual(["blockchair-btc-stats"]);
    expect(profile.supportingSourceIds).toContain("coingecko-2a7ea372");
    expect(profile.expectedMetrics).toEqual([
      "blockCount24h",
      "transactionCount24h",
      "hashrate24h",
      "priceUsd",
      "transactionsPerBlock24h",
    ]);
  });

  it("maps vix-credit topics without needing asset detection", () => {
    const profile = deriveResearchSourceProfile("VIX Credit Stress Signal");

    expect(profile.family).toBe("vix-credit");
    expect(profile.supported).toBe(true);
    expect(profile.asset).toBeNull();
    expect(profile.primarySourceIds).toEqual(["cboe-vix-daily"]);
    expect(profile.supportingSourceIds).toContain("treasury-interest-rates");
  });

  it("keeps reserve-risk topics unsupported when the family cannot ground the claim", () => {
    const profile = deriveResearchSourceProfile("USDC Regulatory Reserve Risk");

    expect(profile.family).toBe("unsupported");
    expect(profile.supported).toBe(false);
    expect(profile.reason).toBe("no_supported_research_family");
  });
});
