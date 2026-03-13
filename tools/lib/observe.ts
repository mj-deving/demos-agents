/**
 * Observation logger — lightweight, append-only, zero-overhead.
 *
 * Emits structured JSONL entries to ~/.{agent}/observations.jsonl.
 * No LLM, no network, no file reads — just sync append.
 * Classification and analysis happen later in the improve skill.
 *
 * Usage:
 *   import { observe, initObserver } from "./lib/observe.js";
 *   initObserver("sentinel", 16);  // call once at session start
 *   observe("error", "TLSN timeout after 180s", { phase: "publish", source: "publish-pipeline.ts:234" });
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

// ── Types ──────────────────────────────────────────

export type ObservationType =
  | "error"
  | "pattern"
  | "insight"
  | "inefficiency"
  | "source-issue";

export interface Observation {
  id: string;
  ts: string;
  session: number;
  phase: string;
  substage?: string;
  type: ObservationType;
  text: string;
  source?: string;
  data?: unknown;
  resolved: string | null;
}

export interface ObserveOptions {
  phase?: string;
  substage?: string;
  source?: string;
  data?: unknown;
}

// ── Substage failure codes ─────────────────────────

export type EngageFailureCode =
  | "ENGAGE_NO_TARGETS"
  | "ENGAGE_RATE_LIMITED";

export type GateFailureCode =
  | "GATE_DUPLICATE"
  | "GATE_LOW_SIGNAL"
  | "GATE_NO_SOURCE"
  | "GATE_NOVELTY_FAIL";

export type PublishFailureCode =
  | "PUBLISH_TLSN_TIMEOUT"
  | "PUBLISH_DAHR_REJECT"
  | "PUBLISH_NO_MATCHING_SOURCE"
  | "PUBLISH_LLM_FAIL"
  | "PUBLISH_BROADCAST_FAIL"
  | "PUBLISH_INDEXER_FAIL";

export type SubstageFailureCode =
  | EngageFailureCode
  | GateFailureCode
  | PublishFailureCode;

export interface SubstageResult {
  substage: "engage" | "gate" | "publish";
  status: "success" | "skipped" | "failed";
  durationMs: number;
  failureCode?: SubstageFailureCode;
  detail?: string;
}

// ── State ──────────────────────────────────────────

let _agentName = "sentinel";
let _sessionNumber = 0;
let _logPath: string | null = null;
let _currentPhase = "unknown";

// ── Init ───────────────────────────────────────────

/**
 * Initialize the observer for this session.
 * Call once at session start before any observe() calls.
 */
export function initObserver(agentName: string, sessionNumber: number): void {
  _agentName = agentName;
  _sessionNumber = sessionNumber;

  const dir = resolve(homedir(), `.${agentName}`);
  mkdirSync(dir, { recursive: true }); // idempotent — no existsSync needed
  _logPath = resolve(dir, "observations.jsonl");
}

/**
 * Set the current phase context. Called by the session runner at each phase transition.
 */
export function setObserverPhase(phase: string): void {
  _currentPhase = phase;
}

// ── Core ───────────────────────────────────────────

/**
 * Generate a deterministic-ish observation ID.
 * Format: obs-{session}-{unixSec}-{4hex}
 */
function generateId(): string {
  const unixSec = Math.floor(Date.now() / 1000);
  const hex = randomBytes(2).toString("hex");
  return `obs-${_sessionNumber}-${unixSec}-${hex}`;
}

/**
 * Append a structured observation to the JSONL log.
 *
 * This is a SYNCHRONOUS operation — it must never block the pipeline.
 * No LLM, no network, no file reads. Just format + append.
 *
 * If the observer hasn't been initialized or the append fails,
 * it silently no-ops (observations are best-effort, not critical path).
 */
export function observe(
  type: ObservationType,
  text: string,
  options: ObserveOptions = {}
): void {
  if (!_logPath) return; // not initialized — silent no-op

  const entry: Observation = {
    id: generateId(),
    ts: new Date().toISOString(),
    session: _sessionNumber,
    phase: options.phase || _currentPhase,
    type,
    text,
    resolved: null,
  };

  if (options.substage) entry.substage = options.substage;
  if (options.source) entry.source = options.source;
  if (options.data !== undefined) entry.data = options.data;

  try {
    appendFileSync(_logPath, JSON.stringify(entry) + "\n");
  } catch {
    // Silent fail — observations are best-effort.
    // The pipeline must never be blocked by observation logging.
  }
}
