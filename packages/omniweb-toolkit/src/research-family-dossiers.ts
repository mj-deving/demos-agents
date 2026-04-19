import type { ResearchEvidenceSummary } from "./research-evidence.js";
import type { ResearchColonySubstrate } from "./research-colony-substrate.js";
import { getResearchTopicFamilyContract } from "./research-family-contracts.js";
import type { ResearchOpportunity } from "./research-opportunities.js";
import type { ResearchTopicFamily } from "./research-source-profile.js";
import type { ResearchSelfHistorySummary } from "./research-self-history.js";

export interface ResearchBrief {
  family: ResearchTopicFamily;
  baselineContext: string[];
  focusNow: string[];
  falseInferenceGuards: string[];
  anomalySummary: string;
  allowedThesisSpace: string;
  invalidationFocus: string;
  linkedThemes: Array<{
    key: string;
    label: string;
    reason: string;
  }>;
  domainContext: string[];
  substrateSummary: string | null;
  previousCoverageDelta: string | null;
}

type CoreResearchBrief = Omit<ResearchBrief, "linkedThemes" | "domainContext" | "substrateSummary" | "previousCoverageDelta">;

export function buildResearchBrief(
  opportunity: ResearchOpportunity,
  colonySubstrate: ResearchColonySubstrate | undefined,
  evidenceSummary: ResearchEvidenceSummary,
  supportingEvidenceSummaries: ResearchEvidenceSummary[] = [],
  selfHistory?: ResearchSelfHistorySummary | null,
): ResearchBrief {
  const linkedContext = buildLinkedResearchContext(
    opportunity,
    colonySubstrate,
    evidenceSummary,
    supportingEvidenceSummaries,
  );
  let baseBrief: CoreResearchBrief;

  if (opportunity.sourceProfile.family === "stablecoin-supply") {
    baseBrief = buildStablecoinSupplyBrief(evidenceSummary, supportingEvidenceSummaries);
  } else if (opportunity.sourceProfile.family === "funding-structure") {
    baseBrief = buildFundingStructureBrief(evidenceSummary, supportingEvidenceSummaries);
  } else if (opportunity.sourceProfile.family === "network-activity") {
    baseBrief = buildNetworkActivityBrief(evidenceSummary, supportingEvidenceSummaries);
  } else if (opportunity.sourceProfile.family === "spot-momentum") {
    baseBrief = buildSpotMomentumBrief(evidenceSummary, supportingEvidenceSummaries);
  } else if (opportunity.sourceProfile.family === "etf-flows") {
    baseBrief = buildEtfFlowsBrief(evidenceSummary, supportingEvidenceSummaries);
  } else if (opportunity.sourceProfile.family === "vix-credit") {
    baseBrief = buildVixCreditBrief(evidenceSummary, supportingEvidenceSummaries);
  } else {
    baseBrief = {
      family: opportunity.sourceProfile.family,
      baselineContext: [
        "Use the fetched evidence as the center of gravity for the post.",
      ],
      focusNow: [
        "Explain what changed or what is mismatched in the evidence.",
      ],
      falseInferenceGuards: [
        "Do not turn internal workflow or default invariants into the thesis.",
      ],
      anomalySummary: "Focus on the strongest non-trivial change or mismatch in the fetched evidence.",
      allowedThesisSpace: "Use the evidence to form one concrete, externally legible thesis.",
      invalidationFocus: "State the next observable condition that would weaken the thesis.",
    };
  }

  return {
    ...baseBrief,
    linkedThemes: linkedContext.linkedThemes,
    domainContext: linkedContext.domainContext,
    substrateSummary: summarizeColonySubstrate(colonySubstrate),
    previousCoverageDelta: summarizePreviousCoverageDelta(selfHistory ?? null),
  };
}

function summarizeColonySubstrate(
  colonySubstrate: ResearchColonySubstrate | undefined,
): string | null {
  if (!colonySubstrate) return null;

  const parts = [
    colonySubstrate.signalSummary.agentCount != null
      ? `${colonySubstrate.signalSummary.agentCount} agent take(s) in the live signal`
      : null,
    colonySubstrate.supportingTakes.length > 0
      ? `${colonySubstrate.supportingTakes.length} supporting take(s)`
      : null,
    colonySubstrate.dissentingTake ? "clear dissent is present" : "no explicit dissent is surfaced",
    colonySubstrate.crossReferences.length > 0
      ? `${colonySubstrate.crossReferences.length} cross-link(s) to adjacent themes`
      : null,
    colonySubstrate.recentRelatedPosts.length > 0
      ? `${colonySubstrate.recentRelatedPosts.length} recent related colony post(s)`
      : null,
  ].filter((value): value is string => value != null);

  return parts.length > 0 ? parts.join("; ") : null;
}

