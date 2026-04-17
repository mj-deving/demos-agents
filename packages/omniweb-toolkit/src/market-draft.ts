import type { QualityGateResult } from "../../../src/toolkit/publish/quality-gate.js";
import { checkPublishQuality } from "../../../src/toolkit/publish/quality-gate.js";
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

export interface MarketPromptPacket {
  role: string[];
  data: {
    asset: string;
    opportunityKind: MarketOpportunity["kind"];
    opportunityScore: number;
    rationale: string;
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
    feed: {
      feedCount: number;
      matchingPostCount: number;
      lastSeenAt: string | null;
    };
    oracleAssetCount: number;
    balanceDem: number;
    recommendedDirection: "higher" | "lower" | null;
    attestation: {
      primarySource: string | null;
      supportingSources: string[];
    };
  };
  rules: string[];
  outputFormat: string[];
}

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
    role: [
      "You are a quantitative market analyst publishing attested, high-signal colony analysis.",
      "Your role is to explain the market edge now using only the observed packet below.",
    ],
    data: {
      asset: opportunity.asset,
      opportunityKind: opportunity.kind,
      opportunityScore: opportunity.score,
      rationale: opportunity.rationale,
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
      feed: {
        feedCount: opts.feedCount,
        matchingPostCount: opportunity.matchingFeedPosts.length,
        lastSeenAt: opportunity.lastSeenAt == null ? null : new Date(opportunity.lastSeenAt).toISOString(),
      },
      oracleAssetCount: opts.oracleAssetCount,
      balanceDem: opts.availableBalance,
      recommendedDirection: opportunity.recommendedDirection,
      attestation: {
        primarySource,
        supportingSources,
      },
    },
    rules: [
      "Use only the packet data; do not invent prices, percentages, or market structure.",
      "Reference the concrete divergence severity and price move when they are present.",
      "Explain why the edge matters now and what still needs confirmation from the attested sources.",
      "Keep the tone measured and conviction-calibrated; market analysis should never sound certain.",
      "Output one compact ANALYSIS post in plain prose, not headings or bullets.",
    ],
    outputFormat: [
      "Sentence 1: the market edge and why it matters now.",
      "Sentence 2: concrete observed divergence/signal/price evidence.",
      "Sentence 3: attestation source context, directionality, and remaining uncertainty.",
    ],
  };
}

async function generateViaProvider(
  provider: PromptCapableProvider | null | undefined,
  packet: MarketPromptPacket,
): Promise<string | null> {
  if (!provider) return null;

  const prompt = [
    "Role:",
    ...packet.role,
    "",
    "Data:",
    JSON.stringify(packet.data, null, 2),
    "",
    "Rules:",
    ...packet.rules.map((rule) => `- ${rule}`),
    "",
    "Output format:",
    ...packet.outputFormat.map((line) => `- ${line}`),
    "",
    "Return only the final post text.",
  ].join("\n");

  const completion = await provider.complete(prompt, {
    system: "You write concise, numeric, evidence-bound market posts. Never use markdown or headings.",
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
