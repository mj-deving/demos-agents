/**
 * Source scanner — Phase 2 of intent-driven scanning.
 *
 * Wires together intent specification, source selection by index,
 * source fetching, and signal detection into a single scan pipeline.
 *
 * Standalone library — no side effects, no I/O beyond what callers provide.
 * CLI entry point is in cli/source-scan.ts.
 */

import type { SourceRecordV2, AgentSourceView } from "../sources/catalog.js";
import type { EvidenceEntry } from "../sources/providers/types.js";
import type { FetchSourceResult } from "../sources/fetch.js";
import { fetchSource } from "../sources/fetch.js";
import { getProviderAdapter } from "../sources/providers/index.js";
import {
  detectSignals,
  updateBaseline,
  type DetectedSignal,
  type SignalRule,
  type BaselineStore,
} from "./signal-detection.js";
import { observe } from "./observe.js";

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
): ScanIntent[] {
  if (signalTopics.length === 0) return [];

  // Common stop words that don't carry domain meaning
  const STOP_WORDS = new Set([
    "the", "and", "from", "for", "with", "into", "that", "this",
    "are", "was", "will", "has", "have", "had", "not", "but",
    "its", "all", "can", "may", "via", "per",
  ]);

  return signalTopics.map(topic => {
    // Extract meaningful tokens (3+ chars, not stop words)
    const tokens = topic
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length >= 3 && !STOP_WORDS.has(t));

    return {
      description: `Signal: ${topic}`,
      // Use tokens as both domains and topics for maximum source coverage
      domains: tokens,
      topics: [topic],
      signals: [{ type: "change" as const, metric: "*", threshold: 10 }],
      maxSources: 3,
    };
  });
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

// ── TopicSuggestion (session-runner compatible) ──────

/**
 * A topic suggestion compatible with session-runner's TopicSuggestion type.
 * Used by mergeAndDedup to produce a unified suggestion list.
 */
export interface TopicSuggestion {
  topic: string;
  category: string;
  reason: string;
  replyTo?: { txHash: string; author: string; text: string };
}

// ── Topic Tokenization ───────────────────────────────

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 2)
  );
}

// ── Merge and Dedup ──────────────────────────────────

/**
 * Merge feed-scan and source-scan suggestions, deduplicating by topic token overlap.
 * Source suggestions appear first (attestation is free).
 *
 * Dedup logic: if two suggestions share any token (from tokenizing their topic),
 * the first one wins. Since source suggestions are placed first, they win ties.
 */
export function mergeAndDedup(
  feedSuggestions: TopicSuggestion[],
  sourceSuggestions: TopicSuggestion[],
): TopicSuggestion[] {
  const merged: TopicSuggestion[] = [];
  const seenTokens = new Set<string>();

  // Source suggestions first (free attestation priority)
  for (const suggestion of [...sourceSuggestions, ...feedSuggestions]) {
    const tokens = tokenize(suggestion.topic);
    // Check if any token was already seen
    let isDuplicate = false;
    for (const token of tokens) {
      if (seenTokens.has(token)) {
        isDuplicate = true;
        break;
      }
    }
    if (isDuplicate) continue;

    // Mark all tokens as seen
    for (const token of tokens) {
      seenTokens.add(token);
    }
    merged.push(suggestion);
  }

  return merged;
}

// ── Source Scan Orchestration ─────────────────────────

/**
 * Run a full source scan across all intents.
 *
 * For each intent: selects sources from the catalog, fetches data via adapters,
 * detects signals (threshold + change), updates baselines, and produces suggestions.
 *
 * This is the library equivalent of cli/source-scan.ts — called inline from
 * session-runner.ts instead of as a subprocess.
 */
export async function runSourceScan(
  sourceView: AgentSourceView,
  intents: ScanIntent[],
  baselineStore: BaselineStore,
  options: {
    maxSources?: number;
    minSignalStrength?: number;
    dryRun?: boolean;
  } = {},
): Promise<SourceScanResult> {
  const maxSources = options.maxSources ?? 10;
  const minSignalStrength = options.minSignalStrength ?? 0.3;

  const allSignals: DetectedSignal[] = [];
  let totalFetched = 0;
  let totalBaselinesUpdated = 0;
  let sourcesUsed = 0;

  for (const intent of intents) {
    const sources = selectSourcesByIntent(intent, sourceView);

    for (const source of sources) {
      if (sourcesUsed >= maxSources) break;

      try {
        const fetchResult = await fetchSource(source.url, source);
        if (!fetchResult.ok || !fetchResult.response) continue;

        totalFetched++;
        sourcesUsed++;

        // Parse via adapter
        const adapter = getProviderAdapter(source.provider);
        let entries: EvidenceEntry[] = [];
        if (adapter && adapter.supports(source)) {
          const parsed = adapter.parseResponse(source, fetchResult.response);
          entries = parsed.entries;
        }
        if (entries.length === 0) continue;

        // Detect signals
        const signals = detectSignals(entries, intent.signals, baselineStore, {
          source,
          fetchResult,
          fetchedAt: new Date().toISOString(),
          minSignalStrength,
        });
        if (signals.length > 0) {
          allSignals.push(...signals);
        }

        // Update baselines
        for (const entry of entries) {
          if (!entry.metrics) continue;
          for (const [metricKey, rawValue] of Object.entries(entry.metrics)) {
            const value = typeof rawValue === "string" ? parseFloat(rawValue) : rawValue;
            if (isNaN(value)) continue;
            updateBaseline(baselineStore, source.id, metricKey, value, new Date().toISOString());
            totalBaselinesUpdated++;
          }
        }
      } catch {
        // Non-fatal — skip this source and continue
        continue;
      }
    }

    if (sourcesUsed >= maxSources) break;
  }

  allSignals.sort((a, b) => b.strength - a.strength);

  const suggestions = options.dryRun
    ? []
    : signalsToSuggestions(allSignals, minSignalStrength);

  return {
    signals: allSignals,
    suggestions,
    sourcesFetched: totalFetched,
    baselinesUpdated: totalBaselinesUpdated,
  };
}

