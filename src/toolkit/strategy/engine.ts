import type { AvailableEvidence } from "../colony/available-evidence.js";
import type { ColonyState } from "../colony/state-extraction.js";
import { computeMedian } from "../math/baseline.js";
import type { ApiEnrichmentData, DecisionContext, DecisionLog, LeaderboardAdjustmentConfig, StrategyAction, StrategyConfig, StrategyRule } from "./types.js";

const MIN_TRUST_POSTS = 3;
const MAX_PUBLISH_EVIDENCE_FRESHNESS_SECONDS = 3600;
const MIN_PUBLISH_EVIDENCE_RICHNESS = 100;
/** Absolute toolkit ceiling — cannot be exceeded regardless of config. */
const ABSOLUTE_TIP_CEILING_DEM = 10;
const BAIT_PATTERNS = [
  /\bscam\b/i,
  /\bfraud(?:ulent)?\b/i,
  /\bpathetic\b/i,
  /\bidiot\b/i,
  /\bstupid\b/i,
  /\btrash\b/i,
  /\bponzi\b/i,
  /\bliar\b/i,
  /\bbagholder\b/i,
];

type RejectedAction = DecisionLog["rejected"][number];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function buildEvidenceIndex(availableEvidence: AvailableEvidence[]): Map<string, AvailableEvidence[]> {
  const index = new Map<string, AvailableEvidence[]>();

  for (const item of availableEvidence) {
    const key = normalize(item.subject);
    const existing = index.get(key);
    if (existing) {
      existing.push(item);
      continue;
    }
    index.set(key, [item]);
  }

  return index;
}

function getRule(config: StrategyConfig, name: string): StrategyRule | null {
  const rule = config.rules.find((candidate) => candidate.name === name);
  if (!rule || !rule.enabled) {
    return null;
  }
  return rule;
}

function createAction(
  rule: StrategyRule,
  reason: string,
  extras: Omit<StrategyAction, "type" | "priority" | "reason"> = {},
): StrategyAction {
  return {
    type: rule.type,
    priority: rule.priority,
    reason,
    ...extras,
  };
}

function reject(
  rejected: RejectedAction[],
  rule: StrategyRule,
  action: StrategyAction,
  reason: string,
): void {
  rejected.push({ action, rule: rule.name, reason });
}

function hasAttestationSignal(text: string, evidenceIndex: Map<string, AvailableEvidence[]>): boolean {
  const normalizedText = normalize(text);

  for (const [subject, evidence] of evidenceIndex.entries()) {
    if (normalizedText.includes(subject) && evidence.some((item) => !item.stale)) {
      return true;
    }
  }

  return false;
}

function getVerifiedTopics(
  state: ColonyState,
  evidenceIndex: Map<string, AvailableEvidence[]>,
): Array<{ topic: string; evidence: AvailableEvidence[] }> {
  return state.activity.trendingTopics
    .map(({ topic }) => ({
      topic,
      evidence: evidenceIndex.get(normalize(topic)) ?? [],
    }))
    .filter(({ evidence }) => evidence.some((item) => !item.stale));
}

function getRateLimitState(
  config: StrategyConfig,
  context: DecisionContext,
): DecisionLog["rateLimitState"] {
  return {
    dailyRemaining: Math.max(0, config.rateLimits.postsPerDay - context.postsToday),
    hourlyRemaining: Math.max(0, config.rateLimits.postsPerHour - context.postsThisHour),
    reactionsRemaining: Math.max(0, config.rateLimits.reactionsPerSession - context.sessionReactionsUsed),
  };
}

function findRule(config: StrategyConfig, ruleName: string): StrategyRule {
  return config.rules.find((rule) => rule.name === ruleName) ?? {
    name: ruleName,
    type: "ENGAGE",
    priority: 0,
    conditions: [],
    enabled: true,
  };
}

/**
 * Phase 7: Adjust action priorities based on leaderboard rank.
 *
 * Top quartile: boost engagement/tip (maintain community presence).
 * Bottom quartile: boost publish (build reputation through content).
 * Middle: no adjustment (baseline priorities).
 */
