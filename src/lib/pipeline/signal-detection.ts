/**
 * Signal detection core — Phase 1 of intent-driven scanning.
 *
 * Pure library: detects interesting signals from source data by comparing
 * fetched metrics against historical baselines and configurable signal rules.
 *
 * Incorporates council review findings (2026-03-21):
 * - Keyed JSON baseline store with ring buffers per metric per window
 * - N>=3 samples before trusting change signals
 * - Staleness checks (15min crypto / 1h macro)
 * - Domain-specific thresholds (crypto 5% / macro 2%)
 * - MAD (median absolute deviation) for outlier rejection
 *
 * No external dependencies beyond Node.js builtins + existing project types.
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { EvidenceEntry } from "../sources/providers/types.js";
import type { SourceRecordV2 } from "../sources/catalog.js";
import type { FetchSourceResult } from "../sources/fetch.js";
import type { ExtractedClaim } from "../attestation/claim-extraction.js";
import {
  ANTI_SIGNAL_DIVERGENCE_THRESHOLD,
  CONVERGENCE_MAGNITUDE_THRESHOLD,
  CONVERGENCE_MIN_SOURCES,
  CRYPTO_DEFAULTS,
  CRYPTO_TAGS,
  DEFAULT_STALENESS,
  MACRO_DEFAULTS,
  MACRO_TAGS,
  UNKNOWN_DEFAULTS,
} from "./signal-rules.js";
import {
  calculateMAD,
  calculateZScore,
  getBaselineMedian,
  getBaselineObservations,
  MAD_FLOOR,
  MAD_MULTIPLIER,
  MIN_BASELINE_SAMPLES,
  recordBaselineValue,
  winsorize,
  ZSCORE_THRESHOLD,
  type BaselineEntry,
  type BaselineObservation,
  type BaselineStore,
  type MetricWindows,
} from "../../toolkit/math/baseline.js";
export {
  calculateMAD,
  calculateZScore,
  winsorize,
} from "../../toolkit/math/baseline.js";
export type {
  BaselineEntry,
  BaselineObservation,
  BaselineStore,
  MetricWindows,
} from "../../toolkit/math/baseline.js";

// ── Constants ─────────────────────────────────────────

/** Maximum age (ms) for baseline entries before pruning on load */
const MAX_BASELINE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Window time horizons for baseline ring buffers */
const WINDOW_KEYS = ["1h", "4h", "24h"] as const;

// ── Types ─────────────────────────────────────────────

/**
 * A rule that defines what constitutes an "interesting" signal.
 */
export interface SignalRule {
  type: "threshold" | "change" | "convergence" | "anti-signal";
  /** Which metric to check (from EvidenceEntry.metrics). "*" matches all. */
  metric: string;
  /** For threshold: value must be above this */
  above?: number;
  /** For threshold: value must be below this */
  below?: number;
  /** For change: minimum % change from baseline to trigger */
  threshold?: number;
  /** For anti-signal: feed claim to contradict (Phase 3) */
  feedClaim?: string;
}

/**
 * A detected signal from source data.
 */
export interface DetectedSignal {
  /** Source that produced this signal */
  source: SourceRecordV2;
  /** The signal rule that triggered */
  rule: SignalRule;
  /** Signal strength (how far past threshold; >=0) */
  strength: number;
  /** Current value from source */
  currentValue: number;
  /** Previous value from baseline (median, if available) */
  baselineValue?: number;
  /** Percentage change (for change signals) */
  changePercent?: number;
  /** Human-readable description */
  summary: string;
  /** The EvidenceEntry that produced this signal */
  evidence: EvidenceEntry;
  /** The raw fetch result (for free attestation in later phases) */
  fetchResult: FetchSourceResult;
  /** Claim entity name for anti-signals (avoids parsing from summary) */
  entity?: string;
  /** Cross-source confirmation for anti-signals (undefined = unevaluated, true/false = evaluated) */
  confirmed?: boolean;
}

/**
 * Domain-specific signal detection configuration.
 */
export interface SignalDetectionConfig {
  changeThreshold: number;
  domain: "crypto" | "macro" | "unknown";
}

/**
 * Per-domain staleness limits in milliseconds.
 */
export interface StalenessConfig {
  crypto: number;
  macro: number;
  unknown: number;
}

/**
 * Context passed to detectSignals alongside entries and rules.
 */
