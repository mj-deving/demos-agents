import type { ResearchTopicFamily } from "./research-source-profile.js";
import type { TopicFamilyContract, TopicQualitySlipPattern } from "./topic-family-contract.js";
import { createTopicFamilyRegistry, defineTopicFamilyContract, getTopicFamilyContract } from "./topic-family-contract.js";

export type SupportedResearchTopicFamily = Exclude<ResearchTopicFamily, "unsupported">;

export interface ResearchBriefDoctrine {
  allowedThesisSpace: string;
  invalidationFocus: string;
}

export interface ResearchTopicFamilyContract<TFamily extends SupportedResearchTopicFamily = SupportedResearchTopicFamily>
  extends TopicFamilyContract<TFamily> {
  researchBrief: ResearchBriefDoctrine;
}

export function defineResearchTopicFamilyContract<TFamily extends SupportedResearchTopicFamily>(
  contract: ResearchTopicFamilyContract<TFamily>,
): ResearchTopicFamilyContract<TFamily> {
  return defineTopicFamilyContract(contract);
}

const STABLECOIN_BASELINE_SLIP_PATTERNS: TopicQualitySlipPattern[] = [
  {
    pattern: /\b(?:still|sits|holding|staying|exactly|right at|near|around)\s+\$?1(?:\.0+)?\b/i,
    detail: "treats the normal 1.00 peg as the thesis instead of background context",
  },
  {
    pattern: /\bwithout (?:any )?peg deviation means\b/i,
    detail: "turns a normal peg sanity check into the main causal claim",
  },
  {
    pattern: /\b(?:still\s+sitting|staying|holding|exactly|right at|near|around)\s+(?:exactly\s+)?\$?1(?:\.0+)?\b.{0,80}\b(?:prove|proves|means|constructive|healthy|bullish|signal|safe)\b/i,
    detail: "uses a normal peg to prove health, bullishness, or the main market signal",
  },
  {
    pattern: /\bpeg\s+(?:staying|holding|remaining|sitting)\s+(?:at\s+)?\$?1(?:\.0+)?\b.{0,80}\b(?:mean|means|proves|shows)\b/i,
    detail: "treats peg stability itself as the key causal conclusion",
  },
];

const FUNDING_BASELINE_SLIP_PATTERNS: TopicQualitySlipPattern[] = [
  {
    pattern: /\bnegative funding\b.{0,80}\b(?:prove|proves|means|guarantees|confirms)\b.{0,80}\b(?:downside|bearish|selloff|breakdown)\b/i,
    detail: "treats negative funding alone as proof of a bearish outcome",
  },
  {
    pattern: /\bnegative funding\b.{0,80}\b(?:guarantees|means|proves)\b.{0,80}\b(?:squeeze|bounce|reversal)\b/i,
    detail: "treats negative funding alone as proof of a contrarian squeeze setup",
  },
  {
    pattern: /\bfunding\b.{0,60}\b(?:by itself|alone)\b/i,
    detail: "explicitly centers funding in isolation instead of relating it to price and positioning context",
  },
];

const SPOT_BASELINE_SLIP_PATTERNS: TopicQualitySlipPattern[] = [
  {
    pattern: /\b(?:price|bitcoin|btc)\b.{0,50}\b(?:up|gained|rallied|climbed)\b.{0,60}\b(?:therefore|so|which means|that means)\b.{0,40}\b(?:bullish|constructive|uptrend)\b/i,
    detail: "treats a raw upward move as the thesis without explaining the range or signal context",
  },
  {
    pattern: /\b(?:price|bitcoin|btc)\b.{0,50}\b(?:down|fell|dropped|sold off)\b.{0,60}\b(?:therefore|so|which means|that means)\b.{0,40}\b(?:bearish|breakdown|downtrend)\b/i,
    detail: "treats a raw downward move as the thesis without explaining the range or signal context",
  },
  {
    pattern: /\brange[- ]bound indecision\b|\bprice keeps oscillating between support and resistance\b/i,
    detail: "falls back to generic range commentary instead of stating where price sits in the range and why that matters",
  },
];

