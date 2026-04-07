import { POST_CATEGORIES, type PostCategory } from "../src/toolkit/supercolony/types.js";
import type { StrategyAction } from "./v3-strategy-bridge.js";
import type { V3SessionState, PublishedPostRecord } from "../src/lib/state.js";
import type { AgentSourceView, SourceRecordV2 } from "../src/lib/sources/catalog.js";
import type { AgentConfig } from "../src/lib/agent-config.js";
import type {
  ProviderAdapter,
  FetchedResponse,
} from "../src/lib/sources/providers/types.js";
import type { ColonyDatabase } from "../src/toolkit/colony/schema.js";
import type { AttestResult } from "../src/actions/publish-pipeline.js";
import { attestDahr, attestTlsn } from "../src/actions/publish-pipeline.js";
import { resolveAttestationPlan } from "../src/lib/attestation/attestation-policy.js";
import { selectSourceForTopicV2 } from "../src/lib/sources/policy.js";
import { preflight } from "../src/lib/sources/policy.js";
import { inferAssetAlias } from "../src/toolkit/chain/asset-helpers.js";
import { fetchSource } from "../src/lib/sources/fetch.js";
import { getPost } from "../src/toolkit/colony/posts.js";
import type { generatePost } from "../src/actions/llm.js";

import type {
  PublishAttestationType,
  ReplyContext,
  ResolvedActionSource,
  PrefetchedSourceData,
  PublishExecutorDeps,
} from "./publish-types.js";

export const MIN_TEXT_LENGTH = 200;
export const MAX_SUMMARY_LENGTH = 1000;
const VALID_CATEGORIES = new Set<string>(POST_CATEGORIES);

export function getTopics(action: StrategyAction): string[] {
  const topics = action.metadata?.topics;
  if (!Array.isArray(topics)) return [];
  return topics.filter((topic): topic is string => typeof topic === "string" && topic.length > 0);
}

export function getActionTopic(action: StrategyAction): string {
  return getTopics(action)[0] ?? action.target ?? action.reason;
}

export function getRequestedCategory(action: StrategyAction): PostCategory {
  const raw = action.metadata?.category;
  if (typeof raw === "string") {
    const normalized = raw.toUpperCase();
    if (VALID_CATEGORIES.has(normalized)) {
      return normalized as PostCategory;
    }
  }
  return "ANALYSIS";
}

export function buildReplyContext(action: StrategyAction, colonyDb?: ColonyDatabase): ReplyContext | undefined {
  if (action.type !== "REPLY" || !action.target) return undefined;

  const parentPost = colonyDb
    ? getPost(colonyDb, action.target)
    : null;

  return parentPost
    ? { txHash: action.target, author: parentPost.author, text: parentPost.text }
    : {
        txHash: action.target,
        author: typeof action.metadata?.author === "string" ? action.metadata.author : "unknown",
        text: action.reason,
      };
}

export function selectMethodForSource(
  source: SourceRecordV2,
  topic: string,
  agentConfig: AgentConfig,
): "DAHR" | "TLSN" | null {
  const plan = resolveAttestationPlan(topic, agentConfig);
  if (plan.required === "TLSN" && source.tlsn_safe) return "TLSN";
  if (plan.required === "DAHR" && source.dahr_safe) return "DAHR";
  if (plan.fallback === "TLSN" && source.tlsn_safe) return "TLSN";
  if (plan.fallback === "DAHR" && source.dahr_safe) return "DAHR";
  return null;
}

export function resolveUrlForSource(
  source: SourceRecordV2,
  topic: string,
  method: "DAHR" | "TLSN",
  sourceView: AgentSourceView,
  agentConfig: AgentConfig,
): { url: string; adapterCandidates?: import("../src/lib/sources/providers/types.js").CandidateRequest[] } | null {
  const selected = selectSourceForTopicV2(topic, sourceView, method);
  if (selected && selected.source.id === source.id) {
    return { url: selected.url, adapterCandidates: selected.adapterCandidates };
  }

  const fallbackPlan = resolveAttestationPlan(topic, agentConfig);
  const fallbackMethod = fallbackPlan.fallback;
  if (fallbackMethod) {
    const fallbackSelection = selectSourceForTopicV2(topic, sourceView, fallbackMethod);
    if (fallbackSelection && fallbackSelection.source.id === source.id) {
      return { url: fallbackSelection.url, adapterCandidates: fallbackSelection.adapterCandidates };
    }
  }

  return source.url
    ? { url: source.url }
    : null;
}

