/**
 * Session state manager for agent session-runner.
 *
 * Persists session state between phases to enable --resume after interruption.
 * State files are namespaced under ~/.{agent}/sessions/ with PID-based lockfiles.
 *
 * State lifecycle:
 *   startSession() → completePhase() × N → clearState()
 *
 * Lock lifecycle:
 *   acquireLock() at session start → releaseLock() at clearState()
 *   Stale locks (>2h or dead PID) are automatically recovered.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
  openSync,
  closeSync,
} from "node:fs";
import { constants as fsConstants } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

// ── Constants ──────────────────────────────────────

const DEFAULT_SESSIONS_DIR = resolve(homedir(), ".sentinel", "sessions");
const STALE_LOCK_MS = 2 * 60 * 60 * 1000; // 2 hours

// ── Types ──────────────────────────────────────────

export type PhaseName =
  | "audit"
  | "scan"
  | "engage"
  | "gate"
  | "publish"
  | "verify"
  | "review"
  | "harden";

export type PhaseStatus = "pending" | "in_progress" | "completed" | "failed";

export interface PhaseState {
  status: PhaseStatus;
  startedAt?: string;
  completedAt?: string;
  result?: any;
  error?: string;
}

export interface SessionState {
  sessionNumber: number;
  agentName: string;
  startedAt: string;
  pid: number;
  phases: Record<PhaseName, PhaseState>;
  /** txHashes from PUBLISH step */
  posts: string[];
  /** Engagement results from ENGAGE step */
  engagements: any[];
}

const PHASE_ORDER: PhaseName[] = [
  "audit",
  "scan",
  "engage",
  "gate",
  "publish",
  "verify",
  "review",
  "harden",
];

// ── V2 Types ─────────────────────────────────────

export type CorePhase = "sense" | "act" | "confirm";
export type LoopVersion = 1 | 2;
export const CORE_PHASE_ORDER: CorePhase[] = ["sense", "act", "confirm"];
export const KNOWN_EXTENSIONS = ["calibrate", "sources", "observe", "signals", "predictions"] as const;

export type SubstageStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface ActSubstageState {
  substage: "engage" | "gate" | "publish";
  status: SubstageStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  failureCode?: string;
  result?: any;
}

/** Full context for a published post — persisted in session state for afterConfirm hooks. */
export interface PublishedPostRecord {
  txHash: string;
  topic: string;
  category: string;
  text: string;
  confidence: number;
  predictedReactions: number;
  hypothesis?: string;
  tags: string[];
  replyTo?: string;
  deadline?: string;
  publishedAt: string;
  attestationType: "DAHR" | "TLSN" | "none";
  verified?: boolean;
}

export interface V2SessionState {
  loopVersion: 2;
  sessionNumber: number;
  agentName: string;
  startedAt: string;
  pid: number;
  phases: Record<CorePhase, PhaseState>;
  substages: ActSubstageState[];
  posts: string[];
  engagements: any[];
  /** Set when --shadow suppresses publish */
  publishSuppressed?: boolean;
  /** Full context for published posts — consumed by afterConfirm hooks (PR1) */
  publishedPosts?: PublishedPostRecord[];
  /** Consensus signal snapshot from /api/signals — consumed by gate/LLM (PR1) */
  signalSnapshot?: unknown;
}

export type AnySessionState = SessionState | V2SessionState;

export function isV2(state: AnySessionState): state is V2SessionState {
  return (state as any).loopVersion === 2;
}

// ── Path Helpers ───────────────────────────────────

function stateFilePath(sessionNumber: number, sessionsDir: string = DEFAULT_SESSIONS_DIR, agentName: string = "sentinel"): string {
  return resolve(sessionsDir, `${agentName}-${sessionNumber}.json`);
}

function lockFilePath(sessionNumber: number, sessionsDir: string = DEFAULT_SESSIONS_DIR, agentName: string = "sentinel"): string {
  return resolve(sessionsDir, `${agentName}-${sessionNumber}.lock`);
}

