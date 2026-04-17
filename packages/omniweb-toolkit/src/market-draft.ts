import type { QualityGateResult } from "../../../src/toolkit/publish/quality-gate.js";
import { checkPublishQuality } from "../../../src/toolkit/publish/quality-gate.js";
import { renderColonyPromptPacket, type ColonyPromptPacket } from "./colony-prompt.js";
import type { MarketOpportunity } from "./market-opportunities.js";

interface PromptCapableProvider {
  complete(prompt: string, options?: {
    system?: string;
    maxTokens?: number;
    model?: string;
    modelTier?: "fast" | "standard" | "premium";
  }): Promise<string>;
  readonly name?: string;
}

export interface BuildMarketDraftOptions {
  opportunity: MarketOpportunity;
  feedCount: number;
  availableBalance: number;
  oracleAssetCount: number;
  llmProvider?: PromptCapableProvider | null;
  minTextLength?: number;
}

export interface MarketPromptInput {
  asset: string;
  divergence: {
    severity: string | null;
    type: string | null;
    description: string | null;
    details: Record<string, unknown> | null;
  };
  signal: {
    topic: string | null;
    confidence: number | null;
    direction: string | null;
  };
  price: {
    priceUsd: number | null;
    change24h: number | null;
    source: string | null;
  };
  marketContext: {
    situation: MarketOpportunity["kind"];
    lastSeenAt: string | null;
    matchingPostCount: number;
    recommendedDirection: "higher" | "lower" | null;
  };
  evidence: {
    primarySourceName: string | null;
    supportingSourceNames: string[];
  };
}

export type MarketPromptPacket = ColonyPromptPacket<MarketPromptInput>;

export interface MarketDraftSuccess {
  ok: true;
  category: "ANALYSIS";
  text: string;
  confidence: number;
  tags: string[];
  promptPacket: MarketPromptPacket;
  qualityGate: QualityGateResult;
  draftSource: "llm";
}

export interface MarketDraftFailure {
  ok: false;
  reason: string;
  promptPacket: MarketPromptPacket;
  qualityGate: QualityGateResult;
  notes: string[];
}

export type MarketDraftResult = MarketDraftSuccess | MarketDraftFailure;

const DEFAULT_MIN_TEXT_LENGTH = 220;

export async function buildMarketDraft(
  opts: BuildMarketDraftOptions,
): Promise<MarketDraftResult> {
  const promptPacket = buildMarketPromptPacket(opts);
  const minTextLength = opts.minTextLength ?? DEFAULT_MIN_TEXT_LENGTH;
  const llmText = await generateViaProvider(opts.llmProvider, promptPacket);

  if (!llmText) {
    return {
      ok: false,
      reason: "llm_provider_unavailable",
      promptPacket,
      qualityGate: checkPublishQuality({ text: "", category: "ANALYSIS" }, { minTextLength }),
      notes: ["Phase 2 market drafting requires a real LLM provider; deterministic fallback is intentionally disabled."],
    };
  }

  const preferredGate = checkPublishQuality({ text: llmText, category: "ANALYSIS" }, { minTextLength });
  if (preferredGate.pass) {
    return {
      ok: true,
      category: "ANALYSIS",
      text: llmText,
      confidence: clampConfidence(opts.opportunity),
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

function buildMarketPromptPacket(opts: BuildMarketDraftOptions): MarketPromptPacket {
  const opportunity = opts.opportunity;
  const primarySource = opportunity.attestationPlan.primary?.name ?? null;
  const supportingSources = opportunity.attestationPlan.supporting.map((candidate) => candidate.name);

  return {
    archetype: "market-analyst",
    role: [
      "You are a quantitative market analyst publishing attested, high-signal colony analysis for traders.",
      "Your job is to compress the setup into a concrete market read with numbers that matter now.",
    ],
    edge: [
      "Speed and precision over breadth: surface the live edge before it gets crowded.",
      "Translate divergences and price data into one actionable read, not a generic recap.",
      "Always pair the setup with a clean invalidation condition so conviction stays calibrated.",
    ],
    input: {
      asset: opportunity.asset,
      divergence: {
        severity: opportunity.divergence?.severity ?? null,
        type: opportunity.divergence?.type ?? null,
        description: opportunity.divergence?.description ?? null,
        details: opportunity.divergence?.details ?? null,
      },
      signal: {
        topic: opportunity.matchedSignal?.topic ?? null,
        confidence: opportunity.matchedSignal?.confidence ?? null,
        direction: opportunity.matchedSignal?.direction ?? null,
      },
      price: {
        priceUsd: opportunity.priceSnapshot?.priceUsd ?? null,
        change24h: opportunity.priceSnapshot?.change24h ?? null,
        source: opportunity.priceSnapshot?.source ?? null,
      },
      marketContext: {
        situation: opportunity.kind,
        matchingPostCount: opportunity.matchingFeedPosts.length,
        lastSeenAt: opportunity.lastSeenAt == null ? null : new Date(opportunity.lastSeenAt).toISOString(),
        recommendedDirection: opportunity.recommendedDirection,
      },
      evidence: {
        primarySourceName: primarySource,
        supportingSourceNames: supportingSources,
      },
    },
    instruction: "Write one standalone ANALYSIS post grounded in this market input. Lead with the edge, support it with the key numbers, and finish with the condition that weakens or breaks the setup.",
    constraints: [
      "Use only the packet data; do not invent prices, percentages, or market structure.",
      "Reference the concrete divergence severity and price move when they are present.",
      "Include the specific market values that make the edge actionable.",
      "Do not mention internal opportunity scores, rationale text, feed counts, or balance/context bookkeeping.",
      "Explain why the edge matters now and what would confirm or weaken it from the evidence.",
      "Keep the tone measured and conviction-calibrated; market analysis should never sound certain.",
      "Do not narrate source selection or attestation mechanics.",
      "Output one compact ANALYSIS post in plain prose, not headings or bullets.",
    ],
    output: {
      category: "ANALYSIS",
      confidenceStyle: "fast but measured; conviction should match the observed numbers and divergence severity",
      shape: [
        "Sentence 1: the market edge and why it matters now.",
        "Sentence 2: concrete observed divergence, signal, or price evidence.",
        "Sentence 3: what would confirm or weaken the setup next.",
      ],
      successCriteria: [
        "Reads like a trader's edge summary, not a backend report.",
        "Includes the concrete numbers that make the setup actionable.",
        "Ends with a credible invalidation or confirmation condition.",
      ],
    },
  };
}

async function generateViaProvider(
  provider: PromptCapableProvider | null | undefined,
  packet: MarketPromptPacket,
): Promise<string | null> {
  if (!provider) return null;

  const prompt = renderColonyPromptPacket(packet);

  const completion = await provider.complete(prompt, {
    system: "You write concise, numeric, evidence-bound market posts for traders. Lead with the edge, keep the numbers concrete, end with invalidation, and never use markdown, headings, or internal workflow language.",
    maxTokens: 220,
    modelTier: "standard",
  });

  return normalizeDraftText(completion);
}

function buildTags(opportunity: MarketOpportunity): string[] {
  return ["market", opportunity.asset.toLowerCase(), opportunity.kind.replace("_", "-")];
}

function clampConfidence(opportunity: MarketOpportunity): number {
  const base = opportunity.divergence?.severity === "high"
    ? 76
    : opportunity.divergence?.severity === "medium"
      ? 68
      : 61;
  const signalConfidence = opportunity.matchedSignal?.confidence ?? base;
  return Math.max(55, Math.min(82, Math.round((base + signalConfidence) / 2)));
}

function normalizeDraftText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/^Claim:\s*/i, "").trim();
}
