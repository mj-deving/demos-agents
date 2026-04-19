import { describe, expect, it } from "vitest";
import {
  buildMinimalAttestationPlan,
  buildMinimalAttestationPlanFromUrls,
  getPrimaryAttestationCandidate,
  getPrimaryAttestationSourceName,
  getPrimaryAttestUrl,
} from "../../packages/omniweb-toolkit/src/minimal-attestation-plan.js";

describe("buildMinimalAttestationPlan", () => {
  it("defaults to a primary-source-ready plan when a valid attestation target exists", () => {
    const plan = buildMinimalAttestationPlan({
      topic: "BTC Sentiment vs Funding",
      preferredSourceIds: ["binance-futures-btc"],
      allowTopicFallback: false,
    });

    expect(plan.ready).toBe(true);
    expect(plan.reason).toBe("ready");
    expect(plan.primary?.sourceId).toBe("binance-futures-btc");
    expect(plan.supporting).toHaveLength(0);
  });

  it("falls back through asset-aware topic variants when the raw topic does not match catalog tags directly", () => {
    const plan = buildMinimalAttestationPlan({
      topic: "BTC Sentiment vs Funding",
      minSupportingSources: 1,
    });

    expect(plan.ready).toBe(true);
    expect(plan.primary).not.toBeNull();
    expect(plan.primary?.dahrSafe).toBe(true);
    expect(plan.supporting.length).toBeGreaterThanOrEqual(1);
  });

  it("can resolve a strict preferred-source plan without generic topic fallback", () => {
    const plan = buildMinimalAttestationPlan({
      topic: "BTC Sentiment vs Funding",
      preferredSourceIds: ["binance-futures-btc", "binance-futures-oi-btc"],
      allowTopicFallback: false,
      minSupportingSources: 1,
    });

    expect(plan.ready).toBe(true);
    expect(plan.primary?.sourceId).toBe("binance-futures-btc");
    expect(plan.supporting[0]?.sourceId).toBe("binance-futures-oi-btc");
  });

  it("can resolve the public BTC ETF flow source as a preferred attestation target", () => {
    const plan = buildMinimalAttestationPlan({
      topic: "BTC ETF flows",
      preferredSourceIds: ["btcetfdata-current-btc", "binance-24hr-btc"],
      allowTopicFallback: false,
      minSupportingSources: 1,
    });

    expect(plan.ready).toBe(true);
    expect(plan.primary?.sourceId).toBe("btcetfdata-current-btc");
    expect(plan.primary?.url).toContain("btcetfdata.com/v1/current.json");
    expect(plan.supporting[0]?.sourceId).toBe("binance-24hr-btc");
  });

  it("supports separated primary and supporting preferred source lists", () => {
    const plan = buildMinimalAttestationPlan({
      topic: "btc funding rate contrarian",
      preferredSourceIds: ["binance-futures-btc"],
      supportingPreferredSourceIds: ["binance-futures-oi-btc", "coingecko-42ff8c85", "coingecko-2a7ea372"],
      allowTopicFallback: false,
      minSupportingSources: 1,
    });

    expect(plan.ready).toBe(true);
    expect(plan.primary?.sourceId).toBe("binance-futures-btc");
    expect(plan.supporting.length).toBeGreaterThanOrEqual(1);
    expect(plan.supporting.map((candidate) => candidate.sourceId)).toContain("binance-futures-oi-btc");
  });

  it("keeps preferred treasury interest-rate sources pinned to avg_interest_rates", () => {
    const plan = buildMinimalAttestationPlan({
      topic: "VIX Credit Stress Signal",
      preferredSourceIds: ["cboe-vix-daily"],
      supportingPreferredSourceIds: ["treasury-interest-rates"],
      allowTopicFallback: false,
      minSupportingSources: 1,
    });

    expect(plan.ready).toBe(true);
    expect(plan.primary?.sourceId).toBe("cboe-vix-daily");
    expect(plan.supporting[0]?.sourceId).toBe("treasury-interest-rates");
    expect(plan.supporting[0]?.url).toContain("/avg_interest_rates");
    expect(plan.supporting[0]?.url).not.toContain("/debt_to_penny");
  });

  it("can build a ready plan from attested feed URLs without catalog lookups", () => {
    const plan = buildMinimalAttestationPlanFromUrls({
      topic: "engagement spotlight 0xpost",
      urls: [
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      ],
    });

    expect(plan.ready).toBe(true);
    expect(plan.primary?.url).toContain("coingecko");
    expect(plan.reason).toBe("ready");
  });

  it("exposes primary attestation helpers for catalog-backed plans", () => {
    const plan = buildMinimalAttestationPlan({
      topic: "BTC ETF flows",
      preferredSourceIds: ["btcetfdata-current-btc", "binance-24hr-btc"],
      allowTopicFallback: false,
      minSupportingSources: 1,
    });

    expect(getPrimaryAttestationCandidate(plan)?.sourceId).toBe("btcetfdata-current-btc");
    expect(getPrimaryAttestationSourceName(plan)).toBe("btcetfdata-current");
    expect(getPrimaryAttestUrl(plan)).toContain("btcetfdata.com/v1/current.json");
  });

  it("exposes primary attestation helpers for URL-backed plans", () => {
    const plan = buildMinimalAttestationPlanFromUrls({
      topic: "engagement spotlight 0xpost",
      urls: [
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      ],
    });

    expect(getPrimaryAttestationCandidate(plan)?.sourceId).toContain("coingecko");
    expect(getPrimaryAttestationSourceName(plan)).toBe("api.coingecko.com");
    expect(getPrimaryAttestUrl(plan)).toContain("coingecko.com/api/v3/simple/price");
  });

  it("returns null attestation helpers when no primary candidate exists", () => {
    const plan = buildMinimalAttestationPlanFromUrls({
      topic: "empty evidence packet",
      urls: [],
    });

    expect(getPrimaryAttestationCandidate(plan)).toBeNull();
    expect(getPrimaryAttestationSourceName(plan)).toBeNull();
    expect(getPrimaryAttestUrl(plan)).toBeNull();
  });
});
