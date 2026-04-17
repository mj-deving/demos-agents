import type { QualityGateResult } from "../../../src/toolkit/publish/quality-gate.js";
import { checkPublishQuality } from "../../../src/toolkit/publish/quality-gate.js";
import { renderColonyPromptPacket, type ColonyPromptPacket } from "./colony-prompt.js";
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

export interface EngagementPromptInput {
  opportunityKind: EngagementOpportunity["kind"];
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
  communityContext: {
    authorRanked: boolean;
    bayesianScore: number | null;
    avgScore: number | null;
  };
  evidence: {
    primarySourceName: string | null;
    supportingSourceNames: string[];
  };
}

export type EngagementPromptPacket = ColonyPromptPacket<EngagementPromptInput>;

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
    archetype: "engagement-optimizer",
    role: [
      "You are a community curator surfacing under-amplified signal in the colony feed.",
      "Your job is to explain why a specific post matters without sounding promotional, internal, or hype-driven.",
    ],
    edge: [
      "Selective curation over volume: surface signal the colony is overlooking.",
      "Translate engagement asymmetry into a readable reason to pay attention now.",
      "Validate quality without cheerleading or leaking internal curation logic.",
    ],
    input: {
      opportunityKind: opportunity.kind,
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
      communityContext: {
        authorRanked: opportunity.leaderboardAgent != null,
        bayesianScore: opportunity.leaderboardAgent?.bayesianScore ?? null,
        avgScore: opportunity.leaderboardAgent?.avgScore ?? null,
      },
      evidence: {
        primarySourceName: primarySource,
        supportingSourceNames: supportingSources,
      },
    },
    instruction: "Write one standalone OBSERVATION post grounded in this packet. Explain why the selected post deserves attention now, using the observed engagement and author context rather than internal curation logic.",
    constraints: [
      "Use only the packet data; do not invent post quality, reactions, or leaderboard standing.",
      "Explain why the post is under-engaged or why the newcomer context matters now.",
      "Do not mention opportunity scores, rationale strings, feed counts, or internal curation logic.",
      "Keep the tone selective and evidence-bound rather than cheerleading.",
      "Mention the source context only as evidence for why the post matters, not as pipeline narration.",
      "Make the post read like a curator's signal note, not a social recommendation engine.",
      "Output one compact OBSERVATION post in plain prose, not headings or bullets.",
    ],
    output: {
      category: "OBSERVATION",
      confidenceStyle: "steady and socially calibrated; the tone should fit curation, not hard prediction",
      shape: [
        "Sentence 1: why this post matters right now.",
        "Sentence 2: the engagement or quality gap using the packet numbers.",
        "Sentence 3: why the colony should pay attention next.",
      ],
      successCriteria: [
        "Reads like selective curation, not praise or promotion.",
        "Uses the engagement/context numbers to justify attention.",
        "Leaves a clear reason the colony should revisit or amplify the post.",
      ],
    },
  };
}

async function generateViaProvider(
  provider: PromptCapableProvider | null | undefined,
  packet: EngagementPromptPacket,
): Promise<string | null> {
  if (!provider) return null;

  const prompt = renderColonyPromptPacket(packet);

  const completion = await provider.complete(prompt, {
    system: "You write concise, selective curation notes for a live colony feed. Highlight why a post matters, stay evidence-bound, avoid hype, and never use markdown, headings, or internal curation language.",
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
