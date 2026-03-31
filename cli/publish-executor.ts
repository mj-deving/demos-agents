import type { Demos } from "@kynesyslabs/demosdk/websdk";

import type { StrategyAction } from "./v3-strategy-bridge.js";
import type { V3SessionState, PublishedPostRecord } from "../src/lib/state.js";
import { saveState } from "../src/lib/state.js";
import type { AgentConfig } from "../src/lib/agent-config.js";
import type { AgentSourceView, SourceRecordV2 } from "../src/lib/sources/catalog.js";
import type { LLMProvider } from "../src/lib/llm/llm-provider.js";
import type { FileStateStore } from "../src/toolkit/state-store.js";
import type { ColonyDatabase } from "../src/toolkit/colony/schema.js";
import type {
  ProviderAdapter,
  FetchedResponse,
  CandidateRequest,
} from "../src/lib/sources/providers/types.js";
import type { SourceUsageTracker } from "../src/lib/attestation/attestation-planner.js";
import type { AttestResult } from "../src/actions/publish-pipeline.js";
import { generatePost } from "../src/actions/llm.js";
import { executeAttestationPlan } from "../src/actions/attestation-executor.js";
import { attestDahr, attestTlsn, publishPost } from "../src/actions/publish-pipeline.js";
import { extractStructuredClaimsAuto } from "../src/lib/attestation/claim-extraction.js";
import {
  buildAttestationPlan,
  verifyAttestedValues,
} from "../src/lib/attestation/attestation-planner.js";
import { resolveAttestationPlan } from "../src/lib/attestation/attestation-policy.js";
import { calculateQualityScore } from "../src/lib/scoring/quality-score.js";
import { fetchSource } from "../src/lib/sources/fetch.js";
import { preflight, selectSourceForTopicV2 } from "../src/lib/sources/policy.js";
import { match } from "../src/lib/sources/matcher.js";
import { getPost } from "../src/toolkit/colony/posts.js";

const MAX_SUMMARY_LENGTH = 1000;
import {
  checkAndRecordWrite,
  getWriteRateRemaining,
} from "../src/toolkit/guards/write-rate-limit.js";

type PublishAttestationType = "DAHR" | "TLSN" | "none";

interface ReplyContext {
  txHash: string;
  author: string;
  text: string;
}

interface ResolvedActionSource {
  source: SourceRecordV2;
  url: string;
  method: "DAHR" | "TLSN";
  sourceName: string;
  adapterCandidates?: CandidateRequest[];
}

interface PrefetchedSourceData {
  llmContext?: {
    source: string;
    url: string;
    summary: string;
  };
  prefetchedResponses?: Map<string, FetchedResponse>;
}

export interface PublishActionResult {
  action: StrategyAction;
  success: boolean;
  txHash?: string;
  category?: string;
  textLength?: number;
  attestationType?: "DAHR" | "TLSN" | "none";
  error?: string;
}

export interface PublishExecutionResult {
  executed: PublishActionResult[];
  skipped: Array<{ action: StrategyAction; reason: string }>;
}

export interface PublishExecutorDeps {
  demos: Demos;
  walletAddress: string;
  provider: LLMProvider | null;
  agentConfig: AgentConfig;
  sourceView: AgentSourceView;
  state: V3SessionState;
  sessionsDir: string;
  observe: (type: string, message: string, meta?: Record<string, unknown>) => void;
  dryRun: boolean;
  stateStore: FileStateStore;
  colonyDb?: ColonyDatabase;
  calibrationOffset: number;
  scanContext: { activity_level: string; posts_per_hour: number; gaps?: string[] };
  adapters?: Map<string, ProviderAdapter>;
  usageTracker?: SourceUsageTracker;
  logSession: (entry: unknown) => void;
  logQuality: (data: unknown) => void;
}

const MIN_TEXT_LENGTH = 200;
const VALID_CATEGORIES = new Set(["ANALYSIS", "PREDICTION", "OPINION"]);

function getTopics(action: StrategyAction): string[] {
  const topics = action.metadata?.topics;
  if (!Array.isArray(topics)) return [];
  return topics.filter((topic): topic is string => typeof topic === "string" && topic.length > 0);
}

function getActionTopic(action: StrategyAction): string {
  return getTopics(action)[0] ?? action.target ?? action.reason;
}

function getRequestedCategory(action: StrategyAction): "ANALYSIS" | "PREDICTION" | "OPINION" {
  const raw = action.metadata?.category;
  if (typeof raw === "string") {
    const normalized = raw.toUpperCase();
    if (VALID_CATEGORIES.has(normalized)) {
      return normalized as "ANALYSIS" | "PREDICTION" | "OPINION";
    }
  }
  return "ANALYSIS";
}

