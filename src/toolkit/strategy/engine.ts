/**
 * Strategy engine — core rules and candidate selection.
 *
 * Core rules: reply_to_mentions, engage_verified, reply_with_evidence,
 * publish_to_gaps, tip_valuable.
 *
 * Enrichment rules → engine-enrichment.ts
 * Contradiction rule → engine-contradiction.ts
 * Shared helpers → engine-helpers.ts
 */

import type { AvailableEvidence } from "../colony/available-evidence.js";
import type { ColonyState } from "../colony/state-extraction.js";
import { computeMedian } from "../math/baseline.js";
import type { DecisionContext, DecisionLog, StrategyAction, StrategyConfig } from "./types.js";
import {
  ABSOLUTE_TIP_CEILING_DEM,
  BAIT_PATTERNS,
  MAX_PUBLISH_EVIDENCE_FRESHNESS_SECONDS,
  MIN_PUBLISH_EVIDENCE_RICHNESS,
  MIN_TRUST_POSTS,
  applyLeaderboardAdjustment,
  buildEvidenceIndex,
  createAction,
  findRule,
  getRule,
  getRateLimitState,
  getVerifiedTopics,
  hasAttestationSignal,
  normalize,
  reject,
} from "./engine-helpers.js";
import { evaluateEnrichmentRules } from "./engine-enrichment.js";
import { evaluateContradictionRule } from "./engine-contradiction.js";

// Re-export for backward compatibility — callers import from engine.ts
export { applyLeaderboardAdjustment } from "./engine-helpers.js";