// ── Lock Management ────────────────────────────────

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire a session lock. Fails if another process holds it.
 * Recovers stale locks (dead PID or >2h old).
 * Uses O_CREAT|O_EXCL for atomic creation (fixes TOCTOU race — Codex finding #1).
 */
export function acquireLock(sessionNumber: number, sessionsDir: string = DEFAULT_SESSIONS_DIR, agentName: string = "sentinel"): void {
  ensureDir(sessionsDir);
  const lockPath = lockFilePath(sessionNumber, sessionsDir, agentName);
  const lockContent = JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() });

  // Try atomic create first (O_CREAT | O_EXCL | O_WRONLY)
  try {
    const fd = openSync(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY);
    writeFileSync(fd, lockContent);
    closeSync(fd);
    return;
  } catch (e: any) {
    if (e.code !== "EEXIST") throw e;
    // Lock file exists — check if stale
  }

  // Lock exists — check staleness (Codex finding #5: protect parse)
  let lockData: { pid: number; createdAt: string };
  try {
    lockData = JSON.parse(readFileSync(lockPath, "utf-8"));
  } catch {
    // Corrupt lock file — treat as stale
    unlinkSync(lockPath);
    const fd = openSync(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY);
    writeFileSync(fd, lockContent);
    closeSync(fd);
    return;
  }

  // Lock is held if PID is alive (regardless of age — Codex review MED-6).
  // Only use age for dead-PID recovery (process crashed, PID recycled).
  if (isPidAlive(lockData.pid)) {
    throw new Error(
      `Session ${sessionNumber} is locked by PID ${lockData.pid} (started ${lockData.createdAt}). ` +
        `Use --resume to continue, or kill PID ${lockData.pid} to release.`
    );
  }
  // Stale lock — remove and re-acquire
  unlinkSync(lockPath);
  const fd = openSync(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY);
  writeFileSync(fd, lockContent);
  closeSync(fd);
}

/**
 * Release a session lock. Only removes if we own it (Codex finding #2).
 */
export function releaseLock(sessionNumber: number, sessionsDir: string = DEFAULT_SESSIONS_DIR, agentName: string = "sentinel"): void {
  const lockPath = lockFilePath(sessionNumber, sessionsDir, agentName);
  if (!existsSync(lockPath)) return;
  try {
    const lockData = JSON.parse(readFileSync(lockPath, "utf-8"));
    if (lockData.pid !== process.pid) return; // Not our lock
  } catch {
    // Corrupt lock — safe to remove
  }
  unlinkSync(lockPath);
}

// ── State CRUD ─────────────────────────────────────

/**
 * Ensure sessions directory exists.
 */
function ensureDir(sessionsDir: string = DEFAULT_SESSIONS_DIR): void {
  if (!existsSync(sessionsDir)) {
    mkdirSync(sessionsDir, { recursive: true });
  }
}

/**
 * Normalize state to handle migrations (e.g., adding new phases).
 * Called by both loadState() and findActiveSession() to ensure
 * resumed sessions always have the full phase set.
 */
export function normalizeState(state: SessionState): SessionState;
export function normalizeState(state: V2SessionState): V2SessionState;
export function normalizeState(state: AnySessionState): AnySessionState;
export function normalizeState(state: AnySessionState): AnySessionState {
  if (isV2(state)) {
    for (const phase of CORE_PHASE_ORDER) {
      if (!state.phases[phase]) {
        state.phases[phase] = { status: "pending" };
      }
    }
    if (!state.substages) state.substages = [];
  } else {
    for (const phase of PHASE_ORDER) {
      if (!state.phases[phase]) {
        state.phases[phase] = { status: "pending" };
      }
    }
  }
  if (!state.posts) state.posts = [];
  if (!state.engagements) state.engagements = [];
  return state;
}

/**
 * Load state for a specific session number. Returns null if not found.
 */
export function loadState(sessionNumber: number, sessionsDir: string = DEFAULT_SESSIONS_DIR, agentName: string = "sentinel"): AnySessionState | null {
  const path = stateFilePath(sessionNumber, sessionsDir, agentName);
  if (!existsSync(path)) return null;
  try {
    const state = JSON.parse(readFileSync(path, "utf-8"));
    return normalizeState(state as AnySessionState);
  } catch {
    return null;
  }
}

/**
 * Find the most recent active session (any session with a state file).
 * Returns null if no active sessions.
 */
