import type { AvailableEvidence } from "../colony/available-evidence.js";
import type { ColonyState } from "../colony/state-extraction.js";
import { computeMedian } from "../math/baseline.js";
import type { DecisionContext, DecisionLog, StrategyAction, StrategyConfig, StrategyRule } from "./types.js";

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

      if (!trusted || trusted.postCount < MIN_TRUST_POSTS) {
        reject(
          rejected,
          mentionsRule,
          action,
          `Author ${mention.author} is not a trusted contributor (MIN_TRUST_POSTS=${MIN_TRUST_POSTS})`,
        );
        continue;
      }

      const looksLikeBait = BAIT_PATTERNS.some((pattern) => pattern.test(mention.text));
      if (looksLikeBait && !hasAttestationSignal(mention.text, evidenceIndex)) {
        reject(rejected, mentionsRule, action, "Mention matched bait pattern without attestation data");
        continue;
      }

      candidates.push({ action, rule: mentionsRule.name });
      considered.push({ action, rule: mentionsRule.name });
    }
  }

  const engageRule = getRule(config, "engage_verified");
  if (engageRule) {
    const contributorMedian = computeMedian(colonyState.agents.topContributors.map((contributor) => contributor.avgReactions));

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
    for (const gap of colonyState.gaps.underservedTopics) {
      const matchingEvidence = (evidenceIndex.get(normalize(gap.topic)) ?? [])
        .filter((item) =>
          !item.stale
          && item.freshness < MAX_PUBLISH_EVIDENCE_FRESHNESS_SECONDS
          && item.richness > MIN_PUBLISH_EVIDENCE_RICHNESS
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

      candidates.push({ action, rule: publishRule.name });
      considered.push({ action, rule: publishRule.name });
    }
  }

  const tipRule = getRule(config, "tip_valuable");
  if (tipRule) {
    const contributorMedian = computeMedian(colonyState.agents.topContributors.map((contributor) => contributor.avgReactions));

    for (const contributor of colonyState.agents.topContributors) {
      if (contributor.avgReactions <= contributorMedian) {
        continue;
      }

      // Defense-in-depth: clamp to absolute toolkit ceiling regardless of config
      const amount = Math.max(
        1,
        Math.min(
          ABSOLUTE_TIP_CEILING_DEM,
          config.rateLimits.maxTipAmount,
          Math.round(contributor.avgReactions - contributorMedian),
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
