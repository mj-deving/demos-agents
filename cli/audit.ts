#!/usr/bin/env npx tsx
/**
 * Session Audit — Sentinel Phase 2 tool
 *
 * Maps to strategy.yaml AUDIT phase.
 * Reads session log, fetches current reactions from chain (on-chain first),
 * compares predicted vs actual, calculates statistics.
 *
 * Chain-first: uses getTransactions to scan for reactions, getTxByHash to verify posts.
 * Score is computed locally from the deterministic scoring formula.
 *
 * Usage:
 *   npx tsx tools/audit.ts [--log PATH] [--env PATH] [--update] [--pretty]
 */

import { connectWallet, info, setLogAgent } from "../src/lib/network/sdk.js";
import { createSdkBridge, AUTH_PENDING_TOKEN } from "../src/toolkit/sdk-bridge.js";
import { readSessionLog, writeSessionLog, rotateSessionLog, resolveLogPath } from "../src/lib/util/log.js";
import type { SessionLogEntry } from "../src/lib/util/log.js";
import {
  SCORE_BASE, SCORE_ATTESTATION, SCORE_CONFIDENCE, SCORE_LONG_TEXT,
  SCORE_ENGAGEMENT_T1, SCORE_ENGAGEMENT_T2, SCORE_MAX,
  ENGAGEMENT_T1_THRESHOLD, ENGAGEMENT_T2_THRESHOLD, LONG_TEXT_MIN_CHARS,
} from "../src/lib/scoring/scoring.js";
import { resolveAgentName, loadAgentConfig } from "../src/lib/agent-config.js";

// ── Arg Parsing ────────────────────────────────────

function parseArgs(): { flags: Record<string, string> } {
  const args = process.argv.slice(2);
  const flags: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      printHelp();
      process.exit(0);
    }
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }

  return { flags };
}

function printHelp(): void {
  console.log(`
Session Audit — Sentinel AUDIT phase tool

USAGE:
  npx tsx tools/audit.ts [flags]

FLAGS:
  --agent NAME   Agent name (default: sentinel)
  --log PATH     Session log path (default: ~/.{agent}-session-log.jsonl)
  --env PATH     Path to .env file (default: .env in cwd)
  --update       Write actual scores/reactions back to log (default: dry-run)
  --pretty       Human-readable formatted output
  --json         Compact JSON output (single line, for piping)
  --help, -h     Show this help

EXAMPLES:
  npx tsx tools/audit.ts --pretty
  npx tsx tools/audit.ts --log ~/.sentinel-session-log.jsonl --pretty
  npx tsx tools/audit.ts --log ~/.sentinel-session-log.jsonl --update --pretty
`);
}

// ── Types ──────────────────────────────────────────

interface AuditResult {
  txHash: string;
  category: string;
  attestation_type: string;
  predicted_reactions: number;
  actual_reactions: number | null;
  actual_score: number | null;
  delta: number | null;
  highDisagree: boolean;
  status: "audited" | "not_found" | "already_audited" | "error" | "invalid_txhash";
  error?: string;
}

interface AuditStats {
  total_entries: number;
  audited_this_run: number;
  already_audited: number;
  not_found: number;
  avg_prediction_error: number | null;
  calibration_offset: number | null;
  score_distribution: Record<number, number>;
  avg_score: number | null;
  engagement_t1: { count: number; total: number };
  engagement_t2: { count: number; total: number };
}

// ── Scoring (local, deterministic — matches strategy.yaml formula) ──

/**
 * Compute post score locally using the canonical on-chain formula.
 * Verified against n=34 real posts (2026-03-14).
 *   base(20) + attestation(40) + confidence(5) + long_text(15) + engagement_t1(10) + engagement_t2(10) = max 100
 */
function computeScore(entry: SessionLogEntry, reactions: number): number {
  let score = SCORE_BASE;
  if (entry.attestation_type && entry.attestation_type !== "none") score += SCORE_ATTESTATION;
  if (entry.confidence != null) score += SCORE_CONFIDENCE;
  // text_length is the actual published length; text_preview is truncated to 100 chars
  // Published posts are guaranteed > 200 chars by quality gate — default true for legacy entries
  const textLen = entry.text_length ?? (LONG_TEXT_MIN_CHARS + 1);
  if (textLen >= LONG_TEXT_MIN_CHARS) score += SCORE_LONG_TEXT;
  if (reactions >= ENGAGEMENT_T1_THRESHOLD) score += SCORE_ENGAGEMENT_T1;
  if (reactions >= ENGAGEMENT_T2_THRESHOLD) score += SCORE_ENGAGEMENT_T2;
  return Math.min(score, SCORE_MAX);
}

/**
 * Calculate audit statistics from results.
 */