export function findActiveSession(sessionsDir: string = DEFAULT_SESSIONS_DIR, agentName: string = "sentinel"): AnySessionState | null {
  ensureDir(sessionsDir);
  const files: string[] = readdirSync(sessionsDir);
  const pattern = new RegExp(`^${agentName}-\\d+\\.json$`);
  const numPattern = new RegExp(`${agentName}-(\\d+)\\.json`);
  const sessionFiles = files
    .filter((f: string) => pattern.test(f))
    .sort((a, b) => {
      // Numeric sort by session number (Codex finding #4)
      const numA = parseInt(a.match(numPattern)![1], 10);
      const numB = parseInt(b.match(numPattern)![1], 10);
      return numB - numA; // descending
    });

  for (const file of sessionFiles) {
    const path = resolve(sessionsDir, file);
    try {
      const state = JSON.parse(readFileSync(path, "utf-8"));
      return normalizeState(state as AnySessionState);
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Save session state to disk.
 */
export function saveState(state: AnySessionState, sessionsDir?: string): void {
  const dir = sessionsDir || resolve(homedir(), `.${state.agentName}`, "sessions");
  ensureDir(dir);
  writeFileSync(stateFilePath(state.sessionNumber, dir, state.agentName), JSON.stringify(state, null, 2));
}

/**
 * Create a fresh session state with all phases pending.
 */
export function startSession(
  sessionNumber: number,
  agentName: string = "sentinel",
  sessionsDir: string = DEFAULT_SESSIONS_DIR,
  loopVersion: LoopVersion = 1
): AnySessionState {
  ensureDir(sessionsDir);
  acquireLock(sessionNumber, sessionsDir, agentName);

  if (loopVersion === 2) {
    const phases: Record<CorePhase, PhaseState> = {} as any;
    for (const phase of CORE_PHASE_ORDER) {
      phases[phase] = { status: "pending" };
    }

    const state: V2SessionState = {
      loopVersion: 2,
      sessionNumber,
      agentName,
      startedAt: new Date().toISOString(),
      pid: process.pid,
      phases,
      substages: [],
      posts: [],
      engagements: [],
    };

    saveState(state, sessionsDir);
    return state;
  }

  const phases: Record<PhaseName, PhaseState> = {} as any;
  for (const phase of PHASE_ORDER) {
    phases[phase] = { status: "pending" };
  }

  const state: SessionState = {
    sessionNumber,
    agentName,
    startedAt: new Date().toISOString(),
    pid: process.pid,
    phases,
    posts: [],
    engagements: [],
  };

  saveState(state, sessionsDir);
  return state;
}

/**
 * Mark a phase as in_progress.
 */
export function beginPhase(state: AnySessionState, phase: PhaseName | CorePhase, sessionsDir?: string): AnySessionState {
  (state.phases as any)[phase] = {
    status: "in_progress",
    startedAt: new Date().toISOString(),
  };
  saveState(state, sessionsDir);
  return state;
}

/**
 * Mark a phase as completed with optional result data.
 */
export function completePhase(
  state: AnySessionState,
  phase: PhaseName | CorePhase,
  result?: any,
  sessionsDir?: string
): AnySessionState {
  (state.phases as any)[phase] = {
    ...(state.phases as any)[phase],
    status: "completed",
    completedAt: new Date().toISOString(),
    result,
  };
  saveState(state, sessionsDir);
  return state;
}

/**
 * Mark a phase as failed with error message.
 */
export function failPhase(
  state: AnySessionState,
  phase: PhaseName | CorePhase,
  error: string,
  sessionsDir?: string
): AnySessionState {
  (state.phases as any)[phase] = {
    ...(state.phases as any)[phase],
    status: "failed",
    completedAt: new Date().toISOString(),
    error,
  };
  saveState(state, sessionsDir);
  return state;
}

/**
 * Get the next pending phase (first non-completed in order).
 * Returns null if all phases are completed.
 */
export function getNextPhase(state: AnySessionState): PhaseName | CorePhase | null {
  if (isV2(state)) {
    for (const phase of CORE_PHASE_ORDER) {
      const status = state.phases[phase].status;
      if (status === "pending" || status === "in_progress" || status === "failed") {
        return phase;
      }
    }
    return null;
  }
  for (const phase of PHASE_ORDER) {
    const status = state.phases[phase].status;
    if (status === "pending" || status === "in_progress" || status === "failed") {
      return phase;
    }
  }
  return null;
}

/**
 * Get ordered list of all phases for the given state version.
 */
export function getPhaseOrder(state?: AnySessionState): (PhaseName | CorePhase)[] {
  if (state && isV2(state)) return [...CORE_PHASE_ORDER];
  return [...PHASE_ORDER];
}

/**
 * Clear session state and release lock. Called after successful HARDEN.
 */
export function clearState(sessionNumber: number, sessionsDir: string = DEFAULT_SESSIONS_DIR, agentName: string = "sentinel"): void {
  const statePath = stateFilePath(sessionNumber, sessionsDir, agentName);
  if (existsSync(statePath)) unlinkSync(statePath);
  releaseLock(sessionNumber, sessionsDir, agentName);
}
