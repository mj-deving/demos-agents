import { expandTopicToDomains } from "../../toolkit/sources/topic-vocabulary.js";
import type { SignalRule } from "./signal-detection.js";

/**
 * An intent describes WHAT to look for and WHERE.
 * Can be explicit (CLI/YAML) or derived from agent persona.
 */
export interface ScanIntent {
  /** Human-readable description — also used as LLM context */
  description: string;
  /** Domain tags to filter sources (maps to sourceView.index.byDomainTag) */
  domains: string[];
  /** Topic tokens to filter sources (maps to sourceView.index.byTopicToken) */
  topics: string[];
  /** Signal rules to apply to fetched data */
  signals: SignalRule[];
  /** Max sources to fetch for this intent per session */
  maxSources?: number;
}

const STOP_WORDS = new Set([
  "the", "and", "from", "for", "with", "into", "that", "this",
  "are", "was", "will", "has", "have", "had", "not", "but",
  "its", "all", "can", "may", "via", "per",
]);

/**
 * Derive intents from agent persona topics when no explicit intents are configured.
 * Each primary topic becomes one intent with a wildcard change signal.
 */
export function deriveIntentsFromTopics(
  topics: { primary: string[]; secondary: string[] },
): ScanIntent[] {
  return topics.primary.map(topic => ({
    description: `Monitor ${topic} for significant changes`,
    domains: [],
    topics: [topic],
    signals: [{ type: "change" as const, metric: "*", threshold: 10 }],
    maxSources: 3,
  }));
}

/**
 * Derive intents from colony signal topic strings.
 *
 * Signal topics are natural-language phrases like "BTC Macro Pressure from
 * Geopolitics PBOC and Derivatives Market". We extract domain-like keywords
 * as both `topics` (matched via byTopicToken) and `domains` (matched via
 * byDomainTag) so that selectSourcesByIntent can find relevant sources.
 *
 * Stop words and short tokens are filtered out to avoid false positives.
 */
export function deriveIntentsFromSignalTopics(
  signalTopics: string[],
  knownDomainTags?: Set<string>,
): ScanIntent[] {
  if (signalTopics.length === 0) return [];

  return signalTopics.map(topic => {
    const tokens = topic
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(token => token.length >= 3 && !STOP_WORDS.has(token));

    const expandedDomains = expandTopicToDomains(tokens, knownDomainTags);

    return {
      description: `Signal: ${topic}`,
      domains: expandedDomains,
      topics: [topic],
      signals: [{ type: "change" as const, metric: "*", threshold: 10 }],
      maxSources: 3,
    };
  });
}
