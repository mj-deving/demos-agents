#!/usr/bin/env npx tsx
/**
 * Structured Review Template — Sentinel Phase 2 tool
 *
 * Maps to strategy.yaml REVIEW phase (4 structured questions).
 * Generates a pre-filled review template using session log data.
 * Output feeds into `improvements.ts propose`.
 *
 * Scoped to existing SessionLogEntry fields only — no schema extensions.
 *
 * Usage:
 *   npx tsx tools/session-review.ts [--log PATH] [--session N] [--pretty] [--json]
 */

import { readSessionLog, resolveLogPath } from "./lib/log.js";
import type { SessionLogEntry } from "./lib/log.js";
import { info, setLogAgent } from "./lib/sdk.js";
import { resolveAgentName, loadAgentConfig } from "./lib/agent-config.js";

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
Structured Review Template — Sentinel REVIEW phase tool

USAGE:
  npx tsx tools/session-review.ts [flags]

FLAGS:
  --agent NAME     Agent name (default: sentinel)
  --log PATH       Session log path (default: ~/.{agent}-session-log.jsonl)
  --last N         Review only the last N entries (default: all)
  --pretty         Human-readable formatted output
  --json           Compact single-line JSON output
  --help, -h       Show this help

EXAMPLES:
  npx tsx tools/session-review.ts --pretty
  npx tsx tools/session-review.ts --log ~/.sentinel-session-log.jsonl --last 5 --pretty
  npx tsx tools/session-review.ts --json