function summarizePreviousCoverageDelta(
  selfHistory: ResearchSelfHistorySummary | null,
): string | null {
  if (!selfHistory) return null;

  const sameTopic = selfHistory.changeSinceLastSameTopic;
  if (selfHistory.lastSameTopicPost) {
    if (sameTopic?.hasMeaningfulChange) {
      const fields = sameTopic.changedFields.slice(0, 4).join(", ");
      return `Last same-topic post was ${selfHistory.lastSameTopicPost.hoursAgo}h ago; the evidence moved materially in ${fields || "the tracked fields"}.`;
    }
    return `Last same-topic post was ${selfHistory.lastSameTopicPost.hoursAgo}h ago with no material evidence change since then.`;
  }

  const sameFamily = selfHistory.changeSinceLastSameFamily;
  if (selfHistory.lastSameFamilyPost) {
    if (sameFamily?.hasMeaningfulChange) {
      const fields = sameFamily.changedFields.slice(0, 4).join(", ");
      return `Last same-family post was ${selfHistory.lastSameFamilyPost.hoursAgo}h ago; the evidence moved materially in ${fields || "the tracked fields"}.`;
    }
    return `Last same-family post was ${selfHistory.lastSameFamilyPost.hoursAgo}h ago with no material evidence change since then.`;
  }

  if (selfHistory.windows.total24h > 0 || selfHistory.windows.total7d > 0) {
    return `This agent has ${selfHistory.windows.total24h} post(s) in the last 24h and ${selfHistory.windows.total7d} in the last 7d, but none on this exact topic or family.`;
  }

  return null;
}

function buildEtfFlowsBrief(
  evidenceSummary: ResearchEvidenceSummary,
  supportingEvidenceSummaries: ResearchEvidenceSummary[],
): CoreResearchBrief {
  const contract = getResearchTopicFamilyContract("etf-flows");
  const netFlowBtc = findMetric("netFlowBtc", evidenceSummary, supportingEvidenceSummaries);
  const totalHoldingsBtc = findMetric("totalHoldingsBtc", evidenceSummary, supportingEvidenceSummaries);
  const positiveIssuerCount = findMetric("positiveIssuerCount", evidenceSummary, supportingEvidenceSummaries);
  const negativeIssuerCount = findMetric("negativeIssuerCount", evidenceSummary, supportingEvidenceSummaries);
  const largestInflowBtc = findMetric("largestInflowBtc", evidenceSummary, supportingEvidenceSummaries);
  const largestOutflowBtc = findMetric("largestOutflowBtc", evidenceSummary, supportingEvidenceSummaries);
  const largestInflowTicker = findMetric("largestInflowTicker", evidenceSummary, supportingEvidenceSummaries);
  const largestOutflowTicker = findMetric("largestOutflowTicker", evidenceSummary, supportingEvidenceSummaries);
  const netFlowDirection = findMetric("netFlowDirection", evidenceSummary, supportingEvidenceSummaries);

  const breadthSummary = [
    positiveIssuerCount ? `${positiveIssuerCount} positive issuer(s)` : null,
    negativeIssuerCount ? `${negativeIssuerCount} negative issuer(s)` : null,
  ].filter((value): value is string => value != null).join(" vs ");

  const concentrationSummary = largestInflowTicker && largestInflowBtc
    ? `${largestInflowTicker} leads the tape at ${largestInflowBtc} BTC`
    : largestOutflowTicker && largestOutflowBtc
      ? `${largestOutflowTicker} is the largest drag at ${largestOutflowBtc} BTC`
      : "issuer leadership is unclear";

  return {
    family: "etf-flows",
    baselineContext: contract.promptDoctrine.baseline,
    focusNow: contract.promptDoctrine.focus,
    falseInferenceGuards: contract.claimBounds.blocked,
    anomalySummary: `ETF holdings sit around ${totalHoldingsBtc ?? "an unresolved total"} BTC, aggregate flow is ${netFlowDirection ?? "unclear"}${netFlowBtc ? ` at ${netFlowBtc} BTC` : ""}, issuer breadth reads ${breadthSummary || "unclear"}, and ${concentrationSummary}.`,
    allowedThesisSpace: contract.researchBrief.allowedThesisSpace,
    invalidationFocus: contract.researchBrief.invalidationFocus,
  };
}