export function findSourceByEvidence(
  evidenceId: string,
  topic: string,
  sourceView: AgentSourceView,
  agentConfig: AgentConfig,
): ResolvedActionSource | null {
  const source = sourceView.index.byId.get(evidenceId);
  if (!source) return null;

  const method = selectMethodForSource(source, topic, agentConfig);
  if (!method) return null;

  const resolved = resolveUrlForSource(source, topic, method, sourceView, agentConfig);
  if (!resolved) return null;

  return {
    source,
    url: resolved.url,
    method,
    sourceName: source.name,
    adapterCandidates: resolved.adapterCandidates,
  };
}

export function resolveSourceForAction(
  action: StrategyAction,
  sourceView: AgentSourceView,
  agentConfig: AgentConfig,
): ResolvedActionSource | null {
  const topic = getActionTopic(action);

  if (action.evidence?.length) {
    const source = findSourceByEvidence(action.evidence[0], topic, sourceView, agentConfig);
    if (source) return source;
  }

  const plan = resolveAttestationPlan(topic, agentConfig);
  const selection = selectSourceForTopicV2(topic, sourceView, plan.required);
  if (selection) {
    return {
      source: selection.source,
      url: selection.url,
      method: plan.required,
      sourceName: selection.source.name,
      adapterCandidates: selection.adapterCandidates,
    };
  }

  // Fallback: if topic is a crypto asset, use coingecko-simple as a generic price source
  const alias = inferAssetAlias(topic);
  if (alias) {
    const cgSource = sourceView.index.byId.get("coingecko-2a7ea372");
    if (cgSource) {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(alias.asset)}&vs_currencies=usd`;
      return { source: cgSource, url, method: "DAHR", sourceName: cgSource.name };
    }
  }

  return null;
}

export function summarizePrefetchedResponse(response: FetchedResponse, adapter?: ProviderAdapter, source?: SourceRecordV2): string {
  if (adapter && source) {
    try {
      const parsed = adapter.parseResponse(source, response);
      const entries = parsed.entries.slice(0, 3).map((entry) => {
        const parts = [
          entry.title,
          entry.summary,
          entry.bodyText,
          entry.metrics ? JSON.stringify(entry.metrics) : undefined,
        ].filter((value): value is string => typeof value === "string" && value.length > 0);
        return parts.join(" | ");
      }).filter((entry) => entry.length > 0);

      if (entries.length > 0) {
        return entries.join("\n").slice(0, MAX_SUMMARY_LENGTH);
      }

      if (parsed.normalized !== undefined) {
        return JSON.stringify(parsed.normalized).slice(0, MAX_SUMMARY_LENGTH);
      }
    } catch {
      // Fall through to raw response body.
    }
  }

  return response.bodyText.slice(0, MAX_SUMMARY_LENGTH);
}

export async function prefetchSourceData(
  resolvedSource: ResolvedActionSource,
  deps: PublishExecutorDeps,
): Promise<PrefetchedSourceData> {
  const adapter = deps.adapters?.get(resolvedSource.source.provider);
  if (!adapter || !adapter.supports(resolvedSource.source)) {
    return {};
  }

  const fetchResult = await fetchSource(resolvedSource.url, resolvedSource.source, {
    rateLimitBucket: adapter.rateLimit.bucket,
    rateLimitRpm: adapter.rateLimit.maxPerMinute,
    rateLimitRpd: adapter.rateLimit.maxPerDay,
  });

  if (!fetchResult.ok || !fetchResult.response) {
    return {};
  }

  return {
    llmContext: {
      source: resolvedSource.sourceName,
      url: resolvedSource.url,
      summary: summarizePrefetchedResponse(fetchResult.response, adapter, resolvedSource.source),
    },
    prefetchedResponses: new Map([[resolvedSource.url, fetchResult.response]]),
  };
}

export function toPublishAttestationType(attested?: AttestResult | null): PublishAttestationType {
  if (!attested) return "none";
  return attested.type === "tlsn" ? "TLSN" : "DAHR";
}

export function buildPublishInput(
  draft: Awaited<ReturnType<typeof generatePost>>,
  attestations: AttestResult[],
) {
  return {
    text: draft.text,
    category: draft.category,
    tags: draft.tags,
    confidence: draft.confidence,
    replyTo: draft.replyTo,
    sourceAttestations: attestations
      .filter((attestation) => attestation.type === "dahr")
      .map((attestation) => ({
        url: attestation.url,
        responseHash: attestation.responseHash ?? "",
        txHash: attestation.txHash,
        timestamp: Date.now(),
      })),
    tlsnAttestations: attestations
      .filter((attestation) => attestation.type === "tlsn")
      .map((attestation) => ({
        url: attestation.url,
        txHash: attestation.txHash,
        timestamp: Date.now(),
      })),
  };
}

export function appendState(
  state: V3SessionState,
  txHash: string,
  topic: string,
  draft: Awaited<ReturnType<typeof generatePost>>,
  textLength: number,
  attestationType: PublishAttestationType,
): void {
  state.posts.push({
    txHash,
    category: draft.category,
    text: draft.text,
    textLength,
    attestationType,
    topic,
  });

  if (!state.publishedPosts) {
    state.publishedPosts = [];
  }

  const record: PublishedPostRecord = {
    txHash,
    topic,
    category: draft.category,
    text: draft.text,
    confidence: draft.confidence,
    predictedReactions: draft.predicted_reactions,
    hypothesis: draft.hypothesis,
    tags: draft.tags,
    replyTo: draft.replyTo,
    publishedAt: new Date().toISOString(),
    attestationType,
  };

  state.publishedPosts.push(record);
}

export async function runSingleAttestationFallback(
  resolvedSource: ResolvedActionSource,
  topic: string,
  preflightResult: ReturnType<typeof preflight>,
  deps: PublishExecutorDeps,
): Promise<AttestResult> {
  if (resolvedSource.method === "TLSN") {
    try {
      return await attestTlsn(deps.demos, resolvedSource.url);
    } catch (tlsnError: unknown) {
      // M17: On TLSN failure, try DAHR as fallback
      const plan = resolveAttestationPlan(topic, deps.agentConfig);
      const fallbackCandidate = preflightResult.candidates.find((candidate) => candidate.method === "DAHR");
      if (fallbackCandidate) {
        deps.observe("insight", "TLSN attestation failed, falling back to DAHR", {
          topic,
          source: resolvedSource.sourceName,
          tlsnError: tlsnError instanceof Error ? tlsnError.message : String(tlsnError),
        });
        try {
          return await attestDahr(deps.demos, fallbackCandidate.url);
        } catch (dahrError: unknown) {
          deps.observe("error", "DAHR fallback attestation also failed", {
            topic,
            source: fallbackCandidate.sourceId,
            tlsnError: tlsnError instanceof Error ? tlsnError.message : String(tlsnError),
            dahrError: dahrError instanceof Error ? dahrError.message : String(dahrError),
          });
          throw dahrError;
        }
      }
      throw tlsnError;
    }
  }

  // M17: On DAHR failure, try TLSN as fallback (opposite method)
  try {
    return await attestDahr(deps.demos, resolvedSource.url);
  } catch (dahrError: unknown) {
    const fallbackCandidate = preflightResult.candidates.find((candidate) => candidate.method === "TLSN");
    if (fallbackCandidate) {
      deps.observe("insight", "DAHR attestation failed, falling back to TLSN", {
        topic,
        source: resolvedSource.sourceName,
        dahrError: dahrError instanceof Error ? dahrError.message : String(dahrError),
      });
      try {
        return await attestTlsn(deps.demos, fallbackCandidate.url);
      } catch (tlsnError: unknown) {
        deps.observe("error", "TLSN fallback attestation also failed", {
          topic,
          source: fallbackCandidate.sourceId,
          dahrError: dahrError instanceof Error ? dahrError.message : String(dahrError),
          tlsnError: tlsnError instanceof Error ? tlsnError.message : String(tlsnError),
        });
        throw tlsnError;
      }
    }
    throw dahrError;
  }
}
