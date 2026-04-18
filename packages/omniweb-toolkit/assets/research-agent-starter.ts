import { pathToFileURL } from "node:url";
import {
  buildResearchDraft,
  buildResearchEvidenceDelta,
  fetchResearchEvidenceSummary,
  deriveResearchOpportunities,
  runMinimalAgentLoop,
  summarizeResearchEvidenceDelta,
  type MinimalObserveContext,
  type MinimalObserveResult,
} from "omniweb-toolkit/agent";

interface ResearchState {
  lastCoverageTopic?: string;
  lastPublishedAt?: string;
  lastResearchSnapshot?: {
    topic: string;
    observedAt: string;
    evidenceValues: Record<string, string>;
    derivedMetrics: {
      highConfidenceSignalCount: number;
      coverageGapCount: number;
      contradictionCount: number;
      staleTopicCount: number;
      feedCoverageRatio: number | null;
    };
  };
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

interface ReadResult<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
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
  const [feed, signals, leaderboard, balance] = await Promise.allSettled([
    ctx.omni.colony.getFeed({ limit: 30 }),
    ctx.omni.colony.getSignals(),
    ctx.omni.colony.getLeaderboard({ limit: 10 }),
    ctx.omni.colony.getBalance(),
  ]);

  const feedRead = unwrapReadResult(feed);
  const signalsRead = unwrapReadResult(signals);
  const leaderboardRead = unwrapReadResult(leaderboard);
  const balanceRead = unwrapReadResult(balance);
  const readStatus = {
    feed: describeReadStatus(feedRead),
    signals: describeReadStatus(signalsRead),
    leaderboard: describeReadStatus(leaderboardRead),
    balance: describeReadStatus(balanceRead),
  };

  if (!feedRead.ok || !signalsRead.ok || !balanceRead.ok) {
    return {
      kind: "skip",
      reason: "read_failed",
      facts: {
        ...readStatus,
      },
      audit: {
        promptPacket: {
          objective: "Continue only when the research loop has the core reads it needs: feed, signals, and balance.",
          readStatus,
        },
      },
      nextState: ctx.memory.state ?? {},
    };
  }

  const posts = extractFeedPosts(feedRead.data);
  const signalList = extractSignalList(signalsRead.data);
  const leaderboardAgents = extractLeaderboardAgents(leaderboardRead.data);
  const availableBalance = extractAvailableBalance(balanceRead.data);
  const feedSample = posts.slice(0, 10).map(samplePost);
  const signalSample = signalList.slice(0, 10).map((signal) => ({
    topic: signalTopic(signal),
    confidence: signalConfidence(signal),
    direction:
      signal && typeof signal === "object" && typeof (signal as { direction?: unknown }).direction === "string"
        ? (signal as { direction: string }).direction
        : null,
  }));
  const highConfidenceSignals = signalSample.filter((signal) => (signal.confidence ?? 0) >= 70);