`);
}

// ── Types ──────────────────────────────────────────

interface ReviewStats {
  total_posts: number;
  by_category: Record<string, number>;
  by_attestation: Record<string, number>;
  reply_count: number;
  predictions_with_actuals: number;
  avg_predicted: number | null;
  avg_actual: number | null;
  avg_delta: number | null;
  score_distribution: Record<number, number>;
  avg_score: number | null;
}

interface Q1Failure {
  txHash: string;
  category: string;
  attestation_type: string;
  predicted: number;
  actual: number | null;
  score: number | null;
  reason: string;
  type: "score_miss";   // session-review.ts only produces score_miss (log-based)
}

interface Q3Insight {
  txHash: string;
  category: string;
  predicted: number;
  actual: number;
  delta: number;
  is_reply: boolean;
  attestation_type: string;
}

interface Q4StaleItem {
  txHash: string;
  description: string;
  type: "unaudited";    // session-review.ts only produces unaudited (log-based)
}

interface ReviewOutput {
  timestamp: string;
  entries_reviewed: number;
  stats: ReviewStats;
  q1_failures: Q1Failure[];
  q2_suggestions: string[];
  q3_insights: Q3Insight[];
  q4_stale: Q4StaleItem[];
}

// ── Analysis ───────────────────────────────────────

function computeStats(entries: SessionLogEntry[]): ReviewStats {
  const byCategory: Record<string, number> = {};
  const byAttestation: Record<string, number> = {};
  let replyCount = 0;
  const predicted: number[] = [];
  const actual: number[] = [];
  const scoreDist: Record<number, number> = {};
  let scoreSum = 0;
  let scoreCount = 0;
  let predsWithActuals = 0;

  for (const e of entries) {
    // Category
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;

    // Attestation
    byAttestation[e.attestation_type] = (byAttestation[e.attestation_type] || 0) + 1;

    // Replies
    if (e.is_reply) replyCount++;

    // Predictions
    predicted.push(e.predicted_reactions);
    if (e.actual_reactions != null) {
      actual.push(e.actual_reactions);
      predsWithActuals++;
    }

    // Scores
    if (e.actual_score != null) {
      const bucket = Math.floor(e.actual_score / 10) * 10;
      scoreDist[bucket] = (scoreDist[bucket] || 0) + 1;
      scoreSum += e.actual_score;
      scoreCount++;
    }
  }

  const avgPredicted = predicted.length > 0
    ? +(predicted.reduce((s, v) => s + v, 0) / predicted.length).toFixed(1)
    : null;
  const avgActual = actual.length > 0
    ? +(actual.reduce((s, v) => s + v, 0) / actual.length).toFixed(1)
    : null;

  // Delta uses only entries with both predicted AND actual (matched pairs)
  const pairedDeltas = entries
    .filter(e => e.actual_reactions != null)
    .map(e => e.actual_reactions! - e.predicted_reactions);
  const avgDelta = pairedDeltas.length > 0
    ? +(pairedDeltas.reduce((s, d) => s + d, 0) / pairedDeltas.length).toFixed(1)
    : null;
  const avgScore = scoreCount > 0 ? +(scoreSum / scoreCount).toFixed(1) : null;

  return {
    total_posts: entries.length,
    by_category: byCategory,
    by_attestation: byAttestation,
    reply_count: replyCount,
    predictions_with_actuals: predsWithActuals,
    avg_predicted: avgPredicted,
    avg_actual: avgActual,
    avg_delta: avgDelta,
    score_distribution: scoreDist,
    avg_score: avgScore,
  };
}

/**
 * Q1: What failed or underperformed?
 * Posts where actual < predicted, or score < 90.
 */
function findFailures(entries: SessionLogEntry[]): Q1Failure[] {
  const failures: Q1Failure[] = [];

  for (const e of entries) {
    const reasons: string[] = [];

    if (e.actual_reactions != null && e.actual_reactions < e.predicted_reactions) {
      reasons.push(`predicted ${e.predicted_reactions}rx, got ${e.actual_reactions}rx`);
    }
    if (e.actual_score != null && e.actual_score < 90) {
      reasons.push(`score ${e.actual_score} (below 90 threshold)`);
    }

    if (reasons.length > 0) {
      failures.push({
        txHash: e.txHash,
        category: e.category,
        attestation_type: e.attestation_type,
        predicted: e.predicted_reactions,
        actual: e.actual_reactions ?? null,
        score: e.actual_score ?? null,
        reason: reasons.join("; "),
        type: "score_miss",
      });
    }
  }

  return failures;
}

/**
 * Q2: What improvement would prevent the failure?
 * Auto-generated suggestions based on Q1 patterns.
 */
function suggestImprovements(failures: Q1Failure[], entries: SessionLogEntry[]): string[] {
  const suggestions: string[] = [];

  // Check if DAHR posts underperform TLSN
  const dahrFails = failures.filter(f => f.attestation_type === "DAHR");
  const tlsnFails = failures.filter(f => f.attestation_type === "TLSN");
  if (dahrFails.length > tlsnFails.length && dahrFails.length > 0) {
    suggestions.push("DAHR posts underperforming — consider switching to TLSN for all posts");
  }

  // Check if non-reply posts underperform (only audited entries with actual data)
  const audited = entries.filter(e => e.actual_reactions != null);
  const nonReplyEntries = audited.filter(e => !e.is_reply);
  const replyEntries = audited.filter(e => e.is_reply);
  const nonReplyAvg = nonReplyEntries.length > 0
    ? nonReplyEntries.reduce((s, e) => s + e.actual_reactions!, 0) / nonReplyEntries.length
    : 0;
  const replyAvg = replyEntries.length > 0
    ? replyEntries.reduce((s, e) => s + e.actual_reactions!, 0) / replyEntries.length
    : 0;
  if (replyAvg > nonReplyAvg * 1.5 && replyEntries.length >= 2) {
    suggestions.push("Reply threads outperform top-level posts — increase reply ratio");
  }

  // Check calibration
  const deltas = entries
    .filter(e => e.actual_reactions != null)
    .map(e => e.actual_reactions! - e.predicted_reactions);
  if (deltas.length >= 3) {
    const avgDelta = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    if (Math.abs(avgDelta) > 3) {
      const dir = avgDelta > 0 ? "under" : "over";
      suggestions.push(`Systematic ${dir}-prediction by ${Math.abs(avgDelta).toFixed(1)}rx — update calibration offset`);
    }
  }

  if (suggestions.length === 0) {
    suggestions.push("No systemic patterns detected — review individual post failures");
  }

  return suggestions;
}

/**
 * Q3: What unexpected insight emerged?
 * Posts where actual >> predicted (delta > +5).
 */
function findInsights(entries: SessionLogEntry[]): Q3Insight[] {
  return entries
    .filter(e => e.actual_reactions != null && (e.actual_reactions - e.predicted_reactions) > 5)
    .map(e => ({
      txHash: e.txHash,
      category: e.category,
      predicted: e.predicted_reactions,
      actual: e.actual_reactions!,
      delta: e.actual_reactions! - e.predicted_reactions,
      is_reply: e.is_reply ?? false,
      attestation_type: e.attestation_type,
    }))
    .sort((a, b) => b.delta - a.delta);
}

/**
 * Q4: What knowledge is stale?
 * Entries with very old timestamps or large calibration drift.
 */
function findStale(entries: SessionLogEntry[]): Q4StaleItem[] {
  const stale: Q4StaleItem[] = [];
  const now = Date.now();
  const threeDays = 3 * 24 * 60 * 60 * 1000;

  for (const e of entries) {
    const ts = new Date(e.timestamp).getTime();
    // Flag posts older than 3 days that still lack actuals
    if (e.actual_reactions == null && (now - ts) > threeDays) {
      stale.push({
        txHash: e.txHash,
        description: `Posted ${Math.floor((now - ts) / (24 * 60 * 60 * 1000))}d ago, still unaudited`,
        type: "unaudited",
      });
    }
  }

  return stale;
}

// ── Pretty Output ──────────────────────────────────

function prettyPrint(review: ReviewOutput): void {
  console.log(`\nREVIEW — Structured Session Review (${review.timestamp})\n`);

  // Stats
  const s = review.stats;
  const catStr = Object.entries(s.by_category).map(([k, v]) => `${v} ${k}`).join(", ");
  const attStr = Object.entries(s.by_attestation).map(([k, v]) => `${v} ${k}`).join(", ");
  console.log("  Session Stats:");
  console.log(`    Posts: ${s.total_posts} (${catStr})`);
  console.log(`    Attestations: ${attStr}`);
  console.log(`    Replies: ${s.reply_count}`);
  if (s.avg_predicted != null) {
    const sign = (s.avg_delta ?? 0) >= 0 ? "+" : "";
    console.log(`    Avg predicted: ${s.avg_predicted}rx → Avg actual: ${s.avg_actual ?? "?"}rx (Δ ${sign}${s.avg_delta ?? "?"})`);
  }
  if (Object.keys(s.score_distribution).length > 0) {
    const distStr = Object.entries(s.score_distribution)
      .sort(([a], [b]) => Number(b) - Number(a))
      .map(([score, count]) => `${score}x${count}`)
      .join(", ");
    console.log(`    Scores: ${distStr} (avg ${s.avg_score})`);
  }

  // Q1
  console.log(`\n  Q1: What failed or underperformed?`);
  if (review.q1_failures.length === 0) {
    console.log(`    (nothing — all posts met or exceeded expectations)`);
  } else {
    for (const f of review.q1_failures) {
      const id = f.txHash ? f.txHash.slice(0, 8) : f.type;
      console.log(`    - ${id} (${f.category || "n/a"}, ${f.attestation_type}): ${f.reason}`);
    }
  }

  // Q2
  console.log(`\n  Q2: What improvement would prevent the failure?`);
  for (const s of review.q2_suggestions) {
    console.log(`    - ${s}`);
  }

  // Q3
  console.log(`\n  Q3: What unexpected insight emerged?`);
  if (review.q3_insights.length === 0) {
    console.log(`    (no standout outperformers)`);
  } else {
    for (const i of review.q3_insights) {
      const replyTag = i.is_reply ? " [reply]" : "";
      console.log(`    - ${i.txHash.slice(0, 8)} (${i.category}, ${i.attestation_type}${replyTag}): predicted ${i.predicted}rx, got ${i.actual}rx (Δ +${i.delta})`);
    }
  }

  // Q4
  console.log(`\n  Q4: What knowledge is stale or needs updating?`);
  if (review.q4_stale.length === 0) {
    console.log(`    (nothing flagged)`);
  } else {
    for (const s of review.q4_stale) {
      const id = s.txHash ? s.txHash.slice(0, 8) : s.type;
      console.log(`    - ${id}: ${s.description}`);
    }
  }

  console.log();
}

// ── Main ───────────────────────────────────────────

function main(): void {
  const { flags } = parseArgs();

  const agentName = resolveAgentName(flags);
  setLogAgent(agentName);
  const config = loadAgentConfig(agentName);
  const logPath = resolveLogPath(flags["log"], agentName);
  const lastN = flags["last"] ? parseInt(flags["last"], 10) : 0;

  // Read log
  let entries = readSessionLog(logPath);
  if (entries.length === 0) {
    info(`No entries in ${logPath}`);
    const empty: ReviewOutput = {
      timestamp: new Date().toISOString(),
      entries_reviewed: 0,
      stats: {
        total_posts: 0, by_category: {}, by_attestation: {},
        reply_count: 0, predictions_with_actuals: 0,
        avg_predicted: null, avg_actual: null, avg_delta: null,
        score_distribution: {}, avg_score: null,
      },
      q1_failures: [], q2_suggestions: [], q3_insights: [], q4_stale: [],
    };
    output(empty, flags);
    return;
  }

  info(`Read ${entries.length} entries from ${logPath}`);

  // Filter to last N if specified
  if (lastN > 0 && lastN < entries.length) {
    entries = entries.slice(-lastN);
    info(`Reviewing last ${lastN} entries`);
  }

  // Analyze
  const stats = computeStats(entries);
  const q1 = findFailures(entries);
  const q2 = suggestImprovements(q1, entries);
  const q3 = findInsights(entries);
  const q4 = findStale(entries);

  const review: ReviewOutput = {
    timestamp: new Date().toISOString(),
    entries_reviewed: entries.length,
    stats,
    q1_failures: q1,
    q2_suggestions: q2,
    q3_insights: q3,
    q4_stale: q4,
  };

  output(review, flags);
}

function output(data: any, flags: Record<string, string>): void {
  if (flags["pretty"] === "true") {
    prettyPrint(data);
  } else if (flags["json"] === "true") {
    console.log(JSON.stringify(data));
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

main();
