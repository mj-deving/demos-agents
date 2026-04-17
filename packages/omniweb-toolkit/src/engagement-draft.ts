import type { QualityGateResult } from "../../../src/toolkit/publish/quality-gate.js";
import { checkPublishQuality } from "../../../src/toolkit/publish/quality-gate.js";
import type { EngagementOpportunity } from "./engagement-opportunities.js";

interface PromptCapableProvider {
  complete(prompt: string, options?: {
    system?: string;
    maxTokens?: number;
    model?: string;
    modelTier?: "fast" | "standard" | "premium";
  }): Promise<string>;
  readonly name?: string;
}

export interface BuildEngagementDraftOptions {
  opportunity: EngagementOpportunity;
  feedCount: number;
  leaderboardCount: number;
  availableBalance: number;
  llmProvider?: PromptCapableProvider | null;
  minTextLength?: number;
}

export interface EngagementPromptPacket {
  role: string[];
  data: {
    opportunityKind: EngagementOpportunity["kind"];
    opportunityScore: number;
    rationale: string;
    post: {
      txHash: string;
      category: string | null;
      score: number;
      reputationTier: string | null;
      replyCount: number;
      textSnippet: string;
    };
    reactions: {
      agree: number;
      disagree: number;
      flag: number;
      total: number;
    };
    leaderboard: {
      count: number;
      authorRanked: boolean;
      bayesianScore: number | null;
      avgScore: number | null;
    };
    feedCount: number;
    balanceDem: number;
    attestation: {
      primarySource: string | null;
      supportingSources: string[];
    };
  };
  rules: string[];
  outputFormat: string[];
}

export interface EngagementDraftSuccess {
  ok: true;
  category: "OBSERVATION";
  text: string;
  confidence: number;
  tags: string[];
  promptPacket: EngagementPromptPacket;
  qualityGate: QualityGateResult;
  draftSource: "llm";
}

export interface EngagementDraftFailure {
  ok: false;
  reason: string;
  promptPacket: EngagementPromptPacket;
  qualityGate: QualityGateResult;
  notes: string[];
}

export type EngagementDraftResult = EngagementDraftSuccess | EngagementDraftFailure;

const DEFAULT_MIN_TEXT_LENGTH = 220;

export async function buildEngagementDraft(
  opts: BuildEngagementDraftOptions,
): Promise<EngagementDraftResult> {
  const promptPacket = buildEngagementPromptPacket(opts);
  const minTextLength = opts.minTextLength ?? DEFAULT_MIN_TEXT_LENGTH;
  const llmText = await generateViaProvider(opts.llmProvider, promptPacket);

  if (!llmText) {
    return {
      ok: false,
      reason: "llm_provider_unavailable",
      promptPacket,
      qualityGate: checkPublishQuality({ text: "", category: "OBSERVATION" }, { minTextLength }),
      notes: ["Phase 2 engagement drafting requires a real LLM provider; deterministic fallback is intentionally disabled."],
    };
  }

  const preferredGate = checkPublishQuality({ text: llmText, category: "OBSERVATION" }, { minTextLength });
  if (preferredGate.pass) {
    return {
      ok: true,
      category: "OBSERVATION",
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

function buildEngagementPromptPacket(opts: BuildEngagementDraftOptions): EngagementPromptPacket {
  const opportunity = opts.opportunity;
  const post = opportunity.selectedPost;
  const primarySource = opportunity.attestationPlan.primary?.name ?? null;
  const supportingSources = opportunity.attestationPlan.supporting.map((candidate) => candidate.name);
  const reactionTotal = post.reactions.agree + post.reactions.disagree + post.reactions.flag;

  return {
    role: [
      "You are a community curator highlighting why a specific attested colony post deserves more attention.",
      "Your role is to surface signal, not to flatter. Explain why the post matters and why it is under-amplified.",
    ],
    data: {
      opportunityKind: opportunity.kind,
      opportunityScore: opportunity.score,
      rationale: opportunity.rationale,
      post: {
        txHash: post.txHash,
        category: post.category,
        score: post.score,
        reputationTier: post.reputationTier,
        replyCount: post.replyCount,
        textSnippet: post.text.slice(0, 220),
      },
      reactions: {
        agree: post.reactions.agree,
        disagree: post.reactions.disagree,
        flag: post.reactions.flag,
        total: reactionTotal,
      },
      leaderboard: {
        count: opts.leaderboardCount,
        authorRanked: opportunity.leaderboardAgent != null,
        bayesianScore: opportunity.leaderboardAgent?.bayesianScore ?? null,
        avgScore: opportunity.leaderboardAgent?.avgScore ?? null,
      },
      feedCount: opts.feedCount,
      balanceDem: opts.availableBalance,
      attestation: {
        primarySource,
        supportingSources,
      },
    },
    rules: [
      "Use only the packet data; do not invent post quality, reactions, or leaderboard standing.",
      "Explain why the post is under-engaged or why the newcomer context matters now.",
      "Keep the tone selective and evidence-bound rather than cheerleading.",
      "Mention the attested source context in the final sentence.",
      "Output one compact OBSERVATION post in plain prose, not headings or bullets.",
    ],
    outputFormat: [
      "Sentence 1: why this post matters right now.",
      "Sentence 2: the quality/engagement gap using the packet numbers.",
      "Sentence 3: attestation context and why the colony should pay attention.",
    ],
  };
}

async function generateViaProvider(
  provider: PromptCapableProvider | null | undefined,
  packet: EngagementPromptPacket,
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
    system: "You write concise, selective curation notes. Never use markdown, headings, or hype.",
    maxTokens: 220,
    modelTier: "standard",
  });

  return normalizeDraftText(completion);
}

function buildTags(opportunity: EngagementOpportunity): string[] {
  return ["engagement", "curation", opportunity.kind.replace("_", "-")];
}

function clampConfidence(opportunity: EngagementOpportunity): number {
  const base = opportunity.kind === "newcomer_spotlight" ? 64 : 70;
  return Math.max(55, Math.min(80, Math.round((base + opportunity.selectedPost.score / 2) / 1.5)));
}

function normalizeDraftText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/^Claim:\s*/i, "").trim();
}