const ETF_BASELINE_SLIP_PATTERNS: TopicQualitySlipPattern[] = [
  {
    pattern: /\bpositive net flow\b.{0,80}\b(?:proves|means|shows|confirms)\b.{0,60}\b(?:broad|strong|durable)\s+institutional demand\b/i,
    detail: "treats positive aggregate flow alone as proof of broad institutional demand",
  },
  {
    pattern: /\btotal holdings\b.{0,80}\b(?:prove|proves|show|shows|mean|means)\b.{0,60}\b(?:fresh|new)\s+(?:demand|buying)\b/i,
    detail: "uses total holdings alone as the fresh signal instead of current flow behavior",
  },
  {
    pattern: /\b(?:inflows?|net flows?)\b.{0,80}\b(?:therefore|so|which means|that means)\b.{0,60}\b(?:institutions are bullish|institutions are buying aggressively)\b/i,
    detail: "jumps from flow direction straight to institutional conviction without breadth or concentration context",
  },
];

const NETWORK_BASELINE_SLIP_PATTERNS: TopicQualitySlipPattern[] = [
  {
    pattern: /\b(?:more|higher|rising|surging)\s+(?:transactions|on-chain activity|network activity|blocks)\b.{0,80}\b(?:means|proves|shows|confirms)\b.{0,60}\b(?:bullish|adoption|strong demand)\b/i,
    detail: "treats raw network activity as automatic proof of adoption, demand, or a bullish outcome",
  },
  {
    pattern: /\bhashrate\b.{0,80}\b(?:means|proves|shows|confirms)\b.{0,60}\b(?:bullish|healthy|safe|strong)\b/i,
    detail: "treats hashrate alone as proof of network health or bullish price implications",
  },
  {
    pattern: /\bon-chain\b.{0,60}\b(?:activity|usage)\b.{0,80}\b(?:therefore|so|which means|that means)\b.{0,60}\b(?:bullish|constructive)\b/i,
    detail: "jumps from generic on-chain activity straight to a market conclusion without explaining the mechanism",
  },
  {
    pattern: /\bprice\b.{0,40}\b(?:absorb(?:s|ing|ed)?|reject(?:s|ing|ed)?|validat(?:es|ing|ed)?)\b.{0,40}\b(?:load|congestion|network activity|throughput)\b|\b(?:load|congestion|network activity|throughput)\b.{0,40}\b(?:absorb(?:ed)?|reject(?:ed)?|validat(?:ed)?)\b.{0,40}\bby price\b|\b(?:market|price)\b.{0,40}\bvalidat(?:es|ing|ed)?\b.{0,40}\b(?:congestion|network stress|network load|throughput)\b/i,
    detail: "claims that price action directly confirms or rejects network load without evidence for that mechanism",
  },
  {
    pattern: /\b(?:network stress|network load|congestion|throughput density|on-chain stress)\b.{0,80}\b(?:prove|proves|means|shows|confirms)\b.{0,60}\b(?:demand is healthy|healthy demand|adoption|bullish|price strength)\b/i,
    detail: "treats network stress or congestion itself as proof of healthy demand, adoption, or a bullish outcome",
  },
];

const VIX_CREDIT_BASELINE_SLIP_PATTERNS: TopicQualitySlipPattern[] = [
  {
    pattern: /\b(?:high|elevated|spiking)\s+vix\b.{0,80}\b(?:means|proves|guarantees|confirms)\b.{0,60}\b(?:crash|recession|panic|meltdown)\b/i,
    detail: "treats a VIX level or spike by itself as proof of a crash or recession outcome",
  },
  {
    pattern: /\bcredit spread\b/i,
    detail: "describes the bill/note spread as a literal credit spread instead of a Treasury rates backdrop",
  },
  {
    pattern: /\bvix\b.{0,60}\b(?:alone|by itself)\b/i,
    detail: "explicitly centers VIX in isolation instead of relating it to the rates backdrop and session move",
  },
];

