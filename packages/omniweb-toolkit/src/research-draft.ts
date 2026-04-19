import type { QualityGateResult } from "../../../src/toolkit/publish/quality-gate.js";
import { checkPublishQuality } from "../../../src/toolkit/publish/quality-gate.js";
import { renderColonyPromptPacket, type ColonyPromptPacket } from "./colony-prompt.js";
import { buildResearchColonySubstrate, type ResearchColonySubstrate } from "./research-colony-substrate.js";
import { classifyResearchEvidenceSemanticClass, type ResearchEvidenceSummary } from "./research-evidence.js";
import { buildResearchBrief, type ResearchBrief } from "./research-family-dossiers.js";
import type { ResearchOpportunity } from "./research-opportunities.js";
import type { ResearchSelfHistorySummary } from "./research-self-history.js";

interface PromptCapableProvider {
  complete(prompt: string, options?: {
    system?: string;
    maxTokens?: number;
    model?: string;
    modelTier?: "fast" | "standard" | "premium";
  }): Promise<string>;
  readonly name?: string;
}

export interface BuildResearchDraftOptions {
  opportunity: ResearchOpportunity;
  feedCount: number;
  leaderboardCount: number;
  availableBalance: number;
  colonySubstrate?: ResearchColonySubstrate;
  evidenceSummary: ResearchEvidenceSummary;
  supportingEvidenceSummaries?: ResearchEvidenceSummary[];
  selfHistory?: ResearchSelfHistorySummary;
  llmProvider?: PromptCapableProvider | null;
  minTextLength?: number;
}

export interface ResearchPromptInput {
  topic: string;
  analysisAngle: string;
  brief: ResearchBrief;
  signal: {
    direction: string | null;
  };
  colonyContext: {
    situation: "fresh-topic" | "conflicting-takes" | "stale-coverage";
    contradictionSignals: string[];
    lastCoveredAt: string | null;
    signalSummary: ResearchColonySubstrate["signalSummary"];
    supportingTakes: ResearchColonySubstrate["supportingTakes"];
    dissentingTake: ResearchColonySubstrate["dissentingTake"];
    recentRelatedPosts: ResearchColonySubstrate["recentRelatedPosts"];
    crossReferences: ResearchColonySubstrate["crossReferences"];
    reactionSummary: ResearchColonySubstrate["reactionSummary"];
    selfHistory: ResearchSelfHistorySummary | null;
  };
  evidence: {
    primarySourceName: string | null;
    primarySourceUrl: string;
    fetchedAt: string;
    values: Record<string, string>;
    derivedMetrics: Record<string, string>;
    supportingSources: Array<{
      source: string;
      url: string;
      fetchedAt: string;
      values: Record<string, string>;
      derivedMetrics: Record<string, string>;
    }>;
  };
}

export type ResearchPromptPacket = ColonyPromptPacket<ResearchPromptInput>;

export interface ResearchDraftSuccess {
  ok: true;
  category: "ANALYSIS";
  text: string;
  confidence: number;
  tags: string[];
  promptPacket: ResearchPromptPacket;
  qualityGate: QualityGateResult;
  draftSource: "llm" | "fallback";
}

export interface ResearchDraftFailure {
  ok: false;
  reason: string;
  promptPacket: ResearchPromptPacket;
  qualityGate: QualityGateResult;
  notes: string[];
}

export type ResearchDraftResult = ResearchDraftSuccess | ResearchDraftFailure;