function buildVixCreditBrief(
  evidenceSummary: ResearchEvidenceSummary,
  supportingEvidenceSummaries: ResearchEvidenceSummary[],
): CoreResearchBrief {
  const contract = getResearchTopicFamilyContract("vix-credit");
  const vixClose = findMetric("vixClose", evidenceSummary, supportingEvidenceSummaries);
  const vixPreviousClose = findMetric("vixPreviousClose", evidenceSummary, supportingEvidenceSummaries);
  const vixSessionChangePct = findMetric("vixSessionChangePct", evidenceSummary, supportingEvidenceSummaries);
  const vixIntradayRange = findMetric("vixIntradayRange", evidenceSummary, supportingEvidenceSummaries);
  const billRate = findMetric("treasuryBillsAvgRatePct", evidenceSummary, supportingEvidenceSummaries);
  const noteRate = findMetric("treasuryNotesAvgRatePct", evidenceSummary, supportingEvidenceSummaries);
  const billNoteSpreadBps = findMetric("billNoteSpreadBps", evidenceSummary, supportingEvidenceSummaries);

  const spreadValue = parseMetric(billNoteSpreadBps);
  const spreadRead = spreadValue == null
    ? "the short-rate backdrop is unresolved"
    : spreadValue > 0
      ? `the bill/note curve is still inverted by ${billNoteSpreadBps} bps`
      : spreadValue < 0
        ? `notes are yielding above bills by ${Math.abs(spreadValue).toFixed(2)} bps`
        : "the bill/note curve is effectively flat";

  return {
    family: "vix-credit",
    baselineContext: contract.promptDoctrine.baseline,
    focusNow: contract.promptDoctrine.focus,
    falseInferenceGuards: contract.claimBounds.blocked,
    anomalySummary: `VIX closed${vixClose ? ` at ${vixClose}` : ""}${vixPreviousClose ? ` versus ${vixPreviousClose} prior` : ""}${vixSessionChangePct ? `, a ${vixSessionChangePct}% session move` : ""}${vixIntradayRange ? ` with a ${vixIntradayRange}-point intraday range` : ""}, while ${spreadRead}${billRate && noteRate ? ` (${billRate}% bills vs ${noteRate}% notes)` : ""}.`,
    allowedThesisSpace: contract.researchBrief.allowedThesisSpace,
    invalidationFocus: contract.researchBrief.invalidationFocus,
  };
}

function buildSpotMomentumBrief(
  evidenceSummary: ResearchEvidenceSummary,
  supportingEvidenceSummaries: ResearchEvidenceSummary[],
): CoreResearchBrief {
  const contract = getResearchTopicFamilyContract("spot-momentum");
  const currentPrice = findMetric("currentPriceUsd", evidenceSummary, supportingEvidenceSummaries);
  const startPrice = findMetric("startingPriceUsd", evidenceSummary, supportingEvidenceSummaries);
  const high7d = findMetric("high7d", evidenceSummary, supportingEvidenceSummaries);
  const low7d = findMetric("low7d", evidenceSummary, supportingEvidenceSummaries);
  const volume = findMetric("latestVolumeUsd", evidenceSummary, supportingEvidenceSummaries);
  const change7d = findMetric("priceChangePercent7d", evidenceSummary, supportingEvidenceSummaries);
  const rangeWidth = findMetric("tradingRangeWidthUsd", evidenceSummary, supportingEvidenceSummaries);
  const rangeLocation = describeRangeLocation(currentPrice, low7d, high7d);

  return {
    family: "spot-momentum",
    baselineContext: contract.promptDoctrine.baseline,
    focusNow: contract.promptDoctrine.focus,
    falseInferenceGuards: contract.claimBounds.blocked,
    anomalySummary: `Spot is ${change7d ? `${change7d}% from the 7d starting level` : "moving without a clear 7d delta"}, with current price${currentPrice ? ` at ${currentPrice}` : ""}${rangeLocation ? ` sitting in the ${rangeLocation} of the 7d range` : ""}${rangeWidth ? ` across a ${rangeWidth} USD band` : ""}${volume ? ` on ${volume} of latest volume` : ""}.`,
    allowedThesisSpace: `${contract.researchBrief.allowedThesisSpace}${startPrice ? ` Anchor the current move to the ${startPrice} starting level.` : ""}${high7d && low7d ? ` Use the observed range from ${low7d} to ${high7d} as the immediate map.` : ""}`,
    invalidationFocus: contract.researchBrief.invalidationFocus,
  };
}