export interface DetectionContext {
  source: SourceRecordV2;
  fetchResult: FetchSourceResult;
  fetchedAt: string;
  /** Minimum signal strength to include in results (default: 0) */
  minSignalStrength?: number;
  /** Override staleness config */
  staleness?: StalenessConfig;
}

// ── Domain Resolution ─────────────────────────────────

/**
 * Resolve domain from source domainTags.
 * Crypto takes priority over macro when both are present.
 */
export function resolveDomain(domainTags: string[]): "crypto" | "macro" | "unknown" {
  const tags = domainTags.map(t => t.toLowerCase());
  if (tags.some(t => CRYPTO_TAGS.has(t))) return "crypto";
  if (tags.some(t => MACRO_TAGS.has(t))) return "macro";
  return "unknown";
}

function getConfig(domain: "crypto" | "macro" | "unknown"): SignalDetectionConfig {
  switch (domain) {
    case "crypto": return CRYPTO_DEFAULTS;
    case "macro": return MACRO_DEFAULTS;
    default: return UNKNOWN_DEFAULTS;
  }
}

// ── Staleness Guard ───────────────────────────────────

function isStale(
  fetchedAt: string,
  domain: "crypto" | "macro" | "unknown",
  staleness: StalenessConfig = DEFAULT_STALENESS,
): boolean {
  const fetchTime = new Date(fetchedAt).getTime();
  const now = Date.now();
  const age = now - fetchTime;
  const limit = staleness[domain];
  return age > limit;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

// ── Baseline Persistence ──────────────────────────────

/**
 * Load baseline store from disk. Returns empty store if file doesn't exist
 * or is corrupted. Prunes entries older than 30 days.
 */
export function loadBaselines(filePath: string): BaselineStore {
  try {
    const content = readFileSync(filePath, "utf8");
    const store: BaselineStore = JSON.parse(content);
    pruneOldEntries(store);
    return store;
  } catch {
    return {};
  }
}

/**
 * Save baseline store to disk atomically (write to temp, then rename).
 */
export function saveBaselines(filePath: string, store: BaselineStore): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmpPath, JSON.stringify(store, null, 0), { mode: 0o600 });
  renameSync(tmpPath, filePath);
}

/**
 * Update baseline store with a new observation for a source metric.
 * Adds to all three window ring buffers. Winsorizes outliers.
 */
export function updateBaseline(
  store: BaselineStore,
  sourceId: string,
  metricKey: string,
  value: number,
  fetchedAt: string,
): void {
  recordBaselineValue(store, sourceId, metricKey, value, fetchedAt);
}

/**
 * Prune observations older than 30 days from all windows.
 * Uses ISO string comparison to avoid Date object allocation per observation.
 * Recomputes samples count from actual window lengths.
 */
function pruneOldEntries(store: BaselineStore): void {
  const cutoffISO = new Date(Date.now() - MAX_BASELINE_AGE_MS).toISOString();

  for (const entry of Object.values(store)) {
    let totalSamples = 0;
    for (const metricWindows of Object.values(entry.metrics)) {
      for (const windowKey of WINDOW_KEYS) {
        metricWindows.windows[windowKey] = metricWindows.windows[windowKey].filter(
          obs => obs.fetchedAt >= cutoffISO
        );
      }
      // Use 24h window length as canonical sample count per metric
      totalSamples += metricWindows.windows["24h"].length;
    }
    entry.samples = totalSamples;
  }
}

// ── Signal Detection Engine ───────────────────────────

/**
 * Parse a metric value to a number. Returns NaN for non-numeric values.
 */
function parseMetric(value: string | number): number {
  if (typeof value === "number") return value;
  const parsed = parseFloat(value);
  return parsed;
}

/**
 * Detect signals from fetched source data by comparing against
 * baselines and applying signal rules.
 *
 * Flow: staleness guard → iterate entries × rules × metrics →
 * threshold/change check → strength calc → filter → sort desc.
 */
