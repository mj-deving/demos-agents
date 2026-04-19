import {
  buildMinimalAttestationPlan,
  type MinimalAttestationPlan,
} from "./minimal-attestation-plan.js";
import {
  deriveResearchSourceProfile,
  type ResearchSourceProfile,
} from "./research-source-profile.js";

export interface ResearchSignalInput {
  topic: string | null;
  shortTopic?: string | null;
  confidence: number | null;
  direction: string | null;
  text?: string | null;
  keyInsight?: string | null;
  consensus?: boolean | null;
  consensusScore?: number | null;
  agentCount?: number | null;
  totalAgents?: number | null;
  assets?: string[];
  tags?: string[];
  sourcePosts?: string[];
  sourcePostData?: ResearchSignalSourcePost[];
  crossReferences?: ResearchSignalCrossReference[];
  reactionSummary?: ResearchSignalReactionSummary | null;
  divergence?: ResearchSignalDivergence | null;
}

export interface ResearchPostInput {
  txHash: string | null;
  category: string | null;
  text: string;
  author: string | null;
  timestamp: number | null;
  score?: number | null;
}

export interface ResearchSignalSourcePost {
  txHash: string | null;
  author: string | null;
  text: string;
  category: string | null;
  timestamp: number | null;
  confidence?: number | null;
  assets?: string[];
  dissents?: boolean;
  reactions?: {
    agree: number;
    disagree: number;
    flag: number;
  } | null;
}

export interface ResearchSignalCrossReference {
  type: string;
  description: string;
  assets: string[];
}

export interface ResearchSignalReactionSummary {
  totalAgrees: number;
  totalDisagrees: number;
  totalFlags: number;
}

export interface ResearchSignalDivergence {
  agent?: string | null;
  direction?: string | null;
  reasoning?: string | null;
}

export interface DeriveResearchOpportunitiesOptions {
  signals: ResearchSignalInput[];
  posts: ResearchPostInput[];
  nowMs?: number;
  staleAfterMs?: number;
  lastCoverageTopic?: string | null;
  recentCoverageTopics?: string[];
  recentCoverageFamilies?: string[];
  minConfidence?: number;
  recentCoveragePenalty?: number;
  recentFamilyCoveragePenalty?: number;
}

export interface ResearchOpportunity {
  kind: "coverage_gap" | "contradiction" | "stale_topic";
  topic: string;
  score: number;
  rationale: string;
  sourceProfile: ResearchSourceProfile;
  matchedSignal: ResearchSignalInput;
  matchingFeedPosts: ResearchPostInput[];
  lastSeenAt: number | null;
  contradictionSignals?: string[];
  attestationPlan: MinimalAttestationPlan;
}

const DEFAULT_STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MIN_CONFIDENCE = 70;
const DEFAULT_RECENT_COVERAGE_PENALTY = 15;
const DEFAULT_RECENT_FAMILY_COVERAGE_PENALTY = 8;

