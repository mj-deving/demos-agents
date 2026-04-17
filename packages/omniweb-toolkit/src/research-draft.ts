import type { QualityGateResult } from "../../../src/toolkit/publish/quality-gate.js";
import { checkPublishQuality } from "../../../src/toolkit/publish/quality-gate.js";
import type { ResearchOpportunity } from "./research-opportunities.js";

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
  llmProvider?: PromptCapableProvider | null;
  minTextLength?: number;
}

export interface ResearchPromptPacket {
  role: string[];
  data: {
    topic: string;
    opportunityKind: ResearchOpportunity["kind"];
    opportunityScore: number;
    rationale: string;
    signal: {
      confidence: number | null;
      direction: string | null;
    };
    feed: {
      feedCount: number;
      matchingPostCount: number;
      matchingAuthors: string[];
      lastSeenAt: string | null;
      contradictionSignals: string[];
    };
    leaderboardCount: number;
    balanceDem: number;
    attestation: {
      primarySource: string | null;
      supportingSources: string[];
    };
  };
  rules: string[];
  outputFormat: string[];
}

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

export async function buildResearchDraft(
  opts: BuildResearchDraftOptions,
): Promise<ResearchDraftResult> {
  const promptPacket = buildResearchPromptPacket(opts);
  const minTextLength = opts.minTextLength ?? DEFAULT_MIN_TEXT_LENGTH;
  const llmText = await generateViaProvider(opts.llmProvider, promptPacket);

  if (!llmText) {
    return {
      ok: false,
      reason: "llm_provider_unavailable",
      promptPacket,
      qualityGate: checkPublishQuality(
        { text: "", category: "ANALYSIS" },
        { minTextLength },
      ),
      notes: ["Phase 2 prompt step requires a real LLM provider; deterministic fallback is intentionally disabled."],
    };
  }

  const preferredGate = checkPublishQuality(
    { text: llmText, category: "ANALYSIS" },
    { minTextLength },
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
  const matchingAuthors = Array.from(new Set(
    opts.opportunity.matchingFeedPosts
      .map((post) => post.author)
      .filter((author): author is string => typeof author === "string" && author.length > 0),
  ));
  const primarySource = opts.opportunity.attestationPlan.primary?.name ?? null;
  const supportingSources = opts.opportunity.attestationPlan.supporting.map((candidate) => candidate.name);

  return {
    role: [
      "You are a deep research analyst contributing original insights to a live agent colony.",
      "Your role is to explain why this topic deserves attention now, using only the evidence packet below.",
    ],
    data: {
      topic: opts.opportunity.topic,
      opportunityKind: opts.opportunity.kind,
      opportunityScore: opts.opportunity.score,
      rationale: opts.opportunity.rationale,
      signal: {
        confidence: opts.opportunity.matchedSignal.confidence,
        direction: opts.opportunity.matchedSignal.direction,
      },
      feed: {
        feedCount: opts.feedCount,
        matchingPostCount: opts.opportunity.matchingFeedPosts.length,
        matchingAuthors,
        lastSeenAt: opts.opportunity.lastSeenAt == null
          ? null
          : new Date(opts.opportunity.lastSeenAt).toISOString(),
        contradictionSignals: opts.opportunity.contradictionSignals ?? [],
      },
      leaderboardCount: opts.leaderboardCount,
      balanceDem: opts.availableBalance,
      attestation: {
        primarySource,
        supportingSources,
      },
    },
    rules: [
      "Interpret the data; do not invent extra metrics or claims.",
      "State the main claim once, then support it with concrete evidence from the packet.",
      "Explain what is still uncertain or what the next live attested fetch must confirm.",
      "If the packet contains contradiction signals, explicitly frame the post as a synthesis or resolution of conflicting takes.",
      "Output one compact ANALYSIS post in plain prose, not headings or bullets.",
    ],
    outputFormat: [
      "Sentence 1: claim and why it matters now.",
      "Sentence 2: concrete evidence from the signal/feed packet.",
      "Sentence 3: attestation/source context and remaining uncertainty.",
    ],
  };
}

async function generateViaProvider(
  provider: PromptCapableProvider | null | undefined,
  packet: ResearchPromptPacket,
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
    system: "You write concise, evidence-bound colony posts. Never use headings, labels, or markdown.",
    maxTokens: 220,
    modelTier: "standard",
  });
  return normalizeDraftText(completion);
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
