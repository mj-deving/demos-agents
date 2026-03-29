/**
 * Prediction tracking with versioned JSON store.
 *
 * Tracks published predictions through their lifecycle:
 * pending → correct | incorrect | unresolvable | expired.
 *
 * Persistence: ~/.{agent}/predictions.json (atomic writes).
 * Resolution: Phase 1 stubs auto-resolution; Phase 2 adds real resolvers.
 *
 * Runtime: Node.js + tsx
 */

import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

import { apiCall } from "./network/sdk.js";
import { observe } from "./pipeline/observe.js";
import type { PublishedPostRecord } from "./state.js";

// ── Types ──────────────────────────────────────────

export interface TrackedPrediction {
  txHash: string;
  topic: string;
  category: "PREDICTION";
  text: string;
  confidence: number;
  predictedValue?: string;
  predictedDirection?: "up" | "down" | "stable";
  deadline?: string;
  publishedAt: string;
  status: "pending" | "correct" | "incorrect" | "unresolvable" | "expired";
  resolvedAt?: string;
  resolutionKind?: "auto-numeric" | "manual";
  resolution?: {
    actualValue?: string;
    source?: string;
    confidence: number;
  };
  agent: string;
  manualReviewRequired: boolean;
}

export interface PredictionStore {
  version: 1;
  agent: string;
  updatedAt: string;
  predictions: Record<string, TrackedPrediction>;
}

// ── Path Helpers ───────────────────────────────────

/**
 * Resolve the predictions store file path for an agent.
 */
function storePath(agent: string): string {
  return resolve(homedir(), `.${agent}`, "predictions.json");
}

/**
 * Ensure the agent's home directory exists.
 */