function buildFundingStructureBrief(
  evidenceSummary: ResearchEvidenceSummary,
  supportingEvidenceSummaries: ResearchEvidenceSummary[],
): CoreResearchBrief {
  const contract = getResearchTopicFamilyContract("funding-structure");
  const fundingBps = findMetric("fundingRateBps", evidenceSummary, supportingEvidenceSummaries);
  const markPrice = findMetric("markPrice", evidenceSummary, supportingEvidenceSummaries);
  const spreadUsd = findMetric("markIndexSpreadUsd", evidenceSummary, supportingEvidenceSummaries);
  const openInterest = findMetric("openInterest", evidenceSummary, supportingEvidenceSummaries)
    ?? findMetric("openInterestContracts", evidenceSummary, supportingEvidenceSummaries);

  const fundingValue = parseMetric(fundingBps);
  const spreadValue = parseMetric(spreadUsd);
  const fundingDirection = describeFundingDirection(fundingValue);
  const spreadDirection = describeSpreadDirection(spreadValue);
  const oiContext = openInterest
    ? `Open interest sits around ${openInterest}, so positioning size has to be part of the interpretation.`
    : "Open interest context is thin, so avoid overclaiming from funding alone.";

  return {
    family: "funding-structure",
    baselineContext: contract.promptDoctrine.baseline,
    focusNow: contract.promptDoctrine.focus,
    falseInferenceGuards: contract.claimBounds.blocked,
    anomalySummary: `Funding is ${fundingDirection}${fundingBps ? ` (${fundingBps} bps)` : ""}, the mark/index spread is ${spreadDirection}${spreadUsd ? ` (${spreadUsd} USD)` : ""}, and ${oiContext}`,
    allowedThesisSpace: `${contract.researchBrief.allowedThesisSpace}${markPrice ? ` Ground the mechanism in the observed mark price (${markPrice}).` : ""}`,
    invalidationFocus: contract.researchBrief.invalidationFocus,
  };
}

function buildNetworkActivityBrief(
  evidenceSummary: ResearchEvidenceSummary,
  supportingEvidenceSummaries: ResearchEvidenceSummary[],
): CoreResearchBrief {
  const contract = getResearchTopicFamilyContract("network-activity");
  const blockCount = findMetric("blockCount24h", evidenceSummary, supportingEvidenceSummaries);
  const transactionCount = findMetric("transactionCount24h", evidenceSummary, supportingEvidenceSummaries);
  const txPerBlock = findMetric("transactionsPerBlock24h", evidenceSummary, supportingEvidenceSummaries);
  const hashrate = findMetric("hashrate24h", evidenceSummary, supportingEvidenceSummaries);
  const priceUsd = findMetric("priceUsd", evidenceSummary, supportingEvidenceSummaries);

  const densityRead = txPerBlock
    ? `roughly ${txPerBlock} transactions per block`
    : "unclear transaction density";
  const hashrateRead = hashrate
    ? `hashrate is running near ${hashrate}`
    : "hashrate context is unresolved";

  return {
    family: "network-activity",
    baselineContext: contract.promptDoctrine.baseline,
    focusNow: contract.promptDoctrine.focus,
    falseInferenceGuards: contract.claimBounds.blocked,
    anomalySummary: `Network activity shows${blockCount ? ` ${blockCount} blocks` : " an unresolved block count"} and${transactionCount ? ` ${transactionCount} transactions` : " unresolved transaction flow"} over the observed window, ${densityRead}, ${hashrateRead}${priceUsd ? `, with spot around ${priceUsd}` : ""}.`,
    allowedThesisSpace: contract.researchBrief.allowedThesisSpace,
    invalidationFocus: contract.researchBrief.invalidationFocus,
  };
}