export const FUNDING_STRUCTURE_CONTRACT = defineResearchTopicFamilyContract({
  family: "funding-structure",
  displayName: "Funding structure",
  sourcePlan: {
    primarySourceIds: ["binance-futures-<asset>"],
    supportingSourceIds: ["binance-futures-oi-<asset>", "coingecko-spot-<asset>"],
    expectedMetrics: ["markPrice", "indexPrice", "lastFundingRate", "openInterest", "priceChangePercent7d"],
  },
  promptDoctrine: {
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
  },
  claimBounds: {
    defensible: [
      "Describe positioning stress or crowding when funding, premium, price, and open interest line up.",
      "Describe confirmation failure when derivatives positioning points one way and spot action fails to follow through.",
      "Describe squeeze setup only as a possibility bounded by positioning evidence rather than as a guaranteed outcome.",
    ],
    blocked: [
      "Do not claim that negative funding by itself proves downside.",
      "Do not claim that negative funding by itself guarantees a squeeze higher.",
      "Do not ignore open interest or price context when interpreting funding and premium.",
    ],
    requiresExtra: [
      {
        claim: "A specific squeeze path is highly probable",
        requiredMetrics: ["openInterest", "fundingRateBps", "markIndexSpreadUsd", "liquidationClusterData"],
        reason: "probabilistic squeeze language needs crowding, premium, and liquidation evidence rather than funding alone",
      },
    ],
  },
  metricSemantics: {
    fundingRateBps: {
      means: "the cost of holding leveraged perpetual exposure over the funding interval",
      doesNotMean: "guaranteed price direction or guaranteed squeeze timing",
    },
    markIndexSpreadUsd: {
      means: "whether the perp is trading above, below, or flat to the index at the time of the snapshot",
      doesNotMean: "a standalone conviction signal without price and open-interest context",
    },
    openInterest: {
      means: "the size of outstanding derivatives positioning",
      doesNotMean: "which side is right or whether that positioning will unwind immediately",
    },
    markPrice: {
      means: "where the contract is currently marked",
      doesNotMean: "whether derivatives positioning is healthy without the rest of the packet",
    },
  },
  quality: {
    slipPatterns: FUNDING_BASELINE_SLIP_PATTERNS,
  },
  researchBrief: {
    allowedThesisSpace: "Write about positioning stress, confirmation failure, or squeeze setup only if the thesis is anchored in the relationship between funding, price, and open interest.",
    invalidationFocus: "Invalidate with a clear normalization in funding/premium or a price move that breaks the positioning interpretation.",
  },
});

export const SPOT_MOMENTUM_CONTRACT = defineResearchTopicFamilyContract({
  family: "spot-momentum",
  displayName: "Spot momentum",
  sourcePlan: {
    primarySourceIds: ["coingecko-market-<asset>"],
    supportingSourceIds: ["binance-24hr-<asset>", "coingecko-spot-context"],
    expectedMetrics: ["currentPriceUsd", "priceChangePercent7d", "high7d", "low7d", "latestVolumeUsd"],
  },
  promptDoctrine: {
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
  },
  claimBounds: {
    defensible: [
      "Describe range resolution, rejection, or absorption using price location and volume context.",
      "Describe whether the tape is confirming or refuting the colony read rather than just restating the move.",
      "Describe a market structure read in plain language without overpromising continuation.",
    ],
    blocked: [
      "Do not claim that price being up by itself proves a bullish thesis.",
      "Do not claim that price being down by itself proves a bearish thesis.",
      "Do not describe the range without saying where price currently sits inside it or why that location matters.",
    ],
    requiresExtra: [
      {
        claim: "Spot flow is cleanly confirming the move",
        requiredMetrics: ["currentPriceUsd", "latestVolumeUsd", "orderFlowImbalance"],
        reason: "tape-confirmation language needs flow evidence beyond price and a coarse volume snapshot",
      },
    ],
  },
  metricSemantics: {
    currentPriceUsd: {
      means: "where spot currently trades in the observed window",
      doesNotMean: "whether the move is structurally strong without range and volume context",
    },
    priceChangePercent7d: {
      means: "the percentage change from the period start to now",
      doesNotMean: "a sufficient thesis by itself",
    },
    high7d: {
      means: "the top of the recent observed range",
      doesNotMean: "automatic resistance that will hold",
    },
    low7d: {
      means: "the bottom of the recent observed range",
      doesNotMean: "automatic support that will hold",
    },
    latestVolumeUsd: {
      means: "coarse participation context for the most recent observed period",
      doesNotMean: "clean flow confirmation by itself",
    },
  },
  quality: {
    slipPatterns: SPOT_BASELINE_SLIP_PATTERNS,
  },
  researchBrief: {
    allowedThesisSpace: "Write about whether the tape is confirming, rejecting, or absorbing the colony signal by relating the current price to the observed range and the latest volume context.",
    invalidationFocus: "Invalidate with a clear move that breaks the current range interpretation, such as losing reclaimed support or cleanly expanding through resistance.",
  },
});