function calculateStats(
  entries: SessionLogEntry[],
  results: AuditResult[]
): AuditStats {
  const auditedThisRun = results.filter(r => r.status === "audited");
  const alreadyAudited = results.filter(r => r.status === "already_audited");
  const notFound = results.filter(r => r.status === "not_found");

  // Combine newly audited + already audited for statistics (exclude not_found)
  const allAudited = [
    ...auditedThisRun.map(r => ({
      predicted: r.predicted_reactions,
      actual: r.actual_reactions!,
      score: r.actual_score!,
    })),
    ...alreadyAudited.map(r => ({
      predicted: r.predicted_reactions,
      actual: r.actual_reactions!,
      score: r.actual_score!,
    })),
  ];

  // Prediction error (positive = under-predict, we got more than expected)
  let avgError: number | null = null;
  let calibrationOffset: number | null = null;
  if (allAudited.length > 0) {
    const errors = allAudited.map(a => a.actual - a.predicted);
    avgError = +(errors.reduce((s, e) => s + e, 0) / errors.length).toFixed(1);
    calibrationOffset = Math.round(avgError);
  }

  // Score distribution
  const scoreDist: Record<number, number> = {};
  let scoreSum = 0;
  for (const a of allAudited) {
    const bucket = Math.floor(a.score / 10) * 10; // 80, 90, 100
    scoreDist[bucket] = (scoreDist[bucket] || 0) + 1;
    scoreSum += a.score;
  }
  const avgScore = allAudited.length > 0
    ? +(scoreSum / allAudited.length).toFixed(1)
    : null;

  // Engagement tiers
  const t1 = allAudited.filter(a => a.actual >= 5).length;
  const t2 = allAudited.filter(a => a.actual >= 15).length;

  return {
    total_entries: entries.length,
    audited_this_run: auditedThisRun.length,
    already_audited: alreadyAudited.length,
    not_found: notFound.length,
    avg_prediction_error: avgError,
    calibration_offset: calibrationOffset,
    score_distribution: scoreDist,
    avg_score: avgScore,
    engagement_t1: { count: t1, total: allAudited.length },
    engagement_t2: { count: t2, total: allAudited.length },
  };
}

// ── Pretty Output ──────────────────────────────────

function prettyPrint(results: AuditResult[], stats: AuditStats): void {
  console.log(`\nAUDIT — Session Post Analysis\n`);

  for (const r of results) {
    const txShort = r.txHash.slice(0, 8);
    const disagreeFlag = r.highDisagree ? " ⚡ HIGH DISAGREE" : "";
    if (r.status === "audited") {
      const delta = r.delta! >= 0 ? `+${r.delta}` : `${r.delta}`;
      console.log(`  Post ${txShort} (${r.category}, ${r.attestation_type}): predicted ${r.predicted_reactions}rx → actual ${r.actual_reactions}rx (Δ ${delta}) | score ${r.actual_score}${disagreeFlag}`);
    } else if (r.status === "already_audited") {
      const delta = r.delta! >= 0 ? `+${r.delta}` : `${r.delta}`;
      console.log(`  Post ${txShort} (${r.category}, ${r.attestation_type}): ${r.actual_reactions}rx (Δ ${delta}) | score ${r.actual_score}${disagreeFlag} [cached]`);
    } else if (r.status === "not_found") {
      console.log(`  Post ${txShort} (${r.category}, ${r.attestation_type}): NOT FOUND in feed`);
    } else {
      console.log(`  Post ${txShort}: ERROR — ${r.error}`);
    }
  }

  console.log(`\nSTATISTICS:`);
  console.log(`  Total entries: ${stats.total_entries}`);
  console.log(`  Audited this run: ${stats.audited_this_run}`);
  console.log(`  Already audited: ${stats.already_audited}`);
  if (stats.not_found > 0) {
    console.log(`  Not found: ${stats.not_found}`);
  }

  if (stats.avg_prediction_error !== null) {
    const sign = stats.avg_prediction_error >= 0 ? "+" : "";
    const tendency = stats.avg_prediction_error > 0 ? "(under-predict)" : "(over-predict)";
    console.log(`  Avg prediction error: ${sign}${stats.avg_prediction_error} reactions ${tendency}`);
    console.log(`  Calibration offset: ${stats.calibration_offset! >= 0 ? "+" : ""}${stats.calibration_offset}`);
  }

  if (Object.keys(stats.score_distribution).length > 0) {
    const distStr = Object.entries(stats.score_distribution)
      .sort(([a], [b]) => Number(b) - Number(a))
      .map(([score, count]) => `${score}x${count}`)
      .join(", ");
    console.log(`  Score distribution: ${distStr} (avg ${stats.avg_score})`);
  }

  console.log(`  Engagement T1 (≥5rx): ${stats.engagement_t1.count}/${stats.engagement_t1.total}`);
  console.log(`  Engagement T2 (≥15rx): ${stats.engagement_t2.count}/${stats.engagement_t2.total}`);
  console.log();
}

// ── Main ───────────────────────────────────────────