export function deriveResearchOpportunities(
  opts: DeriveResearchOpportunitiesOptions,
): ResearchOpportunity[] {
  const nowMs = opts.nowMs ?? Date.now();
  const staleAfterMs = opts.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const minConfidence = opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const lastCoverageTopic = normalize(opts.lastCoverageTopic);
  const recentCoverageTopics = new Set((opts.recentCoverageTopics ?? []).map(normalize).filter(Boolean));
  const recentCoverageFamilies = new Set((opts.recentCoverageFamilies ?? []).map(normalize).filter(Boolean));
  const recentCoveragePenalty = opts.recentCoveragePenalty ?? DEFAULT_RECENT_COVERAGE_PENALTY;
  const recentFamilyCoveragePenalty = opts.recentFamilyCoveragePenalty ?? DEFAULT_RECENT_FAMILY_COVERAGE_PENALTY;
  const opportunities: ResearchOpportunity[] = [];

  for (const signal of opts.signals) {
    const topic = normalize(signal.topic);
    if (!topic || topic === lastCoverageTopic) continue;
    const confidence = signal.confidence ?? 0;
    if (confidence < minConfidence) continue;

    const sourceProfile = deriveResearchSourceProfile(topic, {
      divergence: signal.divergence ?? null,
    });
    if (!sourceProfile.supported) continue;

    const matchingFeedPosts = opts.posts.filter((post) => includesNormalized(post.text, topic));
    const lastSeenAt = matchingFeedPosts.reduce<number | null>((latest, post) => {
      if (typeof post.timestamp !== "number") return latest;
      return latest == null || post.timestamp > latest ? post.timestamp : latest;
    }, null);

    const attestationPlan = buildMinimalAttestationPlan({
      topic,
      agent: "sentinel",
      minSupportingSources: Math.min(1, sourceProfile.supportingSourceIds.length),
      preferredSourceIds: [
        ...sourceProfile.primarySourceIds,
        ...sourceProfile.supportingSourceIds,
      ],
      allowTopicFallback: false,
    });
    const sourcePenalty = sourceProfile.supported ? 0 : 25;
    const supportingBonus = attestationPlan.supporting.length * 3;
    const attestationPenalty = attestationPlan.ready ? 0 : 20;
    const contradictionSignals = detectContradictionSignals(matchingFeedPosts);
    const repeatedTopicPenalty = recentCoverageTopics.has(topic) ? recentCoveragePenalty : 0;
    const repeatedFamilyPenalty = recentCoverageFamilies.has(normalize(sourceProfile.family))
      ? recentFamilyCoveragePenalty
      : 0;
    const signalRichnessBonus = computeSignalRichnessBonus(signal);
    const baseScore = confidence + supportingBonus + signalRichnessBonus
      - attestationPenalty
      - repeatedTopicPenalty
      - repeatedFamilyPenalty
      - sourcePenalty;

    if (matchingFeedPosts.length === 0) {
      opportunities.push({
        kind: "coverage_gap",
        topic,
        score: baseScore + 20,
        rationale: "High-confidence signal is not covered in the recent feed.",
        sourceProfile,
        matchedSignal: signal,
        matchingFeedPosts,
        lastSeenAt: null,
        contradictionSignals: [],
        attestationPlan,
      });
      continue;
    }

    if (contradictionSignals.length > 0) {
      opportunities.push({
        kind: "contradiction",
        topic,
        score: baseScore + 25,
        rationale: "Recent matching feed posts point in conflicting directions and need an evidence-bound synthesis.",
        sourceProfile,
        matchedSignal: signal,
        matchingFeedPosts,
        lastSeenAt,
        contradictionSignals,
        attestationPlan,
      });
      continue;
    }

    if (lastSeenAt != null && nowMs - lastSeenAt > staleAfterMs) {
      opportunities.push({
        kind: "stale_topic",
        topic,
        score: baseScore + 10,
        rationale: "Signal remains active but the most recent matching feed post is stale.",
        sourceProfile,
        matchedSignal: signal,
        matchingFeedPosts,
        lastSeenAt,
        contradictionSignals: [],
        attestationPlan,
      });
    }
  }

  opportunities.sort((left, right) => right.score - left.score);
  return opportunities;
}

function includesNormalized(text: string, topic: string): boolean {
  return normalize(text).includes(topic);
}

function detectContradictionSignals(posts: ResearchPostInput[]): string[] {
  const directionCues = new Set<string>();

  for (const post of posts) {
    const text = normalize(post.text);
    if (!text) continue;
    for (const cue of contradictionCueSet(text)) {
      directionCues.add(cue);
    }
  }

  const bullish = ["bullish", "up", "higher", "long", "positive"];
  const bearish = ["bearish", "down", "lower", "short", "negative"];
  const hasBullish = bullish.some((cue) => directionCues.has(cue));
  const hasBearish = bearish.some((cue) => directionCues.has(cue));

  if (!hasBullish || !hasBearish) {
    return [];
  }

  return Array.from(directionCues).sort();
}

function contradictionCueSet(text: string): string[] {
  const cues = ["bullish", "bearish", "higher", "lower", "up", "down", "long", "short", "positive", "negative"];
  return cues.filter((cue) => text.includes(cue));
}

function computeSignalRichnessBonus(signal: ResearchSignalInput): number {
  const sourcePostCount = Math.min(signal.sourcePostData?.length ?? 0, 3);
  const crossReferenceCount = Math.min(signal.crossReferences?.length ?? 0, 2);
  const reactionSignal = signal.reactionSummary
    ? signal.reactionSummary.totalAgrees + signal.reactionSummary.totalDisagrees + signal.reactionSummary.totalFlags
    : 0;
  const agentCountBonus = (signal.agentCount ?? 0) >= 5
    ? 2
    : (signal.agentCount ?? 0) >= 3
      ? 1
      : 0;

  return sourcePostCount
    + crossReferenceCount
    + agentCountBonus
    + (signal.keyInsight ? 2 : 0)
    + (signal.consensus ? 1 : 0)
    + (signal.divergence ? 1 : 0)
    + (reactionSignal >= 3 ? 1 : 0);
}

function normalize(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}