export function detectSignals(
  entries: EvidenceEntry[],
  rules: SignalRule[],
  baselineStore: BaselineStore | null,
  ctx: DetectionContext,
): DetectedSignal[] {
  const domain = resolveDomain(ctx.source.domainTags || []);
  const config = getConfig(domain);
  const staleness = ctx.staleness || DEFAULT_STALENESS;

  // Staleness guard — suppress all signals if data is too old
  if (isStale(ctx.fetchedAt, domain, staleness)) {
    return [];
  }

  // Memoize baseline median queries to avoid redundant sorts
  const medianCache = new Map<string, number | null>();
  const getCachedMedian = (sourceId: string, metricKey: string): number | null => {
    const key = `${sourceId}:${metricKey}`;
    if (!medianCache.has(key)) {
      medianCache.set(key, getBaselineMedian(baselineStore, sourceId, metricKey));
    }
    return medianCache.get(key)!;
  };

  const signals: DetectedSignal[] = [];

  for (const entry of entries) {
    if (!entry.metrics) continue;

    for (const rule of rules) {
      // Resolve metric keys — wildcard "*" matches all
      const metricKeys = rule.metric === "*"
        ? Object.keys(entry.metrics)
        : [rule.metric];

      for (const metricKey of metricKeys) {
        const rawValue = entry.metrics[metricKey];
        if (rawValue == null) continue;

        const current = parseMetric(rawValue);
        if (isNaN(current)) continue;

        switch (rule.type) {
          case "threshold": {
            const detected = detectThreshold(current, rule, metricKey, entry, ctx);
            if (detected) signals.push(detected);
            break;
          }

          case "change": {
            const detected = detectChange(
              current, rule, metricKey, entry, ctx,
              baselineStore, config, getCachedMedian,
            );
            if (detected) signals.push(detected);
            break;
          }

          // convergence and anti-signal are Phase 3+5 — no-op for now
          case "convergence":
          case "anti-signal":
            break;
        }
      }
    }
  }

  // Filter by minSignalStrength
  const minStrength = ctx.minSignalStrength ?? 0;
  const filtered = signals.filter(s => s.strength >= minStrength);

  // Sort by strength descending
  filtered.sort((a, b) => b.strength - a.strength);

  return filtered;
}

// ── Threshold Detection ───────────────────────────────

function detectThreshold(
  current: number,
  rule: SignalRule,
  metricKey: string,
  entry: EvidenceEntry,
  ctx: DetectionContext,
): DetectedSignal | null {
  if (rule.above != null && current > rule.above) {
    // Use max(|above|, 1) as denominator to handle zero thresholds
    const denominator = Math.max(Math.abs(rule.above), 1);
    const strength = (current - rule.above) / denominator;
    return {
      source: ctx.source,
      rule: { ...rule, metric: metricKey },
      strength,
      currentValue: current,
      summary: `${metricKey} = ${current} (above threshold ${rule.above})`,
      evidence: entry,
      fetchResult: ctx.fetchResult,
    };
  }

  if (rule.below != null && current < rule.below) {
    const denominator = Math.max(Math.abs(rule.below), 1);
    const strength = (rule.below - current) / denominator;
    return {
      source: ctx.source,
      rule: { ...rule, metric: metricKey },
      strength,
      currentValue: current,
      summary: `${metricKey} = ${current} (below threshold ${rule.below})`,
      evidence: entry,
      fetchResult: ctx.fetchResult,
    };
  }

  return null;
}

// ── Change Detection ──────────────────────────────────

