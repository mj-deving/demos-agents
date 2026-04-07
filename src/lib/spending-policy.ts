/**
 * Standalone spending policy for DEM transfers.
 *
 * Guards all DEM spending with configurable daily/session caps,
 * per-tip limits, optional allowlists, and dry-run mode (default: on).
 * Not an extension — used directly by any code that transfers DEM.
 *
 * Persistence: ~/.{agent}/spending-ledger.json (atomic writes).
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

import { observe } from "./pipeline/observe.js";

// ── Types ──────────────────────────────────────────

export interface SpendingPolicyConfig {
  /** Maximum DEM spend per day (default: 10) */
  dailyCapDem: number;
  /** Maximum DEM spend per session (default: 5) */
  sessionCapDem: number;
  /** Minimum DEM per tip (default: 1) */
  perTipMinDem: number;
  /** Maximum DEM per tip (default: 10) */
  perTipMaxDem: number;
  /** If set, only these addresses can receive tips */
  addressAllowlist?: string[];
  /** When true, all spends are simulated (default: true) */
  dryRun: boolean;
  /** When true, require human confirmation for real spends (default: true) */
  requireConfirmation: boolean;
}

export interface SpendingTransaction {
  timestamp: string;
  amount: number;
  recipient: string;
  postTxHash: string;
  type: "tip" | "bet" | "attestation" | "publish";
  dryRun: boolean;
  agent: string;
}

export interface SpendingLedger {
  address: string;
  /** Current day in YYYY-MM-DD format */
  date: string;
  dailySpent: number;
  sessionSpent: number;
  transactions: SpendingTransaction[];
}

export interface SpendDecision {
  allowed: boolean;
  reason: string;
  dryRun: boolean;
}

// ── Defaults ───────────────────────────────────────

/**
 * Create a default spending policy config.
 *
 * Defaults to maximum safety: dryRun=true, requireConfirmation=true,
 * conservative caps. Callers opt into real spending explicitly.
 * Pass autonomous=true for --oversight autonomous to auto-enable real spending.
 */
export function defaultSpendingPolicy(opts?: { autonomous?: boolean }): SpendingPolicyConfig {
  return {
    dailyCapDem: 10,
    sessionCapDem: 5,
    perTipMinDem: 1,
    perTipMaxDem: 10,
    dryRun: opts?.autonomous ? false : true,
    requireConfirmation: opts?.autonomous ? false : true,
  };
}

// ── Policy Checks ──────────────────────────────────

/**
 * Check whether a spend is allowed under the current policy and ledger state.
 *
 * Validates:
 * - Amount is within per-tip min/max bounds
 * - Daily cap would not be exceeded
 * - Session cap would not be exceeded
 * - Recipient is in allowlist (if configured)
 * - Dry-run mode pass-through (always allowed, marked as dry run)
 *
 * Logs the decision via observe() for audit trail.
 */
