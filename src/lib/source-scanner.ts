/**
 * Source scanner — Phase 2 of intent-driven scanning.
 *
 * Wires together intent specification, source selection by index,
 * source fetching, and signal detection into a single scan pipeline.
 *
 * Standalone library — no side effects, no I/O beyond what callers provide.
 * CLI entry point is in cli/source-scan.ts.
 */

import type { SourceRecordV2, AgentSourceView } from "./sources/catalog.js";
import type { EvidenceEntry } from "./sources/providers/types.js";
import type { FetchSourceResult } from "./sources/fetch.js";
import type { DetectedSignal, SignalRule } from "./signal-detection.js";

// ── Types ─────────────────────────────────────────────

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

/**
 * Options for source scan execution.
 */
export interface SourceScanOptions {
  /** Intents to scan for */
  intents: ScanIntent[];
  /** Global max sources across all intents */
  maxSources?: number;
  /** Minimum signal strength to include in results */
  minSignalStrength?: number;
  /** Dry run — detect signals but don't generate suggestions */
  dryRun?: boolean;
}

/**
 * A gate suggestion produced from detected signals.
 */
export interface GateSuggestion {
  topic: string;
  category: "ANALYSIS" | "OPINION";
  sourceData: {
    source: string;
    url: string;
    summary: string;
    metrics: Record<string, string | number> | undefined;
  };
  priority: number;
  attestationCost: number;
}

/**
 * Result of a source scan across all intents.
 */
export interface SourceScanResult {
  /** Detected signals, sorted by strength */
  signals: DetectedSignal[];
  /** Suggested topics for GATE phase */
  suggestions: GateSuggestion[];
  /** Sources fetched (for free attestation) */
  sourcesFetched: number;
  /** Baselines updated */
  baselinesUpdated: number;
}

// ── Allowed Statuses ─────────────────────────────────

const SCAN_ALLOWED_STATUSES = new Set(["active", "degraded"]);

// ── Intent Derivation ─────────────────────────────────

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

// ── Source Selection ──────────────────────────────────

/**
 * Select sources matching an intent using the source view's inverted index.
 * Matches on domain tags AND topic tokens, deduplicates, filters by status,
 * and respects maxSources.
 */
export function selectSourcesByIntent(
  intent: ScanIntent,
  sourceView: AgentSourceView,
): SourceRecordV2[] {
  const candidateIds = new Set<string>();

  // Match by domain tags
  for (const domain of intent.domains) {
    const ids = sourceView.index.byDomainTag.get(domain);
    if (ids) {
      for (const id of ids) candidateIds.add(id);
    }
  }

  // Match by topic tokens
  for (const topic of intent.topics) {
    // Tokenize the topic string
    const tokens = topic.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 2);
    for (const token of tokens) {
      const ids = sourceView.index.byTopicToken.get(token);
      if (ids) {
        for (const id of ids) candidateIds.add(id);
      }
    }
  }

  // Resolve IDs to sources, filter by status
  const candidates: SourceRecordV2[] = [];
  for (const id of candidateIds) {
    const source = sourceView.index.byId.get(id);
    if (source && SCAN_ALLOWED_STATUSES.has(source.status)) {
      candidates.push(source);
    }
  }

  // Sort by rating (best first)
  candidates.sort((a, b) => (b.rating.overall) - (a.rating.overall));

  // Respect maxSources
  const limit = intent.maxSources ?? 10;
  return candidates.slice(0, limit);
}

// ── Signal → Suggestion Conversion ───────────────────

/**
 * Convert detected signals to gate suggestions.
 * Source-first suggestions get a +0.5 priority bonus (attestation is free).
 */
export function signalsToSuggestions(
  signals: DetectedSignal[],
  minSignalStrength: number,
): GateSuggestion[] {
  return signals
    .filter(s => s.strength >= minSignalStrength)
    .map(s => ({
      topic: s.summary,
      category: (s.rule.type === "anti-signal" ? "OPINION" : "ANALYSIS") as "ANALYSIS" | "OPINION",
      sourceData: {
        source: s.source.name,
        url: s.fetchResult.response?.url ?? s.source.url,
        summary: s.summary,
        metrics: s.evidence.metrics,
      },
      priority: s.strength + 0.5, // +0.5 bonus over feed-derived suggestions
      attestationCost: 0, // Data already fetched
    }));
}