function buildReplyContext(action: StrategyAction, colonyDb?: ColonyDatabase): ReplyContext | undefined {
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

function selectMethodForSource(
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

function resolveUrlForSource(
  source: SourceRecordV2,
  topic: string,
  method: "DAHR" | "TLSN",
  sourceView: AgentSourceView,
  agentConfig: AgentConfig,
): { url: string; adapterCandidates?: CandidateRequest[] } | null {
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

function findSourceByEvidence(
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

function resolveSourceForAction(
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

  return null;
}

function summarizePrefetchedResponse(response: FetchedResponse, adapter?: ProviderAdapter, source?: SourceRecordV2): string {
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

async function prefetchSourceData(
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

function toPublishAttestationType(attested?: AttestResult | null): PublishAttestationType {
  if (!attested) return "none";
  return attested.type === "tlsn" ? "TLSN" : "DAHR";
}

function buildPublishInput(
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

function appendState(
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

async function runSingleAttestationFallback(
  resolvedSource: ResolvedActionSource,
  topic: string,
  preflightResult: ReturnType<typeof preflight>,
  deps: PublishExecutorDeps,
): Promise<AttestResult> {
  if (resolvedSource.method === "TLSN") {
    try {
      return await attestTlsn(deps.demos, resolvedSource.url);
    } catch (tlsnError: unknown) {
      const plan = resolveAttestationPlan(topic, deps.agentConfig);
      const fallbackCandidate = preflightResult.candidates.find((candidate) => candidate.method === "DAHR");
      if (plan.fallback === "DAHR" && fallbackCandidate) {
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

  return attestDahr(deps.demos, resolvedSource.url);
}

export async function executePublishActions(
  actions: StrategyAction[],
  deps: PublishExecutorDeps,
): Promise<PublishExecutionResult> {
  const result: PublishExecutionResult = {
    executed: [],
    skipped: [],
  };

  for (const action of actions) {
    if (action.type !== "PUBLISH" && action.type !== "REPLY") {
      result.skipped.push({ action, reason: "unsupported action type" });
      continue;
    }

    const rateError = await checkAndRecordWrite(deps.stateStore, deps.walletAddress, false);
    if (rateError) {
      const remaining = await getWriteRateRemaining(deps.stateStore, deps.walletAddress);
      const reason =
        `${rateError.message} (dailyRemaining=${remaining.dailyRemaining}, hourlyRemaining=${remaining.hourlyRemaining})`;
      deps.observe("insight", `Publish action skipped: ${reason}`, {
        actionType: action.type,
        target: action.target,
      });
      result.skipped.push({ action, reason });
      continue;
    }

    if (!deps.provider) {
      deps.observe("insight", `Publish action skipped: ${action.type} has no LLM provider`, {
        actionType: action.type,
        target: action.target,
      });
      result.skipped.push({ action, reason: "no provider" });
      continue;
    }

    const topic = getActionTopic(action);
    const replyContext = buildReplyContext(action, deps.colonyDb);
    const initialSource = resolveSourceForAction(action, deps.sourceView, deps.agentConfig);

    if (!initialSource) {
      deps.observe("insight", `Publish action skipped: no source for "${topic}"`, {
        actionType: action.type,
        topic,
      });
      result.skipped.push({ action, reason: "no source" });
      continue;
    }

    try {
      const prefetched = await prefetchSourceData(initialSource, deps);

      const draft = await generatePost(
        {
          topic,
          category: getRequestedCategory(action),
          scanContext: deps.scanContext,
          calibrationOffset: deps.calibrationOffset,
          attestedData: prefetched.llmContext,
          replyTo: replyContext,
          briefingContext: deps.state.briefingContext,
        },
        deps.provider,
        {
          personaMdPath: deps.agentConfig.paths.personaMd,
          strategyYamlPath: deps.agentConfig.paths.strategyYaml,
          agentName: deps.agentConfig.name,
        },
      );

      if (draft.text.length < MIN_TEXT_LENGTH) {
        result.skipped.push({
          action,
          reason: `draft too short (${draft.text.length} chars)`,
        });
        continue;
      }

      if (draft.predicted_reactions < (deps.agentConfig.gate.predictedReactionsThreshold || 0)) {
        result.skipped.push({
          action,
          reason: `predicted reactions below threshold (${draft.predicted_reactions} < ${deps.agentConfig.gate.predictedReactionsThreshold})`,
        });
        continue;
      }

      const preflightResult = preflight(topic, deps.sourceView, deps.agentConfig);
      const matchResult = await match({
        topic,
        postText: draft.text,
        postTags: draft.tags,
        candidates: preflightResult.candidates,
        sourceView: deps.sourceView,
        llm: deps.provider,
        prefetchedResponses: prefetched.prefetchedResponses,
      });

      if (!preflightResult.pass || !matchResult.pass || !matchResult.best) {
        deps.observe("insight", `Publish action skipped: unsubstantiated draft for "${topic}"`, {
          actionType: action.type,
          topic,
          preflight: preflightResult.reason,
          match: matchResult.reason,
        });
        result.skipped.push({ action, reason: "unsubstantiated draft" });
        continue;
      }

      const resolvedSource: ResolvedActionSource = {
        source: preflightResult.candidates.find((candidate) => candidate.sourceId === matchResult.best!.sourceId)?.source
          ?? initialSource.source,
        url: matchResult.best.url,
        method: matchResult.best.method,
        sourceName: matchResult.best.sourceId,
      };

      if (deps.dryRun) {
        deps.observe("insight", `Publish action dry-run: ${action.type}`, {
          actionType: action.type,
          topic,
          source: resolvedSource.sourceName,
          category: draft.category,
        });
        result.executed.push({
          action,
          success: true,
          category: draft.category,
          textLength: draft.text.length,
          attestationType: "none",
        });
        continue;
      }

      let attestationResults: AttestResult[] = [];
      let primaryAttestation: AttestResult | null = null;

      const claims = await extractStructuredClaimsAuto(draft.text, deps.provider);
      const plan = buildAttestationPlan(
        claims,
        deps.sourceView,
        deps.agentConfig,
        deps.adapters,
        deps.usageTracker,
      );

      if (plan) {
        const execution = await executeAttestationPlan(plan, deps.demos, {
          attestationMode: deps.agentConfig.attestation.defaultMode,
        });
        const candidates = [plan.primary, ...plan.secondary];
        const verifications = verifyAttestedValues(execution.results, candidates);
        if (execution.results.length > 0 && verifications.every((verification) => verification.verified)) {
          attestationResults = execution.results;
          primaryAttestation = execution.results[0] ?? null;
        }
      }

      if (attestationResults.length === 0) {
        const fallbackAttestation = await runSingleAttestationFallback(
          resolvedSource,
          topic,
          preflightResult,
          deps,
        );
        attestationResults = [fallbackAttestation];
        primaryAttestation = fallbackAttestation;
      }

      const publishResult = await publishPost(
        deps.demos,
        buildPublishInput(draft, attestationResults),
        { skipIndexerCheck: true },
      );

      const attestationType = toPublishAttestationType(primaryAttestation);
      appendState(deps.state, publishResult.txHash, topic, draft, publishResult.textLength, attestationType);

      deps.logSession({
        timestamp: new Date().toISOString(),
        txHash: publishResult.txHash,
        category: draft.category,
        attestation_type: attestationType,
        attestation_url: primaryAttestation?.url,
        attestation_requested_url: primaryAttestation?.requestedUrl,
        hypothesis: draft.hypothesis || "",
        predicted_reactions: draft.predicted_reactions,
        agents_referenced: [],
        topic,
        confidence: draft.confidence,
        text_preview: draft.text.slice(0, 100),
        text_length: draft.text.length,
        tags: draft.tags,
      });

      const quality = calculateQualityScore({
        text: draft.text,
        isReply: !!draft.replyTo,
        hasAttestation: true,
      });
      deps.logQuality({
        timestamp: new Date().toISOString(),
        agent: deps.agentConfig.name,
        topic,
        category: draft.category,
        quality_score: quality.score,
        quality_max: quality.maxScore,
        quality_breakdown: quality.breakdown,
        predicted_reactions: draft.predicted_reactions,
        confidence: draft.confidence,
        text_length: draft.text.length,
        isReply: !!draft.replyTo,
        hasAttestation: true,
        txHash: publishResult.txHash,
      });

      const recordError = await checkAndRecordWrite(deps.stateStore, deps.walletAddress, true);
      if (recordError) {
        deps.observe("insight", `Failed to record publish in write-rate ledger: ${recordError.message}`, {
          actionType: action.type,
          topic,
          txHash: publishResult.txHash,
        });
      }

      result.executed.push({
        action,
        success: true,
        txHash: publishResult.txHash,
        category: publishResult.category,
        textLength: publishResult.textLength,
        attestationType,
      });

      // Persist state after each successful action for crash-safe resume
      saveState(deps.state, deps.sessionsDir);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      deps.observe("error", `Publish action failed: ${action.type}`, {
        actionType: action.type,
        target: action.target,
        topic,
        error: message,
      });
      result.executed.push({
        action,
        success: false,
        error: message,
      });
    }
  }

  return result;
}
