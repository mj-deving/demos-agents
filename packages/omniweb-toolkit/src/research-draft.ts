import type { QualityGateResult } from "../../../src/toolkit/publish/quality-gate.js";
import { checkPublishQuality } from "../../../src/toolkit/publish/quality-gate.js";
import { renderColonyPromptPacket, type ColonyPromptPacket } from "./colony-prompt.js";
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

export interface ResearchPromptInput {
  topic: string;
  signal: {
    direction: string | null;
  };
  colonyContext: {
    situation: "fresh-topic" | "conflicting-takes" | "stale-coverage";
    contradictionSignals: string[];
    lastCoveredAt: string | null;
  };
  evidence: {
    primarySourceName: string | null;
    supportingSourceNames: string[];
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
    pattern: /\bopportunity score\b|\bcoverage gap\b|\bmatching posts?\b|\bfeed items?\b|\bleaderboard\b/i,
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

export async function buildResearchDraft(
  opts: BuildResearchDraftOptions,
): Promise<ResearchDraftResult> {
  const promptPacket = buildResearchPromptPacket(opts);
  const minTextLength = opts.minTextLength ?? DEFAULT_MIN_TEXT_LENGTH;
  const llmText = await generateViaProvider(opts.llmProvider, promptPacket);
  const emptyQualityGate = checkResearchDraftQuality("", minTextLength);

  if (!llmText) {
    return {
      ok: false,
      reason: "llm_provider_unavailable",
      promptPacket,
      qualityGate: emptyQualityGate,
      notes: ["Phase 2 prompt step requires a real LLM provider; deterministic fallback is intentionally disabled."],
    };
  }

  const preferredGate = checkResearchDraftQuality(llmText, minTextLength);
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
  const primarySource = opts.opportunity.attestationPlan.primary?.name ?? null;
  const supportingSources = opts.opportunity.attestationPlan.supporting.map((candidate) => candidate.name);

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
      signal: {
        direction: opts.opportunity.matchedSignal.direction,
      },
      colonyContext: {
        situation: mapOpportunitySituation(opts.opportunity.kind),
        contradictionSignals: opts.opportunity.contradictionSignals ?? [],
        lastCoveredAt: opts.opportunity.lastSeenAt == null
          ? null
          : new Date(opts.opportunity.lastSeenAt).toISOString(),
      },
      evidence: {
        primarySourceName: primarySource,
        supportingSourceNames: supportingSources,
      },
    },
    instruction: "Write one standalone ANALYSIS post grounded in the input evidence and colony context. Lead with the thesis, then explain the mechanism, then say what would confirm or invalidate the view.",
    constraints: [
      "Make the post fully legible to a human reader who never saw the agent's internal reasoning or the prompt packet.",
      "Do not mention internal scoring, confidence numbers, coverage gaps, feed sampling, matching-post counts, or why the agent decided to post.",
      "Do not narrate the attestation pipeline, source ranking, supporting-source bookkeeping, or any source-selection process.",
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
    system: "You write concise, evidence-bound colony research posts for human readers. Synthesize the evidence into one strong thesis, mention only what matters externally, and never leak internal scoring, feed coverage, or attestation workflow details.",
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

function checkResearchDraftQuality(text: string, minTextLength: number): QualityGateResult {
  const base = checkPublishQuality(
    { text, category: "ANALYSIS" },
    { minTextLength },
  );
  const leak = findResearchMetaLeak(text);
  const checks = [
    ...base.checks,
    {
      name: "no-internal-reasoning-leak",
      pass: leak == null,
      detail: leak == null ? "no internal scoring or workflow language detected" : `${leak.name}: ${leak.detail}`,
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

  return {
    pass: true,
    checks,
  };
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
