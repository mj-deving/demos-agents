import {
  createTopicFamilyRegistry,
  defineTopicFamilyContract,
  getTopicFamilyContract,
  type TopicFamilyContract,
  type TopicFamilyRegistry,
} from "./topic-family-contract.js";

export type MarketTopicFamily = "oracle-divergence";

export type MarketTopicFamilyContract = TopicFamilyContract<MarketTopicFamily>;

export const ORACLE_DIVERGENCE_CONTRACT: MarketTopicFamilyContract = defineTopicFamilyContract({
  family: "oracle-divergence",
  displayName: "Oracle Divergence",
  sourcePlan: {
    primarySourceIds: ["supercolony-oracle-divergence"],
    supportingSourceIds: ["coingecko-simple-price", "binance-ticker-price"],
    expectedMetrics: [
      "severity",
      "agentDirection",
      "marketDirection",
      "agentConfidence",
      "priceUsd",
      "change24h",
    ],
  },
  promptDoctrine: {
    baseline: [
      "A sentiment-price divergence is descriptive, not predictive.",
      "The API label 'oracle' is sentiment metadata, not verified external truth.",
      "Divergence severity is an internal grading, not a calibrated probability.",
    ],
    focus: [
      "Name what the agents lean toward and what price is doing instead.",
      "Frame the setup as a measurable dislocation worth watching, not a tradeable edge.",
      "End with the next condition that would narrow, widen, or dissolve the dislocation.",
    ],
  },
  claimBounds: {
    defensible: [
      "Describe the disagreement between agent sentiment and observed price action.",
      "Say why the dislocation is worth monitoring now.",
      "State what would confirm or weaken the dislocation next.",
    ],
    blocked: [
      "Do not claim the agents are right and the market is wrong.",
      "Do not describe the divergence as an edge or recommendation.",
      "Do not treat severity or agent count as calibrated confidence.",
    ],
    requiresExtra: [
      {
        claim: "Independent agreement strength",
        requiredMetrics: ["modelDiversityScore"],
        reason: "Agent count alone does not show independent consensus.",
      },
      {
        claim: "Tradable predictive edge",
        requiredMetrics: ["historicalResolutionRate", "severityMethodology"],
        reason: "The current packet does not show that divergences resolve predictably.",
      },
    ],
  },
  metricSemantics: {
    severity: {
      means: "An internal low/medium/high grading of the dislocation.",
      doesNotMean: "A calibrated probability or validated signal strength.",
    },
    agentDirection: {
      means: "The consensus directional lean of the agent cluster.",
      doesNotMean: "Ground truth about where the market should trade.",
    },
    marketDirection: {
      means: "Observed market-direction metadata from the upstream divergence packet.",
      doesNotMean: "Proof that price will continue or reverse.",
    },
    agentConfidence: {
      means: "A self-reported confidence-like score from the sentiment side when present.",
      doesNotMean: "Well-calibrated confidence or independent verification.",
    },
    priceUsd: {
      means: "Observed spot price context for the asset.",
      doesNotMean: "Proof that the market side of the divergence is correct.",
    },
    change24h: {
      means: "Observed 24-hour price move context.",
      doesNotMean: "A resolution of the divergence by itself.",
    },
  },
  quality: {
    slipPatterns: [
      {
        pattern: /\b(?:agents?|oracle|consensus)\b.{0,60}\b(?:right|correct|accurate)\b.{0,40}\b(?:market|price)\b.{0,40}\b(?:wrong|mispriced|incorrect)\b/i,
        detail: "claims agents are right and the market is wrong — not defensible from sentiment data alone",
      },
      {
        pattern: /\bedge\b.{0,40}\b(?:divergence|mismatch|dislocation)\b|\b(?:divergence|mismatch|dislocation)\b.{0,40}\bedge\b/i,
        detail: "describes the divergence as a tradeable edge even though the packet is only descriptive",
      },
      {
        pattern: /\b(?:high|elevated)\s+severity\b.{0,60}\b(?:means|proves|confirms|guarantees)\b/i,
        detail: "treats divergence severity as proof of a specific outcome even though the grading is opaque",
      },
      {
        pattern: /\b(?:\d+|multiple|several)\s+agents?\s+agree\b.{0,60}\b(?:means|proves|confirms|strong signal)\b/i,
        detail: "treats agent count as evidence of independent agreement without model-diversity evidence",
      },
    ],
  },
});

export const MARKET_TOPIC_FAMILY_CONTRACTS: TopicFamilyRegistry<MarketTopicFamily> = createTopicFamilyRegistry([
  ORACLE_DIVERGENCE_CONTRACT,
]);

export function getMarketTopicFamilyContract(
  family: MarketTopicFamily,
): MarketTopicFamilyContract {
  return getTopicFamilyContract(MARKET_TOPIC_FAMILY_CONTRACTS, family);
}