async function main(): Promise<void> {
  const { flags } = parseArgs();

  const agentName = resolveAgentName(flags);
  setLogAgent(agentName);
  const config = loadAgentConfig(agentName);
  const logPath = resolveLogPath(flags["log"], agentName);
  const envPath = flags["env"] || ".env";
  const shouldUpdate = flags["update"] === "true";
  const prettyOutput = flags["pretty"] === "true";
  const jsonOutput = flags["json"] === "true";

  // Read session log
  const entries = readSessionLog(logPath);
  if (entries.length === 0) {
    info(`No entries in ${logPath}`);
    console.log(JSON.stringify({ results: [], stats: { total_entries: 0 } }));
    return;
  }
  info(`Read ${entries.length} entries from ${logPath}`);

  // Connect wallet — chain-only, no API auth needed
  const { demos, address } = await connectWallet(envPath);
  const bridge = createSdkBridge(demos, undefined, AUTH_PENDING_TOKEN);

  // Separate already-audited from unaudited entries
  const results: AuditResult[] = [];
  const unaudited: SessionLogEntry[] = [];

  for (const entry of entries) {
    // Already audited? (must have non-null values — 0 reactions is valid)
    // If agree/disagree breakdown is missing (pre-IMP-11-5 entries), refetch to populate
    if (entry.actual_reactions != null && entry.actual_score != null && entry.actual_agrees != null) {
      const agrees = entry.actual_agrees ?? 0;
      const disagrees = entry.actual_disagrees ?? 0;
      results.push({
        txHash: entry.txHash,
        category: entry.category,
        attestation_type: entry.attestation_type,
        predicted_reactions: entry.predicted_reactions,
        actual_reactions: entry.actual_reactions,
        actual_score: entry.actual_score,
        delta: entry.actual_reactions - entry.predicted_reactions,
        highDisagree: disagrees > agrees && disagrees >= 5,
        status: "already_audited",
      });
    } else {
      unaudited.push(entry);
    }
  }

  // Chain-first: single scan for all unaudited reactions
  if (unaudited.length > 0) {
    // Validate txHashes before chain scan
    const invalidEntries = unaudited.filter(e => !e.txHash || typeof e.txHash !== "string" || e.txHash.trim().length === 0);
    if (invalidEntries.length > 0) {
      info(`Skipping ${invalidEntries.length} entries with invalid txHash values`);
      for (const entry of invalidEntries) {
        results.push({
          txHash: entry.txHash || "(missing)",
          category: entry.category,
          attestation_type: entry.attestation_type,
          predicted_reactions: entry.predicted_reactions,
          actual_reactions: null,
          actual_score: null,
          delta: null,
          highDisagree: false,
          status: "invalid_txhash",
        });
      }
    }
    const validUnaudited = unaudited.filter(e => e.txHash && typeof e.txHash === "string" && e.txHash.trim().length > 0);
    if (validUnaudited.length === 0) {
      info("No valid unaudited entries to scan");
    } else {
    info(`Scanning chain for reactions on ${validUnaudited.length} unaudited posts...`);
    const txHashes = validUnaudited.map(e => e.txHash);

    try {
      const reactionMap = await bridge.getHiveReactions(txHashes);

      for (const entry of validUnaudited) {
        const rx = reactionMap.get(entry.txHash);
        const agrees = rx?.agree ?? 0;
        const disagrees = rx?.disagree ?? 0;
        const totalReactions = agrees + disagrees;
        const score = computeScore(entry, totalReactions);

        // Update entry in-memory (store agree/disagree for future cached runs)
        entry.actual_reactions = totalReactions;
        entry.actual_score = score;
        entry.actual_agrees = agrees;
        entry.actual_disagrees = disagrees;

        results.push({
          txHash: entry.txHash,
          category: entry.category,
          attestation_type: entry.attestation_type,
          predicted_reactions: entry.predicted_reactions,
          actual_reactions: totalReactions,
          actual_score: score,
          delta: totalReactions - entry.predicted_reactions,
          highDisagree: disagrees > agrees && disagrees >= 5,
          status: "audited",
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      info(`Chain scan failed: ${msg} — marking entries as error`);
      for (const entry of validUnaudited) {
        results.push({
          txHash: entry.txHash,
          category: entry.category,
          attestation_type: entry.attestation_type,
          predicted_reactions: entry.predicted_reactions,
          actual_reactions: null,
          actual_score: null,
          delta: null,
          highDisagree: false,
          status: "error",
          error: msg,
        });
      }
    }
    } // close else block for validUnaudited.length > 0
  }

  // Calculate statistics
  const stats = calculateStats(entries, results);

  // Update log file if requested
  if (shouldUpdate) {
    writeSessionLog(entries, logPath);
    info(`Updated ${logPath}`);

    // Check rotation
    const rotation = rotateSessionLog(logPath);
    if (rotation.rotated) {
      info(`Rotated: archived ${rotation.archived} entries`);
    }
  }

  // Output
  if (prettyOutput) {
    prettyPrint(results, stats);
  } else if (jsonOutput) {
    console.log(JSON.stringify({ results, stats }));
  } else {
    console.log(JSON.stringify({ results, stats }, null, 2));
  }
}

main().catch(err => {
  console.error(`[audit] ERROR: ${err.message}`);
  process.exit(1);
});
