/**
 * Source lifecycle management — evaluate and apply status transitions.
 *
 * Implements the canonical state machine from catalog.ts:
 *   quarantined →(3 consecutive passes)→ active
 *   active →(rating < 40 OR 3 consecutive failures)→ degraded
 *   degraded →(3 consecutive passes, rating ≥ 60)→ active (recovery)
 *   degraded →(14 days failing)→ stale
 *   stale →(30 days)→ deprecated
 *   archived → manual only
 *
 * Import graph:
 *   lifecycle.ts → ./catalog.ts (SourceRecordV2, SourceStatus)
 *   lifecycle.ts → ./health.ts (SourceTestResult, SourceTestStatus)
 */

import type { SourceRecordV2, SourceStatus } from "./catalog.js";
import type { SourceTestResult, SourceTestStatus } from "./health.js";

// ── Constants ────────────────────────────────────────

/** Consecutive passes required for quarantined→active or degraded→active */
const PROMOTION_PASSES = 3;

/** Rating threshold for active→degraded */
const DEGRADED_RATING_THRESHOLD = 40;

/** Consecutive failures for active→degraded */
const DEGRADED_FAILURE_THRESHOLD = 3;

/** Minimum rating for degraded→active recovery */
const RECOVERY_RATING_THRESHOLD = 60;

/** Days of failure before degraded→stale */
const STALE_DAYS = 14;

/** Days of stale before stale→deprecated */
const DEPRECATED_DAYS = 30;

/** Consecutive failures before quarantined→archived (chronic failure pruning) */
const QUARANTINE_ARCHIVE_FAILURES = 5;

// ── Types ────────────────────────────────────────────

export interface TransitionResult {
  sourceId: string;
  currentStatus: SourceStatus;
  newStatus: SourceStatus | null;
  reason: string;
  testResult?: SourceTestResult;
}

export interface LifecycleReport {
  timestamp: string;
  evaluated: number;
  transitions: TransitionResult[];
  summary: Record<SourceStatus, number>;
}

// ── Valid Transitions (state machine enforcement) ────

const VALID_TRANSITIONS: Record<SourceStatus, SourceStatus[]> = {
  quarantined: ["active", "archived"],
  active: ["degraded", "archived"],
  degraded: ["active", "stale", "archived"],
  stale: ["deprecated", "archived"],
  deprecated: ["archived"],
  archived: ["quarantined"],
};

// ── Sampling ─────────────────────────────────────────

/** Statuses excluded from sampling — cannot transition automatically */
const EXCLUDED_STATUSES: Set<SourceStatus> = new Set(["archived", "deprecated"]);

/** Statuses that indicate an unhealthy source — should be skipped during active fetch */
const UNHEALTHY_STATUSES: Set<SourceStatus> = new Set(["degraded", "stale", "deprecated", "archived"]);

/**
 * Filter sources to only those healthy enough for active fetching.
 * Skips degraded, stale, deprecated, and archived sources.
 */
export function filterHealthySources(sources: SourceRecordV2[]): SourceRecordV2[] {
  return sources.filter(s => !UNHEALTHY_STATUSES.has(s.status));
}

/**
 * Sample sources for lifecycle testing, prioritized by urgency.
 *
 * Priority (highest first):
 *   1. Quarantined sources near promotion (successCount close to PROMOTION_PASSES)
 *   2. Active/degraded sources with consecutiveFailures > 0 (health regression)
 *   3. Least-recently-tested sources (oldest lastTestedAt)
 *
 * Never returns archived or deprecated sources.
 */
export function sampleSources(
  sources: SourceRecordV2[],
  maxCount: number,
): SourceRecordV2[] {
  // Filter out non-testable statuses
  const eligible = sources.filter((s) => !EXCLUDED_STATUSES.has(s.status));

  if (eligible.length <= maxCount) return eligible;

  // Score each source for sampling priority (higher = more urgent)
  const scored = eligible.map((source) => {
    let priority = 0;

    // Near-promotion quarantined sources (successCount 2 out of 3 = highest priority)
    if (source.status === "quarantined" && source.rating.consecutiveFailures === 0) {
      priority += 100 + source.rating.successCount * 10; // 100-130 range
    }

    // Sources with consecutive failures (health regression)
    if (source.rating.consecutiveFailures > 0) {
      priority += 50 + source.rating.consecutiveFailures * 5; // 55-70 range
    }

    // Least-recently-tested (inverse of lastTestedAt)
    if (source.rating.lastTestedAt) {
      const hoursSinceTest = (Date.now() - new Date(source.rating.lastTestedAt).getTime()) / (60 * 60 * 1000);
      priority += Math.min(40, hoursSinceTest / 24); // 0-40 range, caps at 40 days
    } else {
      priority += 40; // Never tested = max staleness bonus
    }

    return { source, priority };
  });

  // Sort by priority descending, take top N
  scored.sort((a, b) => b.priority - a.priority);
  return scored.slice(0, maxCount).map((s) => s.source);
}