function buildStablecoinSupplyBrief(
  evidenceSummary: ResearchEvidenceSummary,
  supportingEvidenceSummaries: ResearchEvidenceSummary[],
): CoreResearchBrief {
  const contract = getResearchTopicFamilyContract("stablecoin-supply");
  const pegPrice = findMetric("priceUsd", evidenceSummary, supportingEvidenceSummaries);
  const pegDeviation = findMetric("pegDeviationPct", evidenceSummary, supportingEvidenceSummaries);
  const supply1d = evidenceSummary.derivedMetrics.supplyChangePct1d ?? null;
  const supply7d = evidenceSummary.derivedMetrics.supplyChangePct7d ?? null;
  const supply30d = evidenceSummary.derivedMetrics.supplyChangePct30d ?? null;

  const pegDeviationValue = parseMetric(pegDeviation);
  const pegStable = pegDeviationValue == null || pegDeviationValue < 0.1;
  const supply30dValue = parseMetric(supply30d);
  const supply7dValue = parseMetric(supply7d);
  const supplyTrend = describeSupplyTrend(supply1d, supply7d, supply30d);

  const anomalySummary = pegStable
    ? `Supply is changing (${supplyTrend}) while the peg remains within normal noise${pegPrice ? ` around ${pegPrice}` : ""}; treat peg stability as background context, not as the thesis.`
    : `Supply is changing (${supplyTrend}) and the peg is no longer behaving like background noise${pegPrice ? ` (${pegPrice})` : ""}; focus on whether the deviation is becoming stress.`;

  const allowedThesisSpace = pegStable
    ? "Write about liquidity expansion, absorption, or crowding only if the thesis is anchored in supply change and market context, not in the normal peg itself."
    : "Write about stress only if the thesis is anchored in the combination of supply dynamics and material peg deviation.";

  const invalidationFocus = pegStable
    ? "Invalidate with a clear supply slowdown, supply reversal, or a failure of the broader market context to absorb the new issuance."
    : "Invalidate with peg normalization or a reversal in the supply stress pattern.";

  return {
    family: "stablecoin-supply",
    baselineContext: contract.promptDoctrine.baseline,
    focusNow: contract.promptDoctrine.focus,
    falseInferenceGuards: contract.claimBounds.blocked,
    anomalySummary,
    allowedThesisSpace: allowedThesisSpace === contract.researchBrief.allowedThesisSpace
      ? contract.researchBrief.allowedThesisSpace
      : allowedThesisSpace,
    invalidationFocus: invalidationFocus === contract.researchBrief.invalidationFocus
      ? contract.researchBrief.invalidationFocus
      : invalidationFocus,
  };
}

function findMetric(
  key: string,
  evidenceSummary: ResearchEvidenceSummary,
  supportingEvidenceSummaries: ResearchEvidenceSummary[],
): string | null {
  const allEvidence = [evidenceSummary, ...supportingEvidenceSummaries];
  for (const summary of allEvidence) {
    const direct = summary.values[key] ?? summary.derivedMetrics[key];
    if (typeof direct === "string" && direct.length > 0) {
      return direct;
    }
  }
  return null;
}

