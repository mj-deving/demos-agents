/**
 * Persistent address-scoped write rate limiting.
 *
 * Tracks daily and hourly publish counts per wallet address to stay
 * within SuperColony API rate limits. Uses conservative margins
 * (14/day, 4/hour vs API's 15/day, 5/hour) to avoid hitting walls.
 *
 * Persistence: ~/.config/demos/write-rate-{address-short}.json (atomic writes).
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

// ── Constants ──────────────────────────────────────

/** Default daily publish limit — margin of 1 from API's 15 */
export const DAILY_LIMIT = 14;

/** Default hourly publish limit — margin of 1 from API's 5 */
export const HOURLY_LIMIT = 4;

// ── Types ──────────────────────────────────────────

export interface WriteRateEntry {
  timestamp: string;
  agent: string;
  txHash?: string;
}

export interface WriteRateLedger {
  address: string;
  /** ISO date (YYYY-MM-DD) for daily window */
  dailyWindowStart: string;
  /** ISO timestamp for hourly window */
  hourlyWindowStart: string;
  dailyCount: number;
  hourlyCount: number;
  entries: WriteRateEntry[];
}

export interface WriteRateCheck {
  allowed: boolean;
  reason: string;
  dailyRemaining: number;
  hourlyRemaining: number;
}

// ── Path Helpers ───────────────────────────────────

const CONFIG_DIR = resolve(homedir(), ".config", "demos");

/**
 * Get the ledger file path for an address.
 * Uses first 10 chars of address for filename brevity.
 */
function ledgerPath(address: string): string {
  const short = address.slice(0, 10).replace(/[^a-zA-Z0-9]/g, "");
  return resolve(CONFIG_DIR, `write-rate-${short}.json`);
}

/**
 * Ensure the config directory exists.
 */
function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

// ── Date Helpers ───────────────────────────────────

/**
 * Get today's date as YYYY-MM-DD in UTC.
 */
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Get the current hour's start as ISO timestamp.
 */
function currentHourStart(): string {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  return now.toISOString();
}

/**
 * Check if two ISO timestamps are in the same hour.
 */
function isSameHour(a: string, b: string): boolean {
  // Compare truncated to hour precision
  return a.slice(0, 13) === b.slice(0, 13);
}

// ── Ledger CRUD ────────────────────────────────────

/**
 * Load the write rate ledger for an address.
 *
 * Returns a fresh ledger if the file doesn't exist or is corrupt.
 * Resets stale daily/hourly windows automatically.
 * Never throws.
 */
export function loadWriteRateLedger(address: string): WriteRateLedger {
  const path = ledgerPath(address);
  let ledger: WriteRateLedger;

  try {
    if (!existsSync(path)) {
      return freshLedger(address);
    }
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    if (!raw || typeof raw.address !== "string") {
      return freshLedger(address);
    }
    ledger = raw as WriteRateLedger;
  } catch {
    return freshLedger(address);
  }

  // Reset stale windows
  return resetStaleWindows(ledger);
}

/**
 * Save the write rate ledger atomically (write .tmp then rename).
 */
export function saveWriteRateLedger(ledger: WriteRateLedger): void {
  ensureConfigDir();
  const path = ledgerPath(ledger.address);
  const tmpPath = path + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(ledger, null, 2));
  renameSync(tmpPath, path);
}

/**
 * Check whether a publish is allowed under current rate limits.
 *
 * Resets expired windows before checking. Returns a detailed
 * check result with remaining quota information.
 */
export function canPublish(
  ledger: WriteRateLedger,
  limits?: { dailyLimit?: number; hourlyLimit?: number }
): WriteRateCheck {
  const dailyLimit = limits?.dailyLimit ?? DAILY_LIMIT;
  const hourlyLimit = limits?.hourlyLimit ?? HOURLY_LIMIT;

  // Reset stale windows first
  const current = resetStaleWindows(ledger);
  // Mutate in place so caller's reference stays updated
  Object.assign(ledger, current);

  const dailyRemaining = Math.max(0, dailyLimit - ledger.dailyCount);
  const hourlyRemaining = Math.max(0, hourlyLimit - ledger.hourlyCount);

  if (ledger.hourlyCount >= hourlyLimit) {
    return {
      allowed: false,
      reason: `Hourly limit reached (${hourlyLimit}/hour). ${dailyRemaining} daily remaining.`,
      dailyRemaining,
      hourlyRemaining: 0,
    };
  }

  if (ledger.dailyCount >= dailyLimit) {
    return {
      allowed: false,
      reason: `Daily limit reached (${dailyLimit}/day).`,
      dailyRemaining: 0,
      hourlyRemaining,
    };
  }

  return {
    allowed: true,
    reason: "Within rate limits",
    dailyRemaining,
    hourlyRemaining,
  };
}

/**
 * Record a successful publish in the ledger.
 *
 * Increments daily and hourly counters and adds an entry.
 * Returns the updated ledger.
 */
export function recordPublish(
  ledger: WriteRateLedger,
  agent: string,
  txHash?: string
): WriteRateLedger {
  // Reset stale windows before recording
  const current = resetStaleWindows(ledger);
  Object.assign(ledger, current);

  ledger.dailyCount++;
  ledger.hourlyCount++;

  ledger.entries.push({
    timestamp: new Date().toISOString(),
    agent,
    txHash,
  });

  // Keep entries bounded — only retain last 50
  if (ledger.entries.length > 50) {
    ledger.entries = ledger.entries.slice(-50);
  }

  return ledger;
}

// ── Helpers ────────────────────────────────────────

/**
 * Create a fresh ledger for an address with zeroed counters.
 */
function freshLedger(address: string): WriteRateLedger {
  return {
    address,
    dailyWindowStart: todayUTC(),
    hourlyWindowStart: currentHourStart(),
    dailyCount: 0,
    hourlyCount: 0,
    entries: [],
  };
}

/**
 * Reset daily and/or hourly windows if they are stale.
 * Returns the (possibly updated) ledger.
 */
function resetStaleWindows(ledger: WriteRateLedger): WriteRateLedger {
  const today = todayUTC();
  const hourStart = currentHourStart();

  // Reset daily window if new day
  if (ledger.dailyWindowStart !== today) {
    ledger.dailyWindowStart = today;
    ledger.dailyCount = 0;
  }

  // Reset hourly window if new hour
  if (!isSameHour(ledger.hourlyWindowStart, hourStart)) {
    ledger.hourlyWindowStart = hourStart;
    ledger.hourlyCount = 0;
  }

  return ledger;
}
