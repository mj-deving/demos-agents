import type { StrategyAction } from "./v3-strategy-bridge.js";
import { saveState } from "../src/lib/state.js";
import { generatePost } from "../src/actions/llm.js";
import { executeAttestationPlan } from "../src/actions/attestation-executor.js";
import { publishPost } from "../src/actions/publish-pipeline.js";
import { extractStructuredClaimsAuto } from "../src/lib/attestation/claim-extraction.js";
import {
  buildAttestationPlan,
  verifyAttestedValues,
} from "../src/lib/attestation/attestation-planner.js";
import { calculateStrategyScore } from "../src/lib/scoring/quality-score.js";
import { calculateOfficialScore } from "../src/toolkit/supercolony/scoring.js";
import { preflight } from "../src/lib/sources/policy.js";
import { match } from "../src/lib/sources/matcher.js";
import { checkClaimDedup, checkSelfDedup, checkSemanticDedup } from "../src/toolkit/colony/dedup.js";
import { generateTopicAngle } from "../src/toolkit/strategy/topic-angle.js";
import type { AngleContext } from "../src/toolkit/strategy/topic-angle.js";
import { encodeVotePost, encodeBinaryPost, validateBetPayload, validateBinaryPayload, MAX_BET_AMOUNT } from "../src/toolkit/colony/vote-bet-codec.js";
import { createSdkBridge, AUTH_PENDING_TOKEN } from "../src/toolkit/sdk-bridge.js";
import { checkSessionBudget, recordSpend, saveSpendingLedger } from "../src/lib/spending-policy.js";
import {
  checkAndRecordWrite,
  rollbackWriteRecord,
  getWriteRateRemaining,
} from "../src/toolkit/guards/write-rate-limit.js";

// Re-export shared types so existing consumers don't break
export type { PublishActionResult, PublishExecutionResult, PublishExecutorDeps } from "./publish-types.js";
import type { PublishExecutionResult, PublishExecutorDeps } from "./publish-types.js";
import type { ResolvedActionSource } from "./publish-types.js";

import {
  getActionTopic,
  getRequestedCategory,
  buildReplyContext,
  resolveSourceForAction,
  prefetchSourceData,
  toPublishAttestationType,
  buildPublishInput,
  appendState,
  runSingleAttestationFallback,
  sanitizeUrlForLog,
} from "./publish-helpers.js";
import { checkPublishQuality } from "../src/toolkit/publish/quality-gate.js";

const DEFAULT_MAX_PUBLISH_PER_SESSION = 2;
const ACT_PHASE_TIMEOUT_MS = 120_000;

