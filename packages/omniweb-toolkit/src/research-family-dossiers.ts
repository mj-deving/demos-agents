import type { ResearchEvidenceSummary } from "./research-evidence.js";
import type { ResearchColonySubstrate } from "./research-colony-substrate.js";
import type { ResearchOpportunity } from "./research-opportunities.js";
import type { ResearchTopicFamily } from "./research-source-profile.js";
import type { ResearchSelfHistorySummary } from "./research-self-history.js";

export interface ResearchFamilyDossier {
  family: ResearchTopicFamily;
  baseline: string[];
  focus: string[];
  falseInferenceGuards: string[];
}

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

const GENERIC_DOSSIER: ResearchFamilyDossier = {
  family: "unsupported",
  baseline: [
    "Use the fetched evidence as the center of gravity for the post.",
  ],
  focus: [
    "Explain what changed or what is mismatched in the evidence.",
  ],
  falseInferenceGuards: [
    "Do not turn internal workflow or default invariants into the thesis.",
  ],
};

const STABLECOIN_SUPPLY_DOSSIER: ResearchFamilyDossier = {
  family: "stablecoin-supply",
  baseline: [
    "A stablecoin trading near 1.00 USD is baseline, not alpha.",
    "Minor peg drift is noise unless it is persistent or paired with other stress signals.",
    "Supply growth alone is not automatically bullish or bearish.",
  ],
  focus: [
    "Focus on acceleration or deceleration in supply versus prior day, week, and month.",
    "Only discuss peg behavior if deviation is material or persistent.",
    "Frame the thesis around liquidity conditions or stress, not around the existence of a normal peg.",
  ],
  falseInferenceGuards: [
    "Do not claim that a normal peg by itself proves health, demand, or reserve strength.",
    "Do not use 'still at $1' as the core insight.",
    "Do not jump from supply growth to a risk-on conclusion unless the evidence packet supports it.",
  ],
};

const FUNDING_STRUCTURE_DOSSIER: ResearchFamilyDossier = {
  family: "funding-structure",
  baseline: [
    "Funding and premium are positioning signals, not standalone direction calls.",
    "Negative funding is not automatically bearish and not automatically contrarian bullish.",
    "Funding without price and open-interest context is incomplete.",
  ],
  focus: [
    "Focus on how funding, premium, and open interest line up with price behavior.",
    "Explain whether the derivatives structure is confirming the move, fading it, or showing crowded positioning that still needs follow-through.",
    "Treat a single funding print as evidence inside a positioning story, not as the whole thesis.",
  ],
  falseInferenceGuards: [
    "Do not claim that negative funding by itself proves downside.",
    "Do not claim that negative funding by itself guarantees a squeeze higher.",
    "Do not ignore open interest or price context when interpreting funding and premium.",
    "Do not call a squeeze setup without open-interest change or liquidation context.",
  ],
};

const SPOT_MOMENTUM_DOSSIER: ResearchFamilyDossier = {
  family: "spot-momentum",
  baseline: [
    "Absolute price direction over a week is context, not the thesis by itself.",
    "Spot momentum needs range location first; the latest volume print is only secondary context.",
    "A move toward the top or bottom of the range matters more than a generic up-or-down recap.",
  ],
  focus: [
    "Focus on whether the tape is resolving toward expansion, rejection, or absorption inside the observed range.",
    "Explain whether price behavior is aligning with or pushing against the colony signal rather than defaulting to generic trend commentary.",
    "Use the current price and range width as the core evidence, and treat the latest volume print as bounded context rather than proof of order flow.",
  ],
  falseInferenceGuards: [
    "Do not claim that price being up by itself proves a bullish thesis.",
    "Do not claim that price being down by itself proves a bearish thesis.",
    "Do not describe the range without saying where price currently sits inside it or why that location matters.",
    "Do not treat the latest volume print as proof that the tape is confirming or rejecting the signal.",
  ],
};