export function decideActions(
  colonyState: ColonyState,
  availableEvidence: AvailableEvidence[],
  config: StrategyConfig,
  context: DecisionContext,
): { actions: StrategyAction[]; log: DecisionLog } {
  const now = context.now ?? new Date();
  const evidenceIndex = buildEvidenceIndex(availableEvidence);
  const considered: DecisionLog["considered"] = [];
  const rejected: DecisionLog["rejected"] = [];
  const candidates: Array<{ action: StrategyAction; rule: string }> = [];
  const trustedAuthors = new Map(
    colonyState.agents.topContributors.map((contributor) => [normalize(contributor.author), contributor]),
  );

  const verifiedTopics = getVerifiedTopics(colonyState, evidenceIndex);
  const contributorMedian = computeMedian(colonyState.agents.topContributors.map((contributor) => contributor.avgReactions));

  // ── Core Rule: reply_to_mentions ────────────────
  const mentionsRule = getRule(config, "reply_to_mentions");
  if (mentionsRule) {
    for (const mention of colonyState.threads.mentionsOfUs) {
      const trusted = trustedAuthors.get(normalize(mention.author));
      const action = createAction(
        mentionsRule,
        `Reply to trusted mention from ${mention.author}`,
        {
          target: mention.txHash,
          metadata: {
            author: mention.author,
          },
        },
      );

      considered.push({ action, rule: mentionsRule.name });

      const profile = context.intelligence?.agentProfiles?.[normalize(mention.author)];
      const isTrusted = profile
        ? profile.postCount >= MIN_TRUST_POSTS && profile.avgAgrees > profile.avgDisagrees * 2
        : trusted && trusted.postCount >= MIN_TRUST_POSTS;

      if (!isTrusted) {
        reject(
          rejected,
          mentionsRule,
          action,
          profile
            ? `Author ${mention.author} profile trust check failed (posts=${profile.postCount}, agrees=${profile.avgAgrees.toFixed(1)}, disagrees=${profile.avgDisagrees.toFixed(1)})`
            : `Author ${mention.author} is not a trusted contributor (MIN_TRUST_POSTS=${MIN_TRUST_POSTS})`,
        );
        continue;
      }

      const looksLikeBait = BAIT_PATTERNS.some((pattern) => pattern.test(mention.text));
      if (looksLikeBait && !hasAttestationSignal(mention.text, evidenceIndex)) {
        reject(rejected, mentionsRule, action, "Mention matched bait pattern without attestation data");
        continue;
      }

      candidates.push({ action, rule: mentionsRule.name });
    }
  }

  // ── Core Rule: engage_verified ──────────────────
  const engageRule = getRule(config, "engage_verified");
  if (engageRule) {
    if (verifiedTopics.length > 0) {
      for (const contributor of colonyState.agents.topContributors) {
        if (contributor.avgReactions < contributorMedian) {
          continue;
        }

        const evidenceIds = verifiedTopics.flatMap(({ evidence }) => evidence.map((item) => item.sourceId));
        const action = createAction(
          engageRule,
          `Engage contributor ${contributor.author} on verified topic coverage`,
          {
            target: contributor.author,
            targetType: "agent",
            evidence: evidenceIds,
            metadata: {
              topics: verifiedTopics.map(({ topic }) => topic),
              avgReactions: contributor.avgReactions,
            },
          },
        );

        candidates.push({ action, rule: engageRule.name });
        considered.push({ action, rule: engageRule.name });
      }
    }
  }

  // ── Core Rule: reply_with_evidence ──────────────
  const replyWithEvidenceRule = getRule(config, "reply_with_evidence");
  if (replyWithEvidenceRule) {
    const evidenceIds = verifiedTopics.flatMap(({ evidence }) => evidence.map((item) => item.sourceId));

    if (verifiedTopics.length > 0) {
      for (const discussion of colonyState.threads.activeDiscussions) {
        const action = createAction(
          replyWithEvidenceRule,
          `Reply in active discussion ${discussion.rootTxHash} with matching evidence`,
          {
            target: discussion.rootTxHash,
            evidence: evidenceIds,
            metadata: {
              topics: verifiedTopics.map(({ topic }) => topic),
              replyCount: discussion.replyCount,
            },
          },
        );

        candidates.push({ action, rule: replyWithEvidenceRule.name });
        considered.push({ action, rule: replyWithEvidenceRule.name });
      }
    }
  }

  // ── Core Rule: publish_to_gaps ──────────────────
  const publishRule = getRule(config, "publish_to_gaps");
  if (publishRule) {
    const calibrationOffset = context.calibration?.offset ?? 0;
    const adjustedRichnessThreshold = Math.max(50, MIN_PUBLISH_EVIDENCE_RICHNESS + calibrationOffset * 5);
    const briefingLower = context.briefingContext?.toLowerCase();
    const briefingBoost = config.briefingBoost ?? 10;

    for (const gap of colonyState.gaps.underservedTopics) {
      const matchingEvidence = (evidenceIndex.get(normalize(gap.topic)) ?? [])
        .filter((item) =>
          !item.stale
          && item.freshness < MAX_PUBLISH_EVIDENCE_FRESHNESS_SECONDS
          && item.richness > adjustedRichnessThreshold
        );

      if (matchingEvidence.length === 0) {
        continue;
      }

      const action = createAction(
        publishRule,
        `Publish fresh evidence into underserved topic ${gap.topic}`,
        {
          target: gap.topic,
          evidence: matchingEvidence.map((item) => item.sourceId),
          metadata: {
            lastPostAt: gap.lastPostAt,
          },
        },
      );

      if (briefingLower?.includes(normalize(gap.topic))) {
        action.priority += briefingBoost;
        action.reason += " (briefing-aligned)";
      }

      candidates.push({ action, rule: publishRule.name });
      considered.push({ action, rule: publishRule.name });
    }
  }

  // ── Core Rule: tip_valuable ─────────────────────
  const tipRule = getRule(config, "tip_valuable");
  if (tipRule) {
    for (const contributor of colonyState.agents.topContributors) {
      if (contributor.avgReactions <= contributorMedian) {
        continue;
      }

      const recentTipCount = context.intelligence?.recentTips?.[normalize(contributor.author)] ?? 0;
      if (recentTipCount > 0) {
        const skipAction = createAction(tipRule, `Tip ${contributor.author} skipped (already tipped ${recentTipCount}x in 24h)`, { target: contributor.author });
        considered.push({ action: skipAction, rule: tipRule.name });
        reject(rejected, tipRule, skipAction, `Already tipped ${contributor.author} ${recentTipCount} time(s) in last 24h`);
        continue;
      }

      const tipCalibration = (context.calibration?.offset ?? 0) > 0 ? 1 : 0;
      const amount = Math.max(
        1,
        Math.min(
          ABSOLUTE_TIP_CEILING_DEM,
          config.rateLimits.maxTipAmount,
          Math.round(contributor.avgReactions - contributorMedian) + tipCalibration,
        ),
      );

      const action = createAction(
        tipRule,
        `Tip contributor ${contributor.author} for above-median performance`,
        {
          target: contributor.author,
          metadata: {
            amount,
            avgReactions: contributor.avgReactions,
            medianAvgReactions: contributorMedian,
          },
        },
      );

      candidates.push({ action, rule: tipRule.name });
      considered.push({ action, rule: tipRule.name });
    }
  }

  // ── Enrichment Rules (engine-enrichment.ts) ─────
  evaluateEnrichmentRules(config, context, evidenceIndex, candidates, considered);

  // ── Contradiction Rule (engine-contradiction.ts) ─
  evaluateContradictionRule(config, context, evidenceIndex, candidates, considered);

  // ── Leaderboard Adjustment + Candidate Selection ─
  if (config.leaderboardAdjustment?.enabled) {
    applyLeaderboardAdjustment(
      candidates.map((c) => c.action),
      context.apiEnrichment?.leaderboard,
      context.ourAddress,
      config.leaderboardAdjustment,
    );
  }

  candidates.sort((left, right) =>
    right.action.priority - left.action.priority
    || ((left.action.target ?? "") < (right.action.target ?? "") ? -1 : (left.action.target ?? "") > (right.action.target ?? "") ? 1 : 0)
  );

  const remaining = getRateLimitState(config, context);
  const selected: StrategyAction[] = [];

  for (const candidate of candidates) {
    if (candidate.action.type === "ENGAGE") {
      if (remaining.reactionsRemaining <= 0) {
        reject(rejected, findRule(config, candidate.rule), candidate.action, "Reaction session limit exhausted");
        continue;
      }

      remaining.reactionsRemaining -= 1;
      selected.push(candidate.action);
      continue;
    }

    if (candidate.action.type === "REPLY" || candidate.action.type === "PUBLISH") {
      if (remaining.dailyRemaining <= 0) {
        reject(rejected, findRule(config, candidate.rule), candidate.action, "Daily post limit exhausted");
        continue;
      }
      if (remaining.hourlyRemaining <= 0) {
        reject(rejected, findRule(config, candidate.rule), candidate.action, "Hourly post limit exhausted");
        continue;
      }

      remaining.dailyRemaining -= 1;
      remaining.hourlyRemaining -= 1;
      selected.push(candidate.action);
      continue;
    }

    // Phase 8: VOTE/BET rate limiting — shares daily+hourly post budget + dedicated bet cap
    if (candidate.action.type === "VOTE" || candidate.action.type === "BET") {
      if (remaining.dailyRemaining <= 0) {
        reject(rejected, findRule(config, candidate.rule), candidate.action, "Daily post limit exhausted");
        continue;
      }
      if (remaining.hourlyRemaining <= 0) {
        reject(rejected, findRule(config, candidate.rule), candidate.action, "Hourly post limit exhausted");
        continue;
      }
      const betsPerDay = config.rateLimits.betsPerDay ?? 3;
      const betsUsed = selected.filter((s) => s.type === "VOTE" || s.type === "BET").length;
      if (betsUsed >= betsPerDay) {
        reject(rejected, findRule(config, candidate.rule), candidate.action, `Bet daily limit exhausted (${betsPerDay})`);
        continue;
      }
      remaining.dailyRemaining -= 1;
      remaining.hourlyRemaining -= 1;
      selected.push(candidate.action);
      continue;
    }

    selected.push(candidate.action);
  }

  return {
    actions: selected,
    log: {
      timestamp: now.toISOString(),
      considered,
      selected,
      rejected,
      rateLimitState: remaining,
    },
  };
}