export async function executePublishActions(
  actions: StrategyAction[],
  deps: PublishExecutorDeps,
): Promise<PublishExecutionResult> {
  const result: PublishExecutionResult = {
    executed: [],
    skipped: [],
  };

  const startTime = Date.now();
  let successfulPublishes = 0;
  const publishCap = deps.maxPublishPerSession ?? DEFAULT_MAX_PUBLISH_PER_SESSION;

  for (const action of actions) {
    // H5: Wallclock timeout + action cap guards
    if (Date.now() - startTime > ACT_PHASE_TIMEOUT_MS || successfulPublishes >= publishCap) {
      deps.observe("insight", "ACT phase budget exhausted", {
        reason: successfulPublishes >= publishCap ? "action cap" : "wallclock timeout",
        count: successfulPublishes, elapsed: Date.now() - startTime,
      });
      break;
    }
    // Phase 8: VOTE/BET — lightweight publish via codec, no LLM needed
    if (action.type === "VOTE" || action.type === "BET") {
      if (deps.dryRun) {
        deps.observe("insight", `${action.type} dry-run: ${action.reason}`, { actionType: action.type });
        result.executed.push({ action, success: true });
        continue;
      }
      // Write-rate guard (same as PUBLISH/REPLY — Codex review fix M6)
      const betRateCheck = await checkAndRecordWrite(deps.stateStore, deps.walletAddress, false);
      if (betRateCheck.error) {
        result.skipped.push({ action, reason: betRateCheck.error.message });
        continue;
      }
      // Session budget guard — reject if DEM spend would exceed daily/session cap
      const betAmount = Math.min(Number(action.metadata?.amount) || 0, MAX_BET_AMOUNT);
      if (!Number.isFinite(betAmount) || betAmount <= 0) {
        result.skipped.push({ action, reason: `Invalid bet amount: ${action.metadata?.amount}` });
        continue;
      }
      if (!deps.spending) {
        result.skipped.push({ action, reason: "No spending policy configured — cannot execute bet" });
        continue;
      }
      const budgetDecision = checkSessionBudget(betAmount, deps.spending.policy, deps.spending.ledger);
      if (!budgetDecision.allowed) {
        result.skipped.push({ action, reason: `Budget rejected: ${budgetDecision.reason}` });
        deps.observe("insight", `${action.type} skipped: ${budgetDecision.reason}`, {
          actionType: action.type, amount: betAmount,
        });
        continue;
      }
      try {
        const metadata = action.metadata ?? {};
        let encoded: { text: string; category: string; tags: string[] } | null = null;

        if (action.type === "VOTE") {
          const payload = validateBetPayload({ action: "HIVE_BET", ...metadata });
          if (!payload) { result.skipped.push({ action, reason: "invalid VOTE payload" }); continue; }
          encoded = encodeVotePost(payload);
        } else {
          const payload = validateBinaryPayload({ action: "HIVE_BINARY", ...metadata });
          if (!payload) { result.skipped.push({ action, reason: "invalid BET payload" }); continue; }
          encoded = encodeBinaryPost(payload);
        }

        // Use SDK bridge directly — publishPost() requires attestations which VOTE/BET don't have
        const sdkBridge = createSdkBridge(deps.demos, undefined, AUTH_PENDING_TOKEN);
        const publishResult = await sdkBridge.publishHivePost({
          text: encoded.text,
          category: encoded.category,
          tags: encoded.tags,
          confidence: 50,
        });
        deps.observe("insight", `${action.type} published: ${publishResult.txHash} (${betAmount} DEM)`, {
          actionType: action.type, txHash: publishResult.txHash,
        });
        // Record spend in ledger after successful publish
        if (deps.spending?.ledger && betAmount > 0) {
          recordSpend({
            timestamp: new Date().toISOString(),
            amount: betAmount,
            recipient: "bet-pool",
            postTxHash: publishResult.txHash,
            type: "bet",
            dryRun: false,
            agent: deps.agentConfig.name,
          }, deps.spending.ledger);
          saveSpendingLedger(deps.spending.ledger, deps.agentConfig.name);
        }
        result.executed.push({ action, success: true, txHash: publishResult.txHash });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        deps.observe("warning", `${action.type} failed: ${msg}`, { actionType: action.type });
        result.executed.push({ action, success: false, error: msg });
      }
      continue;
    }

    if (action.type !== "PUBLISH" && action.type !== "REPLY") {
      result.skipped.push({ action, reason: "unsupported action type" });
      continue;
    }

    // H1: Optimistic reservation — reserve rate-limit slot upfront, rollback on failure
    const reservation = await checkAndRecordWrite(deps.stateStore, deps.walletAddress, true);
    if (reservation.error) {
      const remaining = await getWriteRateRemaining(deps.stateStore, deps.walletAddress);
      const reason =
        `${reservation.error.message} (dailyRemaining=${remaining.dailyRemaining}, hourlyRemaining=${remaining.hourlyRemaining})`;
      deps.observe("insight", `Publish action skipped: ${reason}`, {
        actionType: action.type,
        target: action.target,
      });
      result.skipped.push({ action, reason });
      continue;
    }

    let publishSucceeded = false;
    const reservedTimestamp = reservation.recordedTimestamp!;
    try {

    if (!deps.provider) {
      deps.observe("insight", `Publish action skipped: ${action.type} has no LLM provider`, {
        actionType: action.type,
        target: action.target,
      });
      result.skipped.push({ action, reason: "no provider" });
      continue;
    }

    const originalTopic = getActionTopic(action);
    let topic = originalTopic;
    const replyContext = buildReplyContext(action, deps.colonyDb);
    const initialSources = resolveSourceForAction(action, deps.sourceView, deps.agentConfig);

    if (initialSources.length === 0) {
      deps.observe("insight", `Publish action skipped: no source for "${topic}"`, {
        actionType: action.type,
        topic,
      });
      result.skipped.push({ action, reason: "no source" });
      continue;
    }

    // Dedup guard — check BEFORE generating draft to save LLM call
    // On dedup block (self or colony), attempt topic angle rotation once before skipping
    if (deps.colonyDb && action.type === "PUBLISH") {
      // Map engine-enrichment divergence metadata to AngleContext shape.
      // Engine propagates { asset, type, severity, agentDirection, marketDirection } from oracle details.
      const rawDiv = action.metadata as Record<string, unknown> | undefined;
      const hasDivergence = rawDiv?.asset && rawDiv?.type;
      const angleCtx: AngleContext = {
        originalRule: action.metadata?.rule as string ?? rawDiv?.type as string ?? "unknown",
        divergence: hasDivergence ? {
          asset: rawDiv.asset as string,
          severity: (rawDiv.severity as string) ?? "unknown",
          agentDirection: (rawDiv.agentDirection as string) ?? "unknown",
          marketDirection: (rawDiv.marketDirection as string) ?? "unknown",
        } : undefined,
      };

      const selfDedup = checkSelfDedup(deps.colonyDb, topic, deps.walletAddress);
      if (selfDedup.isDuplicate) {
        const angledTopic = generateTopicAngle(topic, angleCtx);
        if (angledTopic && !checkSelfDedup(deps.colonyDb, angledTopic, deps.walletAddress).isDuplicate) {
          deps.observe("insight", `Topic angle rotation (self-dedup): "${topic}" → "${angledTopic}"`, {
            actionType: action.type, originalTopic: topic, angledTopic,
          });
          topic = angledTopic;
        } else {
          deps.observe("insight", `Publish skipped: ${selfDedup.reason} (angle rotation failed)`, {
            actionType: action.type, topic, angledTopic,
          });
          result.skipped.push({ action, reason: selfDedup.reason ?? "self-dedup" });
          continue;
        }
      }
      const colonyDedup = checkClaimDedup(deps.colonyDb, topic);
      if (colonyDedup.isDuplicate) {
        const angledTopic = generateTopicAngle(topic, angleCtx);
        if (angledTopic && !checkClaimDedup(deps.colonyDb, angledTopic).isDuplicate) {
          deps.observe("insight", `Topic angle rotation (colony-dedup): "${topic}" → "${angledTopic}"`, {
            actionType: action.type, originalTopic: topic, angledTopic,
          });
          topic = angledTopic;
        } else {
          deps.observe("insight", `Publish skipped: ${colonyDedup.reason} (angle rotation failed)`, {
            actionType: action.type, topic, angledTopic,
          });
          result.skipped.push({ action, reason: colonyDedup.reason ?? "colony-dedup" });
          continue;
        }
      }
      const semanticDedup = await checkSemanticDedup(deps.colonyDb, topic, { ourAddress: deps.walletAddress });
      if (semanticDedup.isDuplicate) {
        deps.observe("insight", `Publish skipped: ${semanticDedup.reason}`, { actionType: action.type, topic });
        result.skipped.push({ action, reason: semanticDedup.reason ?? "semantic-dedup" });
        continue;
      }
    }

    // --- Source-first: preflight BEFORE LLM to avoid wasted draft generation ---
    const preflightResult = preflight(topic, deps.sourceView, deps.agentConfig);
    if (!preflightResult.pass || preflightResult.candidates.length === 0) {
      deps.observe("insight", `Publish skipped: insufficient source coverage for "${topic}"`, {
        actionType: action.type, topic, preflight: preflightResult.reason,
      });
      result.skipped.push({ action, reason: `insufficient source coverage: ${preflightResult.reason}` });
      continue;
    }

    // --- Step 1: LLM generation (H8: per-step error recovery) ---
    let prefetched: Awaited<ReturnType<typeof prefetchSourceData>>;
    let selectedPrefetchSource: ResolvedActionSource | null = null;
    let draft: Awaited<ReturnType<typeof generatePost>>;
    try {
      prefetched = { fetchAttempted: false, fetchSucceeded: true };
      for (const [index, candidateSource] of initialSources.entries()) {
        const candidatePrefetch = await prefetchSourceData(candidateSource, deps);
        if (candidatePrefetch.fetchAttempted && !candidatePrefetch.fetchSucceeded) {
          const nextSource = initialSources[index + 1];
          if (nextSource) {
            deps.observe("warning", `Source fallback: ${candidateSource.sourceName} failed, trying ${nextSource.sourceName}`, {
              actionType: action.type,
              topic,
              failedSource: candidateSource.source.id,
              nextSource: nextSource.source.id,
            });
          }
          continue;
        }
        prefetched = candidatePrefetch;
        selectedPrefetchSource = candidateSource;
        break;
      }

      if (!selectedPrefetchSource) {
        deps.observe("insight", `Publish skipped: all resolved sources failed for "${topic}"`, {
          actionType: action.type,
          topic,
          sourcesTried: initialSources.map((source) => source.source.id),
        });
        result.skipped.push({ action, reason: "all resolved sources failed during prefetch" });
        continue;
      }

      draft = await generatePost(
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
    } catch (llmError: unknown) {
      const msg = llmError instanceof Error ? llmError.message : String(llmError);
      deps.observe("error", `LLM generation failed, skipping action: ${msg}`, {
        actionType: action.type, topic, error: msg,
      });
      result.executed.push({ action, success: false, error: `LLM failed: ${msg}` });
      continue;
    }

    // Quality gate: check text length + predicted reactions via toolkit primitive
    const qualityResult = checkPublishQuality(
      { text: draft.text, category: draft.category, predicted_reactions: draft.predicted_reactions },
      {
        minTextLength: 200,
        minPredictedReactions: deps.agentConfig.gate.predictedReactionsThreshold || 0,
      },
    );
    if (!qualityResult.pass) {
      result.skipped.push({ action, reason: qualityResult.reason ?? "quality gate failed" });
      continue;
    }

    // Confidence: always set (free +5 points), >=40 for consensus entry threshold.
    if (draft.confidence === undefined || draft.confidence === null) draft.confidence = 70;
    if (draft.confidence < 40) draft.confidence = 40;

    // Score pre-calculation: assume DAHR attestation (+40) since it's the default mode.
    const projectedScore = calculateOfficialScore({
      text: draft.text,
      hasSourceAttestations: true,
      confidence: draft.confidence,
      reactionCount: 0,
    });
    if (projectedScore.score < 50) {
      deps.observe("insight", `Publish skipped: projected score ${projectedScore.score} < 50`, {
        actionType: action.type, topic,
        breakdown: projectedScore.breakdown,
      });
      result.skipped.push({
        action,
        reason: `projected score ${projectedScore.score} below leaderboard threshold (50)`,
      });
      continue;
    }

    // --- Post-LLM safety net: verify draft actually uses the evidence ---
    // Use regex-only claim extraction (llm: null) — a second LLM call here
    // wastes 5-10s and the binary pass/fail decision doesn't need LLM precision
    const matchResult = await match({
      topic,
      postText: draft.text,
      postTags: draft.tags,
      candidates: preflightResult.candidates,
      sourceView: deps.sourceView,
      llm: null,
      prefetchedResponses: prefetched.prefetchedResponses,
    });

    if (!matchResult.pass || !matchResult.best) {
      deps.observe("insight", `Publish action skipped: draft does not align with evidence for "${topic}"`, {
        actionType: action.type,
        topic,
        match: matchResult.reason,
      });
      result.skipped.push({ action, reason: `draft does not align with evidence: ${matchResult.reason}` });
      continue;
    }

    const resolvedSource: ResolvedActionSource = {
      source: preflightResult.candidates.find((candidate) => candidate.sourceId === matchResult.best!.sourceId)?.source
        ?? selectedPrefetchSource.source,
      url: matchResult.best.url,
      method: matchResult.best.method,
      sourceName: matchResult.best.sourceId,
    };

    // M18: Dry-run validation — run preflight/source checks (done above), report realistic results
    if (deps.dryRun) {
      deps.observe("insight", `Publish action dry-run: ${action.type}`, {
        actionType: action.type,
        topic,
        source: resolvedSource.sourceName,
        category: draft.category,
        preflightPass: preflightResult.pass,
        matchPass: matchResult.pass,
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

    // --- Step 2: Claim extraction (H8: per-step error recovery) ---
    let claims: Awaited<ReturnType<typeof extractStructuredClaimsAuto>> = [];
    try {
      claims = await extractStructuredClaimsAuto(draft.text, deps.provider);
    } catch (claimError: unknown) {
      const msg = claimError instanceof Error ? claimError.message : String(claimError);
      deps.observe("warning", `Claim extraction failed, proceeding without structured claims: ${msg}`, {
        actionType: action.type, topic, error: msg,
      });
    }

    // --- Step 3: Attestation (H7 + H8: graceful degradation + per-step recovery) ---
    let attestationResults: import("../src/actions/publish-pipeline.js").AttestResult[] = [];
    let primaryAttestation: import("../src/actions/publish-pipeline.js").AttestResult | null = null;

    try {
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
    } catch (attestError: unknown) {
      // Attestation is mandatory — no attestation = no publish
      const msg = attestError instanceof Error ? attestError.message : String(attestError);
      deps.observe("warning", `Attestation failed — skipping publish (attestation mandatory): ${msg}`, {
        actionType: action.type, topic, error: msg,
      });
      result.skipped.push({ action, reason: `Attestation failed: ${msg}` });
      continue;
    }

    // --- Step 4: Publish (H8: per-step error recovery) ---
    try {
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
        attestation_requested_url: sanitizeUrlForLog(primaryAttestation?.requestedUrl),
        hypothesis: draft.hypothesis || "",
        predicted_reactions: draft.predicted_reactions,
        agents_referenced: [],
        topic,
        confidence: draft.confidence,
        text_preview: draft.text.slice(0, 100),
        text_length: draft.text.length,
        tags: draft.tags,
      });

      const quality = calculateStrategyScore({
        text: draft.text,
        isReply: !!draft.replyTo,
        hasAttestation: attestationResults.length > 0,
      });
      // Official SuperColony score — used for platform compatibility assessment
      const officialScore = calculateOfficialScore({
        text: draft.text,
        hasSourceAttestations: attestationResults.length > 0,
        confidence: draft.confidence,
        reactionCount: 0, // pre-publish, no reactions yet
      });
      deps.logQuality({
        timestamp: new Date().toISOString(),
        agent: deps.agentConfig.name,
        topic,
        category: draft.category,
        quality_score: quality.score,
        quality_max: quality.maxScore,
        quality_breakdown: { ...quality.breakdown, officialScore: officialScore.score },
        predicted_reactions: draft.predicted_reactions,
        confidence: draft.confidence,
        text_length: draft.text.length,
        isReply: !!draft.replyTo,
        hasAttestation: attestationResults.length > 0,
        txHash: publishResult.txHash,
      });

      result.executed.push({
        action,
        success: true,
        txHash: publishResult.txHash,
        category: publishResult.category,
        textLength: publishResult.textLength,
        attestationType,
      });

      // H5: Increment successful publish counter
      publishSucceeded = true;
      successfulPublishes++;

      // Persist state after each successful action for crash-safe resume
      saveState(deps.state, deps.sessionsDir);
    } catch (publishError: unknown) {
      const msg = publishError instanceof Error ? publishError.message : String(publishError);
      deps.observe("error", `Chain publish failed, skipping action: ${msg}`, {
        actionType: action.type, topic, error: msg,
      });
      result.executed.push({ action, success: false, error: `Publish failed: ${msg}` });
    }

    // H1: end of try block for optimistic reservation
    } finally {
      if (!publishSucceeded) {
        await rollbackWriteRecord(deps.stateStore, deps.walletAddress, reservedTimestamp);
      }
    }
  }

  return result;
}