export const ETF_FLOWS_CONTRACT = defineResearchTopicFamilyContract({
  family: "etf-flows",
  displayName: "ETF flows",
  sourcePlan: {
    primarySourceIds: ["btcetfdata-current-btc"],
    supportingSourceIds: ["binance-24hr-btc"],
    expectedMetrics: [
      "totalHoldingsBtc",
      "netFlowBtc",
      "positiveIssuerCount",
      "negativeIssuerCount",
      "largestInflowBtc",
      "largestOutflowBtc",
    ],
  },
  promptDoctrine: {
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
  },
  claimBounds: {
    defensible: [
      "Describe whether demand is broadening, narrowing, or concentrating in one issuer.",
      "Describe issuer mix as participation context rather than as AUM-weighted breadth.",
      "Describe holdings as structural context and fresh net flow as the live input.",
    ],
    blocked: [
      "Do not claim that positive net flow alone proves broad institutional demand.",
      "Do not treat total holdings by themselves as a fresh bullish signal.",
      "Do not ignore issuer concentration when one fund is carrying the tape.",
    ],
    requiresExtra: [
      {
        claim: "Broad institutional demand is strengthening across the complex",
        requiredMetrics: ["netFlowBtc", "positiveIssuerCount", "negativeIssuerCount", "issuerAumWeights"],
        reason: "breadth claims need weighted participation, not just raw issuer counts",
      },
    ],
  },
  metricSemantics: {
    netFlowBtc: {
      means: "aggregate BTC-equivalent flow across the ETF complex for the observed print",
      doesNotMean: "broad participation or institutional conviction by itself",
    },
    positiveIssuerCount: {
      means: "how many issuers printed positive flow in the observed window",
      doesNotMean: "AUM-weighted breadth",
    },
    negativeIssuerCount: {
      means: "how many issuers printed negative flow in the observed window",
      doesNotMean: "which issuers dominate the tape",
    },
    totalHoldingsBtc: {
      means: "the structural size of the ETF complex",
      doesNotMean: "fresh demand today",
    },
  },
  quality: {
    slipPatterns: ETF_BASELINE_SLIP_PATTERNS,
  },
  researchBrief: {
    allowedThesisSpace: "Write about broad institutional demand only if the aggregate flow, issuer mix, and leadership all point in the same direction. Otherwise, frame the tape as concentrated, mixed, or weakening demand.",
    invalidationFocus: "Invalidate with a flip in net flow, a collapse in issuer participation, or a reversal in the issuer that is currently leading the tape.",
  },
});

