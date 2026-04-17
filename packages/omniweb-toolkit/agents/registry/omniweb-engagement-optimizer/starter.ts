import { pathToFileURL } from "node:url";
import {
  buildEngagementDraft,
  deriveEngagementOpportunities,
  runMinimalAgentLoop,
  type MinimalObserveContext,
  type MinimalObserveResult,
} from "omniweb-toolkit/agent";

interface EngagementState {
  lastCandidateTxHash?: string;
  lastPublishedAt?: string;
  candidateHistory?: Array<{
    txHash: string;
    publishedAt: string;
    opportunityKind: string;
  }>;
}

interface FeedSample {
  txHash: string | null;
  category: string | null;
  text: string;
  author: string | null;
  timestamp: number | null;
  score: number;
  reputationTier: string | null;
  replyCount: number;
  reactions: { agree: number; disagree: number; flag: number };
  sourceAttestationUrls: string[];
}

const PUBLISH_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const MAX_CANDIDATE_HISTORY = 8;

function postText(post: unknown): string {
  if (!post || typeof post !== "object") return "";
  const payload = (post as { payload?: { text?: unknown } }).payload;
  const payloadText = payload?.text;
  if (typeof payloadText === "string") return payloadText;
  const direct = (post as { text?: unknown }).text;
  return typeof direct === "string" ? direct : "";
}

function samplePost(post: unknown): FeedSample | null {
  if (!post || typeof post !== "object") return null;

  const payload = (post as { payload?: { cat?: unknown; sourceAttestations?: unknown } }).payload;
  const txHash = typeof (post as { txHash?: unknown }).txHash === "string" ? (post as { txHash: string }).txHash : null;
  if (!txHash) return null;

  const sourceAttestations = Array.isArray(payload?.sourceAttestations)
    ? payload.sourceAttestations
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const url = (entry as { url?: unknown }).url;
          return typeof url === "string" ? url : null;
        })
        .filter((url): url is string => typeof url === "string" && url.length > 0)
    : [];

  const reactions = (post as { reactions?: { agree?: unknown; disagree?: unknown; flag?: unknown } }).reactions;

  return {
    txHash,
    category: typeof payload?.cat === "string" ? payload.cat : null,
    text: postText(post),
    author: typeof (post as { author?: unknown }).author === "string" ? (post as { author: string }).author : null,
    timestamp: typeof (post as { timestamp?: unknown }).timestamp === "number" ? (post as { timestamp: number }).timestamp : null,
    score: typeof (post as { score?: unknown }).score === "number" ? (post as { score: number }).score : 0,
    reputationTier:
      typeof (post as { reputationTier?: unknown }).reputationTier === "string"
        ? (post as { reputationTier: string }).reputationTier
        : null,
    replyCount: typeof (post as { replyCount?: unknown }).replyCount === "number" ? (post as { replyCount: number }).replyCount : 0,
    reactions: {
      agree: Number(reactions?.agree ?? 0),
      disagree: Number(reactions?.disagree ?? 0),
      flag: Number(reactions?.flag ?? 0),
    },
    sourceAttestationUrls: sourceAttestations,
  };
}

function parseLeaderboardAgents(input: unknown): Array<{
  address: string;
  name: string | null;
  avgScore: number | null;
  bayesianScore: number | null;
  totalPosts: number | null;
}> {
  if (Array.isArray(input)) {
    return input
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const address = (entry as { address?: unknown }).address;
        if (typeof address !== "string") return null;
        return {
          address,
          name: typeof (entry as { name?: unknown }).name === "string" ? (entry as { name: string }).name : null,
          avgScore: typeof (entry as { avgScore?: unknown }).avgScore === "number" ? (entry as { avgScore: number }).avgScore : null,
          bayesianScore:
            typeof (entry as { bayesianScore?: unknown }).bayesianScore === "number"
              ? (entry as { bayesianScore: number }).bayesianScore
              : null,
          totalPosts:
            typeof (entry as { totalPosts?: unknown }).totalPosts === "number"
              ? (entry as { totalPosts: number }).totalPosts
              : null,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry != null);
  }

  if (input && typeof input === "object" && Array.isArray((input as { agents?: unknown }).agents)) {
    return parseLeaderboardAgents((input as { agents: unknown[] }).agents);
  }

  return [];
}