// ── Test Result Classification ───────────────────────

/** Statuses that count as a successful test */
const SUCCESS_STATUSES: Set<SourceTestStatus> = new Set(["OK", "EMPTY"]);

/** Statuses that count as a failed test */
const FAILURE_STATUSES: Set<SourceTestStatus> = new Set(["FETCH_FAILED", "PARSE_FAILED"]);

/** Statuses that are inconclusive (don't affect success/failure counts) */
// NO_ADAPTER, NOT_SUPPORTED, NO_CANDIDATES, VALIDATION_REJECTED, UNRESOLVED_VARS

// ── updateRating ─────────────────────────────────────

/**
 * Update a source's rating fields based on a test result.
 * Returns a new source object (does not mutate input).
 *
 * Success (OK, EMPTY): increment testCount + successCount, reset consecutiveFailures
 * Failure (FETCH_FAILED, PARSE_FAILED): increment testCount + consecutiveFailures, reset successCount
 * Inconclusive: increment testCount only
 */
export function updateRating(
  source: SourceRecordV2,
  testResult: SourceTestResult,
): SourceRecordV2 {
  const now = new Date().toISOString();
  const isSuccess = SUCCESS_STATUSES.has(testResult.status);
  const isFailure = FAILURE_STATUSES.has(testResult.status);

  const rating = { ...source.rating };
  const lifecycle = { ...source.lifecycle };

  // Always increment testCount
  rating.testCount += 1;
  rating.lastTestedAt = now;

  if (isSuccess) {
    rating.successCount += 1;
    rating.consecutiveFailures = 0;
  } else if (isFailure) {
    rating.successCount = 0; // Reset — consecutive enforcement
    rating.consecutiveFailures += 1;
    lifecycle.lastFailedAt = now;
  }
  // Inconclusive: no change to successCount or consecutiveFailures

  return { ...source, rating, lifecycle };
}

// ── evaluateTransition ───────────────────────────────

/**
 * Evaluate whether a source should transition to a new status.
 * Uses the source's current rating/lifecycle data — call updateRating first
 * if you have a fresh test result.
 */
export function evaluateTransition(
  source: SourceRecordV2,
  testResult?: SourceTestResult,
): TransitionResult {
  const base: Pick<TransitionResult, "sourceId" | "currentStatus"> = {
    sourceId: source.id,
    currentStatus: source.status,
  };

  const noChange = (reason: string): TransitionResult => ({
    ...base,
    newStatus: null,
    reason,
    testResult,
  });

  switch (source.status) {
    case "quarantined": {
      // Promotion: 3 consecutive passes
      if (
        source.rating.successCount >= PROMOTION_PASSES &&
        source.rating.consecutiveFailures === 0
      ) {
        return {
          ...base,
          newStatus: "active",
          reason: `Promoted: ${source.rating.successCount} consecutive passes`,
          testResult,
        };
      }
      // Pruning: chronic failures → archive
      if (source.rating.consecutiveFailures >= QUARANTINE_ARCHIVE_FAILURES) {
        return {
          ...base,
          newStatus: "archived",
          reason: `Archived: ${source.rating.consecutiveFailures} consecutive failures (threshold: ${QUARANTINE_ARCHIVE_FAILURES})`,
          testResult,
        };
      }
      return noChange(
        `Quarantined: ${source.rating.successCount}/${PROMOTION_PASSES} passes, ${source.rating.consecutiveFailures} failures`,
      );
    }

    case "active": {
      if (source.rating.overall < DEGRADED_RATING_THRESHOLD) {
        return {
          ...base,
          newStatus: "degraded",
          reason: `Rating ${source.rating.overall} below threshold ${DEGRADED_RATING_THRESHOLD}`,
          testResult,
        };
      }
      if (source.rating.consecutiveFailures >= DEGRADED_FAILURE_THRESHOLD) {
        return {
          ...base,
          newStatus: "degraded",
          reason: `${source.rating.consecutiveFailures} consecutive failures`,
          testResult,
        };
      }
      return noChange("Healthy");
    }

    case "degraded": {
      // Recovery: 3 consecutive passes + acceptable rating
      if (
        source.rating.successCount >= PROMOTION_PASSES &&
        source.rating.consecutiveFailures === 0 &&
        source.rating.overall >= RECOVERY_RATING_THRESHOLD
      ) {
        return {
          ...base,
          newStatus: "active",
          reason: `Recovered: ${source.rating.successCount} consecutive passes, rating ${source.rating.overall}`,
          testResult,
        };
      }

      // Decay: 14 days since status changed to degraded (or lastFailedAt as fallback)
      const degradedSince = source.lifecycle.statusChangedAt || source.lifecycle.lastFailedAt;
      if (degradedSince) {
        const daysSinceChange = (Date.now() - new Date(degradedSince).getTime()) / (24 * 60 * 60 * 1000);
        if (daysSinceChange >= STALE_DAYS) {
          return {
            ...base,
            newStatus: "stale",
            reason: `${Math.floor(daysSinceChange)} days since degraded (threshold: ${STALE_DAYS})`,
            testResult,
          };
        }
      }

      return noChange("Degraded, awaiting recovery or stale threshold");
    }

    case "stale": {
      // 30 days since became stale (statusChangedAt or lastFailedAt as fallback)
      const staleSince = source.lifecycle.statusChangedAt || source.lifecycle.lastFailedAt;
      if (staleSince) {
        const daysSinceStale = (Date.now() - new Date(staleSince).getTime()) / (24 * 60 * 60 * 1000);
        if (daysSinceStale >= DEPRECATED_DAYS) {
          return {
            ...base,
            newStatus: "deprecated",
            reason: `${Math.floor(daysSinceStale)} days since stale (threshold: ${DEPRECATED_DAYS})`,
            testResult,
          };
        }
      }
      return noChange("Stale, awaiting deprecation threshold");
    }

    case "deprecated":
      return noChange("Deprecated — no automated transitions");

    case "archived":
      return noChange("Archived — manual transitions only");

    default:
      return noChange(`Unknown status: ${source.status}`);
  }
}

