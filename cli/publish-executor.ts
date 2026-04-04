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
import { checkClaimDedup, checkSelfDedup } from "../src/toolkit/colony/dedup.js";
import { encodeVotePost, encodeBinaryPost, validateBetPayload, validateBinaryPayload, MAX_BET_AMOUNT } from "../src/toolkit/colony/vote-bet-codec.js";
import { createSdkBridge, AUTH_PENDING_TOKEN } from "../src/toolkit/sdk-bridge.js";
import { checkSessionBudget, recordSpend, saveSpendingLedger } from "../src/lib/spending-policy.js";
import {
  checkAndRecordWrite,
  getWriteRateRemaining,
} from "../src/toolkit/guards/write-rate-limit.js";

// Re-export shared types so existing consumers don't break
export type { PublishActionResult, PublishExecutionResult, PublishExecutorDeps } from "./publish-types.js";
import type { PublishExecutionResult, PublishExecutorDeps } from "./publish-types.js";
import type { ResolvedActionSource } from "./publish-types.js";

import {
  MIN_TEXT_LENGTH,
  getActionTopic,
  getRequestedCategory,
  buildReplyContext,
  resolveSourceForAction,
  prefetchSourceData,
  toPublishAttestationType,
  buildPublishInput,
  appendState,
  runSingleAttestationFallback,
} from "./publish-helpers.js";

export async function executePublishActions(
  actions: StrategyAction[],
  deps: PublishExecutorDeps,
): Promise<PublishExecutionResult> {
  const result: PublishExecutionResult = {
    executed: [],
    skipped: [],
  };

  for (const action of actions) {
    // Phase 8: VOTE/BET — lightweight publish via codec, no LLM needed
    if (action.type === "VOTE" || action.type === "BET") {
      if (deps.dryRun) {
        deps.observe("insight", `${action.type} dry-run: ${action.reason}`, { actionType: action.type });
        result.executed.push({ action, success: true });
        continue;
      }
      // Write-rate guard (same as PUBLISH/REPLY — Codex review fix M6)
      const betRateError = await checkAndRecordWrite(deps.stateStore, deps.walletAddress, false);
      if (betRateError) {
        result.skipped.push({ action, reason: betRateError.message });
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

    // Dedup guard — check BEFORE generating draft to save LLM call
    if (deps.colonyDb && action.type === "PUBLISH") {
      const selfDedup = checkSelfDedup(deps.colonyDb, topic, deps.walletAddress);
      if (selfDedup.isDuplicate) {
        deps.observe("insight", `Publish skipped: ${selfDedup.reason}`, {
          actionType: action.type, topic,
        });
        result.skipped.push({ action, reason: selfDedup.reason ?? "self-dedup" });
        continue;
      }
      const colonyDedup = checkClaimDedup(deps.colonyDb, topic);
      if (colonyDedup.isDuplicate) {
        deps.observe("insight", `Publish skipped: ${colonyDedup.reason}`, {
          actionType: action.type, topic,
        });
        result.skipped.push({ action, reason: colonyDedup.reason ?? "colony-dedup" });
        continue;
      }
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

      // Confidence optimization: always set (free +5 points), ≥40 for consensus entry.
      // 40 matches strategy config enrichment.minConfidence default and SuperColony consensus
      // entry threshold (2+ agents, confidence ≥40, 24h lookback).
      if (draft.confidence === undefined || draft.confidence === null) {
        draft.confidence = 70;
      }
      if (draft.confidence < 40) {
        draft.confidence = 40;
      }

      // Score pre-calculation: assume DAHR attestation (+40) since it's the default mode.
      // TLSN does NOT earn the +40 bonus per SuperColony spec — TLSN-only agents will
      // have lower achievable scores. This is a platform constraint, not a bug.
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

      let attestationResults: import("../src/actions/publish-pipeline.js").AttestResult[] = [];
      let primaryAttestation: import("../src/actions/publish-pipeline.js").AttestResult | null = null;

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

      const quality = calculateStrategyScore({
        text: draft.text,
        isReply: !!draft.replyTo,
        hasAttestation: true,
      });
      // Official SuperColony score — used for platform compatibility assessment
      const officialScore = calculateOfficialScore({
        text: draft.text,
        hasSourceAttestations: true, // DAHR attestation present
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