  if (availableBalance < 10 || signalList.length === 0) {
    return {
      kind: "skip",
      reason: availableBalance < 10 ? "low_balance" : "no_signals",
      facts: {
        availableBalance,
        signalCount: signalList.length,
        ...readStatus,
      },
      audit: {
        inputs: {
          feedSample,
          signalSample,
          leaderboardSample: leaderboardAgents.slice(0, 5),
        },
        promptPacket: {
          objective: "Decide whether a research publish is justified from current signals and feed coverage.",
          skipReason: availableBalance < 10 ? "low_balance" : "no_signals",
          readStatus,
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
  const derivedMetrics = {
    highConfidenceSignalCount: highConfidenceSignals.length,
    coverageGapCount: opportunities.filter((opportunity) => opportunity.kind === "coverage_gap").length,
    contradictionCount: opportunities.filter((opportunity) => opportunity.kind === "contradiction").length,
    staleTopicCount: opportunities.filter((opportunity) => opportunity.kind === "stale_topic").length,
    feedCoverageRatio: highConfidenceSignals.length === 0
      ? null
      : Number(
          (
            (highConfidenceSignals.length
              - opportunities.filter((opportunity) => opportunity.kind === "coverage_gap").length)
            / highConfidenceSignals.length
          ).toFixed(3),
        ),
  };
  const chosenOpportunity = opportunities[0] ?? null;
  const topic = chosenOpportunity?.topic ?? null;
  if (!topic) {
    return {
      kind: "skip",
      reason: "no_publishable_research_opportunity",
      facts: {
        signalCount: signalList.length,
        feedCount: posts.length,
        ...derivedMetrics,
        ...readStatus,
      },
      audit: {
        inputs: {
          feedSample,
          signalSample,
          leaderboardSample: leaderboardAgents.slice(0, 5),
        },
        selectedEvidence: {
          matchedSignal: null,
          feedMentions: [],
        },
        promptPacket: {
          objective: "Find a publishable research opportunity grounded in current signals, feed drift, and attestation viability.",
          derivedMetrics,
          readStatus,
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
  const sourceProfile = chosenOpportunity.sourceProfile;
  const publishedAtMs = parseIsoMs(ctx.memory.state?.lastPublishedAt);

  if (publishedAtMs != null && Date.parse(ctx.cycle.startedAt) - publishedAtMs < PUBLISH_COOLDOWN_MS) {
    return {
      kind: "skip",
      reason: "published_within_last_hour",
      facts: {
        topic,
        lastPublishedAt: ctx.memory.state?.lastPublishedAt ?? null,
        cooldownMsRemaining: PUBLISH_COOLDOWN_MS - (Date.parse(ctx.cycle.startedAt) - publishedAtMs),
        ...derivedMetrics,
        ...readStatus,
      },
      attestationPlan,
      audit: {
        inputs: {
          feedSample,
          signalSample,
          leaderboardSample: leaderboardAgents.slice(0, 5),
        },
        selectedEvidence: {
          matchedSignal,
          feedMentions: matchingFeedPosts,
          sourceProfile,
        },
        promptPacket: {
          objective: "Skip repeated research publishes until the one-hour cooldown expires.",
          topic,
          opportunityKind: chosenOpportunity.kind,
          derivedMetrics,
          readStatus,
          result: "skip",
          attestationPlanReady: attestationPlan.ready,
        },
      },
      nextState: ctx.memory.state ?? {},
    };
  }

  if (!sourceProfile.supported) {
    return {
      kind: "skip",
      reason: "research_family_not_ready",
      facts: {
        topic,
        researchFamily: sourceProfile.family,
        sourceProfileReason: sourceProfile.reason,
        signalCount: signalList.length,
        feedCount: posts.length,
        availableBalance,
        opportunityKind: chosenOpportunity.kind,
        ...derivedMetrics,
        ...readStatus,
      },
      attestationPlan,
      audit: {
        inputs: {
          feedSample,
          signalSample,
          leaderboardSample: leaderboardAgents.slice(0, 5),
        },
        selectedEvidence: {
          matchedSignal,
          feedMentions: matchingFeedPosts,
          sourceProfile,
        },
        promptPacket: {
          objective: "Only prompt when the research topic maps to a supported evidence family with attestation-ready sources.",
          topic,
          opportunityKind: chosenOpportunity.kind,
          researchFamily: sourceProfile.family,
          sourceProfileReason: sourceProfile.reason,
          derivedMetrics,
          readStatus,
          result: "skip",
        },
        notes: [
          ...attestationPlan.warnings,
        ],
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
        researchFamily: sourceProfile.family,
        signalCount: signalList.length,
        feedCount: posts.length,
        availableBalance,
        opportunityKind: chosenOpportunity.kind,
        ...derivedMetrics,
        ...readStatus,
      },
      attestationPlan,
      audit: {
        inputs: {
          feedSample,
          signalSample,
          leaderboardSample: leaderboardAgents.slice(0, 5),
        },
        selectedEvidence: {
          matchedSignal,
          feedMentions: matchingFeedPosts,
          sourceProfile,
        },
        promptPacket: {
          objective: "Only publish when the claim has a viable primary plus supporting attestation plan.",
          topic,
          opportunityKind: chosenOpportunity.kind,
          researchFamily: sourceProfile.family,
          derivedMetrics,
          readStatus,
          result: "skip",
          attestationPlanReady: attestationPlan.ready,
        },
        notes: attestationPlan.warnings,
      },
      nextState: ctx.memory.state ?? {},
    };
  }

  const evidenceReads = await Promise.allSettled([
    fetchResearchEvidenceSummary({
      source: attestationPlan.primary,
      topic,
    }),
    ...attestationPlan.supporting.map((source) =>
      fetchResearchEvidenceSummary({
        source,
        topic,
      })),
  ]);
  const primaryEvidenceRead = evidenceReads[0];
  const supportingEvidenceReads = evidenceReads.slice(1);
  const evidenceSummaryResult = primaryEvidenceRead?.status === "fulfilled"
    ? primaryEvidenceRead.value
    : {
      ok: false as const,
      reason: "fetch_failed" as const,
      note: primaryEvidenceRead?.status === "rejected"
        ? `Primary evidence fetch failed for ${attestationPlan.primary.name}: ${String(primaryEvidenceRead.reason)}`
        : `Primary evidence fetch failed for ${attestationPlan.primary.name}.`,
    };
  const supportingEvidenceSummaries = supportingEvidenceReads.flatMap((entry) =>
    entry.status === "fulfilled" && entry.value.ok ? [entry.value.summary] : []);
  const supportingEvidenceNotes = supportingEvidenceReads.flatMap((entry, index) => {
    const source = attestationPlan.supporting[index];
    if (!source) return [];
    if (entry.status === "rejected") {
      return [`Supporting evidence fetch failed for ${source.name}: ${String(entry.reason)}`];
    }
    if (!entry.value.ok) {
      return [`Supporting evidence fetch skipped for ${source.name}: ${entry.value.note}`];
    }
    return [];
  });

  if (!evidenceSummaryResult.ok) {
    return {
      kind: "skip",
      reason: "evidence_summary_not_ready",
      facts: {
        topic,
        researchFamily: sourceProfile.family,
        signalCount: signalList.length,
        feedCount: posts.length,
        availableBalance,
        opportunityKind: chosenOpportunity.kind,
        ...derivedMetrics,
        ...readStatus,
      },
      attestationPlan,
      audit: {
        inputs: {
          feedSample,
          signalSample,
          leaderboardSample: leaderboardAgents.slice(0, 5),
        },
        selectedEvidence: {
          matchedSignal,
          feedMentions: matchingFeedPosts,
          sourceProfile,
          evidenceSummary: null,
          supportingEvidenceSummaries: [],
        },
        promptPacket: {
          objective: "Only prompt from real fetched evidence, not just topic labels and source names.",
          topic,
          opportunityKind: chosenOpportunity.kind,
          researchFamily: sourceProfile.family,
          derivedMetrics,
          readStatus,
          result: "skip",
          attestationPlanReady: attestationPlan.ready,
        },
        notes: [
          evidenceSummaryResult.note,
          ...supportingEvidenceNotes,
          ...attestationPlan.warnings,
        ],
      },
      nextState: ctx.memory.state ?? {},
    };
  }

  const previousSnapshot = ctx.memory.state?.lastResearchSnapshot;
  const evidenceDelta = buildResearchEvidenceDelta(
    previousSnapshot?.topic === topic ? previousSnapshot.evidenceValues : null,
    evidenceSummaryResult.summary.values,
  );
  const deltaSummary = summarizeResearchEvidenceDelta(evidenceDelta);

  if (previousSnapshot?.topic === topic && !deltaSummary.hasMeaningfulChange) {
    return {
      kind: "skip",
      reason: "values_within_normal_range",
      facts: {
        topic,
        researchFamily: sourceProfile.family,
        signalCount: signalList.length,
        feedCount: posts.length,
        availableBalance,
        opportunityKind: chosenOpportunity.kind,
        ...derivedMetrics,
        ...readStatus,
      },
      attestationPlan,
      audit: {
        inputs: {
          feedSample,
          signalSample,
          leaderboardSample: leaderboardAgents.slice(0, 5),
        },
        selectedEvidence: {
          matchedSignal,
          feedMentions: matchingFeedPosts,
          sourceProfile,
          evidenceSummary: evidenceSummaryResult.summary,
          supportingEvidenceSummaries,
          evidenceDelta,
        },
        promptPacket: {
          objective: "Skip when the same research topic has not moved meaningfully since the last cycle.",
          topic,
          opportunityKind: chosenOpportunity.kind,
          researchFamily: sourceProfile.family,
          derivedMetrics,
          readStatus,
          deltaSummary,
          result: "skip",
        },
      },
      nextState: {
        ...(ctx.memory.state ?? {}),
        lastResearchSnapshot: {
          topic,
          observedAt: ctx.cycle.startedAt,
          evidenceValues: evidenceSummaryResult.summary.values,
          derivedMetrics,
        },
      },
    };
  }

  const draft = await buildResearchDraft({
    opportunity: chosenOpportunity,
    feedCount: posts.length,
    leaderboardCount: leaderboardAgents.length,
    availableBalance,
    evidenceSummary: evidenceSummaryResult.summary,
    supportingEvidenceSummaries,
    llmProvider: ctx.omni.runtime.llmProvider,
    minTextLength: 300,
  });

  if (!draft.ok) {
    return {
      kind: "skip",
      reason: draft.reason,
      facts: {
        topic,
        researchFamily: sourceProfile.family,
        signalCount: signalList.length,
        feedCount: posts.length,
        availableBalance,
        opportunityKind: chosenOpportunity.kind,
        opportunityScore: chosenOpportunity.score,
        ...derivedMetrics,
        ...readStatus,
      },
      attestationPlan,
      audit: {
        inputs: {
          feedSample,
          signalSample,
          leaderboardSample: leaderboardAgents.slice(0, 5),
        },
        selectedEvidence: {
          matchedSignal,
          feedMentions: matchingFeedPosts,
          sourceProfile,
          evidenceSummary: evidenceSummaryResult.summary,
          supportingEvidenceSummaries,
          evidenceDelta,
        },
        promptPacket: draft.promptPacket as unknown as Record<string, unknown>,
        notes: [
          ...draft.notes,
          ...supportingEvidenceNotes,
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
      researchFamily: sourceProfile.family,
      signalCount: signalList.length,
      feedCount: posts.length,
      availableBalance,
      opportunityKind: chosenOpportunity.kind,
      opportunityScore: chosenOpportunity.score,
      draftSource: draft.draftSource,
      ...derivedMetrics,
      ...readStatus,
    },
    attestationPlan,
    audit: {
      inputs: {
        feedSample,
        signalSample,
        leaderboardSample: leaderboardAgents.slice(0, 5),
      },
      selectedEvidence: {
        matchedSignal,
        feedMentions: matchingFeedPosts,
        sourceProfile,
        evidenceSummary: evidenceSummaryResult.summary,
        supportingEvidenceSummaries,
        evidenceDelta,
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
        ...supportingEvidenceNotes,
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
      lastResearchSnapshot: {
        topic,
        observedAt: ctx.cycle.startedAt,
        evidenceValues: evidenceSummaryResult.summary.values,
        derivedMetrics,
      },
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

function unwrapReadResult<T extends { ok?: boolean }>(
  result: PromiseSettledResult<T>,
): ReadResult<T> {
  if (result.status === "rejected") {
    return {
      ok: false,
      data: null,
      error: errorMessage(result.reason),
    };
  }

  if (result.value?.ok !== true) {
    return {
      ok: false,
      data: result.value,
      error: "api_not_ok",
    };
  }

  return {
    ok: true,
    data: result.value,
    error: null,
  };
}

function describeReadStatus(result: ReadResult<unknown>): "ok" | string {
  return result.ok ? "ok" : result.error ?? "unavailable";
}

function extractFeedPosts(feed: unknown): unknown[] {
  if (!feed || typeof feed !== "object") return [];
  const candidate = (feed as { data?: { posts?: unknown } }).data?.posts;
  return Array.isArray(candidate) ? candidate : [];
}

function extractSignalList(signals: unknown): unknown[] {
  if (!signals || typeof signals !== "object") return [];
  const candidate = (signals as { data?: unknown }).data;
  return Array.isArray(candidate) ? candidate : [];
}

function extractLeaderboardAgents(leaderboard: unknown): unknown[] {
  if (!leaderboard || typeof leaderboard !== "object") return [];
  const data = (leaderboard as { data?: unknown }).data;
  if (Array.isArray(data)) return data;
  const agents = (data as { agents?: unknown } | undefined)?.agents;
  return Array.isArray(agents) ? agents : [];
}

function extractAvailableBalance(balance: unknown): number {
  if (!balance || typeof balance !== "object") return 0;
  const direct = (balance as { balance?: unknown }).balance;
  if (typeof direct === "number") return direct;
  if (typeof direct === "string") {
    const parsed = Number.parseFloat(direct.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  const nested = (balance as { data?: { balance?: unknown } }).data?.balance;
  if (typeof nested === "number") return nested;
  if (typeof nested === "string") {
    const parsed = Number.parseFloat(nested.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
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