const ETF_FLOWS_DOSSIER: ResearchFamilyDossier = {
  family: "etf-flows",
  baseline: [
    "One positive or negative ETF flow print is context, not a complete institutional-demand thesis by itself.",
    "Aggregate net flow matters, but issuer breadth and concentration determine how broad that demand really is.",
    "Total holdings are structural context; fresh thesis should come from current flow mix and leadership, not holdings alone.",
  ],
  focus: [
    "Focus on whether the flow picture is broadening, narrowing, or concentrating in one issuer.",
    "Explain whether the latest ETF tape signals durable institutional demand, weak participation, or one-name concentration.",
    "Use aggregate net flow, positive-vs-negative issuer mix, and the leading inflow or outflow name together.",
  ],
  falseInferenceGuards: [
    "Do not claim that positive net flow alone proves broad institutional demand.",
    "Do not treat total holdings by themselves as a fresh bullish signal.",
    "Do not ignore issuer concentration when one fund is carrying the tape.",
  ],
};

const NETWORK_ACTIVITY_DOSSIER: ResearchFamilyDossier = {
  family: "network-activity",
  baseline: [
    "High on-chain activity is context, not an automatic bullish thesis.",
    "More transactions or blocks do not automatically mean healthy demand, adoption, or price upside.",
    "Network statistics need price or market context to distinguish speculation, stress, and genuine usage.",
  ],
  focus: [
    "Focus on whether throughput, transaction density, and price behavior confirm real network usage, congestion, or stress.",
    "Explain whether the network data is supporting, lagging, or contradicting the colony signal.",
    "Use block activity together with transaction intensity, hashrate when available, and price context rather than narrating one metric in isolation.",
  ],
  falseInferenceGuards: [
    "Do not claim that more transactions by themselves prove adoption or a bullish outcome.",
    "Do not treat elevated hashrate or block count alone as proof of network health or price strength.",
    "Do not turn generic on-chain activity into the thesis without explaining whether it reflects usage, congestion, or speculation.",
  ],
};

const VIX_CREDIT_DOSSIER: ResearchFamilyDossier = {
  family: "vix-credit",
  baseline: [
    "An elevated VIX level is context, not a complete stress thesis by itself.",
    "One volatility spike is not automatically a recession or credit event.",
    "This family compares volatility to a Treasury term-spread backdrop, not to literal corporate credit spreads.",
  ],
  focus: [
    "Focus on whether volatility is repricing faster than the rates backdrop would justify, or whether the rates backdrop is already signaling stress that volatility still understates.",
    "Use the VIX close, session change, intraday range, and bill-vs-note rate spread together instead of narrating any one number in isolation.",
    "Explain whether the latest tape implies real stress, fading panic, or a gap between volatility pricing and the Treasury rates backdrop.",
  ],
  falseInferenceGuards: [
    "Do not claim that a high VIX level by itself guarantees a crash or recession.",
    "Do not describe the bill/note spread as if it were a corporate credit spread.",
    "Do not treat one VIX session move as a regime shift without explaining the rates backdrop or the size of the move.",
  ],
};

