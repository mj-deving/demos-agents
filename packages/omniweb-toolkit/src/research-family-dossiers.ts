import type { ResearchEvidenceSummary } from "./research-evidence.js";
import type { ResearchOpportunity } from "./research-opportunities.js";
import type { ResearchTopicFamily } from "./research-source-profile.js";

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
}

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
    "Explain whether the derivatives structure is confirming the move, fading it, or setting up a squeeze.",
    "Treat a single funding print as evidence inside a positioning story, not as the whole thesis.",
  ],
  falseInferenceGuards: [
    "Do not claim that negative funding by itself proves downside.",
    "Do not claim that negative funding by itself guarantees a squeeze higher.",
    "Do not ignore open interest or price context when interpreting funding and premium.",
  ],
};

const SPOT_MOMENTUM_DOSSIER: ResearchFamilyDossier = {
  family: "spot-momentum",
  baseline: [
    "Absolute price direction over a week is context, not the thesis by itself.",
    "Spot momentum needs range location and volume context to mean anything.",
    "A move toward the top or bottom of the range matters more than a generic up-or-down recap.",
  ],
  focus: [
    "Focus on whether the tape is resolving toward expansion, rejection, or absorption inside the observed range.",
    "Explain whether price behavior is confirming or refuting the colony signal rather than defaulting to generic trend commentary.",
    "Use the current price, range width, and volume evidence to say what kind of move the market is actually making.",
  ],
  falseInferenceGuards: [
    "Do not claim that price being up by itself proves a bullish thesis.",
    "Do not claim that price being down by itself proves a bearish thesis.",
    "Do not describe the range without saying where price currently sits inside it or why that location matters.",
  ],
};

export function buildResearchBrief(
  opportunity: ResearchOpportunity,
  evidenceSummary: ResearchEvidenceSummary,
  supportingEvidenceSummaries: ResearchEvidenceSummary[] = [],
): ResearchBrief {
  const dossier = dossierForFamily(opportunity.sourceProfile.family);

  if (opportunity.sourceProfile.family === "stablecoin-supply") {
    return buildStablecoinSupplyBrief(dossier, evidenceSummary, supportingEvidenceSummaries);
  }

  if (opportunity.sourceProfile.family === "funding-structure") {
    return buildFundingStructureBrief(dossier, evidenceSummary, supportingEvidenceSummaries);
  }

  if (opportunity.sourceProfile.family === "spot-momentum") {
    return buildSpotMomentumBrief(dossier, evidenceSummary, supportingEvidenceSummaries);
  }

  return {
    family: opportunity.sourceProfile.family,
    baselineContext: dossier.baseline,
    focusNow: dossier.focus,
    falseInferenceGuards: dossier.falseInferenceGuards,
    anomalySummary: "Focus on the strongest non-trivial change or mismatch in the fetched evidence.",
    allowedThesisSpace: "Use the evidence to form one concrete, externally legible thesis.",
    invalidationFocus: "State the next observable condition that would weaken the thesis.",
  };
}

function buildSpotMomentumBrief(
  dossier: ResearchFamilyDossier,
  evidenceSummary: ResearchEvidenceSummary,
  supportingEvidenceSummaries: ResearchEvidenceSummary[],
): ResearchBrief {
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
    allowedThesisSpace: `Write about whether the tape is confirming, rejecting, or absorbing the colony signal by relating the current price${startPrice ? ` to the ${startPrice} starting level` : ""}, the range${high7d && low7d ? ` from ${low7d} to ${high7d}` : ""}, and the latest volume context.`,
    invalidationFocus: "Invalidate with a clear move that breaks the current range interpretation, such as losing reclaimed support or cleanly expanding through resistance.",
  };
}

function buildFundingStructureBrief(
  dossier: ResearchFamilyDossier,
  evidenceSummary: ResearchEvidenceSummary,
  supportingEvidenceSummaries: ResearchEvidenceSummary[],
): ResearchBrief {
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
    allowedThesisSpace: `Write about positioning stress, confirmation failure, or squeeze setup only if the thesis is anchored in the relationship between funding, price${markPrice ? ` (${markPrice})` : ""}, and open interest.`,
    invalidationFocus: "Invalidate with a clear normalization in funding/premium or a price move that breaks the positioning interpretation.",
  };
}

function buildStablecoinSupplyBrief(
  dossier: ResearchFamilyDossier,
  evidenceSummary: ResearchEvidenceSummary,
  supportingEvidenceSummaries: ResearchEvidenceSummary[],
): ResearchBrief {
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
  if (family === "spot-momentum") {
    return SPOT_MOMENTUM_DOSSIER;
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