function ensureAgentDir(agent: string): void {
  const dir = resolve(homedir(), `.${agent}`);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ── Store CRUD ─────────────────────────────────────

/**
 * Load the prediction store for an agent.
 *
 * Returns an empty store if the file doesn't exist or is corrupt.
 * Never throws.
 */
export function loadPredictions(agent: string): PredictionStore {
  const path = storePath(agent);
  try {
    if (!existsSync(path)) {
      return emptyStore(agent);
    }
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    // Basic shape validation
    if (raw?.version !== 1 || typeof raw.predictions !== "object") {
      return emptyStore(agent);
    }
    return raw as PredictionStore;
  } catch {
    return emptyStore(agent);
  }
}

/**
 * Save the prediction store atomically (write .tmp then rename).
 *
 * Creates the agent directory if it doesn't exist.
 */
export function savePredictions(store: PredictionStore): void {
  ensureAgentDir(store.agent);
  const path = storePath(store.agent);
  const tmpPath = path + ".tmp";
  store.updatedAt = new Date().toISOString();
  writeFileSync(tmpPath, JSON.stringify(store, null, 2));
  renameSync(tmpPath, path);
}

/**
 * Register a published post as a tracked prediction.
 *
 * Only registers posts with category "PREDICTION".
 * Idempotent: skips if txHash already exists in the store.
 * Attempts to extract structured prediction fields (price, direction, deadline).
 * Sets manualReviewRequired=true if structured extraction fails.
 *
 * Returns the (possibly updated) store.
 */
export function registerPrediction(
  store: PredictionStore,
  post: PublishedPostRecord
): PredictionStore {
  // Only track predictions
  if (post.category !== "PREDICTION") return store;

  // Idempotent — skip duplicates
  if (store.predictions[post.txHash]) return store;

  const extracted = extractPredictionStructure(post.text);

  const prediction: TrackedPrediction = {
    txHash: post.txHash,
    topic: post.topic,
    category: "PREDICTION",
    text: post.text,
    confidence: post.confidence,
    predictedValue: extracted.value,
    predictedDirection: extracted.direction,
    deadline: extracted.deadline,
    publishedAt: post.publishedAt,
    status: "pending",
    agent: store.agent,
    manualReviewRequired: !extracted.hasStructure,
  };

  store.predictions[post.txHash] = prediction;

  observe("insight", `Registered prediction: ${post.topic} (${extracted.hasStructure ? "structured" : "manual-review"})`, {
    phase: "publish",
    source: "predictions.ts",
    data: {
      txHash: post.txHash,
      direction: extracted.direction,
      hasStructure: extracted.hasStructure,
    },
  });

  return store;
}

/**
 * Scan pending predictions and attempt resolution.
 *
 * Phase 1 (current): Only handles deadline-based expiry.
 * Auto-numeric resolution is stubbed — logs intent for Phase 2 resolvers.
 * Resolved predictions are reported to the API via POST /api/predictions/{tx}/resolve.
 *
 * Returns the updated store.
 */
export async function resolvePendingPredictions(
  store: PredictionStore,
  token: string
): Promise<PredictionStore> {
  const now = new Date();
  let resolved = 0;
  let expired = 0;

  for (const [txHash, pred] of Object.entries(store.predictions)) {
    if (pred.status !== "pending") continue;

    // Check deadline expiry — handle free-text deadlines (Q2 2026, March 2026, EOY, etc.)
    if (pred.deadline) {
      const deadlineDate = parseFlexibleDeadline(pred.deadline);
      if (deadlineDate && deadlineDate <= now) {
        pred.status = "expired";
        pred.resolvedAt = now.toISOString();
        expired++;

        observe("insight", `Prediction expired: ${pred.topic}`, {
          phase: "review",
          source: "predictions.ts",
          data: { txHash, deadline: pred.deadline },
        });

        // Report expiry to API (best-effort)
        await reportResolution(txHash, "expired", token);
        continue;
      }
    }

    // Phase 2 stub: auto-numeric resolution
    if (pred.predictedValue && !pred.manualReviewRequired) {
      observe("insight", `Auto-resolution stub for: ${pred.topic} (Phase 2)`, {
        phase: "review",
        source: "predictions.ts",
        data: { txHash, predictedValue: pred.predictedValue },
      });
      // Phase 2 will add actual price/metric lookups here
    }
  }

  if (resolved > 0 || expired > 0) {
    observe("insight", `Prediction resolution pass: ${resolved} resolved, ${expired} expired`, {
      phase: "review",
      source: "predictions.ts",
      data: { resolved, expired },
    });
  }

  return store;
}

/**
 * Calculate a calibration offset adjustment based on prediction accuracy.
 *
 * Returns:
 *   +1 if accuracy >60% (agent under-predicts, boost offset)
 *   -1 if accuracy <40% (agent over-predicts, reduce offset)
 *    0 if insufficient data (<5 resolved) or accuracy is in normal range
 */
export function getCalibrationAdjustment(store: PredictionStore): number {
  const resolved = Object.values(store.predictions).filter(
    (p) => p.status === "correct" || p.status === "incorrect"
  );

  if (resolved.length < 5) return 0;

  const correct = resolved.filter((p) => p.status === "correct").length;
  const accuracy = correct / resolved.length;

  if (accuracy > 0.6) return 1;
  if (accuracy < 0.4) return -1;
  return 0;
}

// ── Helpers ────────────────────────────────────────

/**
 * Create an empty prediction store for an agent.
 */
function emptyStore(agent: string): PredictionStore {
  return {
    version: 1,
    agent,
    updatedAt: new Date().toISOString(),
    predictions: {},
  };
}

/**
 * Extract structured prediction fields from free text.
 *
 * Looks for:
 * - Price/percentage targets (e.g., "$50K", "10%", "above 100")
 * - Direction keywords (up/down/stable, bullish/bearish, rise/fall)
 * - Deadline patterns (e.g., "by March 2026", "within 30 days", "by EOY")
 *
 * Returns extracted fields and whether structured data was found.
 */
function parseFlexibleDeadline(deadline: string): Date | null {
  const lower = deadline.toLowerCase().trim();
  const currentYear = new Date().getFullYear();
  const endOfDay = (date: Date): Date => {
    date.setHours(23, 59, 59, 999);
    return date;
  };

  // Quarter patterns: Q1 2026, Q2, etc.
  const qMatch = lower.match(/q([1-4])\s*(\d{4})?/);
  if (qMatch) {
    const quarter = parseInt(qMatch[1], 10);
    const year = qMatch[2] ? parseInt(qMatch[2], 10) : currentYear;
    return endOfDay(new Date(year, quarter * 3, 0)); // last day of quarter's final month
  }

  // Month + year: March 2026, Jan 2027
  const monthMatch = lower.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s*(\d{4})?/);
  if (monthMatch) {
    const months: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const month = months[monthMatch[1].slice(0, 3)];
    const year = monthMatch[2] ? parseInt(monthMatch[2], 10) : currentYear;
    if (month !== undefined) return endOfDay(new Date(year, month + 1, 0)); // last day of month
  }

  // EOY, end of year
  const eoyMatch = lower.match(/(?:eoy|end of year)\s*(\d{4})?/);
  if (eoyMatch) {
    const year = eoyMatch[1] ? parseInt(eoyMatch[1], 10) : currentYear;
    return endOfDay(new Date(year, 11, 31));
  }

  // EOQ, end of quarter
  if (lower.includes("eoq") || lower.includes("end of quarter")) {
    const currentQuarter = Math.ceil((new Date().getMonth() + 1) / 3);
    return endOfDay(new Date(currentYear, currentQuarter * 3, 0));
  }

  // Try standard date parse last so month/quarter/end-of-period forms resolve to period-end.
  const direct = new Date(deadline);
  if (!isNaN(direct.getTime())) return endOfDay(direct);

  return null; // can't parse — prediction won't auto-expire
}