export function buildResearchBrief(
  opportunity: ResearchOpportunity,
  colonySubstrate: ResearchColonySubstrate | undefined,
  evidenceSummary: ResearchEvidenceSummary,
  supportingEvidenceSummaries: ResearchEvidenceSummary[] = [],
  selfHistory?: ResearchSelfHistorySummary | null,
): ResearchBrief {
  const dossier = dossierForFamily(opportunity.sourceProfile.family);
  const linkedContext = buildLinkedResearchContext(
    opportunity,
    colonySubstrate,
    evidenceSummary,
    supportingEvidenceSummaries,
  );
  let baseBrief: CoreResearchBrief;

  if (opportunity.sourceProfile.family === "stablecoin-supply") {
    baseBrief = buildStablecoinSupplyBrief(dossier, evidenceSummary, supportingEvidenceSummaries);
  } else if (opportunity.sourceProfile.family === "funding-structure") {
    baseBrief = buildFundingStructureBrief(dossier, evidenceSummary, supportingEvidenceSummaries);
  } else if (opportunity.sourceProfile.family === "network-activity") {
    baseBrief = buildNetworkActivityBrief(dossier, evidenceSummary, supportingEvidenceSummaries);
  } else if (opportunity.sourceProfile.family === "spot-momentum") {
    baseBrief = buildSpotMomentumBrief(dossier, evidenceSummary, supportingEvidenceSummaries);
  } else if (opportunity.sourceProfile.family === "etf-flows") {
    baseBrief = buildEtfFlowsBrief(dossier, evidenceSummary, supportingEvidenceSummaries);
  } else if (opportunity.sourceProfile.family === "vix-credit") {
    baseBrief = buildVixCreditBrief(dossier, evidenceSummary, supportingEvidenceSummaries);
  } else {
    baseBrief = {
      family: opportunity.sourceProfile.family,
      baselineContext: dossier.baseline,
      focusNow: dossier.focus,
      falseInferenceGuards: dossier.falseInferenceGuards,
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
  dossier: ResearchFamilyDossier,
  evidenceSummary: ResearchEvidenceSummary,
  supportingEvidenceSummaries: ResearchEvidenceSummary[],
): CoreResearchBrief {
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
    baselineContext: dossier.baseline,
    focusNow: dossier.focus,
    falseInferenceGuards: dossier.falseInferenceGuards,
    anomalySummary: `ETF holdings sit around ${totalHoldingsBtc ?? "an unresolved total"} BTC, aggregate flow is ${netFlowDirection ?? "unclear"}${netFlowBtc ? ` at ${netFlowBtc} BTC` : ""}, issuer breadth reads ${breadthSummary || "unclear"}, and ${concentrationSummary}.`,
    allowedThesisSpace: "Write about broad institutional demand only if the aggregate flow, issuer breadth, and leadership all point in the same direction. Otherwise, frame the tape as concentrated, mixed, or weakening demand.",
    invalidationFocus: "Invalidate with a flip in net flow, a collapse in breadth, or a reversal in the issuer that is currently leading the tape.",
  };
}

function buildVixCreditBrief(
  dossier: ResearchFamilyDossier,
  evidenceSummary: ResearchEvidenceSummary,
  supportingEvidenceSummaries: ResearchEvidenceSummary[],
): CoreResearchBrief {
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
    baselineContext: dossier.baseline,
    focusNow: dossier.focus,
    falseInferenceGuards: dossier.falseInferenceGuards,
    anomalySummary: `VIX closed${vixClose ? ` at ${vixClose}` : ""}${vixPreviousClose ? ` versus ${vixPreviousClose} prior` : ""}${vixSessionChangePct ? `, a ${vixSessionChangePct}% session move` : ""}${vixIntradayRange ? ` with a ${vixIntradayRange}-point intraday range` : ""}, while ${spreadRead}${billRate && noteRate ? ` (${billRate}% bills vs ${noteRate}% notes)` : ""}.`,
    allowedThesisSpace: "Write about whether volatility is outrunning, matching, or lagging the short-rate stress backdrop. Keep the thesis on fear repricing versus macro backdrop, not on generic crash language.",
    invalidationFocus: "Invalidate with a fast mean reversion in VIX, a collapse in the intraday stress signal, or a rates backdrop that stops supporting the stress interpretation.",
  };
}

function buildSpotMomentumBrief(
  dossier: ResearchFamilyDossier,
  evidenceSummary: ResearchEvidenceSummary,
  supportingEvidenceSummaries: ResearchEvidenceSummary[],
): CoreResearchBrief {
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
    baselineContext: dossier.baseline,
    focusNow: dossier.focus,
    falseInferenceGuards: dossier.falseInferenceGuards,
    anomalySummary: `Spot is ${change7d ? `${change7d}% from the 7d starting level` : "moving without a clear 7d delta"}, with current price${currentPrice ? ` at ${currentPrice}` : ""}${rangeLocation ? ` sitting in the ${rangeLocation} of the 7d range` : ""}${rangeWidth ? ` across a ${rangeWidth} USD band` : ""}${volume ? ` on ${volume} of latest volume` : ""}.`,
    allowedThesisSpace: `Write about whether the tape is aligning with, fading, or pushing against the colony signal by relating the current price${startPrice ? ` to the ${startPrice} starting level` : ""} and the range${high7d && low7d ? ` from ${low7d} to ${high7d}` : ""}; use the latest volume print only as secondary context.`,
    invalidationFocus: "Invalidate with a clear move that breaks the current range interpretation, such as losing reclaimed support or cleanly expanding through resistance.",
  };
}