// ── applyTransitions ─────────────────────────────────

/**
 * Apply transition results to a list of sources.
 * Returns a new array with updated statuses and lifecycle timestamps.
 *
 * Validates transitions against the state machine — invalid transitions
 * are silently skipped (source left unchanged).
 *
 * Does not write to disk — caller handles persistence.
 */
export function applyTransitions(
  sources: SourceRecordV2[],
  transitions: TransitionResult[],
): SourceRecordV2[] {
  const transitionMap = new Map<string, TransitionResult>();
  for (const t of transitions) {
    if (t.newStatus !== null) {
      transitionMap.set(t.sourceId, t);
    }
  }

  return sources.map((source) => {
    const transition = transitionMap.get(source.id);
    if (!transition || transition.newStatus === null) return source;

    // Validate against state machine
    const allowed = VALID_TRANSITIONS[source.status] || [];
    if (!allowed.includes(transition.newStatus)) {
      // Invalid transition — skip silently
      return source;
    }

    const now = new Date().toISOString();
    const updated = { ...source, status: transition.newStatus, lifecycle: { ...source.lifecycle } };

    // Always record when status changed (for time-based transitions)
    updated.lifecycle.statusChangedAt = now;

    // Set lifecycle timestamps based on transition type
    if (transition.newStatus === "active" && source.status === "quarantined") {
      updated.lifecycle.promotedAt = now;
    } else if (transition.newStatus === "active" && source.status === "degraded") {
      // Recovery — re-promote
      updated.lifecycle.promotedAt = now;
    } else if (transition.newStatus === "deprecated") {
      updated.lifecycle.deprecatedAt = now;
    }

    return updated;
  });
}

// ── Health Summary ──────────────────────────────────

export interface SourceHealthSummary {
  total: number;
  byStatus: Record<SourceStatus, number>;
  healthyCount: number;
  degradedCount: number;
  avgRating: number;
}

/**
 * Aggregate health summary across all sources.
 * Toolkit primitive available to agent templates via import.
 */
export function getSourceHealthSummary(sources: SourceRecordV2[]): SourceHealthSummary {
  const byStatus: Record<string, number> = {
    quarantined: 0, active: 0, degraded: 0,
    stale: 0, deprecated: 0, archived: 0,
  };
  let ratingSum = 0;
  let ratingCount = 0;

  for (const s of sources) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    if (s.rating?.overall != null) {
      ratingSum += s.rating.overall;
      ratingCount++;
    }
  }

  return {
    total: sources.length,
    byStatus: byStatus as Record<SourceStatus, number>,
    healthyCount: (byStatus.active ?? 0) + (byStatus.quarantined ?? 0),
    degradedCount: (byStatus.degraded ?? 0) + (byStatus.stale ?? 0),
    avgRating: ratingCount > 0 ? Math.round(ratingSum / ratingCount) : 0,
  };
}