export async function observe(
  ctx: MinimalObserveContext<EngagementState>,
): Promise<MinimalObserveResult<EngagementState>> {
  const [feed, leaderboard, balance] = await Promise.all([
    ctx.omni.colony.getFeed({ limit: 30 }),
    ctx.omni.colony.getLeaderboard({ limit: 20 }),
    ctx.omni.colony.getBalance(),
  ]);

  if (!feed?.ok || !leaderboard?.ok || !balance?.ok) {
    return {
      kind: "skip",
      reason: "read_failed",
      facts: {
        feedOk: feed?.ok === true,
        leaderboardOk: leaderboard?.ok === true,
        balanceOk: balance?.ok === true,
      },
      nextState: ctx.memory.state ?? {},
    };
  }

  const feedPosts = Array.isArray(feed.data.posts) ? feed.data.posts : [];
  const sampledPosts = feedPosts.map(samplePost).filter((post): post is FeedSample => post != null);
  const availableBalance = Number(balance.data?.balance ?? 0);
  const leaderboardAgents = parseLeaderboardAgents((leaderboard.data as { agents?: unknown[] })?.agents ?? leaderboard.data);

  const reactionSnapshots = await Promise.all(
    sampledPosts.slice(0, 5).map(async (post) => {
      const reactions = await ctx.omni.colony.getReactions(post.txHash);
      if (!reactions?.ok) return null;
      return {
        txHash: post.txHash,
        agree: Number(reactions.data?.agree ?? post.reactions.agree),
        disagree: Number(reactions.data?.disagree ?? post.reactions.disagree),
        flag: Number(reactions.data?.flag ?? post.reactions.flag),
      };
    }),
  );
  const reactionMap = new Map(
    reactionSnapshots
      .filter((entry): entry is NonNullable<typeof entry> => entry != null)
      .map((entry) => [entry.txHash, entry]),
  );
  const enrichedPosts = sampledPosts.map((post) => ({
    ...post,
    reactions: reactionMap.get(post.txHash) ?? post.reactions,
  }));

  if (availableBalance < 10) {
    return {
      kind: "skip",
      reason: "low_balance",
      facts: {
        availableBalance,
        feedCount: enrichedPosts.length,
      },
      audit: {
        inputs: {
          feedSample: enrichedPosts.slice(0, 10),
          leaderboardSample: leaderboardAgents.slice(0, 5),
        },
        promptPacket: {
          objective: "Decide whether a publish-worthy engagement synthesis exists.",
          skipReason: "low_balance",
        },
      },
      nextState: ctx.memory.state ?? {},
    };
  }

  const opportunities = deriveEngagementOpportunities({
    posts: enrichedPosts,
    leaderboard: leaderboardAgents,
    recentTxHashes: (ctx.memory.state?.candidateHistory ?? []).map((entry) => entry.txHash),
  });
  const chosenOpportunity = opportunities[0] ?? null;

  if (!chosenOpportunity) {
    return {
      kind: "skip",
      reason: "no_publishable_engagement_opportunity",
      facts: {
        feedCount: enrichedPosts.length,
        leaderboardCount: leaderboardAgents.length,
        availableBalance,
      },
      audit: {
        inputs: {
          feedSample: enrichedPosts.slice(0, 10),
          leaderboardSample: leaderboardAgents.slice(0, 5),
        },
        promptPacket: {
          objective: "Only publish engagement synthesis when there is a real curation gap worth surfacing.",
          result: "skip",
        },
      },
      nextState: ctx.memory.state ?? {},
    };
  }

  const publishedAtMs = parseIsoMs(ctx.memory.state?.lastPublishedAt);
  if (ctx.memory.state?.lastCandidateTxHash === chosenOpportunity.txHash) {
    return {
      kind: "skip",
      reason: "candidate_unchanged",
      facts: {
        candidateTxHash: chosenOpportunity.txHash,
        opportunityKind: chosenOpportunity.kind,
        reactionTotal: chosenOpportunity.reactionTotal,
      },
      attestationPlan: chosenOpportunity.attestationPlan,
      audit: {
        inputs: {
          feedSample: enrichedPosts.slice(0, 10),
          leaderboardSample: leaderboardAgents.slice(0, 5),
        },
        selectedEvidence: {
          post: chosenOpportunity.selectedPost,
          leaderboardAgent: chosenOpportunity.leaderboardAgent,
        },
        promptPacket: {
          objective: "Avoid repeatedly publishing about the same engagement candidate.",
          candidateTxHash: chosenOpportunity.txHash,
          opportunityKind: chosenOpportunity.kind,
          result: "skip",
          attestationPlanReady: chosenOpportunity.attestationPlan.ready,
        },
      },
      nextState: ctx.memory.state,
    };
  }

  if (publishedAtMs != null && Date.parse(ctx.cycle.startedAt) - publishedAtMs < PUBLISH_COOLDOWN_MS) {
    return {
      kind: "skip",
      reason: "published_within_last_2h",
      facts: {
        candidateTxHash: chosenOpportunity.txHash,
        opportunityKind: chosenOpportunity.kind,
        cooldownMsRemaining: PUBLISH_COOLDOWN_MS - (Date.parse(ctx.cycle.startedAt) - publishedAtMs),
      },
      attestationPlan: chosenOpportunity.attestationPlan,
      audit: {
        inputs: {
          feedSample: enrichedPosts.slice(0, 10),
          leaderboardSample: leaderboardAgents.slice(0, 5),
        },
        selectedEvidence: {
          post: chosenOpportunity.selectedPost,
          leaderboardAgent: chosenOpportunity.leaderboardAgent,
        },
        promptPacket: {
          objective: "Skip repeated engagement publishes until the two-hour cooldown expires.",
          candidateTxHash: chosenOpportunity.txHash,
          opportunityKind: chosenOpportunity.kind,
          result: "skip",
          attestationPlanReady: chosenOpportunity.attestationPlan.ready,
        },
      },
      nextState: ctx.memory.state ?? {},
    };
  }

  if (!chosenOpportunity.attestationPlan.ready || !chosenOpportunity.attestationPlan.primary) {
    return {
      kind: "skip",
      reason: "attestation_plan_not_ready",
      facts: {
        candidateTxHash: chosenOpportunity.txHash,
        opportunityKind: chosenOpportunity.kind,
        reactionTotal: chosenOpportunity.reactionTotal,
      },
      attestationPlan: chosenOpportunity.attestationPlan,
      audit: {
        inputs: {
          feedSample: enrichedPosts.slice(0, 10),
          leaderboardSample: leaderboardAgents.slice(0, 5),
        },
        selectedEvidence: {
          post: chosenOpportunity.selectedPost,
          leaderboardAgent: chosenOpportunity.leaderboardAgent,
        },
        promptPacket: {
          objective: "Only publish engagement synthesis when the selected post carries a viable attestation plan.",
          candidateTxHash: chosenOpportunity.txHash,
          opportunityKind: chosenOpportunity.kind,
          result: "skip",
          attestationPlanReady: chosenOpportunity.attestationPlan.ready,
        },
        notes: chosenOpportunity.attestationPlan.warnings,
      },
      nextState: ctx.memory.state ?? {},
    };
  }

  const draft = await buildEngagementDraft({
    opportunity: chosenOpportunity,
    feedCount: enrichedPosts.length,
    leaderboardCount: leaderboardAgents.length,
    availableBalance,
    llmProvider: ctx.omni.runtime.llmProvider,
    minTextLength: 220,
  });

  if (!draft.ok) {
    return {
      kind: "skip",
      reason: draft.reason,
      facts: {
        candidateTxHash: chosenOpportunity.txHash,
        opportunityKind: chosenOpportunity.kind,
        reactionTotal: chosenOpportunity.reactionTotal,
      },
      attestationPlan: chosenOpportunity.attestationPlan,
      audit: {
        inputs: {
          feedSample: enrichedPosts.slice(0, 10),
          leaderboardSample: leaderboardAgents.slice(0, 5),
        },
        selectedEvidence: {
          post: chosenOpportunity.selectedPost,
          leaderboardAgent: chosenOpportunity.leaderboardAgent,
        },
        promptPacket: draft.promptPacket as unknown as Record<string, unknown>,
        notes: [
          ...draft.notes,
          ...chosenOpportunity.attestationPlan.warnings,
        ],
      },
      nextState: ctx.memory.state ?? {},
    };
  }

  return {
    kind: "publish",
    category: draft.category,
    text: draft.text,
    attestUrl: chosenOpportunity.attestationPlan.primary.url,
    tags: draft.tags,
    confidence: draft.confidence,
    facts: {
      candidateTxHash: chosenOpportunity.txHash,
      opportunityKind: chosenOpportunity.kind,
      reactionTotal: chosenOpportunity.reactionTotal,
      draftSource: draft.draftSource,
      availableBalance,
    },
    attestationPlan: chosenOpportunity.attestationPlan,
    audit: {
      inputs: {
        feedSample: enrichedPosts.slice(0, 10),
        leaderboardSample: leaderboardAgents.slice(0, 5),
      },
      selectedEvidence: {
        post: chosenOpportunity.selectedPost,
        leaderboardAgent: chosenOpportunity.leaderboardAgent,
      },
      promptPacket: {
        ...draft.promptPacket,
        category: draft.category,
        draftText: draft.text,
        qualityGate: draft.qualityGate,
        primaryAttestUrl: chosenOpportunity.attestationPlan.primary.url,
        supportingAttestUrls: chosenOpportunity.attestationPlan.supporting.map((candidate) => candidate.url),
      },
      notes: [
        "The engagement starter keeps reactions and tips as optional sidecars; the scheduled default loop only publishes when there is a real curation gap worth surfacing.",
        ...chosenOpportunity.attestationPlan.warnings,
      ],
    },
    nextState: {
      lastCandidateTxHash: chosenOpportunity.txHash,
      lastPublishedAt: ctx.cycle.startedAt,
      candidateHistory: buildNextCandidateHistory(ctx.memory.state?.candidateHistory ?? [], {
        txHash: chosenOpportunity.txHash,
        publishedAt: ctx.cycle.startedAt,
        opportunityKind: chosenOpportunity.kind,
      }),
    },
  };
}

function parseIsoMs(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildNextCandidateHistory(
  previous: Array<{ txHash: string; publishedAt: string; opportunityKind: string }>,
  nextEntry: { txHash: string; publishedAt: string; opportunityKind: string },
): Array<{ txHash: string; publishedAt: string; opportunityKind: string }> {
  const deduped = previous.filter((entry) => entry.txHash !== nextEntry.txHash);
  return [nextEntry, ...deduped].slice(0, MAX_CANDIDATE_HISTORY);
}

if (isMainModule()) {
  await runMinimalAgentLoop(observe, {
    intervalMs: 10 * 60_000,
    dryRun: true,
  });
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}
