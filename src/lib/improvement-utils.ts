/**
 * Improvement loop utilities — dedup, EMA calibration, age-out.
 *
 * Extracted from improvements.ts for testability.
 * WS1: Fix the improvement loop (dedup, bounded auto-tuning, stale management).
 */

// ── Types ──────────────────────────────────────────

export interface Improvement {
  id: string;
  session: number;
  timestamp: string;
  source: string;
  description: string;
  target: string;
  status: "proposed" | "approved" | "applied" | "verified" | "rejected" | "stale";
  evidence: string[];
  history: Array<{ action: string; timestamp: string; detail?: string }>;
}

export interface ImprovementsFile {
  version: number;
  nextSession: number;
  nextSequence: Record<string, number>;
  items: Improvement[];
}

// ── Status Constants ───────────────────────────────

/** Statuses where items are still actionable and should dedup against */
export const ACTIVE_STATUSES = ["proposed", "approved", "applied"] as const;
/** Terminal statuses — items here are done and won't dedup */
export const TERMINAL_STATUSES = ["rejected", "stale", "verified"] as const;
/** All statuses in display order */
export const ALL_STATUSES = [...ACTIVE_STATUSES, ...TERMINAL_STATUSES] as const;

// ── Valid Transitions (extended with stale) ────────
// Terminal states (rejected, stale, verified) have no outgoing transitions.

export const VALID_TRANSITIONS: Record<string, string[]> = {
  proposed: ["approved", "rejected", "stale"],
  approved: ["applied"],
  applied: ["verified", "rejected"],
};

// ── Dedup ──────────────────────────────────────────

/**
 * Normalize a description for dedup comparison.
 * Strips Q1:/Q2:/Q3:/Q4:/S{N}: prefixes and trims whitespace.
 */
export function normalizeDescription(desc: string): string {
  return desc
    .replace(/^(?:Q[1-4]|S\d+):\s*/i, "")
    .trim()
    .toLowerCase()
    // Strip hex hashes (8+ chars) for fuzzy dedup of outperformer observations
    .replace(/\b[0-9a-f]{8,}\b/g, "X")
    // Strip numeric values (e.g., "13.0rx", "+12rx", "8.7") for calibration dedup
    .replace(/[+-]?\d+(?:\.\d+)?(?:rx|%|ms|s|kb|mb)?\b/g, "N");
}

/**
 * Check if a description is a duplicate of an existing non-terminal item.
 * Terminal statuses (rejected, stale, verified) are excluded from dedup.
 */
export function isDuplicate(
  items: Improvement[],
  description: string
): { duplicate: boolean; existingId?: string } {
  const normalized = normalizeDescription(description);
  const activeStatuses = new Set<string>(ACTIVE_STATUSES);

  for (const item of items) {
    if (!activeStatuses.has(item.status)) continue;
    if (normalizeDescription(item.description) === normalized) {
      return { duplicate: true, existingId: item.id };
    }
  }

  return { duplicate: false };
}

// ── EMA Calibration ────────────────────────────────

/** EMA smoothing factor — how much weight to give the latest error */
const EMA_ALPHA = 0.3;
/** Hard floor for calibration offset */
const OFFSET_MIN = -15;
/** Hard ceiling for calibration offset */
const OFFSET_MAX = 15;

/**
 * Calculate new calibration offset using exponential moving average.
 *
 * Formula: new_offset = alpha * latest_error + (1 - alpha) * old_offset
 * Bounded to [OFFSET_MIN, OFFSET_MAX] to prevent runaway.
 *
 * @param currentOffset - The current calibration offset
 * @param latestError - The latest prediction error (actual - predicted)
 * @returns The new bounded offset
 */
export function emaCalibrationOffset(
  currentOffset: number,
  latestError: number
): number {
  const raw = EMA_ALPHA * latestError + (1 - EMA_ALPHA) * currentOffset;
  return Math.max(OFFSET_MIN, Math.min(OFFSET_MAX, raw));
}

/** Default max sessions before an item is aged out */
const DEFAULT_MAX_AGE = 20;

/** Expose constants for testing */
export { EMA_ALPHA, OFFSET_MIN, OFFSET_MAX, DEFAULT_MAX_AGE };

// ── Age-Out ────────────────────────────────────────

/**
 * Mark items older than `maxAge` sessions as "stale".
 * Only affects items with status "proposed".
 *
 * @param items - The improvement items
 * @param currentSession - The current session number
 * @param maxAge - Max sessions before staleness (default: 20)
 * @returns Number of items marked stale
 */
export function ageOutStale(
  items: Improvement[],
  currentSession: number,
  maxAge: number = DEFAULT_MAX_AGE
): number {
  const now = new Date().toISOString();
  let count = 0;

  for (const item of items) {
    if (item.status !== "proposed") continue;
    if (currentSession - item.session >= maxAge) {
      item.status = "stale";
      item.history.push({ action: "stale", timestamp: now, detail: `Aged out after ${currentSession - item.session} sessions` });
      count++;
    }
  }

  return count;
}

/**
 * Surface the top N oldest unresolved proposed items.
 * Used by HARDEN phase to remind the human of backlog.
 *
 * @param items - The improvement items
 * @param n - Number of items to surface (default: 3)
 * @returns The oldest proposed items, sorted by session ascending
 */
export function surfaceTopItems(items: Improvement[], n: number = 3): Improvement[] {
  return items
    .filter(i => i.status === "proposed")
    .sort((a, b) => a.session - b.session)
    .slice(0, n);
}