function parseMetric(value: string | null): number | null {
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function describeSupplyTrend(day: string | null, week: string | null, month: string | null): string {
  const parts = [
    day ? `${day}% 1d` : null,
    week ? `${week}% 7d` : null,
    month ? `${month}% 30d` : null,
  ].filter((value): value is string => value != null);
  return parts.length > 0 ? parts.join(", ") : "with no derived supply delta";
}

function describeFundingDirection(value: number | null): string {
  if (value == null) return "unresolved";
  if (value < 0) return "negative";
  if (value > 0) return "positive";
  return "flat";
}

function describeSpreadDirection(value: number | null): string {
  if (value == null) return "unclear";
  if (value < 0) return "discounted";
  if (value > 0) return "trading above index";
  return "flat to index";
}

function describeRangeLocation(
  currentPrice: string | null,
  low7d: string | null,
  high7d: string | null,
): string | null {
  const current = parseMetric(currentPrice);
  const low = parseMetric(low7d);
  const high = parseMetric(high7d);
  if (current == null || low == null || high == null || high <= low) {
    return null;
  }

  const normalized = (current - low) / (high - low);
  if (normalized >= 0.67) return "upper third";
  if (normalized <= 0.33) return "lower third";
  return "middle third";
}

function buildLinkedResearchContext(
  opportunity: ResearchOpportunity,
  colonySubstrate: ResearchColonySubstrate | undefined,
  evidenceSummary: ResearchEvidenceSummary,
  supportingEvidenceSummaries: ResearchEvidenceSummary[],
): Pick<ResearchBrief, "linkedThemes" | "domainContext"> {
  const themeMap = new Map<string, { key: string; label: string; reason: string }>();
  const haystack = collectColonyContextText(opportunity, colonySubstrate).join(" ").toLowerCase();
  const assets = new Set(
    [
      ...(opportunity.matchedSignal.assets ?? []),
      ...(colonySubstrate?.signalSummary.assets ?? []),
    ].map((value) => value.toLowerCase()),
  );
  const pegDeviation = parseMetric(findMetric("pegDeviationPct", evidenceSummary, supportingEvidenceSummaries));

  const addTheme = (key: string, label: string, reason: string): void => {
    if (!themeMap.has(key)) {
      themeMap.set(key, { key, label, reason });
    }
  };

  const mentions = (...keywords: string[]): boolean => keywords.some((keyword) => haystack.includes(keyword));
  const family = opportunity.sourceProfile.family;

  if (family === "stablecoin-supply") {
    addTheme("dollar-liquidity", "Dollar liquidity", "Stablecoin supply is best read as a dollar-liquidity input, not a standalone direction call.");
    if (mentions("absorption", "bitcoin absorption", "btc absorption") || assets.has("btc") || assets.has("bitcoin")) {
      addTheme("btc-absorption", "BTC absorption", "The colony signal ties stablecoin issuance to whether BTC can absorb the added liquidity cleanly.");
    }
    if ((pegDeviation != null && pegDeviation >= 0.1) || mentions("peg", "reserve", "regulatory", "redemption")) {
      addTheme("peg-stress", "Peg stress", "Peg behavior matters here only as a stress check layered on top of supply dynamics.");
    }
    if (mentions("rwa", "treasury", "treasuries", "yield", "buidl", "flight to safety")) {
      addTheme("rwa-rotation", "RWA rotation", "Recent colony context links stablecoin liquidity to rotation into tokenized yield or treasury products.");
    }
  }

  if (family === "funding-structure") {
    addTheme("exchange-liquidity", "Exchange liquidity", "Funding, premium, and open interest describe how exchange liquidity is being used, not just where price is trading.");
    if (assets.has("btc") || assets.has("bitcoin") || mentions("btc", "bitcoin")) {
      addTheme("btc-absorption", "BTC absorption", "The derivatives setup matters because it can show whether BTC is absorbing bearish positioning or failing under it.");
    }
  }

  if (family === "etf-flows") {
    addTheme("btc-absorption", "BTC absorption", "ETF demand only matters if BTC can absorb the flow without narrowing into one-issuer support.");
    if (mentions("rwa", "treasury", "treasuries", "yield", "buidl")) {
      addTheme("rwa-rotation", "RWA rotation", "The colony context links ETF demand to broader institutional allocation across onchain yield and treasury products.");
    }
  }

  if (family === "vix-credit") {
    addTheme("dollar-liquidity", "Dollar liquidity", "Front-end rates and volatility together are a dollar-liquidity backdrop, not just a one-session fear gauge.");
  }

  const linkedThemes = Array.from(themeMap.values()).slice(0, 3);
  const domainContext = linkedThemes.map((theme) => `${theme.label}: ${theme.reason}`);
  return { linkedThemes, domainContext };
}

function collectColonyContextText(
  opportunity: ResearchOpportunity,
  colonySubstrate: ResearchColonySubstrate | undefined,
): string[] {
  const values = [
    opportunity.topic,
    opportunity.matchedSignal.shortTopic ?? null,
    opportunity.matchedSignal.text ?? null,
    opportunity.matchedSignal.keyInsight ?? null,
    ...(opportunity.matchedSignal.tags ?? []),
    ...(opportunity.matchedSignal.crossReferences ?? []).map((entry) => entry.description),
    colonySubstrate?.signalSummary.shortTopic ?? null,
    colonySubstrate?.signalSummary.text ?? null,
    colonySubstrate?.signalSummary.keyInsight ?? null,
    ...(colonySubstrate?.crossReferences ?? []).map((entry) => entry.description),
    ...(colonySubstrate?.supportingTakes ?? []).map((entry) => entry.textSnippet),
    colonySubstrate?.dissentingTake?.textSnippet ?? null,
    ...(colonySubstrate?.recentRelatedPosts ?? []).map((entry) => entry.textSnippet),
  ];

  return values.filter((value): value is string => typeof value === "string" && value.length > 0);
}
