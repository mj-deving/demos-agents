import { pathToFileURL } from "node:url";
import {
  buildResearchColonySubstrate,
  buildResearchDraft,
  buildResearchSelfHistory,
  buildResearchEvidenceDelta,
  fetchResearchEvidenceSummary,
  deriveResearchOpportunities,
  matchResearchDraftToPlan,
  runMinimalAgentLoop,
  summarizeResearchEvidenceDelta,
  type MinimalObserveContext,
  type MinimalObserveResult,
  type ResearchPostInput,
  type ResearchPublishHistoryEntry,
  type ResearchSignalInput,
  type ResearchSignalCrossReference,
  type ResearchSignalDivergence,
  type ResearchSignalReactionSummary,
  type ResearchSignalSourcePost,
} from "../src/agent.js";

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
  publishHistory?: ResearchPublishHistoryEntry[];
}

type FeedSample = ResearchPostInput;

interface ReadResult<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
}

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

function signalString(signal: unknown, key: string): string | null {
  if (!signal || typeof signal !== "object") return null;
  const candidate = (signal as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function signalNumber(signal: unknown, key: string): number | null {
  if (!signal || typeof signal !== "object") return null;
  const candidate = (signal as Record<string, unknown>)[key];
  return typeof candidate === "number" ? candidate : null;
}

function signalBoolean(signal: unknown, key: string): boolean | null {
  if (!signal || typeof signal !== "object") return null;
  const candidate = (signal as Record<string, unknown>)[key];
  return typeof candidate === "boolean" ? candidate : null;
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
    score: typeof (post as { score?: unknown }).score === "number" ? (post as { score: number }).score : null,
  };
}

function sampleSignalSourcePost(post: unknown): ResearchSignalSourcePost | null {
  if (!post || typeof post !== "object") return null;
  const reactionsValue = (post as { reactions?: unknown }).reactions;
  const reactions = reactionsValue && typeof reactionsValue === "object"
    ? {
        agree: typeof (reactionsValue as { agree?: unknown }).agree === "number" ? (reactionsValue as { agree: number }).agree : 0,
        disagree: typeof (reactionsValue as { disagree?: unknown }).disagree === "number" ? (reactionsValue as { disagree: number }).disagree : 0,
        flag: typeof (reactionsValue as { flag?: unknown }).flag === "number" ? (reactionsValue as { flag: number }).flag : 0,
      }
    : null;

  const assetsValue = (post as { assets?: unknown }).assets;
  return {
    txHash: signalString(post, "txHash"),
    author: signalString(post, "author"),
    text: signalString(post, "text") ?? "",
    category: signalString(post, "cat"),
    timestamp: signalNumber(post, "timestamp"),
    confidence: signalNumber(post, "confidence"),
    assets: Array.isArray(assetsValue) ? assetsValue.filter((value): value is string => typeof value === "string") : [],
    dissents: signalBoolean(post, "dissents") ?? false,
    reactions,
  };
}

function sampleSignalCrossReference(value: unknown): ResearchSignalCrossReference | null {
  if (!value || typeof value !== "object") return null;
  const assetsValue = (value as { assets?: unknown }).assets;
  return {
    type: signalString(value, "type") ?? "unknown",
    description: signalString(value, "description") ?? "",
    assets: Array.isArray(assetsValue) ? assetsValue.filter((entry): entry is string => typeof entry === "string") : [],
  };
}

function sampleSignalReactionSummary(value: unknown): ResearchSignalReactionSummary | null {
  if (!value || typeof value !== "object") return null;
  return {
    totalAgrees: signalNumber(value, "totalAgrees") ?? 0,
    totalDisagrees: signalNumber(value, "totalDisagrees") ?? 0,
    totalFlags: signalNumber(value, "totalFlags") ?? 0,
  };
}

function sampleSignalDivergence(value: unknown): ResearchSignalDivergence | null {
  if (!value || typeof value !== "object") return null;
  return {
    agent: signalString(value, "agent"),
    direction: signalString(value, "direction"),
    reasoning: signalString(value, "reasoning"),
  };
}

function sampleSignal(signal: unknown): ResearchSignalInput {
  const assetsValue = signal && typeof signal === "object" ? (signal as { assets?: unknown }).assets : null;
  const tagsValue = signal && typeof signal === "object" ? (signal as { tags?: unknown }).tags : null;
  const sourcePostsValue = signal && typeof signal === "object" ? (signal as { sourcePosts?: unknown }).sourcePosts : null;
  const sourcePostDataValue = signal && typeof signal === "object" ? (signal as { sourcePostData?: unknown }).sourcePostData : null;
  const crossReferencesValue = signal && typeof signal === "object" ? (signal as { crossReferences?: unknown }).crossReferences : null;

  return {
    topic: signalTopic(signal),
    shortTopic: signalString(signal, "shortTopic"),
    confidence: signalConfidence(signal),
    direction: signalString(signal, "direction"),
    text: signalString(signal, "text"),
    keyInsight: signalString(signal, "keyInsight"),
    consensus: signalBoolean(signal, "consensus"),
    consensusScore: signalNumber(signal, "consensusScore"),
    agentCount: signalNumber(signal, "agentCount"),
    totalAgents: signalNumber(signal, "totalAgents"),
    assets: Array.isArray(assetsValue) ? assetsValue.filter((value): value is string => typeof value === "string") : [],
    tags: Array.isArray(tagsValue) ? tagsValue.filter((value): value is string => typeof value === "string") : [],
    sourcePosts: Array.isArray(sourcePostsValue) ? sourcePostsValue.filter((value): value is string => typeof value === "string") : [],
    sourcePostData: Array.isArray(sourcePostDataValue)
      ? sourcePostDataValue.map(sampleSignalSourcePost).filter((value): value is ResearchSignalSourcePost => value != null)
      : [],
    crossReferences: Array.isArray(crossReferencesValue)
      ? crossReferencesValue.map(sampleSignalCrossReference).filter((value): value is ResearchSignalCrossReference => value != null)
      : [],
    reactionSummary: sampleSignalReactionSummary(signal && typeof signal === "object" ? (signal as { reactionSummary?: unknown }).reactionSummary : null),
    divergence: sampleSignalDivergence(signal && typeof signal === "object" ? (signal as { divergence?: unknown }).divergence : null),
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
  const feedSample = posts.slice(0, 10);
  const signalEntries = signalList.map(sampleSignal);
  const signalSample = signalEntries.slice(0, 10).map((signal) => ({
    topic: signal.topic,
    shortTopic: signal.shortTopic ?? null,
    confidence: signal.confidence,
    direction: signal.direction,
    keyInsight: signal.keyInsight ?? null,
    agentCount: signal.agentCount ?? null,
    assets: signal.assets ?? [],
    tags: signal.tags ?? [],
  }));
  const highConfidenceSignals = signalEntries.filter((signal) => (signal.confidence ?? 0) >= 70);

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
    signals: signalEntries,
    posts,
    lastCoverageTopic: ctx.memory.state?.lastCoverageTopic ?? null,
    recentCoverageTopics: (ctx.memory.state?.topicHistory ?? []).map((entry) => entry.topic),
    recentCoverageFamilies: (ctx.memory.state?.publishHistory ?? [])
      .map((entry) => entry.family)
      .filter((family): family is string => typeof family === "string" && family.length > 0),
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
  if (opportunities.length === 0) {
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

  let deferredRepeatSkip: MinimalObserveResult<ResearchState> | null = null;

  for (const chosenOpportunity of opportunities) {
    const topic = chosenOpportunity.topic;
    const matchingFeedPosts = chosenOpportunity.matchingFeedPosts;
    const matchedSignal = chosenOpportunity.matchedSignal;
    const attestationPlan = chosenOpportunity.attestationPlan;
    const sourceProfile = chosenOpportunity.sourceProfile;
    const colonySubstrate = buildResearchColonySubstrate({
      opportunity: chosenOpportunity,
      allPosts: posts,
    });

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
            colonySubstrate,
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
            colonySubstrate,
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
    const prefetchedReadResults = evidenceReads.flatMap((entry) =>
      entry.status === "fulfilled" ? [entry.value] : []);
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
            colonySubstrate,
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
    const selfHistory = buildResearchSelfHistory({
      history: ctx.memory.state?.publishHistory ?? [],
      topic,
      family: sourceProfile.family,
      now: ctx.cycle.startedAt,
      currentEvidenceValues: evidenceSummaryResult.summary.values,
    });
    const deltaSummary = summarizeResearchEvidenceDelta(evidenceDelta);

    if (previousSnapshot?.topic === topic && !deltaSummary.hasMeaningfulChange) {
      deferredRepeatSkip ??= {
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
            colonySubstrate,
            evidenceSummary: evidenceSummaryResult.summary,
            supportingEvidenceSummaries,
            evidenceDelta,
            selfHistory,
          },
          promptPacket: {
            objective: "Skip when the same research topic has not moved meaningfully since the last cycle.",
            topic,
            opportunityKind: chosenOpportunity.kind,
            researchFamily: sourceProfile.family,
            derivedMetrics,
            readStatus,
            deltaSummary,
            selfHistory,
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
      continue;
    }

    if (selfHistory.skipSuggested) {
      deferredRepeatSkip ??= {
        kind: "skip",
        reason: "recent_self_coverage_without_new_delta",
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
            colonySubstrate,
            evidenceSummary: evidenceSummaryResult.summary,
            supportingEvidenceSummaries,
            evidenceDelta,
            selfHistory,
          },
          promptPacket: {
            objective: "Skip when the same family or topic was just covered and the evidence packet has not moved enough to justify repeating the thesis.",
            topic,
            opportunityKind: chosenOpportunity.kind,
            researchFamily: sourceProfile.family,
            derivedMetrics,
            readStatus,
            deltaSummary,
            selfHistory,
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
      continue;
    }

    const draft = await buildResearchDraft({
      opportunity: chosenOpportunity,
      feedCount: posts.length,
      leaderboardCount: leaderboardAgents.length,
      availableBalance,
      colonySubstrate,
      evidenceSummary: evidenceSummaryResult.summary,
      supportingEvidenceSummaries,
      selfHistory,
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
            colonySubstrate,
            evidenceSummary: evidenceSummaryResult.summary,
            supportingEvidenceSummaries,
            evidenceDelta,
            selfHistory,
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

    const sourceMatch = await matchResearchDraftToPlan({
      topic,
      text: draft.text,
      tags: draft.tags,
      attestationPlan,
      evidenceReads: prefetchedReadResults,
    });

    if (!sourceMatch.pass) {
      return {
        kind: "skip",
        reason: "draft_source_match_failed",
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
            colonySubstrate,
            evidenceSummary: evidenceSummaryResult.summary,
            supportingEvidenceSummaries,
            evidenceDelta,
            selfHistory,
          },
          promptPacket: draft.promptPacket as unknown as Record<string, unknown>,
          notes: [
            `shared_source_match_failed: ${sourceMatch.reason}`,
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
          colonySubstrate,
          evidenceSummary: evidenceSummaryResult.summary,
          supportingEvidenceSummaries,
          evidenceDelta,
          selfHistory,
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
        publishHistory: buildNextPublishHistory(ctx.memory.state?.publishHistory ?? [], {
          topic,
          family: sourceProfile.family,
          publishedAt: ctx.cycle.startedAt,
          opportunityKind: chosenOpportunity.kind,
          textSnippet: snippetText(draft.text),
          evidenceValues: evidenceSummaryResult.summary.values,
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

  if (deferredRepeatSkip) {
    return deferredRepeatSkip;
  }

  return {
    kind: "skip",
    reason: "no_publishable_research_opportunity",
    facts: {
      signalCount: signalList.length,
      feedCount: posts.length,
      availableBalance,
      ...derivedMetrics,
      ...readStatus,
    },
    audit: {
      inputs: {
        feedSample,
        signalSample,
        leaderboardSample: leaderboardAgents.slice(0, 5),
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

function buildNextTopicHistory(
  previous: Array<{ topic: string; publishedAt: string; opportunityKind: string }>,
  nextEntry: { topic: string; publishedAt: string; opportunityKind: string },
): Array<{ topic: string; publishedAt: string; opportunityKind: string }> {
  const deduped = previous.filter((entry) => entry.topic !== nextEntry.topic);
  return [nextEntry, ...deduped].slice(0, MAX_TOPIC_HISTORY);
}

function buildNextPublishHistory(
  previous: ResearchPublishHistoryEntry[],
  nextEntry: ResearchPublishHistoryEntry,
): ResearchPublishHistoryEntry[] {
  return [nextEntry, ...previous].slice(0, 20);
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

function extractFeedPosts(feed: unknown): FeedSample[] {
  if (!feed || typeof feed !== "object") return [];
  const candidate = (feed as { data?: { posts?: unknown } }).data?.posts;
  return Array.isArray(candidate) ? candidate.map(samplePost) : [];
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

function snippetText(text: string, maxLength: number = 220): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
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