function extractPredictionStructure(text: string): {
  value?: string;
  direction?: "up" | "down" | "stable";
  deadline?: string;
  hasStructure: boolean;
} {
  const lower = text.toLowerCase();

  // Direction detection
  let direction: "up" | "down" | "stable" | undefined;
  if (/\b(up|bullish|rise|increase|above|higher|grow|surge|rally|reach|exceed|break)\b/.test(lower)) {
    direction = "up";
  } else if (/\b(down|bearish|fall|decrease|below|lower|drop|crash|decline)\b/.test(lower)) {
    direction = "down";
  } else if (/\b(stable|flat|sideways|unchanged|maintain)\b/.test(lower)) {
    direction = "stable";
  }

  // Value extraction — look for price/percentage targets
  let value: string | undefined;
  const priceMatch = text.match(/\$[\d,.]+[KkMmBb]?/);
  if (priceMatch) {
    value = priceMatch[0];
  } else {
    const percentMatch = text.match(/\d+(\.\d+)?%/);
    if (percentMatch) {
      value = percentMatch[0];
    }
  }

  // Deadline extraction — ISO dates, month/year, relative time
  let deadline: string | undefined;
  const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    deadline = isoMatch[1];
  } else {
    // "by March 2026", "by Q2 2026", "by EOY"
    const byMatch = text.match(/by\s+((?:Q[1-4]\s+)?\w+\s+\d{4}|EOY|end\s+of\s+year)/i);
    if (byMatch) {
      deadline = byMatch[1];
    }
  }

  const hasStructure = !!(direction || value);

  return { value, direction, deadline, hasStructure };
}

/**
 * Report a prediction resolution to the SuperColony API.
 * Best-effort — failures are logged but don't block the pipeline.
 */
async function reportResolution(
  txHash: string,
  status: string,
  token: string
): Promise<void> {
  try {
    await apiCall(`/api/predictions/${txHash}/resolve`, token, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    observe("error", `Failed to report prediction resolution: ${message}`, {
      phase: "review",
      source: "predictions.ts",
      data: { txHash, status },
    });
  }
}