function detectChange(
  current: number,
  rule: SignalRule,
  metricKey: string,
  entry: EvidenceEntry,
  ctx: DetectionContext,
  baselineStore: BaselineStore | null,
  config: SignalDetectionConfig,
  getCachedMedian: (sourceId: string, metricKey: string) => number | null,
): DetectedSignal | null {
  const sourceId = ctx.source.id;

  // Fetch observations once — used for sample count, median, and z-score
  const observations = getBaselineObservations(baselineStore, sourceId, metricKey, "24h");

  // N>=3 requirement
  if (observations.length < MIN_BASELINE_SAMPLES) return null;

  const baselineMedian = getCachedMedian(sourceId, metricKey);
  if (baselineMedian == null) return null;

  // Guard against zero baseline (division by zero)
  if (baselineMedian === 0) return null;

  const changePct = ((current - baselineMedian) / Math.abs(baselineMedian)) * 100;

  // Phase 5: Z-score adaptive threshold when 15+ samples available
  // Falls back to fixed threshold for cold-start (3-14 samples)
  const zScore = calculateZScore(current, observations);

  if (zScore !== null && Math.abs(zScore) >= ZSCORE_THRESHOLD) {
    // Z-score triggered — use z-score-based strength
    const strength = Math.abs(zScore) / ZSCORE_THRESHOLD - 1;
    return {
      source: ctx.source,
      rule: { ...rule, metric: metricKey },
      strength,
      currentValue: current,
      baselineValue: baselineMedian,
      changePercent: changePct,
      summary: `${metricKey} changed ${changePct > 0 ? "+" : ""}${changePct.toFixed(1)}% (${baselineMedian} → ${current}, z=${zScore.toFixed(1)})`,
      evidence: entry,
      fetchResult: ctx.fetchResult,
    };
  }

  // Cold-start fallback: fixed threshold (3-14 samples, or z-score below threshold)
  const changeThreshold = rule.threshold ?? config.changeThreshold;
  if (Math.abs(changePct) >= changeThreshold) {
    const strength = Math.abs(changePct) / changeThreshold - 1;
    return {
      source: ctx.source,
      rule: { ...rule, metric: metricKey },
      strength,
      currentValue: current,
      baselineValue: baselineMedian,
      changePercent: changePct,
      summary: `${metricKey} changed ${changePct > 0 ? "+" : ""}${changePct.toFixed(1)}% (${baselineMedian} → ${current})`,
      evidence: entry,
      fetchResult: ctx.fetchResult,
    };
  }

  return null;
}

// ── Anti-Signal Detection (Phase 3) ──────────────────

/** Anti-signal context — reuses DetectionContext fields needed for anti-signals */
export type AntiSignalContext = Pick<DetectionContext, "source" | "fetchResult" | "fetchedAt">;

/**
 * Detect anti-signals: source data that contradicts recent feed claims.
 *
 * For each claim with a numeric value, compares against matching source
 * entry metrics. If divergence exceeds 10%, produces an anti-signal.
 *
 * Entity matching is case-insensitive substring match between
 * claim.entities and entry.topics.
 */
export function detectAntiSignals(
  entries: EvidenceEntry[],
  claims: ExtractedClaim[],
  ctx: AntiSignalContext,
): DetectedSignal[] {
  // Pre-filter: only numeric claims with non-zero values
  const numericClaims = claims.filter(
    c => typeof c.value === "number" && c.value !== 0,
  );
  if (numericClaims.length === 0) return [];

  // Pre-filter: only entries with metrics
  const metricEntries = entries.filter(e => e.metrics);
  if (metricEntries.length === 0) return [];

  const antiSignals: DetectedSignal[] = [];

  for (const claim of numericClaims) {
    // Pre-lowercase claim entities once per claim
    const claimEntitiesLower = claim.entities.map(e => e.toLowerCase());

    for (const entry of metricEntries) {
      // Pre-lowercase entry topics once per entry (safe: metricEntries is stable)
      const topicsLower = entry.topics.map(t => t.toLowerCase());

      // Entity-topic overlap (case-insensitive substring)
      const entityMatch = claimEntitiesLower.some(entity =>
        topicsLower.some(topic =>
          topic.includes(entity) || entity.includes(topic)
        )
      );
      if (!entityMatch) continue;

      // Compare each metric against the claim value
      for (const [metricKey, metricVal] of Object.entries(entry.metrics!)) {
        const sourceValue = parseMetric(metricVal);
        if (isNaN(sourceValue)) continue;

        const divergence = ((sourceValue - claim.value!) / Math.abs(claim.value!)) * 100;

        if (Math.abs(divergence) > ANTI_SIGNAL_DIVERGENCE_THRESHOLD) {
          const strength = Math.abs(divergence) / ANTI_SIGNAL_DIVERGENCE_THRESHOLD - 1;
          const entityName = claim.entities[0] ?? "unknown";
          antiSignals.push({
            source: ctx.source,
            rule: { type: "anti-signal", metric: metricKey },
            strength,
            currentValue: sourceValue,
            baselineValue: claim.value,
            changePercent: divergence,
            summary: `Feed claims ${entityName} at ${claim.value}, source shows ${sourceValue} (${divergence > 0 ? "+" : ""}${divergence.toFixed(1)}% divergence)`,
            evidence: entry,
            fetchResult: ctx.fetchResult,
            entity: entityName.toLowerCase(),
          });
        }
      }
    }
  }

  // Sort by strength descending
  antiSignals.sort((a, b) => b.strength - a.strength);
  return antiSignals;
}