export function applyLeaderboardAdjustment(
  actions: StrategyAction[],
  leaderboard: ApiEnrichmentData["leaderboard"],
  ourAddress: string,
  config: LeaderboardAdjustmentConfig,
): void {
  if (!leaderboard?.agents?.length) return;

  const totalAgents = leaderboard.agents.length;
  const normalizedOurAddress = normalize(ourAddress);
  const ourIndex = leaderboard.agents.findIndex(
    (entry) => normalize(entry.address) === normalizedOurAddress,
  );
  if (ourIndex === -1) return;

  // Rank as percentile: 0 = top, 1 = bottom
  const percentile = ourIndex / totalAgents;

  for (const action of actions) {
    if (percentile <= 0.25) {
      if (action.type === "ENGAGE" || action.type === "TIP") {
        action.priority += config.topBoostEngagement;
      }
      if (action.type === "PUBLISH") {
        action.priority += config.topAdjustPublish;
      }
    } else if (percentile >= 0.75) {
      if (action.type === "PUBLISH") {
        action.priority += config.bottomBoostPublish;
      }
      if (action.type === "ENGAGE" || action.type === "TIP") {
        action.priority += config.bottomAdjustEngagement;
      }
    }
  }
}

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

  // Compute verified topics once — used by engage_verified and reply_with_evidence
  const verifiedTopics = getVerifiedTopics(colonyState, evidenceIndex);

  // Compute contributor median once — used by engage_verified and tip_valuable
  const contributorMedian = computeMedian(colonyState.agents.topContributors.map((contributor) => contributor.avgReactions));

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

      // Trust check: use agent profile if available (Phase 6b), fall back to topContributors
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

  const publishRule = getRule(config, "publish_to_gaps");
  if (publishRule) {
    // Calibration adjusts evidence richness threshold:
    // Outperforming (offset > 0) → raise bar (more selective)
    // Underperforming (offset < 0) → lower bar (publish more to build volume)
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

      // Phase 7: Briefing-aligned boost — topics mentioned in colony report get priority
      if (briefingLower?.includes(normalize(gap.topic))) {
        action.priority += briefingBoost;
        action.reason += " (briefing-aligned)";
      }

      candidates.push({ action, rule: publishRule.name });
      considered.push({ action, rule: publishRule.name });
    }
  }

  const tipRule = getRule(config, "tip_valuable");
  if (tipRule) {
    for (const contributor of colonyState.agents.topContributors) {
      if (contributor.avgReactions <= contributorMedian) {
        continue;
      }

      // Skip recently tipped agents (Phase 6b — only tips, not all interactions)
      const recentTipCount = context.intelligence?.recentTips?.[normalize(contributor.author)] ?? 0;
      if (recentTipCount > 0) {
        const skipAction = createAction(tipRule, `Tip ${contributor.author} skipped (already tipped ${recentTipCount}x in 24h)`, { target: contributor.author });
        considered.push({ action: skipAction, rule: tipRule.name });
        reject(rejected, tipRule, skipAction, `Already tipped ${contributor.author} ${recentTipCount} time(s) in last 24h`);
        continue;
      }

      // Calibration adjusts tip generosity: outperforming → tip more, underperforming → tip less
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

  // ── Phase 6b: Intelligence-Aware Rules ─────────────────────
  const enrichment = context.apiEnrichment;

  const engageNovelRule = getRule(config, "engage_novel_agents");
  if (engageNovelRule && enrichment?.leaderboard) {
    const recentTargets = new Set(
      candidates
        .filter((c) => c.action.type === "ENGAGE")
        .map((c) => normalize(c.action.target ?? "")),
    );

    for (const agent of enrichment.leaderboard.agents.slice(0, 10)) {
      if (recentTargets.has(normalize(agent.address))) continue;
      if (agent.bayesianScore < (enrichment.leaderboard.globalAvg ?? 0)) continue;
      // Skip agents we've already interacted with recently
      if ((context.intelligence?.recentInteractions?.[normalize(agent.address)] ?? 0) > 0) continue;

      const action = createAction(
        engageNovelRule,
        `Engage novel high-quality agent ${agent.name ?? agent.address} (score ${agent.bayesianScore.toFixed(1)})`,
        {
          target: agent.address,
          targetType: "agent",
          metadata: {
            bayesianScore: agent.bayesianScore,
            totalPosts: agent.totalPosts,
          },
        },
      );

      candidates.push({ action, rule: engageNovelRule.name });
      considered.push({ action, rule: engageNovelRule.name });
    }
  }

  // ── Phase 6a: Enrichment-Aware Rules ────────────────────────

  const signalAlignedRule = getRule(config, "publish_signal_aligned");
  if (signalAlignedRule && enrichment?.signals) {
    for (const signal of enrichment.signals) {
      if (!signal.trending || signal.agents < (config.enrichment?.minSignalAgents ?? 2)) continue;

      const matchingEvidence = (evidenceIndex.get(normalize(signal.topic)) ?? [])
        .filter((item) => !item.stale);

      if (matchingEvidence.length === 0) continue;

      const action = createAction(
        signalAlignedRule,
        `Publish signal-aligned content on trending topic ${signal.topic} (${signal.agents} agents)`,
        {
          target: signal.topic,
          evidence: matchingEvidence.map((item) => item.sourceId),
          metadata: {
            signalConsensus: signal.consensus,
            signalAgents: signal.agents,
            signalSummary: signal.summary,
          },
        },
      );

      candidates.push({ action, rule: signalAlignedRule.name });
      considered.push({ action, rule: signalAlignedRule.name });
    }
  }

  const divergenceRule = getRule(config, "publish_on_divergence");
  if (divergenceRule && enrichment?.oracle?.priceDivergences) {
    const divergenceThreshold = config.enrichment?.divergenceThreshold ?? 10;

    for (const div of enrichment.oracle.priceDivergences) {
      if (Math.abs(div.spread) < divergenceThreshold) continue;

      const action = createAction(
        divergenceRule,
        `Publish divergence analysis: ${div.asset} spread ${div.spread > 0 ? "+" : ""}${div.spread}%`,
        {
          target: div.asset.toLowerCase(),
          metadata: {
            asset: div.asset,
            cexPrice: div.cex,
            dexPrice: div.dex,
            spread: div.spread,
            sentiment: enrichment.oracle.sentiment?.[div.asset],
          },
        },
      );

      candidates.push({ action, rule: divergenceRule.name });
      considered.push({ action, rule: divergenceRule.name });
    }
  }

  const predictionRule = getRule(config, "publish_prediction");
  if (
    predictionRule
    && enrichment?.ballotAccuracy
    && enrichment.ballotAccuracy.accuracy > (config.enrichment?.minBallotAccuracy ?? 0.5)
    && enrichment.prices
    && enrichment.prices.length > 0
  ) {
    const action = createAction(
      predictionRule,
      `Publish prediction — ballot accuracy ${(enrichment.ballotAccuracy.accuracy * 100).toFixed(0)}%, streak ${enrichment.ballotAccuracy.streak}`,
      {
        metadata: {
          accuracy: enrichment.ballotAccuracy.accuracy,
          streak: enrichment.ballotAccuracy.streak,
          totalVotes: enrichment.ballotAccuracy.totalVotes,
          availableAssets: enrichment.prices.map((p) => p.asset),
        },
      },
    );

    candidates.push({ action, rule: predictionRule.name });
    considered.push({ action, rule: predictionRule.name });
  }

  // ── Phase 8b: Contradiction-Driven Disagree ───────────────────
  const contradictionRule = getRule(config, "disagree_contradiction");
  if (contradictionRule && context.intelligence?.contradictions) {
    for (const contradiction of context.intelligence.contradictions) {
      // Only generate REPLY if we have a supported value (evidence to back the disagreement)
      if (contradiction.supportedValue === null) continue;

      const action = createAction(
        contradictionRule,
        `Contradiction on ${contradiction.subject}/${contradiction.metric}: ${contradiction.claims.length} conflicting claims`,
        {
          target: contradiction.targetPostTxHash,
          evidence: contradiction.supportedValue !== null
            ? (evidenceIndex.get(normalize(contradiction.subject)) ?? []).map((e) => e.sourceId)
            : [],
          metadata: {
            subject: contradiction.subject,
            metric: contradiction.metric,
            supportedValue: contradiction.supportedValue,
            claimCount: contradiction.claims.length,
            topics: [contradiction.subject],
          },
        },
      );

      candidates.push({ action, rule: contradictionRule.name });
      considered.push({ action, rule: contradictionRule.name });
    }
  }

  // Phase 7: Apply leaderboard-based priority adjustment before sorting
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
    || (left.action.target ?? "").localeCompare(right.action.target ?? "")
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
