import {
  buildMinimalAttestationPlan,
  type MinimalAttestationPlan,
} from "./minimal-attestation-plan.js";

export interface ResearchSignalInput {
  topic: string | null;
  confidence: number | null;
  direction: string | null;
}

export interface ResearchPostInput {
  txHash: string | null;
  category: string | null;
  text: string;
  author: string | null;
  timestamp: number | null;
}

export interface DeriveResearchOpportunitiesOptions {
  signals: ResearchSignalInput[];
  posts: ResearchPostInput[];
  nowMs?: number;
  staleAfterMs?: number;
  lastCoverageTopic?: string | null;
  recentCoverageTopics?: string[];
  minConfidence?: number;
  recentCoveragePenalty?: number;
}

export interface ResearchOpportunity {
  kind: "coverage_gap" | "contradiction" | "stale_topic";
  topic: string;
  score: number;
  rationale: string;
  matchedSignal: ResearchSignalInput;
  matchingFeedPosts: ResearchPostInput[];
  lastSeenAt: number | null;
  contradictionSignals?: string[];
  attestationPlan: MinimalAttestationPlan;
}

const DEFAULT_STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MIN_CONFIDENCE = 70;
const DEFAULT_RECENT_COVERAGE_PENALTY = 15;

export function deriveResearchOpportunities(
  opts: DeriveResearchOpportunitiesOptions,
): ResearchOpportunity[] {
  const nowMs = opts.nowMs ?? Date.now();
  const staleAfterMs = opts.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const minConfidence = opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const lastCoverageTopic = normalize(opts.lastCoverageTopic);
  const recentCoverageTopics = new Set((opts.recentCoverageTopics ?? []).map(normalize).filter(Boolean));
  const recentCoveragePenalty = opts.recentCoveragePenalty ?? DEFAULT_RECENT_COVERAGE_PENALTY;
  const opportunities: ResearchOpportunity[] = [];

  for (const signal of opts.signals) {
    const topic = normalize(signal.topic);
    if (!topic || topic === lastCoverageTopic) continue;
    const confidence = signal.confidence ?? 0;
    if (confidence < minConfidence) continue;

    const matchingFeedPosts = opts.posts.filter((post) => includesNormalized(post.text, topic));
    const lastSeenAt = matchingFeedPosts.reduce<number | null>((latest, post) => {
      if (typeof post.timestamp !== "number") return latest;
      return latest == null || post.timestamp > latest ? post.timestamp : latest;
    }, null);

    const attestationPlan = buildMinimalAttestationPlan({
      topic,
      agent: "sentinel",
      minSupportingSources: 1,
    });
    const supportingBonus = attestationPlan.supporting.length * 3;
    const attestationPenalty = attestationPlan.ready ? 0 : 20;
    const contradictionSignals = detectContradictionSignals(matchingFeedPosts);
    const repeatedTopicPenalty = recentCoverageTopics.has(topic) ? recentCoveragePenalty : 0;

    if (matchingFeedPosts.length === 0) {
      opportunities.push({
        kind: "coverage_gap",
        topic,
        score: confidence + 20 + supportingBonus - attestationPenalty - repeatedTopicPenalty,
        rationale: "High-confidence signal is not covered in the recent feed.",
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
        score: confidence + 25 + supportingBonus - attestationPenalty - repeatedTopicPenalty,
        rationale: "Recent matching feed posts point in conflicting directions and need an evidence-bound synthesis.",
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
        score: confidence + 10 + supportingBonus - attestationPenalty - repeatedTopicPenalty,
        rationale: "Signal remains active but the most recent matching feed post is stale.",
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

function normalize(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}