/**
 * Cross-source confirmation for anti-signals.
 *
 * Groups anti-signals by claim entity (first entity, lowercased) + divergence direction.
 * Marks `confirmed=true` when 2+ independent sources agree on the same
 * entity + direction (both show source < claim, or both show source > claim).
 *
 * Returns a flat array of all anti-signals with `confirmed` field set.
 */
export function confirmAntiSignals(
  signalsBySource: Map<string, DetectedSignal[]>,
): DetectedSignal[] {
  // Group by entity + direction across sources
  const groups = new Map<string, { sourceId: string; signal: DetectedSignal }[]>();

  for (const [sourceId, signals] of signalsBySource) {
    for (const signal of signals) {
      if (signal.rule.type !== "anti-signal") continue;
      if (signal.changePercent == null) continue;

      const direction = signal.changePercent > 0 ? "up" : "down";
      const entity = signal.entity ?? "unknown";
      const key = `${entity}:${direction}`;

      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ sourceId, signal });
    }
  }

  // Mark confirmed when 2+ distinct sources agree
  const allSignals: DetectedSignal[] = [];

  for (const entries of groups.values()) {
    const distinctSources = new Set(entries.map(e => e.sourceId));
    const isConfirmed = distinctSources.size >= 2;

    for (const { signal } of entries) {
      allSignals.push({ ...signal, confirmed: isConfirmed });
    }
  }

  return allSignals;
}

// ── Cross-Source Convergence (Phase 5) ───────────────

/**
 * Detect when multiple independent sources show the same directional move
 * for the same metric. Stronger signal than any single source alone.
 *
 * Groups signals by metric + direction across sources. Requires:
 * - 3+ distinct sources agreeing on direction
 * - Each signal must have |changePercent| >= 1% (magnitude guard against broken APIs)
 *
 * Strength = sourceCount / 3 (3 sources = 1.0, 6 = 2.0).
 */
export function detectConvergence(
  signalsBySource: Map<string, DetectedSignal[]>,
): DetectedSignal[] {
  // Group by metric + direction, tracking distinct sources
  const groups = new Map<string, { sourceIds: Set<string>; signals: DetectedSignal[] }>();

  for (const [sourceId, signals] of signalsBySource) {
    for (const signal of signals) {
      if (signal.changePercent == null) continue;
      // Magnitude guard: ignore tiny changes (broken API returning zeros)
      if (Math.abs(signal.changePercent) < CONVERGENCE_MAGNITUDE_THRESHOLD) continue;

      const direction = signal.changePercent > 0 ? "up" : "down";
      const key = `${signal.rule.metric}:${direction}`;

      if (!groups.has(key)) groups.set(key, { sourceIds: new Set(), signals: [] });
      const group = groups.get(key)!;
      group.sourceIds.add(sourceId);
      group.signals.push(signal);
    }
  }

  const convergenceSignals: DetectedSignal[] = [];

  for (const [key, { sourceIds, signals }] of groups) {
    if (sourceIds.size < CONVERGENCE_MIN_SOURCES) continue;

    // Average one value per source (take strongest signal per source to avoid double-counting)
    const perSource = new Map<string, number>();
    for (const signal of signals) {
      const sid = signal.source.id;
      const pct = signal.changePercent ?? 0;
      if (!perSource.has(sid) || Math.abs(pct) > Math.abs(perSource.get(sid)!)) {
        perSource.set(sid, pct);
      }
    }
    const avgChange = [...perSource.values()].reduce((sum, v) => sum + v, 0) / perSource.size;
    const metric = key.split(":")[0];
    const strength = sourceIds.size / CONVERGENCE_MIN_SOURCES;

    // Use the first signal as a template for source/evidence/fetchResult
    const template = signals[0];
    convergenceSignals.push({
      source: template.source,
      rule: { type: "convergence", metric },
      strength,
      currentValue: avgChange,
      summary: `${sourceIds.size} sources agree: ${metric} ${avgChange > 0 ? "+" : ""}${avgChange.toFixed(1)}% (convergence)`,
      evidence: template.evidence,
      fetchResult: template.fetchResult,
    });
  }

  convergenceSignals.sort((a, b) => b.strength - a.strength);
  return convergenceSignals;
}