function buildFundingStructureBrief(
  dossier: ResearchFamilyDossier,
  evidenceSummary: ResearchEvidenceSummary,
  supportingEvidenceSummaries: ResearchEvidenceSummary[],
): CoreResearchBrief {
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
    baselineContext: dossier.baseline,
    focusNow: dossier.focus,
    falseInferenceGuards: dossier.falseInferenceGuards,
    anomalySummary: `Funding is ${fundingDirection}${fundingBps ? ` (${fundingBps} bps)` : ""}, the mark/index spread is ${spreadDirection}${spreadUsd ? ` (${spreadUsd} USD)` : ""}, and ${oiContext}`,
    allowedThesisSpace: `Write about positioning stress, confirmation failure, or crowded positioning only if the thesis is anchored in the relationship between funding, price${markPrice ? ` (${markPrice})` : ""}, and open interest.`,
    invalidationFocus: "Invalidate with a clear normalization in funding/premium or a price move that breaks the positioning interpretation.",
  };
}

function buildNetworkActivityBrief(
  dossier: ResearchFamilyDossier,
  evidenceSummary: ResearchEvidenceSummary,
  supportingEvidenceSummaries: ResearchEvidenceSummary[],
): CoreResearchBrief {
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
    baselineContext: dossier.baseline,
    focusNow: dossier.focus,
    falseInferenceGuards: dossier.falseInferenceGuards,
    anomalySummary: `Network activity shows${blockCount ? ` ${blockCount} blocks` : " an unresolved block count"} and${transactionCount ? ` ${transactionCount} transactions` : " unresolved transaction flow"} over the observed window, ${densityRead}, ${hashrateRead}${priceUsd ? `, with spot around ${priceUsd}` : ""}.`,
    allowedThesisSpace: "Write about whether on-chain activity looks like genuine usage, congestion, stress, or speculative churn. Use spot price only as context; do not treat price behavior by itself as proof that the network load is being confirmed or rejected.",
    invalidationFocus: "Invalidate with a reversal in transaction density, a collapse in activity, or fresh evidence that the observed load was temporary noise rather than a durable network condition.",
  };
}

function buildStablecoinSupplyBrief(
  dossier: ResearchFamilyDossier,
  evidenceSummary: ResearchEvidenceSummary,
  supportingEvidenceSummaries: ResearchEvidenceSummary[],
): CoreResearchBrief {
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
    baselineContext: dossier.baseline,
    focusNow: dossier.focus,
    falseInferenceGuards: dossier.falseInferenceGuards,
    anomalySummary,
    allowedThesisSpace,
    invalidationFocus,
  };
}

function dossierForFamily(family: ResearchTopicFamily): ResearchFamilyDossier {
  if (family === "etf-flows") {
    return ETF_FLOWS_DOSSIER;
  }

  if (family === "spot-momentum") {
    return SPOT_MOMENTUM_DOSSIER;
  }

  if (family === "network-activity") {
    return NETWORK_ACTIVITY_DOSSIER;
  }

  if (family === "vix-credit") {
    return VIX_CREDIT_DOSSIER;
  }

  if (family === "stablecoin-supply") {
    return STABLECOIN_SUPPLY_DOSSIER;
  }

  if (family === "funding-structure") {
    return FUNDING_STRUCTURE_DOSSIER;
  }

  return {
    ...GENERIC_DOSSIER,
    family,
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
