import { describe, expect, it, vi } from "vitest";
import { buildResearchDraft } from "../../packages/omniweb-toolkit/src/research-draft.js";
import type { ResearchEvidenceSummary } from "../../packages/omniweb-toolkit/src/research-evidence.js";
import type { ResearchOpportunity } from "../../packages/omniweb-toolkit/src/research-opportunities.js";
import type { ResearchSourceProfile } from "../../packages/omniweb-toolkit/src/research-source-profile.js";

function makeOpportunity(): ResearchOpportunity {
  const sourceProfile: ResearchSourceProfile = {
    family: "funding-structure",
    topic: "btc sentiment vs funding",
    asset: { asset: "bitcoin", symbol: "BTC" },
    supported: true,
    reason: null,
    primarySourceIds: ["binance-futures-btc"],
    supportingSourceIds: ["binance-futures-oi-btc", "coingecko-42ff8c85"],
    expectedMetrics: ["markPrice", "indexPrice", "lastFundingRate", "openInterest"],
  };
  return {
    kind: "coverage_gap",
    topic: "btc sentiment vs funding",
    score: 99,
    rationale: "High-confidence signal is not covered in the recent feed.",
    sourceProfile,
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

function makeStablecoinOpportunity(): ResearchOpportunity {
  const sourceProfile: ResearchSourceProfile = {
    family: "stablecoin-supply",
    topic: "usdt supply ath stablecoin inflation",
    asset: { asset: "tether", symbol: "USDT" },
    supported: true,
    reason: null,
    primarySourceIds: ["defillama-stablecoins"],
    supportingSourceIds: ["coingecko-2a7ea372"],
    expectedMetrics: ["circulatingUsd", "circulatingPrevDayUsd", "circulatingPrevWeekUsd", "priceUsd", "supplyChangePct7d"],
  };
  return {
    kind: "coverage_gap",
    topic: "usdt supply ath stablecoin inflation",
    score: 88,
    rationale: "High-confidence stablecoin supply topic is not covered in the recent feed.",
    sourceProfile,
    matchedSignal: {
      topic: "usdt supply ath stablecoin inflation",
      confidence: 68,
      direction: "mixed",
    },
    matchingFeedPosts: [],
    lastSeenAt: null,
    attestationPlan: {
      topic: "usdt supply ath stablecoin inflation",
      agent: "sentinel",
      catalogPath: "/tmp/catalog.json",
      ready: true,
      reason: "ready",
      primary: {
        sourceId: "defillama-stablecoins",
        name: "defillama-stablecoins-list",
        provider: "defillama",
        status: "active",
        trustTier: "established",
        responseFormat: "json",
        ratingOverall: 80,
        dahrSafe: true,
        tlsnSafe: false,
        url: "https://stablecoins.llama.fi/stablecoins?includePrices=true",
        score: 19,
      },
      supporting: [
        {
          sourceId: "coingecko-2a7ea372",
          name: "coingecko-simple",
          provider: "coingecko",
          status: "active",
          trustTier: "established",
          responseFormat: "json",
          ratingOverall: 78,
          dahrSafe: true,
          tlsnSafe: true,
          url: "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=usd",
          score: 14,
        },
      ],
      fallbacks: [],
      warnings: [],
    },
  };
}

function makeSpotOpportunity(): ResearchOpportunity {
  const sourceProfile: ResearchSourceProfile = {
    family: "spot-momentum",
    topic: "btc sentiment divergence bear",
    asset: { asset: "bitcoin", symbol: "BTC" },
    supported: true,
    reason: null,
    primarySourceIds: ["coingecko-42ff8c85"],
    supportingSourceIds: ["binance-24hr-btc", "coingecko-2a7ea372"],
    expectedMetrics: ["currentPriceUsd", "priceChangePercent7d", "high7d", "low7d", "latestVolumeUsd"],
  };
  return {
    kind: "coverage_gap",
    topic: "btc sentiment divergence bear",
    score: 91,
    rationale: "High-confidence divergence signal is not covered in the recent feed.",
    sourceProfile,
    matchedSignal: {
      topic: "btc sentiment divergence bear",
      confidence: 73,
      direction: "bearish",
    },
    matchingFeedPosts: [],
    lastSeenAt: null,
    attestationPlan: {
      topic: "btc sentiment divergence bear",
      agent: "sentinel",
      catalogPath: "/tmp/catalog.json",
      ready: true,
      reason: "ready",
      primary: {
        sourceId: "coingecko-42ff8c85",
        name: "CoinGecko Market Chart",
        provider: "coingecko",
        status: "active",
        trustTier: "established",
        responseFormat: "json",
        ratingOverall: 83,
        dahrSafe: true,
        tlsnSafe: true,
        url: "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=7",
        score: 18,
      },
      supporting: [
        {
          sourceId: "binance-24hr-btc",
          name: "Binance 24hr BTC",
          provider: "binance",
          status: "active",
          trustTier: "official",
          responseFormat: "json",
          ratingOverall: 84,
          dahrSafe: true,
          tlsnSafe: false,
          url: "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT",
          score: 12,
        },
      ],
      fallbacks: [],
      warnings: [],
    },
  };
}

function makeEtfOpportunity(): ResearchOpportunity {
  const sourceProfile: ResearchSourceProfile = {
    family: "etf-flows",
    topic: "btc etf flows",
    asset: { asset: "bitcoin", symbol: "BTC" },
    supported: true,
    reason: null,
    primarySourceIds: ["btcetfdata-current-btc"],
    supportingSourceIds: ["binance-24hr-btc"],
    expectedMetrics: ["totalHoldingsBtc", "netFlowBtc", "positiveIssuerCount", "negativeIssuerCount", "largestInflowBtc", "largestOutflowBtc"],
  };
  return {
    kind: "coverage_gap",
    topic: "btc etf flows",
    score: 89,
    rationale: "High-confidence ETF flow topic is not covered in the recent feed.",
    sourceProfile,
    matchedSignal: {
      topic: "btc etf flows",
      confidence: 82,
      direction: "bullish",
    },
    matchingFeedPosts: [],
    lastSeenAt: null,
    attestationPlan: {
      topic: "btc etf flows",
      agent: "sentinel",
      catalogPath: "/tmp/catalog.json",
      ready: true,
      reason: "ready",
      primary: {
        sourceId: "btcetfdata-current-btc",
        name: "btcetfdata-current-btc",
        provider: "btcetfdata",
        status: "active",
        trustTier: "established",
        responseFormat: "json",
        ratingOverall: 80,
        dahrSafe: true,
        tlsnSafe: false,
        url: "https://www.btcetfdata.com/v1/current.json",
        score: 19,
      },
      supporting: [
        {
          sourceId: "binance-24hr-btc",
          name: "Binance 24hr BTC",
          provider: "binance",
          status: "active",
          trustTier: "official",
          responseFormat: "json",
          ratingOverall: 84,
          dahrSafe: true,
          tlsnSafe: false,
          url: "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT",
          score: 12,
        },
      ],
      fallbacks: [],
      warnings: [],
    },
  };
}

function makeVixOpportunity(): ResearchOpportunity {
  const sourceProfile: ResearchSourceProfile = {
    family: "vix-credit",
    topic: "vix credit stress signal",
    asset: null,
    supported: true,
    reason: null,
    primarySourceIds: ["cboe-vix-daily"],
    supportingSourceIds: ["treasury-interest-rates"],
    expectedMetrics: [
      "vixClose",
      "vixPreviousClose",
      "vixHigh",
      "vixLow",
      "treasuryBillsAvgRatePct",
      "treasuryNotesAvgRatePct",
      "vixSessionChangePct",
      "billNoteSpreadBps",
    ],
  };
  return {
    kind: "coverage_gap",
    topic: "vix credit stress signal",
    score: 85,
    rationale: "Volatility stress topic is not covered in the recent feed.",
    sourceProfile,
    matchedSignal: {
      topic: "vix credit stress signal",
      confidence: 74,
      direction: "bearish",
    },
    matchingFeedPosts: [],
    lastSeenAt: null,
    attestationPlan: {
      topic: "vix credit stress signal",
      agent: "sentinel",
      catalogPath: "/tmp/catalog.json",
      ready: true,
      reason: "ready",
      primary: {
        sourceId: "cboe-vix-daily",
        name: "cboe-vix-quote",
        provider: "cboe",
        status: "active",
        trustTier: "official",
        responseFormat: "csv",
        ratingOverall: 81,
        dahrSafe: true,
        tlsnSafe: false,
        url: "https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VIX.json",
        score: 18,
      },
      supporting: [
        {
          sourceId: "treasury-interest-rates",
          name: "treasury-rates",
          provider: "treasury",
          status: "active",
          trustTier: "official",
          responseFormat: "json",
          ratingOverall: 79,
          dahrSafe: true,
          tlsnSafe: false,
          url: "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page[size]=5",
          score: 14,
        },
      ],
      fallbacks: [],
      warnings: [],
    },
  };
}

function makeEvidenceSummary(): ResearchEvidenceSummary {
  return {
    source: "Binance Futures Premium Index",
    url: "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT",
    fetchedAt: "2026-04-18T08:00:00.000Z",
    values: {
      markPrice: "67250.00",
      indexPrice: "67245.12",
      lastFundingRate: "-0.012",
      interestRate: "0.0001",
    },
    derivedMetrics: {
      fundingRateBps: "-120",
      markIndexSpreadUsd: "4.88",
    },
  };
}

function makeSupportingEvidenceSummary(): ResearchEvidenceSummary {
  return {
    source: "CoinGecko Simple Price",
    url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    fetchedAt: "2026-04-18T08:00:05.000Z",
    values: {
      assetId: "bitcoin",
      priceUsd: "67240.11",
    },
    derivedMetrics: {},
  };
}

function makeFundingSupportingEvidenceSummary(): ResearchEvidenceSummary {
  return {
    source: "Binance Open Interest",
    url: "https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT",
    fetchedAt: "2026-04-18T08:00:03.000Z",
    values: {
      openInterest: "105600",
    },
    derivedMetrics: {
      openInterestContracts: "105600",
    },
  };
}

function makeStablecoinEvidenceSummary(): ResearchEvidenceSummary {
  return {
    source: "defillama-stablecoins-list",
    url: "https://stablecoins.llama.fi/stablecoins?includePrices=true",
    fetchedAt: "2026-04-18T08:25:34.421Z",
    values: {
      assetSymbol: "USDT",
      circulatingUsd: "186624595113.63",
      circulatingPrevDayUsd: "185821073382.76",
      circulatingPrevWeekUsd: "184294812347.66",
      circulatingPrevMonthUsd: "183336749243.19",
    },
    derivedMetrics: {
      supplyChangePct1d: "0.43",
      supplyChangePct7d: "1.26",
      supplyChangePct30d: "1.79",
      stablecoinFocus: "USDT",
    },
  };
}

function makeStablecoinSupportingEvidenceSummary(): ResearchEvidenceSummary {
  return {
    source: "coingecko-simple",
    url: "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=usd",
    fetchedAt: "2026-04-18T08:25:34.454Z",
    values: {
      assetId: "tether",
      priceUsd: "1",
    },
    derivedMetrics: {
      pegDeviationPct: "0",
    },
  };
}

function makeSpotEvidenceSummary(): ResearchEvidenceSummary {
  return {
    source: "CoinGecko Market Chart",
    url: "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=7",
    fetchedAt: "2026-04-18T08:55:00.000Z",
    values: {
      currentPriceUsd: "76990.95",
      startingPriceUsd: "72772.65",
      high7d: "77956.91",
      low7d: "70678.35",
      latestVolumeUsd: "73774927039.04",
    },
    derivedMetrics: {
      priceChangePercent7d: "5.8",
      tradingRangeWidthUsd: "7278.56",
    },
  };
}

function makeEtfEvidenceSummary(): ResearchEvidenceSummary {
  return {
    source: "btcetfdata-current-btc",
    url: "https://www.btcetfdata.com/v1/current.json",
    fetchedAt: "2026-04-18T09:50:00.000Z",
    values: {
      totalHoldingsBtc: "984687.45",
      netFlowBtc: "609.21",
      issuerCount: "2",
      positiveIssuerCount: "1",
      negativeIssuerCount: "1",
      largestInflowBtc: "1088.13",
      largestOutflowBtc: "-478.92",
    },
    derivedMetrics: {
      largestInflowTicker: "IBIT",
      largestOutflowTicker: "FBTC",
      netFlowDirection: "positive",
    },
  };
}

function makeVixEvidenceSummary(): ResearchEvidenceSummary {
  return {
    source: "cboe-vix-quote",
    url: "https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VIX.json",
    fetchedAt: "2026-04-18T11:00:00.000Z",
    values: {
      vixClose: "21.34",
      vixPreviousClose: "19.80",
      vixHigh: "22.10",
      vixLow: "19.65",
    },
    derivedMetrics: {
      vixSessionChangePct: "7.78",
      vixIntradayRange: "2.45",
    },
  };
}

function makeTreasurySupportingEvidenceSummary(): ResearchEvidenceSummary {
  return {
    source: "treasury-rates",
    url: "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page[size]=5",
    fetchedAt: "2026-04-18T11:00:02.000Z",
    values: {
      treasuryBillsAvgRatePct: "5.22",
      treasuryNotesAvgRatePct: "4.61",
    },
    derivedMetrics: {
      billNoteSpreadBps: "61",
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
      evidenceSummary: makeEvidenceSummary(),
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
        "BTC funding pressure is worth watching because the premium setup is leaning bearish while mark price still sits near 67,250 dollars instead of breaking lower. " +
        "A negative funding read around -0.012 would fit the idea that long conviction is fading before spot fully rolls over, which is why the premium signal matters more than a generic macro mood. " +
        "A rebound in the premium reading would weaken the bearish case, while further compression would confirm downside pressure is still building."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeEvidenceSummary(),
      selfHistory: {
        lastPost: {
          topic: "btc funding previous take",
          family: "funding-structure",
          publishedAt: "2026-04-18T07:00:00.000Z",
          hoursAgo: 4,
          textSnippet: "Earlier funding take.",
        },
        lastSameTopicPost: null,
        lastSameFamilyPost: {
          topic: "btc funding previous take",
          family: "funding-structure",
          publishedAt: "2026-04-18T07:00:00.000Z",
          hoursAgo: 4,
          textSnippet: "Earlier funding take.",
        },
        windows: {
          total24h: 1,
          total7d: 1,
          sameTopic24h: 0,
          sameTopic7d: 0,
          sameFamily24h: 1,
          sameFamily7d: 1,
        },
        changeSinceLastSameTopic: null,
        changeSinceLastSameFamily: {
          comparedToPublishedAt: "2026-04-18T07:00:00.000Z",
          changedFields: ["markPrice"],
          hasMeaningfulChange: true,
        },
        repeatRisk: "medium",
        skipSuggested: false,
        repetitionReason: "recent_same_family_coverage",
      },
      llmProvider: provider,
      minTextLength: 300,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.promptPacket.archetype).toBe("research-agent");
    expect(result.promptPacket.input.analysisAngle).toContain("bearish read in colony signals");
    expect(result.promptPacket.input).not.toHaveProperty("opportunityScore");
    expect(result.promptPacket.input).not.toHaveProperty("rationale");
    expect(result.promptPacket.input).not.toHaveProperty("leaderboardCount");
    expect(result.promptPacket.input).not.toHaveProperty("balanceDem");
    expect(result.promptPacket.instruction).toContain("standalone ANALYSIS post grounded in the input evidence");
    expect(result.promptPacket.constraints.join(" ")).toContain("analysis angle");
    expect(result.promptPacket.constraints.join(" ")).toContain("Do not mention internal scoring");
    expect(result.promptPacket.edge[0]).toContain("Depth over speed");
    expect(result.promptPacket.output.confidenceStyle).toContain("calibrated and evidence-led");
    expect(result.promptPacket.output.successCriteria[0]).toContain("original research");
    expect(result.promptPacket.input.evidence.values.markPrice).toBe("67250.00");
    expect(result.promptPacket.input.evidence.derivedMetrics.fundingRateBps).toBe("-120");
    expect(result.promptPacket.input.evidence.supportingSources[0]?.source).toBe("Blockchain.com Ticker");
    expect(result.promptPacket.input.colonyContext.selfHistory?.repeatRisk).toBe("medium");
    expect(result.promptPacket.constraints.join(" ")).toContain("delta from the last same-topic or same-family post");
  });

  it("adds a family dossier brief for funding-structure topics", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "Negative funding matters here because it is showing up alongside real positioning size and a still-firm price, which makes the setup a derivatives mismatch rather than an automatic trend call. " +
        "Funding near -120 basis points with open interest around 105,600 means traders are paying for bearish positioning while spot remains elevated, so the real question is whether price starts to validate that stress or squeezes it out. " +
        "The view weakens if funding normalizes without price damage or if price decisively breaks higher while positioning stays stretched."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeEvidenceSummary(),
      supportingEvidenceSummaries: [makeFundingSupportingEvidenceSummary()],
      llmProvider: provider,
      minTextLength: 260,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.promptPacket.input.brief.family).toBe("funding-structure");
    expect(result.promptPacket.input.brief.baselineContext[0]).toContain("positioning signals");
    expect(result.promptPacket.input.brief.falseInferenceGuards[0]).toContain("negative funding by itself");
  });

  it("adds a family dossier brief for stablecoin supply topics", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "USDT supply is expanding faster than usual, which matters more than the peg because the relevant signal is issuance speed rather than whether a dollar stablecoin still looks like a dollar. " +
        "The evidence shows 1.79 percent growth over thirty days and 1.26 percent over seven days, so the question is whether the market is absorbing new dollar liquidity cleanly or starting to choke on it. " +
        "The read weakens if supply growth cools materially or if the broader market stops absorbing fresh issuance."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeStablecoinOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeStablecoinEvidenceSummary(),
      supportingEvidenceSummaries: [makeStablecoinSupportingEvidenceSummary()],
      llmProvider: provider,
      minTextLength: 260,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.promptPacket.input.brief.family).toBe("stablecoin-supply");
    expect(result.promptPacket.input.brief.baselineContext[0]).toContain("near 1.00 USD is baseline");
    expect(result.promptPacket.input.brief.falseInferenceGuards[0]).toContain("normal peg");
  });

  it("adds a family dossier brief for spot-momentum topics", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "The bearish read in colony signals is being contradicted by the tape because bitcoin is up 5.8% over the week at 76,991 dollars and the mismatch is that price is still trading in the upper third of a 7,279-dollar range rather than breaking down. " +
        "That matters because price has rebuilt toward the weekly high on heavy volume instead of validating the bearish signal, which makes the live question one of resistance absorption rather than momentum failure. " +
        "The thesis weakens if bitcoin loses the weekly starting level and slips back into the lower half of the range on rising volume."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeSpotOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeSpotEvidenceSummary(),
      llmProvider: provider,
      minTextLength: 260,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.promptPacket.input.brief.family).toBe("spot-momentum");
    expect(result.promptPacket.input.brief.baselineContext[0]).toContain("Absolute price direction");
    expect(result.promptPacket.input.brief.falseInferenceGuards[0]).toContain("price being up by itself");
  });

  it("adds a family dossier brief for ETF flow topics", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "BTC ETF demand is still constructive, but the important detail is that the tape is concentrated rather than broad: aggregate net flow is positive at 609.21 BTC while holdings sit near 984,687 BTC and only one issuer is on the positive side. " +
        "IBIT is doing the real lifting with a 1,088.13 BTC inflow while FBTC is still leaking 478.92 BTC, so the flow picture is supportive but narrow rather than a uniform institutional bid across the complex. " +
        "That view weakens if the net flow flips negative or if the current leader stops carrying the tape."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeEtfOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeEtfEvidenceSummary(),
      llmProvider: provider,
      minTextLength: 260,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.promptPacket.input.brief.family).toBe("etf-flows");
    expect(result.promptPacket.input.brief.baselineContext[0]).toContain("positive or negative ETF flow print");
    expect(result.promptPacket.input.brief.falseInferenceGuards[0]).toContain("positive net flow alone");
  });

  it("adds a family dossier brief for vix-credit topics", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "Volatility is repricing faster than the short-rate backdrop, but the real point is calibration rather than crash-calling: VIX closed at 21.34 after a 7.78 percent session jump while bills still yield 5.22 percent versus 4.61 percent on notes. " +
        "That mix says fear is rising against an already restrictive front-end curve, so the tape is flashing stress without yet proving a full macro break. " +
        "The read weakens if VIX mean-reverts quickly or if the rates backdrop stops holding this inversion."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeVixOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeVixEvidenceSummary(),
      supportingEvidenceSummaries: [makeTreasurySupportingEvidenceSummary()],
      llmProvider: provider,
      minTextLength: 260,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.promptPacket.input.brief.family).toBe("vix-credit");
    expect(result.promptPacket.input.brief.baselineContext[0]).toContain("VIX level is context");
    expect(result.promptPacket.input.brief.falseInferenceGuards[1]).toContain("credit spread");
  });

  it("accepts LLM output only when it clears the quality gate", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "BTC funding pressure is the real thing to watch here because weak premium readings while price stays firm near 67,250 dollars usually mean longs are losing conviction before spot actually rolls over. " +
        "A negative funding read around -0.012 turns that into a concrete bearish setup instead of a vague macro complaint, because positioning stress is visible in the fetched evidence itself. " +
        "Watch the next premium-index read closely: a rebound would weaken the bearish setup, while further compression would confirm downside pressure is building."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeEvidenceSummary(),
      supportingEvidenceSummaries: [makeSupportingEvidenceSummary()],
      llmProvider: provider,
      minTextLength: 300,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.draftSource).toBe("llm");
    expect(result.qualityGate.pass).toBe(true);
    expect(result.text).not.toContain("opportunity score");
    expect(result.text).not.toContain("coverage gap");
    expect(result.qualityGate.checks.find((check) => check.name === "research-angle-grounding")?.pass).toBe(true);
    expect(result.qualityGate.checks.find((check) => check.name === "research-style")?.pass).toBe(true);
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
      evidenceSummary: makeEvidenceSummary(),
      llmProvider: provider,
      minTextLength: 300,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("draft_quality_gate_failed");
    expect(result.qualityGate.checks.find((check) => check.name === "no-internal-reasoning-leak")?.pass).toBe(false);
  });

  it("rejects LLM output that never references fetched evidence values", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "BTC funding pressure still looks bearish because conviction is clearly fading even if spot is holding together for now. " +
        "The structure is negative enough to justify caution, and the broader setup still points to downside risk building under the surface. " +
        "A reversal in positioning would weaken the thesis, but until then the bear case still deserves close attention."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeEvidenceSummary(),
      llmProvider: provider,
      minTextLength: 300,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("draft_quality_gate_failed");
    expect(result.qualityGate.checks.find((check) => check.name === "evidence-value-overlap")?.pass).toBe(false);
  });

  it("accepts evidence overlap from supporting-source values too", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "BTC funding pressure still matters because spot is holding around 67,240 dollars while the premium side stays negative, which keeps the signal grounded in real market data. " +
        "That price anchor and the weak funding read together suggest positioning is softening before spot fully gives way, rather than a generic mood swing across crypto. " +
        "If the funding read normalizes and the price pushes through resistance, the bearish read weakens quickly."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeEvidenceSummary(),
      supportingEvidenceSummaries: [makeSupportingEvidenceSummary()],
      llmProvider: provider,
      minTextLength: 300,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.qualityGate.checks.find((check) => check.name === "evidence-value-overlap")?.pass).toBe(true);
  });

  it("rejects funding drafts that treat negative funding alone as proof", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "Negative funding by itself proves downside here, because traders are clearly positioned the right way and the market is only waiting to catch down to the derivatives signal. " +
        "The negative funding print guarantees the next move is lower, so there is no need to weigh price structure or open interest context beyond the sign of the rate itself. " +
        "Only a sudden reversal in funding would challenge that bearish call."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeEvidenceSummary(),
      supportingEvidenceSummaries: [makeFundingSupportingEvidenceSummary()],
      llmProvider: provider,
      minTextLength: 260,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("draft_quality_gate_failed");
    expect(result.qualityGate.checks.find((check) => check.name === "family-dossier-grounding")?.pass).toBe(false);
  });

  it("rejects stablecoin drafts that treat a normal peg as alpha", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "USDT supply expansion is constructive because the token is still sitting exactly at $1, and that alone proves the system is healthy enough to absorb new issuance without stress. " +
        "The peg staying at 1 means the latest supply growth is a clean bullish signal rather than a reserve concern, which is why the new issuance should be read as straightforward fuel for risk assets. " +
        "Only a break below the peg would challenge that interpretation."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeStablecoinOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeStablecoinEvidenceSummary(),
      supportingEvidenceSummaries: [makeStablecoinSupportingEvidenceSummary()],
      llmProvider: provider,
      minTextLength: 260,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("draft_quality_gate_failed");
    expect(result.qualityGate.checks.find((check) => check.name === "family-dossier-grounding")?.pass).toBe(false);
  });

  it("rejects vix-credit drafts that treat vix alone as a crash signal", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "High VIX proves a crash is coming here, because the volatility spike confirms recession panic and the credit spread is already signaling the same thing. " +
        "VIX alone is enough to make the call because fear metrics only move like this when the market is about to break. " +
        "Only a sudden drop in VIX would challenge that crash thesis."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeVixOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeVixEvidenceSummary(),
      supportingEvidenceSummaries: [makeTreasurySupportingEvidenceSummary()],
      llmProvider: provider,
      minTextLength: 260,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("draft_quality_gate_failed");
    expect(result.qualityGate.checks.find((check) => check.name === "family-dossier-grounding")?.pass).toBe(false);
  });

  it("rejects spot-momentum drafts that turn raw price direction into the thesis", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "Bitcoin is up 5.8 percent this week, so the market is clearly bullish again and the bearish signal no longer matters. " +
        "Price has rallied hard enough that the only real conclusion is that momentum has already resolved higher, which means the bearish take is simply wrong because the weekly move is positive. " +
        "Only a sudden crash would challenge that bullish conclusion."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeSpotOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeSpotEvidenceSummary(),
      llmProvider: provider,
      minTextLength: 260,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("draft_quality_gate_failed");
    expect(result.qualityGate.checks.find((check) => check.name === "family-dossier-grounding")?.pass).toBe(false);
  });

  it("rejects ETF drafts that treat positive net flow alone as proof of broad demand", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "Positive net flow of 609.21 BTC proves broad institutional demand is strong again, so the whole ETF complex is clearly back in accumulation mode. " +
        "The holdings base near 984,687 BTC just reinforces that conclusion and means institutions are buying aggressively across the board. " +
        "Only a turn to outright net outflows would challenge that bullish call."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeEtfOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeEtfEvidenceSummary(),
      llmProvider: provider,
      minTextLength: 260,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("draft_quality_gate_failed");
    expect(result.qualityGate.checks.find((check) => check.name === "family-dossier-grounding")?.pass).toBe(false);
  });

  it("rejects generic market commentary that ignores the divergence angle", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "Bitcoin has gained 5.8 percent this week and is now trading near 67,250 dollars inside a broad range with heavy volume. " +
        "The market still looks indecisive because price keeps oscillating between support and resistance without a clean breakout. " +
        "A move above the recent high would be constructive, while a move back toward the lower end of the range would turn the setup weaker."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeEvidenceSummary(),
      llmProvider: provider,
      minTextLength: 300,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("draft_quality_gate_failed");
    expect(result.qualityGate.checks.find((check) => check.name === "research-angle-grounding")?.pass).toBe(false);
  });

  it("rejects awkward colony-sentiment phrasing even when the numbers overlap", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "Bitcoin's 5.8% weekly move is quietly refuting the bearish half of colony sentiment because spot is still trading near 67,250 dollars rather than breaking lower. " +
        "The range structure still matters, but the phrase above captures the idea that the market is not yet validating the signal. " +
        "A reversal through the lower end of the range would restore the bear case."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeEvidenceSummary(),
      llmProvider: provider,
      minTextLength: 300,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("draft_quality_gate_failed");
    expect(result.qualityGate.checks.find((check) => check.name === "research-style")?.pass).toBe(false);
  });

  it("rejects mirrored rhetorical closes even when the analysis angle is present", async () => {
    const provider = {
      name: "test-provider",
      complete: vi.fn().mockResolvedValue(
        "The bearish read in colony signals is being contradicted by the tape because Bitcoin is up 5.8% this week at 67,250 dollars and still holding near the top of its range. " +
        "That mismatch matters because price and volume are leaning constructive instead of validating the breakdown thesis. " +
        "Until support breaks, the divergence is one of narrative lagging structure rather than structure lagging narrative."
      ),
    };

    const result = await buildResearchDraft({
      opportunity: makeOpportunity(),
      feedCount: 30,
      leaderboardCount: 10,
      availableBalance: 25,
      evidenceSummary: makeEvidenceSummary(),
      llmProvider: provider,
      minTextLength: 300,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("draft_quality_gate_failed");
    expect(result.qualityGate.checks.find((check) => check.name === "research-style")?.pass).toBe(false);
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
      evidenceSummary: makeEvidenceSummary(),
      llmProvider: provider,
      minTextLength: 300,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("draft_quality_gate_failed");
    expect(result.notes[0]).toContain("llm_output_failed");
  });
});
