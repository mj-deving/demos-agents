/**
 * Session log I/O for Sentinel tools.
 *
 * Reads/writes JSONL session logs (append-only).
 * Handles rotation to archive when entry count exceeds threshold.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

// ── Constants ──────────────────────────────────────

const FALLBACK_LOG_NAME = ".sentinel-session-log.jsonl";
const MAX_ENTRIES = 50;

// ── Types ──────────────────────────────────────────

export interface SessionLogEntry {
  timestamp: string;
  txHash: string;
  category: string;
  attestation_type: string;
  attestation_url?: string;
  hypothesis: string;
  predicted_reactions: number;
  actual_reactions?: number;
  actual_score?: number;
  actual_agrees?: number;
  actual_disagrees?: number;
  agents_referenced: string[];
  topic: string;
  confidence: number;
  text_preview: string;
  text_length?: number;
  tags: string[];
  is_reply?: boolean;
  parent_tx_hash?: string;
  confidence_gate?: string[];
  [key: string]: unknown; // Allow extra fields
}

// ── Read ───────────────────────────────────────────

/**
 * Read all entries from a JSONL session log.
 * Returns empty array if file doesn't exist.
 */
export function readSessionLog(logPath?: string): SessionLogEntry[] {
  const path = logPath || resolveLogPath();
  if (!existsSync(path)) return [];

  const content = readFileSync(path, "utf-8").trim();
  if (!content) return [];

  return content.split("\n").map((line, i) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSON on line ${i + 1} of ${path}`);
    }
  });
}

// ── Write ──────────────────────────────────────────

/**
 * Append a single entry to the session log.
 */
export function appendSessionLog(entry: SessionLogEntry, logPath?: string): void {
  const path = logPath || resolveLogPath();
  appendFileSync(path, JSON.stringify(entry) + "\n");
}

/**
 * Rewrite the entire session log (used by audit --update).
 */
export function writeSessionLog(entries: SessionLogEntry[], logPath?: string): void {
  const path = logPath || resolveLogPath();
  const content = entries.map(e => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(path, content);
}

// ── Rotation ───────────────────────────────────────

/**
 * Rotate session log if it exceeds MAX_ENTRIES.
 * Moves oldest entries to archive file, keeps newest MAX_ENTRIES.
 */
export function rotateSessionLog(logPath?: string): { rotated: boolean; archived: number } {
  const path = logPath || resolveLogPath();
  const entries = readSessionLog(path);

  if (entries.length <= MAX_ENTRIES) {
    return { rotated: false, archived: 0 };
  }

  const archivePath = path.endsWith(".jsonl")
    ? path.replace(/\.jsonl$/, ".archive.jsonl")
    : path + ".archive";
  if (archivePath === path) {
    throw new Error(`Archive path collision: ${archivePath} === ${path}`);
  }
  const toArchive = entries.slice(0, entries.length - MAX_ENTRIES);
  const toKeep = entries.slice(entries.length - MAX_ENTRIES);

  // Append archived entries to archive file
  const archiveContent = toArchive.map(e => JSON.stringify(e)).join("\n") + "\n";
  appendFileSync(archivePath, archiveContent);

  // Rewrite active log with kept entries
  writeSessionLog(toKeep, path);

  return { rotated: true, archived: toArchive.length };
}

/**
 * Resolve log path from flag, env var, or default.
 * Checked lazily so env vars can be set after module load (e.g. via dotenv).
 */
export function resolveLogPath(flagValue?: string, agentName: string = "sentinel"): string {
  if (flagValue) {
    return resolve(flagValue.replace(/^~/, homedir()));
  }
  const envPath = process.env.AGENT_LOG_PATH || process.env.SENTINEL_LOG_PATH;
  if (envPath) {
    return resolve(envPath.replace(/^~/, homedir()));
  }
  return resolve(homedir(), `.${agentName}-session-log.jsonl`);
}