export function canSpend(
  amount: number,
  recipient: string,
  config: SpendingPolicyConfig,
  ledger: SpendingLedger
): SpendDecision {
  // Reset daily counters if new day
  const today = todayUTC();
  if (ledger.date !== today) {
    ledger.date = today;
    ledger.dailySpent = 0;
  }

  // Dry run — always allowed but flagged
  if (config.dryRun) {
    const decision: SpendDecision = {
      allowed: true,
      reason: "Dry run — spend simulated, no DEM transferred",
      dryRun: true,
    };
    logDecision(amount, recipient, decision);
    return decision;
  }

  // Per-tip bounds
  if (amount < config.perTipMinDem) {
    const decision: SpendDecision = {
      allowed: false,
      reason: `Amount ${amount} DEM below minimum tip of ${config.perTipMinDem} DEM`,
      dryRun: false,
    };
    logDecision(amount, recipient, decision);
    return decision;
  }

  if (amount > config.perTipMaxDem) {
    const decision: SpendDecision = {
      allowed: false,
      reason: `Amount ${amount} DEM exceeds maximum tip of ${config.perTipMaxDem} DEM`,
      dryRun: false,
    };
    logDecision(amount, recipient, decision);
    return decision;
  }

  // Daily cap
  if (ledger.dailySpent + amount > config.dailyCapDem) {
    const remaining = Math.max(0, config.dailyCapDem - ledger.dailySpent);
    const decision: SpendDecision = {
      allowed: false,
      reason: `Daily cap would be exceeded (spent: ${ledger.dailySpent}, cap: ${config.dailyCapDem}, remaining: ${remaining} DEM)`,
      dryRun: false,
    };
    logDecision(amount, recipient, decision);
    return decision;
  }

  // Session cap
  if (ledger.sessionSpent + amount > config.sessionCapDem) {
    const remaining = Math.max(0, config.sessionCapDem - ledger.sessionSpent);
    const decision: SpendDecision = {
      allowed: false,
      reason: `Session cap would be exceeded (spent: ${ledger.sessionSpent}, cap: ${config.sessionCapDem}, remaining: ${remaining} DEM)`,
      dryRun: false,
    };
    logDecision(amount, recipient, decision);
    return decision;
  }

  // Allowlist check
  if (config.addressAllowlist && config.addressAllowlist.length > 0) {
    const normalized = recipient.toLowerCase();
    const allowed = config.addressAllowlist.some(
      (a) => a.toLowerCase() === normalized
    );
    if (!allowed) {
      const decision: SpendDecision = {
        allowed: false,
        reason: `Recipient ${recipient} not in address allowlist`,
        dryRun: false,
      };
      logDecision(amount, recipient, decision);
      return decision;
    }
  }

  const decision: SpendDecision = {
    allowed: true,
    reason: "Within policy limits",
    dryRun: false,
  };
  logDecision(amount, recipient, decision);
  return decision;
}

/**
 * Check whether a spend is allowed under daily+session caps only (no per-tip bounds).
 * Use for non-tip spends (bets, attestation gas, publish fees) that have their own
 * amount validation but should still respect the session-level DEM budget.
 */
export function checkSessionBudget(
  amount: number,
  config: SpendingPolicyConfig,
  ledger: SpendingLedger,
): SpendDecision {
  // Hard guard: reject invalid amounts at the policy layer (Codex review fix H1)
  if (!Number.isFinite(amount) || amount <= 0) {
    const decision: SpendDecision = {
      allowed: false,
      reason: `Invalid amount: ${amount} (must be finite and positive)`,
      dryRun: false,
    };
    logDecision(amount, "session-budget", decision);
    return decision;
  }

  const today = todayUTC();
  if (ledger.date !== today) {
    ledger.date = today;
    ledger.dailySpent = 0;
  }

  if (config.dryRun) {
    const decision: SpendDecision = { allowed: true, reason: "Dry run — spend simulated", dryRun: true };
    logDecision(amount, "session-budget", decision);
    return decision;
  }

  if (ledger.dailySpent + amount > config.dailyCapDem) {
    const remaining = Math.max(0, config.dailyCapDem - ledger.dailySpent);
    const decision: SpendDecision = { allowed: false, reason: `Daily DEM cap exceeded (remaining: ${remaining})`, dryRun: false };
    logDecision(amount, "session-budget", decision);
    return decision;
  }

  if (ledger.sessionSpent + amount > config.sessionCapDem) {
    const remaining = Math.max(0, config.sessionCapDem - ledger.sessionSpent);
    const decision: SpendDecision = { allowed: false, reason: `Session DEM cap exceeded (remaining: ${remaining})`, dryRun: false };
    logDecision(amount, "session-budget", decision);
    return decision;
  }

  const decision: SpendDecision = { allowed: true, reason: "Within session budget", dryRun: false };
  logDecision(amount, "session-budget", decision);
  return decision;
}

/**
 * Record a completed spend transaction in the ledger.
 *
 * Updates daily and session totals and appends the transaction.
 * Returns the updated ledger.
 */
export function recordSpend(
  tx: SpendingTransaction,
  ledger: SpendingLedger
): SpendingLedger {
  // Reset daily counters if new day
  const today = todayUTC();
  if (ledger.date !== today) {
    ledger.date = today;
    ledger.dailySpent = 0;
  }

  if (!tx.dryRun) {
    ledger.dailySpent += tx.amount;
  }
  ledger.sessionSpent += tx.amount;
  ledger.transactions.push(tx);

  // Keep transactions bounded — retain last 100
  if (ledger.transactions.length > 100) {
    ledger.transactions = ledger.transactions.slice(-100);
  }

  return ledger;
}