export const NETWORK_ACTIVITY_CONTRACT = defineResearchTopicFamilyContract({
  family: "network-activity",
  displayName: "Network activity",
  sourcePlan: {
    primarySourceIds: ["blockchair-<asset>-stats"],
    supportingSourceIds: ["coingecko-spot-<asset>"],
    expectedMetrics: ["blockCount24h", "transactionCount24h", "hashrate24h", "priceUsd", "transactionsPerBlock24h"],
  },
  promptDoctrine: {
    baseline: [
      "High on-chain activity is context, not an automatic bullish thesis.",
      "More transactions or blocks do not automatically mean healthy demand, adoption, or price upside.",
      "Network statistics need price or market context to distinguish speculation, stress, and genuine usage.",
    ],
    focus: [
      "Focus on whether the packet describes unusually high or low network activity, not on whether price supposedly confirms it.",
      "Explain what the measured block, transaction, and hashrate context says about network conditions in plain descriptive terms.",
      "Use spot price only as market backdrop rather than as proof that the network signal is valid.",
    ],
  },
  claimBounds: {
    defensible: [
      "Describe unusually high or low activity in the measured network statistics.",
      "Describe transaction density, block throughput, and hashrate as descriptive network conditions.",
      "Describe spot as backdrop rather than as validation of the network read.",
    ],
    blocked: [
      "Do not claim that more transactions by themselves prove adoption or a bullish outcome.",
      "Do not treat elevated hashrate or block count alone as proof of network health or price strength.",
      "Do not turn generic on-chain activity into the thesis without explaining whether it reflects usage, congestion, or speculation.",
    ],
    requiresExtra: [
      {
        claim: "The activity reflects real user adoption rather than churn",
        requiredMetrics: ["transactionCount24h", "activeAddresses", "feesPaidUsd", "economicTransferVolumeUsd"],
        reason: "adoption claims need activity-quality metrics, not raw counts alone",
      },
      {
        claim: "Price is absorbing or rejecting the network signal",
        requiredMetrics: ["priceUsd", "feesPaidUsd", "mempoolBacklog", "timeSeriesPriceReaction"],
        reason: "price-validation language needs a real mechanism and time-series context",
      },
    ],
  },
  metricSemantics: {
    blockCount24h: {
      means: "how many blocks were observed in the window",
      doesNotMean: "user adoption or price strength",
    },
    transactionCount24h: {
      means: "how many transactions were recorded in the window",
      doesNotMean: "economic quality of demand",
    },
    transactionsPerBlock24h: {
      means: "coarse transaction density across the observed blocks",
      doesNotMean: "clean congestion diagnosis or durable adoption",
    },
    hashrate24h: {
      means: "the observed mining or validation power context when available",
      doesNotMean: "automatic network health or bullish price implications",
    },
    priceUsd: {
      means: "spot backdrop alongside the network packet",
      doesNotMean: "validation of the network thesis by itself",
    },
  },
  quality: {
    slipPatterns: NETWORK_BASELINE_SLIP_PATTERNS,
  },
  researchBrief: {
    allowedThesisSpace: "Write descriptively about network conditions, activity intensity, and whether the packet looks unusual. Keep market interpretation bounded and do not infer adoption quality or price validation from the raw packet alone.",
    invalidationFocus: "Invalidate with a reversal in transaction density, a collapse in activity, or new evidence that the measured load was temporary noise rather than a durable network condition.",
  },
});

export const STABLECOIN_SUPPLY_CONTRACT = defineResearchTopicFamilyContract({
  family: "stablecoin-supply",
  displayName: "Stablecoin supply",
  sourcePlan: {
    primarySourceIds: ["defillama-stablecoins"],
    supportingSourceIds: ["coingecko-stablecoin-spot"],
    expectedMetrics: ["circulatingUsd", "circulatingPrevDayUsd", "circulatingPrevWeekUsd", "priceUsd", "supplyChangePct7d"],
  },
  promptDoctrine: {
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
  },
  claimBounds: {
    defensible: [
      "Describe liquidity expansion or deceleration using supply change and market context.",
      "Describe peg behavior only when the deviation is material or persistent.",
      "Describe the packet as liquidity context rather than as automatic bullish fuel.",
    ],
    blocked: [
      "Do not claim that a normal peg by itself proves health, demand, or reserve strength.",
      "Do not use 'still at $1' as the core insight.",
      "Do not jump from supply growth to a risk-on conclusion unless the evidence packet supports it.",
    ],
    requiresExtra: [
      {
        claim: "Supply growth is cleanly risk-on fuel",
        requiredMetrics: ["supplyChangePct7d", "exchangeInflows", "spotAbsorption", "reserveComposition"],
        reason: "risk-on conclusions need routing and absorption evidence, not supply growth alone",
      },
    ],
  },
  metricSemantics: {
    priceUsd: {
      means: "the current peg print",
      doesNotMean: "a thesis by itself when the peg is normal",
    },
    pegDeviationPct: {
      means: "how far the stablecoin print deviates from 1.00 in percentage terms",
      doesNotMean: "stress unless the deviation is material or persistent",
    },
    supplyChangePct7d: {
      means: "the observed weekly supply acceleration or contraction",
      doesNotMean: "automatic bullishness or bearishness",
    },
    circulatingUsd: {
      means: "the current size of the stablecoin float",
      doesNotMean: "where the marginal liquidity is actually flowing",
    },
  },
  quality: {
    slipPatterns: STABLECOIN_BASELINE_SLIP_PATTERNS,
  },
  researchBrief: {
    allowedThesisSpace: "Write about liquidity expansion, absorption, or crowding only if the thesis is anchored in supply change and market context, not in the normal peg itself.",
    invalidationFocus: "Invalidate with a clear supply slowdown, supply reversal, or a failure of the broader market context to absorb the new issuance.",
  },
});