// ── Double-Fetch Anti-Signal Verification ────────────

/** Default gap between fetches for anti-signal verification */
const DOUBLE_FETCH_GAP_MS = 60_000; // 60 seconds

/**
 * Verify anti-signals by re-fetching source data after a delay.
 * If the metric value diverges >5% between fetches, the signal is suppressed
 * (data is unstable — not safe to publish a contrarian take).
 *
 * Returns only the signals that remain stable across both fetches.
 */
export async function verifyAntiSignalsWithRefetch(
  signals: DetectedSignal[],
  options: { gapMs?: number } = {},
): Promise<DetectedSignal[]> {
  if (signals.length === 0) return [];

  const gapMs = options.gapMs ?? DOUBLE_FETCH_GAP_MS;

  // Wait for the gap period
  await new Promise(resolve => setTimeout(resolve, gapMs));

  const verified: DetectedSignal[] = [];

  for (const signal of signals) {
    if (signal.rule.type !== "anti-signal") {
      verified.push(signal);
      continue;
    }

    try {
      // Re-fetch the source
      const refetchResult = await fetchSource(signal.source.url, signal.source);
      if (!refetchResult.ok || !refetchResult.response) {
        observe("insight", `Anti-signal suppressed: refetch failed for ${signal.source.name}`, {
          source: "source-scanner.ts:verifyAntiSignals",
          data: { sourceId: signal.source.id, metric: signal.rule.metric },
        });
        continue;
      }

      // Parse response
      const adapter = getProviderAdapter(signal.source.provider);
      if (!adapter || !adapter.supports(signal.source)) {
        observe("insight", `Anti-signal suppressed: no adapter for ${signal.source.provider}`, {
          source: "source-scanner.ts:verifyAntiSignals",
        });
        continue;
      }

      const parsed = adapter.parseResponse(signal.source, refetchResult.response);
      const metricKey = signal.rule.metric;

      // Find the same metric in the re-fetched data
      let metricFound = false;
      for (const entry of parsed.entries) {
        if (!entry.metrics || entry.metrics[metricKey] == null) continue;
        metricFound = true;
        const refetchValue = typeof entry.metrics[metricKey] === "string"
          ? parseFloat(entry.metrics[metricKey] as string)
          : entry.metrics[metricKey] as number;
        if (isNaN(refetchValue)) continue;

        // Compare: if original and refetch values diverge by >5%, suppress
        const originalValue = signal.currentValue;
        if (originalValue === 0) {
          observe("insight", `Anti-signal suppressed: original value is 0 for ${metricKey}`, {
            source: "source-scanner.ts:verifyAntiSignals",
            data: { sourceId: signal.source.id, metric: metricKey },
          });
          continue;
        }
        const drift = Math.abs((refetchValue - originalValue) / originalValue) * 100;
        if (drift <= 5) {
          verified.push(signal);
        } else {
          observe("insight", `Anti-signal suppressed: data unstable (${drift.toFixed(1)}% drift) for ${signal.source.name}:${metricKey}`, {
            source: "source-scanner.ts:verifyAntiSignals",
            data: { sourceId: signal.source.id, metric: metricKey, drift, original: originalValue, refetch: refetchValue },
          });
        }
        // Only check first matching entry
        break;
      }
      if (!metricFound) {
        observe("insight", `Anti-signal suppressed: metric ${metricKey} not found in refetch for ${signal.source.name}`, {
          source: "source-scanner.ts:verifyAntiSignals",
          data: { sourceId: signal.source.id, metric: metricKey },
        });
      }
    } catch {
      observe("insight", `Anti-signal suppressed: refetch error for ${signal.source?.name}`, {
        source: "source-scanner.ts:verifyAntiSignals",
      });
      continue;
    }
  }

  return verified;
}