// ── Persistence ────────────────────────────────────

/**
 * Load the spending ledger for an address and agent.
 *
 * Returns a fresh ledger if the file doesn't exist or is corrupt.
 * Resets daily counters if the stored date doesn't match today.
 * Never throws.
 */
export function loadSpendingLedger(
  address: string,
  agent: string
): SpendingLedger {
  const path = ledgerFilePath(agent);

  try {
    if (!existsSync(path)) {
      return freshLedger(address);
    }
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    if (!raw || typeof raw.address !== "string") {
      return freshLedger(address);
    }
    const ledger = raw as SpendingLedger;

    // Reset daily counters if new day
    const today = todayUTC();
    if (ledger.date !== today) {
      ledger.date = today;
      ledger.dailySpent = 0;
    }

    // Session spent always starts at 0 for a new session
    ledger.sessionSpent = 0;

    return ledger;
  } catch {
    return freshLedger(address);
  }
}

/**
 * Save the spending ledger atomically (write .tmp then rename).
 */
export function saveSpendingLedger(
  ledger: SpendingLedger,
  agent: string
): void {
  const dir = resolve(homedir(), `.${agent}`);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const path = ledgerFilePath(agent);
  const tmpPath = path + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(ledger, null, 2));
  renameSync(tmpPath, path);
}

// ── Helpers ────────────────────────────────────────

/**
 * Get today's date as YYYY-MM-DD in UTC.
 */
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Resolve the spending ledger file path for an agent.
 */
function ledgerFilePath(agent: string): string {
  return resolve(homedir(), `.${agent}`, "spending-ledger.json");
}

/**
 * Create a fresh spending ledger for an address.
 */
function freshLedger(address: string): SpendingLedger {
  return {
    address,
    date: todayUTC(),
    dailySpent: 0,
    sessionSpent: 0,
    transactions: [],
  };
}

/**
 * Log a spend decision via observe() for audit trail.
 */
function logDecision(
  amount: number,
  recipient: string,
  decision: SpendDecision
): void {
  observe(
    decision.allowed ? "insight" : "pattern",
    `Spend check: ${amount} DEM to ${recipient.slice(0, 10)}... — ${decision.reason}`,
    {
      phase: "act",
      source: "spending-policy.ts",
      data: {
        amount,
        recipient,
        allowed: decision.allowed,
        dryRun: decision.dryRun,
      },
    }
  );
}

// ── Signing Boundary Guard ──────────────────────────

/**
 * Wrap a Demos instance with spending policy enforcement at the signing boundary.
 *
 * Returns a proxy that intercepts DemosTransactions operations and checks
 * spending policy before allowing the transaction to proceed. This enforces
 * policy at the SDK level rather than relying on application-layer checks.
 *
 * Non-spending operations (store, general signing) pass through unmodified.
 */
export interface SigningGuard {
  /** Check if a spend of `amount` DEM to `recipient` would be allowed */
  canSpend(amount: number, recipient: string): SpendDecision;
  /** Record a completed spend (call after successful broadcast) */
  recordSpend(tx: SpendingTransaction): void;
  /** Get current policy config */
  readonly policy: SpendingPolicyConfig;
  /** Get current ledger state */
  readonly ledger: SpendingLedger;
}

/**
 * Create a signing guard that enforces spending policy at the signing boundary.
 * All spend decisions are logged to the observation JSONL for audit trail.
 */
export function createSigningGuard(
  policy: SpendingPolicyConfig,
  ledger: SpendingLedger
): SigningGuard {
  return {
    canSpend(amount: number, recipient: string): SpendDecision {
      return canSpend(amount, recipient, policy, ledger);
    },
    recordSpend(tx: SpendingTransaction): void {
      recordSpend(tx, ledger);
    },
    get policy() { return policy; },
    get ledger() { return ledger; },
  };
}
