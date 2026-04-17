import { buildMinimalAttestationPlanFromUrls, type MinimalAttestationPlan } from "./minimal-attestation-plan.js";

export interface EngagementPostInput {
  txHash: string;
  category: string | null;
  text: string;
  author: string | null;
  timestamp: number | null;
  score: number;
  reputationTier: string | null;
  replyCount: number;
  reactions: {
    agree: number;
    disagree: number;
    flag: number;
  };
  sourceAttestationUrls: string[];
}

export interface EngagementLeaderboardInput {
  address: string;
  name: string | null;
  avgScore: number | null;
  bayesianScore: number | null;
  totalPosts: number | null;
}

export interface DeriveEngagementOpportunitiesOptions {
  posts: EngagementPostInput[];
  leaderboard: EngagementLeaderboardInput[];
  recentTxHashes?: string[];
  minQualityScore?: number;
  maxReactionTotal?: number;
}

export interface EngagementOpportunity {
  kind: "newcomer_spotlight" | "under_engaged_attested";
  txHash: string;
  score: number;
  rationale: string;
  selectedPost: EngagementPostInput;
  leaderboardAgent: EngagementLeaderboardInput | null;
  reactionTotal: number;
  attestationPlan: MinimalAttestationPlan;
}

const DEFAULT_MIN_QUALITY_SCORE = 60;
const DEFAULT_MAX_REACTION_TOTAL = 3;
const NEWCOMER_BONUS = 12;
const UNDERREACTION_BONUS = 10;

export function deriveEngagementOpportunities(
  opts: DeriveEngagementOpportunitiesOptions,
): EngagementOpportunity[] {
  const minQualityScore = opts.minQualityScore ?? DEFAULT_MIN_QUALITY_SCORE;
  const maxReactionTotal = opts.maxReactionTotal ?? DEFAULT_MAX_REACTION_TOTAL;
  const recentTxHashes = new Set((opts.recentTxHashes ?? []).filter(Boolean));
  const opportunities: EngagementOpportunity[] = [];

  for (const post of opts.posts) {
    if (!post.txHash || recentTxHashes.has(post.txHash)) continue;
    if (post.score < minQualityScore) continue;

    const reactionTotal = post.reactions.agree + post.reactions.disagree + post.reactions.flag;
    if (reactionTotal >= maxReactionTotal) continue;
    if (post.sourceAttestationUrls.length === 0) continue;

    const leaderboardAgent = selectLeaderboardAgent(opts.leaderboard, post.author);
    const attestationPlan = buildMinimalAttestationPlanFromUrls({
      topic: `engagement spotlight ${post.txHash}`,
      urls: post.sourceAttestationUrls,
      minSupportingSources: 0,
    });

    const baseScore = post.score + Math.max(0, maxReactionTotal - reactionTotal) * UNDERREACTION_BONUS;
    const leaderboardBonus = Math.max(0, Math.round((leaderboardAgent?.bayesianScore ?? 0) / 20));

    if (isNewcomer(post.reputationTier)) {
      opportunities.push({
        kind: "newcomer_spotlight",
        txHash: post.txHash,
        score: baseScore + NEWCOMER_BONUS + leaderboardBonus,
        rationale: "A newcomer attested post is under-engaged and worth a curation spotlight before the colony misses it.",
        selectedPost: post,
        leaderboardAgent,
        reactionTotal,
        attestationPlan,
      });
      continue;
    }

    opportunities.push({
      kind: "under_engaged_attested",
      txHash: post.txHash,
      score: baseScore + leaderboardBonus,
      rationale: "An attested high-quality post is not getting enough engagement and deserves a synthesis spotlight.",
      selectedPost: post,
      leaderboardAgent,
      reactionTotal,
      attestationPlan,
    });
  }

  opportunities.sort((left, right) => right.score - left.score);
  return opportunities;
}

function selectLeaderboardAgent(
  leaderboard: EngagementLeaderboardInput[],
  author: string | null,
): EngagementLeaderboardInput | null {
  if (!author) return null;
  return leaderboard.find((agent) => agent.address === author) ?? null;
}

function isNewcomer(value: string | null): boolean {
  const normalized = (value ?? "").toLowerCase();
  return normalized.includes("new");
}
