#!/usr/bin/env npx tsx
/**
 * Session Audit — Sentinel Phase 2 tool
 *
 * Maps to strategy.yaml AUDIT phase.
 * Reads session log, fetches current scores/reactions from API,
 * compares predicted vs actual, calculates statistics.
 *
 * Usage:
 *   npx tsx tools/audit.ts [--log PATH] [--env PATH] [--update] [--pretty]
 */

import { connectWallet, apiCall, info } from "./lib/sdk.js";
import { ensureAuth } from "./lib/auth.js";
import { readSessionLog, writeSessionLog, rotateSessionLog, resolveLogPath } from "./lib/log.js";
import type { SessionLogEntry } from "./lib/log.js";

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
  --log PATH     Session log path (default: $SENTINEL_LOG_PATH or ~/.sentinel-session-log.jsonl)
  --env PATH     Path to .env file (default: .env in cwd)
  --update       Write actual scores/reactions back to log (default: dry-run)
  --pretty       Human-readable formatted output
  --json         Compact JSON output (single line, for piping)
  --help, -h     Show this help

EXAMPLES:
  npx tsx tools/audit.ts --pretty
  npx tsx tools/audit.ts --log ~/.isidore-session-log.jsonl --pretty
  npx tsx tools/audit.ts --log ~/.isidore-session-log.jsonl --update --pretty
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
  status: "audited" | "not_found" | "already_audited" | "error";
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

// ── Audit Logic ────────────────────────────────────

/**
 * Fetch a post's current state from the API.
 * Tries feed search by txHash, then falls back to author feed scan.
 */
async function fetchPostState(
  txHash: string,
  token: string,
  authorAddress: string
): Promise<{ reactions: number; score: number } | null> {
  // Try direct thread lookup (returns post + replies)
  const threadRes = await apiCall(`/api/feed/thread/${txHash}`, token);
  if (threadRes.ok && threadRes.data) {
    // Thread response may be the post itself or contain a posts array
    const post = threadRes.data.post || threadRes.data;
    if (post && post.txHash === txHash) {
      const reactions = (post.reactions?.agree || 0) +
                        (post.reactions?.disagree || 0);
      return { reactions, score: post.score ?? 0 };
    }
    // Check posts array
    const threadPosts = threadRes.data?.posts;
    if (Array.isArray(threadPosts)) {
      const found = threadPosts.find((p: any) => p.txHash === txHash);
      if (found) {
        const reactions = (found.reactions?.agree || 0) +
                          (found.reactions?.disagree || 0);
        return { reactions, score: found.score ?? 0 };
      }
    }
  }

  // Fallback: search author's posts
  const feedRes = await apiCall(`/api/feed?author=${authorAddress}&limit=50`, token);
  if (feedRes.ok) {
    const rawPosts = feedRes.data?.posts ?? feedRes.data;
    const posts = Array.isArray(rawPosts) ? rawPosts : [];
    const found = posts.find((p: any) => p.txHash === txHash);
    if (found) {
      const reactions = (found.reactions?.agree || 0) +
                        (found.reactions?.disagree || 0);
      return { reactions, score: found.score ?? 0 };
    }
  }

  return null;
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
    if (r.status === "audited") {
      const delta = r.delta! >= 0 ? `+${r.delta}` : `${r.delta}`;
      console.log(`  Post ${txShort} (${r.category}, ${r.attestation_type}): predicted ${r.predicted_reactions}rx → actual ${r.actual_reactions}rx (Δ ${delta}) | score ${r.actual_score}`);
    } else if (r.status === "already_audited") {
      const delta = r.delta! >= 0 ? `+${r.delta}` : `${r.delta}`;
      console.log(`  Post ${txShort} (${r.category}, ${r.attestation_type}): ${r.actual_reactions}rx (Δ ${delta}) | score ${r.actual_score} [cached]`);
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

  const logPath = resolveLogPath(flags["log"]);
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

  // Connect and auth
  const { demos, address } = await connectWallet(envPath);
  const token = await ensureAuth(demos, address);

  // Audit each entry
  const results: AuditResult[] = [];

  for (const entry of entries) {
    // Already audited? (must have non-null values — 0 reactions is valid)
    if (entry.actual_reactions != null && entry.actual_score != null) {
      results.push({
        txHash: entry.txHash,
        category: entry.category,
        attestation_type: entry.attestation_type,
        predicted_reactions: entry.predicted_reactions,
        actual_reactions: entry.actual_reactions,
        actual_score: entry.actual_score,
        delta: entry.actual_reactions - entry.predicted_reactions,
        status: "already_audited",
      });
      continue;
    }

    // Fetch from API
    info(`Auditing ${entry.txHash.slice(0, 8)}...`);
    try {
      const state = await fetchPostState(entry.txHash, token, address);
      if (!state) {
        results.push({
          txHash: entry.txHash,
          category: entry.category,
          attestation_type: entry.attestation_type,
          predicted_reactions: entry.predicted_reactions,
          actual_reactions: null,
          actual_score: null,
          delta: null,
          status: "not_found",
        });
        continue;
      }

      // Update entry in-memory
      entry.actual_reactions = state.reactions;
      entry.actual_score = state.score;

      results.push({
        txHash: entry.txHash,
        category: entry.category,
        attestation_type: entry.attestation_type,
        predicted_reactions: entry.predicted_reactions,
        actual_reactions: state.reactions,
        actual_score: state.score,
        delta: state.reactions - entry.predicted_reactions,
        status: "audited",
      });
    } catch (err: any) {
      results.push({
        txHash: entry.txHash,
        category: entry.category,
        attestation_type: entry.attestation_type,
        predicted_reactions: entry.predicted_reactions,
        actual_reactions: null,
        actual_score: null,
        delta: null,
        status: "error",
        error: err.message,
      });
    }
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
