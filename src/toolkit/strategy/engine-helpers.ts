/**
 * Shared helpers for the strategy engine modules.
 *
 * Extracted to avoid circular imports between engine.ts, engine-enrichment.ts,
 * and engine-contradiction.ts. All functions are pure.
 */

import type { AvailableEvidence } from "../colony/available-evidence.js";
import type { ColonyState } from "../colony/state-extraction.js";
import type { SignalData } from "../supercolony/types.js";
import type { ApiEnrichmentData, DecisionLog, LeaderboardAdjustmentConfig, StrategyAction, StrategyConfig, StrategyRule } from "./types.js";

export const MIN_TRUST_POSTS = 3;
export const MAX_PUBLISH_EVIDENCE_FRESHNESS_SECONDS = 3600;
export const MIN_PUBLISH_EVIDENCE_RICHNESS = 50;
/** Absolute toolkit ceiling — cannot be exceeded regardless of config. */
export const ABSOLUTE_TIP_CEILING_DEM = 10;
export const BAIT_PATTERNS = [
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

export type RejectedAction = DecisionLog["rejected"][number];
export type EngineCandidate = { action: StrategyAction; rule: string };
export interface TopicEvidenceMatch {
  normalizedTopic: string;
  topicTokens: string[];
  matchedKeys: string[];
  evidence: AvailableEvidence[];
}

export function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function tokenizeTopic(value: string): string[] {
  const normalized = normalize(value);
  if (!normalized) return [];

  return Array.from(new Set(
    normalized
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3),
  ));
}

export function buildEvidenceIndex(availableEvidence: AvailableEvidence[]): Map<string, AvailableEvidence[]> {
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

export function findTopicEvidenceMatches(
  topic: string,
  evidenceIndex: Map<string, AvailableEvidence[]>,
): TopicEvidenceMatch {
  const normalizedTopic = normalize(topic);
  const topicTokens = tokenizeTopic(normalizedTopic);
  const requestedKeys = new Set([normalizedTopic, ...topicTokens]);
  const matchedKeys: string[] = [];
  const seenKeys = new Set<string>();
  const evidenceBySourceId = new Map<string, AvailableEvidence>();

  const addEntries = (key: string, entries: AvailableEvidence[]): void => {
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      matchedKeys.push(key);
    }

    for (const item of entries) {
      evidenceBySourceId.set(item.sourceId, item);
    }
  };

  for (const key of requestedKeys) {
    const entries = evidenceIndex.get(key);
    if (entries) addEntries(key, entries);
  }

  if (topicTokens.length > 0) {
    const topicTokenSet = new Set(topicTokens);
    for (const [key, entries] of evidenceIndex.entries()) {
      if (seenKeys.has(key)) continue;
      const keyTokens = tokenizeTopic(key);
      const overlapCount = keyTokens.filter((token) => topicTokenSet.has(token)).length;
      // Require 2+ shared tokens to avoid false positives from generic terms like "bitcoin" or "market"
      if (overlapCount >= 2) {
        addEntries(key, entries);
      }
    }
  }

  return {
    normalizedTopic,
    topicTokens,
    matchedKeys,
    evidence: Array.from(evidenceBySourceId.values()),
  };
}

export function getRule(config: StrategyConfig, name: string): StrategyRule | null {
  const rule = config.rules.find((candidate) => candidate.name === name);
  if (!rule || !rule.enabled) {
    return null;
  }
  return rule;
}

export function createAction(
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

export function reject(
  rejected: RejectedAction[],
  rule: StrategyRule,
  action: StrategyAction,
  reason: string,
): void {
  rejected.push({ action, rule: rule.name, reason });
}

export function hasAttestationSignal(text: string, evidenceIndex: Map<string, AvailableEvidence[]>): boolean {
  const normalizedText = normalize(text);

  for (const [subject, evidence] of evidenceIndex.entries()) {
    if (normalizedText.includes(subject) && evidence.some((item) => !item.stale)) {
      return true;
    }
  }

  return false;
}

export function getVerifiedTopics(
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

export function getRateLimitState(
  config: StrategyConfig,
  context: { postsToday: number; postsThisHour: number; sessionReactionsUsed: number },
): DecisionLog["rateLimitState"] {
  return {
    dailyRemaining: Math.max(0, config.rateLimits.postsPerDay - context.postsToday),
    hourlyRemaining: Math.max(0, config.rateLimits.postsPerHour - context.postsThisHour),
    reactionsRemaining: Math.max(0, config.rateLimits.reactionsPerSession - context.sessionReactionsUsed),
  };
}

export function findRule(config: StrategyConfig, ruleName: string): StrategyRule {
  return config.rules.find((rule) => rule.name === ruleName) ?? {
    name: ruleName,
    type: "ENGAGE",
    priority: 0,
    conditions: [],
    enabled: true,
  };
}

/**
 * M3: Check whether a signal qualifies for publish_signal_aligned.
 * Uses the same criteria as the enrichment rule filter:
 * trending !== false AND agentCount >= minSignalAgents.
 */
export function signalQualifies(signal: SignalData, config: StrategyConfig): boolean {
  if (signal.trending === false) return false;
  if (signal.agentCount < (config.enrichment?.minSignalAgents ?? 2)) return false;
  return true;
}

/**
 * M3: Check whether any signal in the enrichment data qualifies.
 * Returns true if there are no signals at all (no suppression needed).
 * Returns false only when signals exist but none qualify.
 */
export function hasQualifyingSignals(config: StrategyConfig, signals: SignalData[] | undefined): boolean {
  if (!signals || signals.length === 0) return true; // No signals = no suppression
  return signals.some((signal) => signalQualifies(signal, config));
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