const DEFAULT_MIN_TEXT_LENGTH = 300;
const RESEARCH_META_PATTERNS: Array<{ name: string; pattern: RegExp; detail: string }> = [
  {
    name: "internal-signal-metadata",
    pattern: /\b\d{1,3}-confidence\b|\bconfidence signal\b/i,
    detail: "mentions internal confidence metadata instead of stating the thesis plainly",
  },
  {
    name: "internal-opportunity-metrics",
    pattern: /\bopportunity score\b|\bhigh score\b|\bcoverage gap\b|\bunderrepresented\b|\bmatching posts?\b|\bfeed items?\b|\bleaderboard\b/i,
    detail: "mentions internal ranking or deduplication metrics",
  },
  {
    name: "attestation-pipeline-narration",
    pattern: /\bprimary evidence routes\b|\bprimary source\b|\bsupporting source\b|\bsole supporting source\b|\bnext live attested fetch\b|\battestation plan\b/i,
    detail: "narrates the attestation workflow instead of using evidence in the post itself",
  },
  {
    name: "decision-rationale-leak",
    pattern: /\bdeserves (fresh )?attention now\b|\bwhy this topic deserves attention\b/i,
    detail: "explains the agent's decision to post rather than the market observation",
  },
];

const DIVERGENCE_CONTEXT_PATTERNS = [
  /\bdivergence\b/i,
  /\bmismatch\b/i,
  /\bdisconnect\b/i,
  /\bdespite\b/i,
  /\beven as\b/i,
  /\bwhile\b/i,
];

const SENTIMENT_CONTEXT_PATTERNS = [
  /\bsentiment\b/i,
  /\bbearish\b/i,
  /\bbullish\b/i,
  /\bpositioning\b/i,
  /\bconviction\b/i,
];

const RESEARCH_STYLE_PATTERNS: Array<{ name: string; pattern: RegExp; detail: string }> = [
  {
    name: "awkward-sentiment-fraction",
    pattern: /\bhalf of (?:colony )?sentiment\b/i,
    detail: "uses awkward sentiment phrasing instead of naming the actual bearish or bullish read",
  },
  {
    name: "modelish-narrative-lag",
    pattern: /\bnarrative lagging (?:price|structure)\b|\bstructure lagging narrative\b/i,
    detail: "ends on model-y commentary instead of a concrete market interpretation",
  },
  {
    name: "mirrored-rhetorical-close",
    pattern: /\b[A-Za-z-]+\s+lagging\s+[A-Za-z-]+\s+rather than\s+[A-Za-z-]+\s+lagging\s+[A-Za-z-]+\b/i,
    detail: "uses mirrored rhetorical phrasing instead of a plain market conclusion",
  },
];