export const VIX_CREDIT_CONTRACT = defineResearchTopicFamilyContract({
  family: "vix-credit",
  displayName: "VIX and rates stress",
  sourcePlan: {
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
  },
  promptDoctrine: {
    baseline: [
      "An elevated VIX level is context, not a complete stress thesis by itself.",
      "One volatility spike is not automatically a recession or credit event.",
      "The Treasury bill/note spread is a short-rate backdrop signal, not a literal corporate credit spread.",
    ],
    focus: [
      "Focus on whether volatility is repricing faster than the rates backdrop would justify, or whether the rates backdrop is already signaling stress that volatility still understates.",
      "Use the VIX close, session change, intraday range, and bill-vs-note rate spread together instead of narrating any one number in isolation.",
      "Explain whether the latest tape implies real stress, fading panic, or a gap between macro fear pricing and the rates backdrop.",
    ],
  },
  claimBounds: {
    defensible: [
      "Describe whether volatility is outrunning, matching, or lagging the short-rate backdrop.",
      "Describe the short-rate spread as macro backdrop rather than literal credit stress.",
      "Describe whether the latest session looks like real stress, fading panic, or repricing noise.",
    ],
    blocked: [
      "Do not claim that a high VIX level by itself guarantees a crash or recession.",
      "Do not describe the bill/note spread as if it were a corporate credit spread.",
      "Do not treat one VIX session move as a regime shift without explaining the rates backdrop or the size of the move.",
    ],
    requiresExtra: [
      {
        claim: "Corporate credit stress is confirming the move",
        requiredMetrics: ["billNoteSpreadBps", "creditSpreadIndex", "cdsIndex", "fundingStressIndex"],
        reason: "credit claims need actual credit-spread or funding-stress measures rather than the Treasury term spread alone",
      },
    ],
  },
  metricSemantics: {
    vixClose: {
      means: "where implied equity volatility closed for the observed session",
      doesNotMean: "automatic crash probability",
    },
    vixSessionChangePct: {
      means: "how much implied volatility moved during the session",
      doesNotMean: "a regime shift by itself",
    },
    vixIntradayRange: {
      means: "how much the VIX moved intraday",
      doesNotMean: "persistent stress unless the wider backdrop supports it",
    },
    billNoteSpreadBps: {
      means: "the Treasury bill-vs-note term spread in basis points",
      doesNotMean: "a corporate credit spread",
    },
  },
  quality: {
    slipPatterns: VIX_CREDIT_BASELINE_SLIP_PATTERNS,
  },
  researchBrief: {
    allowedThesisSpace: "Write about whether volatility is outrunning, matching, or lagging the short-rate stress backdrop. Keep the thesis on fear repricing versus macro backdrop, not on generic crash language.",
    invalidationFocus: "Invalidate with a fast mean reversion in VIX, a collapse in the intraday stress signal, or a rates backdrop that stops supporting the stress interpretation.",
  },
});

export const RESEARCH_TOPIC_FAMILY_CONTRACTS = createTopicFamilyRegistry([
  FUNDING_STRUCTURE_CONTRACT,
  SPOT_MOMENTUM_CONTRACT,
  ETF_FLOWS_CONTRACT,
  NETWORK_ACTIVITY_CONTRACT,
  STABLECOIN_SUPPLY_CONTRACT,
  VIX_CREDIT_CONTRACT,
]);

export function getResearchTopicFamilyContract<TFamily extends SupportedResearchTopicFamily>(
  family: TFamily,
): ResearchTopicFamilyContract<TFamily> {
  return getTopicFamilyContract(RESEARCH_TOPIC_FAMILY_CONTRACTS, family) as ResearchTopicFamilyContract<TFamily>;
}
