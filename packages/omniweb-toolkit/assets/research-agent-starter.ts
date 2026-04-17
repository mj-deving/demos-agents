import { pathToFileURL } from "node:url";
import {
  buildResearchDraft,
  deriveResearchOpportunities,
  runMinimalAgentLoop,
  type MinimalObserveContext,
  type MinimalObserveResult,
} from "omniweb-toolkit/agent";

interface ResearchState {
  lastCoverageTopic?: string;
  lastPublishedAt?: string;
  topicHistory?: Array<{
    topic: string;
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
}

const PUBLISH_COOLDOWN_MS = 60 * 60 * 1000;
const MAX_TOPIC_HISTORY = 5;

function signalTopic(signal: unknown): string | null {
  if (!signal || typeof signal !== "object") return null;
  const candidate = (signal as { shortTopic?: unknown; topic?: unknown }).shortTopic
    ?? (signal as { shortTopic?: unknown; topic?: unknown }).topic;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function signalConfidence(signal: unknown): number | null {
  if (!signal || typeof signal !== "object") return null;
  const candidate = (signal as { confidence?: unknown }).confidence;
  return typeof candidate === "number" ? candidate : null;
}

function postText(post: unknown): string {
  if (!post || typeof post !== "object") return "";
  const payload = (post as { payload?: { text?: unknown } }).payload;
  const payloadText = payload?.text;
  if (typeof payloadText === "string") return payloadText;
  const direct = (post as { text?: unknown }).text;
  return typeof direct === "string" ? direct : "";
}

function samplePost(post: unknown): FeedSample {
  if (!post || typeof post !== "object") {
    return {
      txHash: null,
      category: null,
      text: "",
      author: null,
      timestamp: null,
    };
  }

  const payload = (post as { payload?: { cat?: unknown } }).payload;
  return {
    txHash: typeof (post as { txHash?: unknown }).txHash === "string" ? (post as { txHash: string }).txHash : null,
    category: typeof payload?.cat === "string" ? payload.cat : null,
    text: postText(post),
    author: typeof (post as { author?: unknown }).author === "string" ? (post as { author: string }).author : null,
    timestamp: typeof (post as { timestamp?: unknown }).timestamp === "number" ? (post as { timestamp: number }).timestamp : null,
  };
}

export async function observe(
  ctx: MinimalObserveContext<ResearchState>,
): Promise<MinimalObserveResult<ResearchState>> {
  const [feed, signals, leaderboard, balance] = await Promise.all([
    ctx.omni.colony.getFeed({ limit: 30 }),
    ctx.omni.colony.getSignals(),
    ctx.omni.colony.getLeaderboard({ limit: 10 }),
    ctx.omni.colony.getBalance(),
  ]);

  if (!feed?.ok || !signals?.ok || !leaderboard?.ok || !balance?.ok) {
    return {
      kind: "skip",
      reason: "read_failed",
      facts: {
        feedOk: feed?.ok === true,
        signalsOk: signals?.ok === true,
        leaderboardOk: leaderboard?.ok === true,
        balanceOk: balance?.ok === true,
      },
      nextState: ctx.memory.state ?? {},
    };
  }

  const posts = Array.isArray(feed.data.posts) ? feed.data.posts : [];
  const signalList = Array.isArray(signals.data) ? signals.data : [];
  const availableBalance = Number(balance.data?.balance ?? 0);
  const feedSample = posts.slice(0, 10).map(samplePost);
  const signalSample = signalList.slice(0, 10).map((signal) => ({
    topic: signalTopic(signal),
    confidence: signalConfidence(signal),
    direction:
      signal && typeof signal === "object" && typeof (signal as { direction?: unknown }).direction === "string"
        ? (signal as { direction: string }).direction
        : null,
  }));

  if (availableBalance < 10 || signalList.length === 0) {
    return {
      kind: "skip",
      reason: availableBalance < 10 ? "low_balance" : "no_signals",
      facts: {
        availableBalance,
        signalCount: signalList.length,
      },
      audit: {
        inputs: {
          feedSample,
          signalSample,
          leaderboardSample: Array.isArray(leaderboard.data) ? leaderboard.data.slice(0, 5) : [],
        },
        promptPacket: {
          objective: "Decide whether a research publish is justified from current signals and feed coverage.",
          skipReason: availableBalance < 10 ? "low_balance" : "no_signals",
        },
      },
      nextState: ctx.memory.state ?? {},
    };
  }

  const opportunities = deriveResearchOpportunities({
    signals: signalSample,
    posts: feedSample,
    lastCoverageTopic: ctx.memory.state?.lastCoverageTopic ?? null,
    recentCoverageTopics: (ctx.memory.state?.topicHistory ?? []).map((entry) => entry.topic),
  });
  const chosenOpportunity = opportunities[0] ?? null;
  const topic = chosenOpportunity?.topic ?? null;
  if (!topic) {
    return {
      kind: "skip",
      reason: "no_publishable_research_opportunity",
      facts: {
        signalCount: signalList.length,
        feedCount: posts.length,
      },
      audit: {
        inputs: {
          feedSample,
          signalSample,
          leaderboardSample: Array.isArray(leaderboard.data) ? leaderboard.data.slice(0, 5) : [],
        },
        selectedEvidence: {
          matchedSignal: null,
          feedMentions: [],
        },
        promptPacket: {
          objective: "Find a publishable research opportunity grounded in current signals, feed drift, and attestation viability.",
          result: "skip",
        },
      },
      nextState: ctx.memory.state ?? {},
    };
  }

  const matchingFeedPosts = chosenOpportunity.matchingFeedPosts;
  const matchedSignal = {
    topic: chosenOpportunity.matchedSignal.topic,
    confidence: chosenOpportunity.matchedSignal.confidence,
    direction: chosenOpportunity.matchedSignal.direction,
    shortTopic: chosenOpportunity.matchedSignal.topic,
  };
  const attestationPlan = chosenOpportunity.attestationPlan;
  const publishedAtMs = parseIsoMs(ctx.memory.state?.lastPublishedAt);

  if (ctx.memory.state?.lastCoverageTopic === topic) {
    return {
      kind: "skip",
      reason: "coverage_gap_unchanged",
      facts: {
        topic,
        lastPublishedAt: ctx.memory.state.lastPublishedAt ?? null,
      },
      audit: {
        inputs: {
          feedSample,
          signalSample,
          leaderboardSample: Array.isArray(leaderboard.data) ? leaderboard.data.slice(0, 5) : [],
        },
        selectedEvidence: {
          matchedSignal,
          feedMentions: matchingFeedPosts,
        },
        promptPacket: {
          objective: "Avoid repeating the same research coverage gap too soon.",
          topic,
          result: "skip",
          attestationPlanReady: attestationPlan.ready,
        },
      },
      nextState: ctx.memory.state,
    };
  }

  if (publishedAtMs != null && Date.parse(ctx.cycle.startedAt) - publishedAtMs < PUBLISH_COOLDOWN_MS) {
    return {
      kind: "skip",
      reason: "published_within_last_hour",
      facts: {
        topic,
        lastPublishedAt: ctx.memory.state?.lastPublishedAt ?? null,
        cooldownMsRemaining: PUBLISH_COOLDOWN_MS - (Date.parse(ctx.cycle.startedAt) - publishedAtMs),
      },
      attestationPlan,
      audit: {
        inputs: {
          feedSample,
          signalSample,
          leaderboardSample: Array.isArray(leaderboard.data) ? leaderboard.data.slice(0, 5) : [],
        },
        selectedEvidence: {
          matchedSignal,
          feedMentions: matchingFeedPosts,
        },
        promptPacket: {
          objective: "Skip repeated research publishes until the one-hour cooldown expires.",
          topic,
          opportunityKind: chosenOpportunity.kind,
          rationale: chosenOpportunity.rationale,
          result: "skip",
          attestationPlanReady: attestationPlan.ready,
        },
      },
      nextState: ctx.memory.state ?? {},
    };
  }

  if (!attestationPlan.ready || !attestationPlan.primary) {
    return {
      kind: "skip",
      reason: "attestation_plan_not_ready",
      facts: {
        topic,
        signalCount: signalList.length,
        feedCount: posts.length,
        availableBalance,
        opportunityKind: chosenOpportunity.kind,
      },
      attestationPlan,
      audit: {
        inputs: {
          feedSample,
          signalSample,
          leaderboardSample: Array.isArray(leaderboard.data) ? leaderboard.data.slice(0, 5) : [],
        },
        selectedEvidence: {
          matchedSignal,
          feedMentions: matchingFeedPosts,
        },
        promptPacket: {
          objective: "Only publish when the claim has a viable primary plus supporting attestation plan.",
          topic,
          opportunityKind: chosenOpportunity.kind,
          rationale: chosenOpportunity.rationale,
          result: "skip",
          attestationPlanReady: attestationPlan.ready,
        },
        notes: attestationPlan.warnings,
      },
      nextState: ctx.memory.state ?? {},
    };
  }

  const draft = await buildResearchDraft({
    opportunity: chosenOpportunity,
    feedCount: posts.length,
    leaderboardCount: Array.isArray(leaderboard.data) ? leaderboard.data.length : 0,
    availableBalance,
    llmProvider: ctx.omni.runtime.llmProvider,
    minTextLength: 300,
  });

  if (!draft.ok) {
    return {
      kind: "skip",
      reason: draft.reason,
      facts: {
        topic,
        signalCount: signalList.length,
        feedCount: posts.length,
        availableBalance,
        opportunityKind: chosenOpportunity.kind,
        opportunityScore: chosenOpportunity.score,
      },
      attestationPlan,
      audit: {
        inputs: {
          feedSample,
          signalSample,
          leaderboardSample: Array.isArray(leaderboard.data) ? leaderboard.data.slice(0, 5) : [],
        },
        selectedEvidence: {
          matchedSignal,
          feedMentions: matchingFeedPosts,
        },
        promptPacket: draft.promptPacket as unknown as Record<string, unknown>,
        notes: [
          ...draft.notes,
          ...attestationPlan.warnings,
        ],
      },
      nextState: ctx.memory.state ?? {},
    };
  }

  return {
    kind: "publish",
    category: draft.category,
    text: draft.text,
    attestUrl: attestationPlan.primary.url,
    tags: draft.tags,
    confidence: draft.confidence,
    facts: {
      topic,
      signalCount: signalList.length,
      feedCount: posts.length,
      availableBalance,
      opportunityKind: chosenOpportunity.kind,
      opportunityScore: chosenOpportunity.score,
      draftSource: draft.draftSource,
    },
    attestationPlan,
    audit: {
      inputs: {
        feedSample,
        signalSample,
        leaderboardSample: Array.isArray(leaderboard.data) ? leaderboard.data.slice(0, 5) : [],
      },
      selectedEvidence: {
        matchedSignal,
        feedMentions: matchingFeedPosts,
      },
      promptPacket: {
        ...draft.promptPacket,
        category: draft.category,
        draftText: draft.text,
        qualityGate: draft.qualityGate,
        primaryAttestUrl: attestationPlan.primary.url,
        supportingAttestUrls: attestationPlan.supporting.map((candidate) => candidate.url),
      },
      notes: [
        "This starter now persists reduced raw inputs, selected evidence, the prompt packet, and the attestation plan for operator audit.",
        ...attestationPlan.warnings,
      ],
    },
    nextState: {
      lastCoverageTopic: topic,
      lastPublishedAt: ctx.cycle.startedAt,
      topicHistory: buildNextTopicHistory(ctx.memory.state?.topicHistory ?? [], {
        topic,
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

function buildNextTopicHistory(
  previous: Array<{ topic: string; publishedAt: string; opportunityKind: string }>,
  nextEntry: { topic: string; publishedAt: string; opportunityKind: string },
): Array<{ topic: string; publishedAt: string; opportunityKind: string }> {
  const deduped = previous.filter((entry) => entry.topic !== nextEntry.topic);
  return [nextEntry, ...deduped].slice(0, MAX_TOPIC_HISTORY);
}

if (isMainModule()) {
  await runMinimalAgentLoop(observe, {
    intervalMs: 15 * 60_000,
    dryRun: true,
  });
}

// Before enabling live writes, run check-attestation-workflow.ts with the
// primary and supporting URLs so the evidence chain is stronger than one
// placeholder URL.

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}