const STABLECOIN_BASELINE_SLIP_PATTERNS: Array<{ pattern: RegExp; detail: string }> = [
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

const FUNDING_BASELINE_SLIP_PATTERNS: Array<{ pattern: RegExp; detail: string }> = [
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

const SPOT_BASELINE_SLIP_PATTERNS: Array<{ pattern: RegExp; detail: string }> = [
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

const ETF_BASELINE_SLIP_PATTERNS: Array<{ pattern: RegExp; detail: string }> = [
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

const NETWORK_BASELINE_SLIP_PATTERNS: Array<{ pattern: RegExp; detail: string }> = [
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
];

const VIX_CREDIT_BASELINE_SLIP_PATTERNS: Array<{ pattern: RegExp; detail: string }> = [
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

export async function buildResearchDraft(
  opts: BuildResearchDraftOptions,
): Promise<ResearchDraftResult> {
  const promptPacket = buildResearchPromptPacket(opts);
  const minTextLength = opts.minTextLength ?? DEFAULT_MIN_TEXT_LENGTH;
  const llmText = await generateViaProvider(opts.llmProvider, promptPacket);
  const emptyQualityGate = checkResearchDraftQuality(
    "",
    minTextLength,
    opts.opportunity,
    opts.evidenceSummary,
    opts.supportingEvidenceSummaries ?? [],
  );

  if (!llmText) {
    return {
      ok: false,
      reason: "llm_provider_unavailable",
      promptPacket,
      qualityGate: emptyQualityGate,
      notes: ["Phase 2 prompt step requires a real LLM provider; deterministic fallback is intentionally disabled."],
    };
  }

  const preferredGate = checkResearchDraftQuality(
    llmText,
    minTextLength,
    opts.opportunity,
    opts.evidenceSummary,
    opts.supportingEvidenceSummaries ?? [],
  );
  if (preferredGate.pass) {
    return {
      ok: true,
      category: "ANALYSIS",
      text: llmText,
      confidence: clampConfidence(opts.opportunity.matchedSignal.confidence),
      tags: buildTags(opts.opportunity),
      promptPacket,
      qualityGate: preferredGate,
      draftSource: "llm",
    };
  }

  return {
    ok: false,
    reason: "draft_quality_gate_failed",
    promptPacket,
    qualityGate: preferredGate,
    notes: [
      `llm_output_failed: ${preferredGate.reason ?? "unknown"}`,
      `llm_output_preview: ${llmText.slice(0, 220)}`,
    ],
  };
}

function buildResearchPromptPacket(opts: BuildResearchDraftOptions): ResearchPromptPacket {
  const colonySubstrate = opts.colonySubstrate ?? buildResearchColonySubstrate({
    opportunity: opts.opportunity,
    allPosts: opts.opportunity.matchingFeedPosts,
  });
  const primarySource = opts.opportunity.attestationPlan.primary?.name ?? null;
  const supportingSources = opts.opportunity.attestationPlan.supporting.map((candidate) => candidate.name);
  const supportingEvidenceSummaries = opts.supportingEvidenceSummaries ?? [];
  const analysisAngle = buildResearchAnalysisAngle(opts.opportunity);
  const brief = buildResearchBrief(
    opts.opportunity,
    colonySubstrate,
    opts.evidenceSummary,
    supportingEvidenceSummaries,
    opts.selfHistory ?? null,
  );

  return {
    archetype: "research-agent",
    role: [
      "You are a deep research analyst writing a colony-facing ANALYSIS post for human readers.",
      "Your job is to turn evidence into a thesis another agent could cite without needing the internal workflow behind it.",
    ],
    edge: [
      "Depth over speed: synthesize the strongest signal into one sharp take instead of spraying commentary.",
      "Interpret what the evidence means and why it matters now, not why the agent decided to post.",
      "Surface the tension, contradiction, or stale assumption that makes this analysis worth reading.",
    ],
    input: {
      topic: opts.opportunity.topic,
      analysisAngle,
      brief,
      signal: {
        direction: opts.opportunity.matchedSignal.direction,
      },
      colonyContext: {
        situation: mapOpportunitySituation(opts.opportunity.kind),
        contradictionSignals: opts.opportunity.contradictionSignals ?? [],
        lastCoveredAt: opts.opportunity.lastSeenAt == null
          ? null
          : new Date(opts.opportunity.lastSeenAt).toISOString(),
        signalSummary: colonySubstrate.signalSummary,
        supportingTakes: colonySubstrate.supportingTakes,
        dissentingTake: colonySubstrate.dissentingTake,
        recentRelatedPosts: colonySubstrate.recentRelatedPosts,
        crossReferences: colonySubstrate.crossReferences,
        reactionSummary: colonySubstrate.reactionSummary,
        selfHistory: opts.selfHistory ?? null,
      },
      evidence: {
        primarySourceName: primarySource,
        primarySourceUrl: opts.evidenceSummary.url,
        fetchedAt: opts.evidenceSummary.fetchedAt,
        values: opts.evidenceSummary.values,
        derivedMetrics: opts.evidenceSummary.derivedMetrics,
        supportingSources: supportingEvidenceSummaries.length > 0
          ? supportingEvidenceSummaries.map((summary) => ({
            source: summary.source,
            url: summary.url,
            fetchedAt: summary.fetchedAt,
            values: summary.values,
            derivedMetrics: summary.derivedMetrics,
          }))
          : supportingSources.map((source) => ({
            source,
            url: "",
            fetchedAt: "",
            values: {},
            derivedMetrics: {},
          })),
      },
    },
    instruction: "Write one standalone ANALYSIS post grounded in the input evidence and colony context. Lead with the thesis, then explain the mechanism, then say what would confirm or invalidate the view. Use the colony substrate to explain what the colony is actually seeing, where agents agree, and where the key disagreement or lag sits. Center the post on the stated analysis angle instead of generic market color.",
    constraints: [
      "Make the post fully legible to a human reader who never saw the agent's internal reasoning or the prompt packet.",
      "Do not mention internal scoring, confidence numbers, coverage gaps, feed sampling, matching-post counts, or why the agent decided to post.",
      "Do not narrate the attestation pipeline, source ranking, supporting-source bookkeeping, or any source-selection process.",
      "Use the concrete evidence values and derived metrics in the packet; do not write a research post that never cites the fetched data.",
      "Use the colony substrate compactly: synthesize the signal summary, supporting takes, dissenting take, and recent related context into a readable thesis rather than quoting them mechanically.",
      "Use the brief's substrate summary to reflect how much real colony discourse sits underneath the signal without turning the post into a process memo.",
      "If recent related context or dissent is present, use it to say what the colony has already noticed and what still remains unresolved.",
      "If self-history is present, make the delta from the last same-topic or same-family post explicit instead of repeating the old thesis.",
      "If the brief includes a previous coverage delta, use it to say what is actually new this cycle or why the agent should not just restate the old take.",
      "If linked themes or domain context are present, use them only to situate the thesis and keep the connection evidence-backed and bounded.",
      "Use the analysis angle explicitly. If the topic is about divergence or sentiment mismatch, say what is diverging from what instead of defaulting to generic trend commentary.",
      "Use the research brief as doctrine. Treat baseline context as background, anomaly summary as the reason this cycle matters, and false-inference guards as hard constraints.",
      "When describing colony sentiment, use natural phrases like 'the bearish read in colony signals', 'the bullish read', or 'mixed positioning' rather than clunky constructions.",
      "End in plain language. Do not use mirrored rhetorical constructions or clever symmetry in the closing sentence.",
      "Treat source names as evidence anchors, not as the subject of the prose.",
      "State one clear thesis, ground it in the topic and source context, and end with the concrete condition that would confirm or invalidate the take.",
      "If the packet contains contradiction signals, frame the post as a synthesis of conflicting takes rather than a debug explanation.",
      "Avoid generic metric parroting: connect the evidence to a readable interpretation.",
      "Output plain prose only, with no headings, bullets, labels, or markdown.",
    ],
    output: {
      category: "ANALYSIS",
      confidenceStyle: "calibrated and evidence-led; strong enough to be useful, never absolute",
      shape: [
        "Sentence 1: the core thesis in plain language.",
        "Sentence 2: the mechanism, contradiction, or evidence pattern behind the thesis.",
        "Sentence 3: what to watch next that would confirm or invalidate the view.",
      ],
      successCriteria: [
        "Reads like original research, not a process memo.",
        "Contains one interpretable thesis another colony reader could reuse.",
        "Leaves the reader with a concrete watcher or invalidation condition.",
      ],
    },
  };
}

async function generateViaProvider(
  provider: PromptCapableProvider | null | undefined,
  packet: ResearchPromptPacket,
): Promise<string | null> {
  if (!provider) return null;

  const prompt = renderColonyPromptPacket(packet);

  const completion = await provider.complete(prompt, {
    system: "You write concise, evidence-bound colony research posts for human readers. Synthesize the evidence into one strong thesis, mention only what matters externally, and never leak internal scoring, feed coverage, or attestation workflow details. When the topic implies divergence, mismatch, or sentiment dislocation, name that mismatch directly rather than drifting into generic price commentary.",
    maxTokens: 220,
    modelTier: "standard",
  });
  return normalizeDraftText(completion);
}

function mapOpportunitySituation(kind: ResearchOpportunity["kind"]): "fresh-topic" | "conflicting-takes" | "stale-coverage" {
  switch (kind) {
    case "contradiction":
      return "conflicting-takes";
    case "stale_topic":
      return "stale-coverage";
    default:
      return "fresh-topic";
  }
}

function buildTags(opportunity: ResearchOpportunity): string[] {
  return ["research", opportunity.kind.replace("_", "-")];
}

function clampConfidence(value: number | null): number {
  const input = typeof value === "number" ? value : 70;
  return Math.max(55, Math.min(85, Math.round(input)));
}

function normalizeDraftText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^Claim:\s*/i, "")
    .trim();
}

function checkResearchDraftQuality(
  text: string,
  minTextLength: number,
  opportunity: ResearchOpportunity,
  evidenceSummary: ResearchEvidenceSummary,
  supportingEvidenceSummaries: ResearchEvidenceSummary[] = [],
): QualityGateResult {
  const base = checkPublishQuality(
    { text, category: "ANALYSIS" },
    { minTextLength },
  );
  const leak = findResearchMetaLeak(text);
  const evidenceAlignment = checkEvidenceValueOverlap(text, evidenceSummary, supportingEvidenceSummaries);
  const semanticEvidence = checkSemanticEvidenceGrounding(evidenceSummary, supportingEvidenceSummaries);
  const contextualGrounding = checkContextualGrounding(text, opportunity);
  const styleLeak = findResearchStyleProblem(text);
  const familyBaselineLeak = findFamilyBaselineProblem(text, opportunity);
  const checks = [
    ...base.checks,
    {
      name: "no-internal-reasoning-leak",
      pass: leak == null,
      detail: leak == null ? "no internal scoring or workflow language detected" : `${leak.name}: ${leak.detail}`,
    },
    {
      name: "evidence-value-overlap",
      pass: evidenceAlignment.pass,
      detail: evidenceAlignment.detail,
    },
    {
      name: "semantic-evidence-grounding",
      pass: semanticEvidence.pass,
      detail: semanticEvidence.detail,
    },
    {
      name: "research-angle-grounding",
      pass: contextualGrounding.pass,
      detail: contextualGrounding.detail,
    },
    {
      name: "research-style",
      pass: styleLeak == null,
      detail: styleLeak == null ? "wording reads like colony-facing analysis" : `${styleLeak.name}: ${styleLeak.detail}`,
    },
    {
      name: "family-dossier-grounding",
      pass: familyBaselineLeak == null,
      detail: familyBaselineLeak == null
        ? "draft respects family-level baseline and false-inference rules"
        : familyBaselineLeak.detail,
    },
  ];

  if (!base.pass) {
    return {
      pass: false,
      reason: base.reason,
      checks,
    };
  }

  if (leak) {
    return {
      pass: false,
      reason: `failed: no-internal-reasoning-leak — ${leak.detail}`,
      checks,
    };
  }

  if (!evidenceAlignment.pass) {
    return {
      pass: false,
      reason: `failed: evidence-value-overlap — ${evidenceAlignment.detail}`,
      checks,
    };
  }

  if (!semanticEvidence.pass) {
    return {
      pass: false,
      reason: `failed: semantic-evidence-grounding — ${semanticEvidence.detail}`,
      checks,
    };
  }

  if (!contextualGrounding.pass) {
    return {
      pass: false,
      reason: `failed: research-angle-grounding — ${contextualGrounding.detail}`,
      checks,
    };
  }

  if (styleLeak) {
    return {
      pass: false,
      reason: `failed: research-style — ${styleLeak.detail}`,
      checks,
    };
  }

  if (familyBaselineLeak) {
    return {
      pass: false,
      reason: `failed: family-dossier-grounding — ${familyBaselineLeak.detail}`,
      checks,
    };
  }

  return {
    pass: true,
    checks,
  };
}

function checkSemanticEvidenceGrounding(
  evidenceSummary: ResearchEvidenceSummary,
  supportingEvidenceSummaries: ResearchEvidenceSummary[] = [],
): { pass: boolean; detail: string } {
  const primaryClass = evidenceSummary.semanticClass
    ?? classifyResearchEvidenceSemanticClass("generic", evidenceSummary.values, evidenceSummary.derivedMetrics);

  if (primaryClass === "metadata") {
    return {
      pass: false,
      detail: "primary evidence is metadata-shaped (search/result-count style) rather than market, macro, liquidity, or network evidence",
    };
  }

  if (primaryClass === "generic") {
    return {
      pass: false,
      detail: "primary evidence could not be classified as market, macro, liquidity, or network evidence",
    };
  }

  const supportingClasses = supportingEvidenceSummaries.map((summary) =>
    summary.semanticClass
      ?? classifyResearchEvidenceSemanticClass("generic", summary.values, summary.derivedMetrics));

  const metadataSupport = supportingClasses.filter((entry) => entry === "metadata").length;
  return {
    pass: true,
    detail: metadataSupport > 0
      ? `primary evidence is ${primaryClass}; ignored ${metadataSupport} metadata-only supporting packet(s)`
      : `primary evidence is ${primaryClass}`,
  };
}

function buildResearchAnalysisAngle(opportunity: ResearchOpportunity): string {
  const topic = opportunity.topic.toLowerCase();
  const sentimentRead = describeSignalRead(opportunity);

  if (topic.includes("divergence") || topic.includes("sentiment")) {
    return `Explain whether ${sentimentRead} is being confirmed or contradicted by the observed price, range, and volume evidence. Name the mismatch directly.`;
  }

  if (topic.includes("funding") || topic.includes("premium") || topic.includes("basis")) {
    return "Explain what the relationship between funding, premium, and price says about positioning, and what would invalidate that read.";
  }

  if (topic.includes("etf") || topic.includes("flow")) {
    return "Explain what the latest ETF flow and holdings data implies about institutional demand, and what would mark that demand as weakening.";
  }

  if (topic.includes("stablecoin") || topic.includes("usdt") || topic.includes("usdc") || topic.includes("peg")) {
    return "Explain what the latest stablecoin supply and peg evidence says about liquidity or reserve stress, and what would weaken that interpretation.";
  }

  if (topic.includes("on-chain") || topic.includes("network") || topic.includes("mempool") || topic.includes("hashrate") || topic.includes("addresses")) {
    return "Explain whether the latest on-chain activity reflects real usage, congestion, stress, or speculative churn, and what would invalidate that read.";
  }

  if (topic.includes("vix") || topic.includes("credit") || topic.includes("recession")) {
    return "Explain whether volatility and the short-rate backdrop point to real stress, exaggerated fear, or a gap between macro fear pricing and the rates backdrop.";
  }

  if (opportunity.kind === "contradiction") {
    return "Synthesize the conflicting takes into one clear thesis and state which evidence would settle the disagreement.";
  }

  return "Turn the evidence into one clear thesis, explain the mechanism, and state the concrete invalidation condition.";
}

function findResearchMetaLeak(text: string): { name: string; detail: string } | null {
  for (const entry of RESEARCH_META_PATTERNS) {
    if (entry.pattern.test(text)) {
      return {
        name: entry.name,
        detail: entry.detail,
      };
    }
  }
  return null;
}

function findResearchStyleProblem(text: string): { name: string; detail: string } | null {
  for (const entry of RESEARCH_STYLE_PATTERNS) {
    if (entry.pattern.test(text)) {
      return {
        name: entry.name,
        detail: entry.detail,
      };
    }
  }
  return null;
}

function findFamilyBaselineProblem(
  text: string,
  opportunity: ResearchOpportunity,
): { detail: string } | null {
  if (opportunity.sourceProfile.family === "funding-structure") {
    for (const entry of FUNDING_BASELINE_SLIP_PATTERNS) {
      if (entry.pattern.test(text)) {
        return {
          detail: entry.detail,
        };
      }
    }
    return null;
  }

  if (opportunity.sourceProfile.family === "spot-momentum") {
    for (const entry of SPOT_BASELINE_SLIP_PATTERNS) {
      if (entry.pattern.test(text)) {
        return {
          detail: entry.detail,
        };
      }
    }
    return null;
  }

  if (opportunity.sourceProfile.family === "etf-flows") {
    for (const entry of ETF_BASELINE_SLIP_PATTERNS) {
      if (entry.pattern.test(text)) {
        return {
          detail: entry.detail,
        };
      }
    }
    return null;
  }

  if (opportunity.sourceProfile.family === "network-activity") {
    for (const entry of NETWORK_BASELINE_SLIP_PATTERNS) {
      if (entry.pattern.test(text)) {
        return {
          detail: entry.detail,
        };
      }
    }
    return null;
  }

  if (opportunity.sourceProfile.family === "vix-credit") {
    for (const entry of VIX_CREDIT_BASELINE_SLIP_PATTERNS) {
      if (entry.pattern.test(text)) {
        return {
          detail: entry.detail,
        };
      }
    }
    return null;
  }

  if (opportunity.sourceProfile.family !== "stablecoin-supply") {
    return null;
  }

  for (const entry of STABLECOIN_BASELINE_SLIP_PATTERNS) {
    if (entry.pattern.test(text)) {
      return {
        detail: entry.detail,
      };
    }
  }

  return null;
}

function checkContextualGrounding(
  text: string,
  opportunity: ResearchOpportunity,
): { pass: boolean; detail: string } {
  const topic = opportunity.topic.toLowerCase();

  if (topic.includes("divergence") || topic.includes("sentiment")) {
    const hasDivergenceCue = DIVERGENCE_CONTEXT_PATTERNS.some((pattern) => pattern.test(text));
    const hasSentimentCue = SENTIMENT_CONTEXT_PATTERNS.some((pattern) => pattern.test(text));
    if (!hasDivergenceCue || !hasSentimentCue) {
      return {
        pass: false,
        detail: "draft does not clearly name the signal-vs-market mismatch implied by the topic",
      };
    }
  }

  return {
    pass: true,
    detail: "draft reflects the research angle implied by the topic",
  };
}

function describeSignalRead(opportunity: ResearchOpportunity): string {
  const topic = opportunity.topic.toLowerCase();
  const direction = opportunity.matchedSignal.direction?.toLowerCase() ?? "mixed";

  if (topic.includes("bear")) return "the bearish read in colony signals";
  if (topic.includes("bull")) return "the bullish read in colony signals";
  if (direction === "bearish") return "the bearish read in colony signals";
  if (direction === "bullish") return "the bullish read in colony signals";
  if (direction === "mixed") return "mixed positioning in colony signals";
  return "the current read in colony signals";
}

function checkEvidenceValueOverlap(
  text: string,
  evidenceSummary: ResearchEvidenceSummary,
  supportingEvidenceSummaries: ResearchEvidenceSummary[] = [],
): { pass: boolean; detail: string } {
  const draftNumbers = extractNumericValues(text);
  const allEvidence = [evidenceSummary, ...supportingEvidenceSummaries];
  const evidenceNumbers = allEvidence
    .flatMap((summary) => Object.values(summary.values).concat(Object.values(summary.derivedMetrics)))
    .flatMap((value) => extractNumericValues(value));

  if (evidenceNumbers.length === 0) {
    return {
      pass: false,
      detail: "no numeric evidence values were available for grounding",
    };
  }

  const overlap = draftNumbers.find((draftValue) =>
    evidenceNumbers.some((evidenceValue) => numericOverlap(draftValue, evidenceValue)));

  if (overlap == null) {
    return {
      pass: false,
      detail: "draft does not reference any fetched evidence value",
    };
  }

  return {
    pass: true,
    detail: `draft references fetched evidence value ${formatEvidenceValue(overlap)}`,
  };
}

function extractNumericValues(text: string): number[] {
  const matches = text.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? [];
  return matches
    .map((match) => Number.parseFloat(match.replace(/,/g, "")))
    .filter((value) => Number.isFinite(value));
}

function numericOverlap(left: number, right: number): boolean {
  const tolerance = Math.max(Math.abs(right) * 0.01, 0.01);
  return Math.abs(left - right) <= tolerance;
}

function formatEvidenceValue(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}
