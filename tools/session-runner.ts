#!/usr/bin/env npx tsx
/**
 * Session Runner — Sentinel Phase 3 orchestrator
 *
 * Runs the full 7-phase Sentinel loop from a single command.
 * Automated phases execute via subprocess, interactive phases prompt via readline.
 * State persists between phases for --resume capability.
 *
 * Phase sequence: AUDIT → SCAN → ENGAGE → GATE → PUBLISH → VERIFY → REVIEW
 *
 * Usage:
 *   npx tsx tools/session-runner.ts [--env PATH] [--log PATH] [--resume] [--skip-to PHASE] [--dry-run] [--pretty]
 *
 * Examples:
 *   npx tsx tools/session-runner.ts --pretty
 *   npx tsx tools/session-runner.ts --resume --pretty
 *   npx tsx tools/session-runner.ts --dry-run
 *   npx tsx tools/session-runner.ts --skip-to scan --force-skip-audit --pretty
 */

import { resolve, dirname } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { runTool } from "./lib/subprocess.js";
import {
  startSession,
  loadState,
  saveState,
  findActiveSession,
  acquireLock,
  beginPhase,
  completePhase,
  failPhase,
  getNextPhase,
  getPhaseOrder,
  clearState,
  releaseLock,
  type SessionState,
  type PhaseName,
} from "./lib/state.js";
import { readSessionLog, appendSessionLog, resolveLogPath } from "./lib/log.js";

// ── Constants ──────────────────────────────────────

const IMPROVEMENTS_PATH = resolve(homedir(), ".sentinel-improvements.json");
const PHASE_LABELS: Record<PhaseName, { index: number; mode: string; desc: string }> = {
  audit:   { index: 1, mode: "automatic",   desc: "Audit previous posts" },
  scan:    { index: 2, mode: "automatic",   desc: "Scan room temperature" },
  engage:  { index: 3, mode: "automatic",   desc: "Cast reactions" },
  gate:    { index: 4, mode: "interactive", desc: "Quality gate check" },
  publish: { index: 5, mode: "manual",      desc: "Publish posts" },
  verify:  { index: 6, mode: "automatic",   desc: "Verify published posts" },
  review:  { index: 7, mode: "interactive", desc: "Session review" },
};

// ── Arg Parsing ────────────────────────────────────

interface RunnerFlags {
  env: string;
  log: string;
  resume: boolean;
  skipTo: PhaseName | null;
  forceSkipAudit: boolean;
  dryRun: boolean;
  pretty: boolean;
}

function parseArgs(): RunnerFlags {
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

  const validPhases = getPhaseOrder();
  let skipTo: PhaseName | null = null;
  if (flags["skip-to"]) {
    if (!validPhases.includes(flags["skip-to"] as PhaseName)) {
      console.error(`Error: --skip-to must be one of: ${validPhases.join(", ")}`);
      process.exit(1);
    }
    skipTo = flags["skip-to"] as PhaseName;
  }

  return {
    env: resolve(flags.env || ".env"),
    log: resolveLogPath(flags.log),
    resume: flags.resume === "true",
    skipTo,
    forceSkipAudit: flags["force-skip-audit"] === "true",
    dryRun: flags["dry-run"] === "true",
    pretty: flags.pretty === "true",
  };
}

function printHelp(): void {
  console.log(`
Session Runner — Sentinel 7-phase loop orchestrator

USAGE:
  npx tsx tools/session-runner.ts [flags]

FLAGS:
  --env PATH             Path to .env file (default: .env in cwd)
  --log PATH             Session log path (default: ~/.sentinel-session-log.jsonl)
  --resume               Resume interrupted session from last completed phase
  --skip-to PHASE        Start from specific phase (audit|scan|engage|gate|publish|verify|review)
  --force-skip-audit     Required with --skip-to when skipping AUDIT phase
  --dry-run              Show what would run without executing
  --pretty               Human-readable output (default for interactive)
  --help, -h             Show this help

PHASE SEQUENCE:
  1. AUDIT    (auto)     — Audit previous posts, update scores
  2. SCAN     (auto)     — Room temperature scan
  3. ENGAGE   (auto)     — Cast reactions (max 5)
  4. GATE     (interact) — Quality gate check with prompts
  5. PUBLISH  (manual)   — Publish posts (operator-driven)
  6. VERIFY   (auto)     — Verify published posts in feed
  7. REVIEW   (interact) — Session review + improvements

EXAMPLES:
  npx tsx tools/session-runner.ts --pretty
  npx tsx tools/session-runner.ts --resume --pretty
  npx tsx tools/session-runner.ts --skip-to scan --force-skip-audit --pretty
  npx tsx tools/session-runner.ts --dry-run
`);
}

// ── Display Helpers ────────────────────────────────

function banner(sessionNumber: number): void {
  console.log("\n" + "═".repeat(50));
  console.log(`  SENTINEL SESSION ${sessionNumber}`);
  console.log("═".repeat(50));
}

function phaseHeader(phase: PhaseName): void {
  const info = PHASE_LABELS[phase];
  console.log(`\nPhase ${info.index}/7: ${phase.toUpperCase()} (${info.mode})`);
}

function phaseResult(msg: string): void {
  console.log(`  ✓ ${msg}`);
}

function phaseSkipped(msg: string): void {
  console.log(`  ⊘ ${msg}`);
}

function phaseError(msg: string): void {
  console.error(`  ✗ ${msg}`);
}

function info(msg: string): void {
  console.error(`[runner] ${msg}`);
}

// ── Session Number ─────────────────────────────────

/**
 * Read nextSession from improvements.json.
 * If file doesn't exist, default to 1.
 */
function getNextSessionNumber(): number {
  if (!existsSync(IMPROVEMENTS_PATH)) return 1;
  try {
    const data = JSON.parse(readFileSync(IMPROVEMENTS_PATH, "utf-8"));
    return data.nextSession || 1;
  } catch {
    return 1;
  }
}

/**
 * Increment nextSession in improvements.json after successful completion.
 */
function incrementSessionNumber(): void {
  if (!existsSync(IMPROVEMENTS_PATH)) return;
  try {
    const data = JSON.parse(readFileSync(IMPROVEMENTS_PATH, "utf-8"));
    data.nextSession = (data.nextSession || 1) + 1;
    writeFileSync(IMPROVEMENTS_PATH, JSON.stringify(data, null, 2));
    info(`Session number incremented to ${data.nextSession}`);
  } catch (e: any) {
    info(`Warning: could not increment session number: ${e.message}`);
  }
}

// ── Readline Helpers ───────────────────────────────

/**
 * Safe readline question — handles Ctrl+D/EOF by returning empty string
 * instead of throwing (Codex review MED-3).
 */
async function ask(
  rl: ReturnType<typeof createInterface>,
  prompt: string
): Promise<string> {
  try {
    const answer = await rl.question(prompt);
    return answer ?? "";
  } catch {
    // EOF (Ctrl+D) — treat as empty input
    return "";
  }
}

// ── Phase Handlers ─────────────────────────────────

/**
 * Run a tool via subprocess and parse JSON stdout.
 * Displays stderr (info logs) to console.
 */
async function runToolAndParse(
  toolPath: string,
  args: string[],
  label: string
): Promise<any> {
  info(`Running ${label}...`);
  const result = await runTool(toolPath, args, {
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    timeout: 180_000, // 3 min for slow tools
  });

  // Display stderr (info logs) for operator visibility
  if (result.stderr.trim()) {
    for (const line of result.stderr.trim().split("\n")) {
      console.error(`  ${line}`);
    }
  }

  // Parse JSON stdout — throw on failure (Codex review HIGH-2)
  const stdout = result.stdout.trim();
  if (!stdout) return {};
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`${label} returned non-JSON output: ${stdout.slice(0, 200)}`);
  }
}

// ── AUDIT Phase ────────────────────────────────────

async function runAudit(state: SessionState, flags: RunnerFlags): Promise<void> {
  const args = ["--update", "--log", flags.log, "--env", flags.env];
  // audit.ts has no --json flag — default output IS JSON
  const result = await runToolAndParse("tools/audit.ts", args, "audit.ts");

  const stats = result.stats || {};
  phaseResult(
    `${stats.total_entries || 0} entries audited | ` +
    `avg error: ${stats.avg_prediction_error !== undefined ? stats.avg_prediction_error.toFixed(1) : "N/A"} | ` +
    `scores: ${stats.score_distribution ? JSON.stringify(stats.score_distribution) : "N/A"}`
  );

  completePhase(state, "audit", result);
}

// ── SCAN Phase ─────────────────────────────────────

async function runScan(state: SessionState, flags: RunnerFlags): Promise<void> {
  const args = ["--json", "--env", flags.env];
  const result = await runToolAndParse("tools/room-temp.ts", args, "room-temp.ts");

  const level = result.activity?.level || "unknown";
  const pph = result.activity?.posts_per_hour ?? "?";
  const gapCount = result.gaps?.topics?.length || 0;
  phaseResult(`${level} activity (${pph} posts/hr) | ${gapCount} gap topics found`);

  completePhase(state, "scan", result);
}

// ── ENGAGE Phase ───────────────────────────────────

async function runEngage(state: SessionState, flags: RunnerFlags): Promise<void> {
  const args = ["--max", "5", "--json", "--env", flags.env];
  const result = await runToolAndParse("tools/engage.ts", args, "engage.ts");

  phaseResult(
    `${result.reactions_cast || 0} reactions (${result.agrees || 0} agree, ${result.disagrees || 0} disagree) | ${result.errors || 0} errors`
  );

  state.engagements = result.targets || [];
  completePhase(state, "engage", result);
}

// ── GATE Phase (interactive) ───────────────────────

interface GatePost {
  topic: string;
  category: string;
  text: string;
  confidence: number;
  gateResult: any;
}

async function runGate(
  state: SessionState,
  flags: RunnerFlags,
  rl: ReturnType<typeof createInterface>
): Promise<void> {
  const gatePosts: GatePost[] = [];
  let postNum = 1;
  const MAX_POSTS = 3;

  while (postNum <= MAX_POSTS) {
    console.log(`\n  --- Post ${postNum}/${MAX_POSTS} ---`);

    const topic = await ask(rl,"  Topic: ");
    if (!topic || topic.toLowerCase() === "done" || topic.toLowerCase() === "skip") {
      if (postNum === 1) {
        phaseSkipped("No posts gated — skipping to REVIEW");
      }
      break;
    }

    const category = await ask(rl,"  Category (ANALYSIS/PREDICTION): ");
    const text = await ask(rl,"  Draft text (or 'skip'): ");
    const confStr = await ask(rl,"  Confidence (60-100): ");

    // Build gate.ts args
    const gateArgs = ["--topic", topic, "--json", "--env", flags.env];
    if (category && category.toLowerCase() !== "skip") {
      gateArgs.push("--category", category.toUpperCase());
    }
    if (text && text.toLowerCase() !== "skip") {
      gateArgs.push("--text", text);
    }
    if (confStr && /^\d+$/.test(confStr)) {
      gateArgs.push("--confidence", confStr);
    }

    const result = await runToolAndParse("tools/gate.ts", gateArgs, "gate.ts");

    // Display gate result
    const checks = Array.isArray(result.checks) ? result.checks : [];
    const passed = checks.filter((c: any) => c.passed).length;
    const total = checks.length;
    console.log(`\n  Gate result: ${passed}/${total} checks passed`);
    for (const check of checks) {
      const icon = check.passed ? "✓" : "✗";
      console.log(`    ${icon} ${check.name}: ${check.detail || ""}`);
    }

    const proceed = await ask(rl,"\n  Proceed to publish? (y/n/skip): ");

    if (proceed.toLowerCase() === "y" || proceed.toLowerCase() === "yes") {
      gatePosts.push({
        topic,
        category: category.toUpperCase() || "ANALYSIS",
        text: text.toLowerCase() === "skip" ? "" : text,
        confidence: /^\d+$/.test(confStr) ? Number(confStr) : 0,
        gateResult: result,
      });
      postNum++;
    } else if (proceed.toLowerCase() === "skip" || proceed.toLowerCase() === "done") {
      break;
    } else {
      // Empty or unrecognized input → treat as "no" with hint (Codex review LOW-6)
      console.log("  (enter 'y' to proceed, 'n' to re-try, 'skip' to finish gating)");
    }
  }

  completePhase(state, "gate", { posts: gatePosts });
}

// ── PUBLISH Phase (manual with log capture) ────────

async function runPublish(
  state: SessionState,
  flags: RunnerFlags,
  rl: ReturnType<typeof createInterface>
): Promise<void> {
  const gateResult = state.phases.gate.result || { posts: [] };
  const gatePosts = gateResult.posts || [];

  if (gatePosts.length === 0) {
    phaseSkipped("No posts gated — nothing to publish");
    completePhase(state, "publish", { posts: [] });
    return;
  }

  console.log("\n  Publish your post(s) now using isidore-publish.ts");
  console.log("  (or your agent's publish tool)");
  if (gatePosts.length > 0) {
    console.log(`\n  Gated ${gatePosts.length} post(s):`);
    for (const gp of gatePosts) {
      console.log(`    - ${gp.topic} (${gp.category}, confidence: ${gp.confidence})`);
    }
  }

  // Read existing log for dedupe — recover gracefully if corrupted (Codex review MED-5)
  let existingLog: any[] = [];
  try {
    existingLog = readSessionLog(flags.log);
  } catch (e: any) {
    info(`Warning: could not read session log (${e.message}) — skipping dedupe`);
  }
  const existingTxHashes = new Set(existingLog.map((e) => e.txHash));
  const publishedHashes: string[] = [];

  for (let i = 0; i < gatePosts.length; i++) {
    console.log(`\n  --- Published post ${i + 1}/${gatePosts.length} ---`);
    const txHash = await ask(rl,"  Enter txHash (or 'done' to stop): ");

    if (!txHash || txHash.toLowerCase() === "done") break;

    // Validate hex format (loose — chain returns variable length)
    if (!/^[a-fA-F0-9]+$/.test(txHash)) {
      console.log("  ⚠️ txHash should be hex characters only. Skipping.");
      continue;
    }

    const predStr = await ask(rl,"  Predicted reactions: ");
    const predicted = /^\d+$/.test(predStr) ? Number(predStr) : 0;

    // Dedupe before appending (Codex review MED-5)
    if (existingTxHashes.has(txHash)) {
      console.log("  ⚠️ txHash already in session log — skipping append");
    } else {
      const gp = gatePosts[i] || {};
      appendSessionLog(
        {
          timestamp: new Date().toISOString(),
          txHash,
          category: gp.category || "ANALYSIS",
          attestation_type: "unknown",
          hypothesis: "",
          predicted_reactions: predicted,
          agents_referenced: [],
          topic: gp.topic || "",
          confidence: gp.confidence || 0,
          text_preview: (gp.text || "").slice(0, 100),
          tags: [],
        },
        flags.log
      );
      existingTxHashes.add(txHash);
      info(`Logged ${txHash.slice(0, 16)}...`);
    }

    publishedHashes.push(txHash);
    state.posts.push(txHash);
    saveState(state);
  }

  phaseResult(`${publishedHashes.length} post(s) captured`);
  completePhase(state, "publish", { txHashes: publishedHashes });
}

// ── VERIFY Phase ───────────────────────────────────

async function runVerify(state: SessionState, flags: RunnerFlags): Promise<void> {
  // Skip when zero posts (Codex review HIGH-2)
  if (state.posts.length === 0) {
    phaseSkipped("No posts to verify — skipping");
    completePhase(state, "verify", { skipped: true, reason: "no posts" });
    return;
  }

  const args = [...state.posts, "--json", "--log", flags.log, "--env", flags.env, "--wait", "15"];
  const result = await runToolAndParse("tools/verify.ts", args, "verify.ts");

  const summary = result.summary || {};
  phaseResult(`${summary.verified || 0}/${summary.total || 0} verified`);

  completePhase(state, "verify", result);
}

// ── REVIEW Phase (interactive) ─────────────────────

async function runReview(
  state: SessionState,
  flags: RunnerFlags,
  rl: ReturnType<typeof createInterface>
): Promise<void> {
  const args = ["--json", "--log", flags.log];
  const result = await runToolAndParse("tools/session-review.ts", args, "session-review.ts");

  // Display review data
  if (result.session_stats) {
    const s = result.session_stats;
    console.log(`\n  Session Stats:`);
    console.log(`    Posts: ${s.total_posts || 0} | Avg score: ${s.avg_score || "N/A"} | Avg reactions: ${s.avg_reactions || "N/A"}`);
  }

  // Prompt for improvements
  const improvementDesc = await ask(rl,"\n  Any improvements to propose? (describe or 'none'): ");

  if (improvementDesc && improvementDesc.toLowerCase() !== "none") {
    const evidence = await ask(rl,"  Evidence for this improvement: ");
    const target = await ask(rl,"  Target file/component: ");

    try {
      const impArgs = [
        "propose", improvementDesc,
        "--evidence", evidence || "session observation",
        "--target", target || "workflow",
      ];
      await runToolAndParse("tools/improvements.ts", impArgs, "improvements.ts propose");
      phaseResult("Improvement proposed");
    } catch (e: any) {
      info(`Warning: could not propose improvement: ${e.message}`);
    }
  }

  completePhase(state, "review", result);
}

// ── Session Report ─────────────────────────────────

function phaseDuration(state: SessionState, phase: PhaseName): string {
  const p = state.phases[phase];
  if (!p.startedAt || !p.completedAt) return "";
  const ms = new Date(p.completedAt).getTime() - new Date(p.startedAt).getTime();
  return ` (${(ms / 60000).toFixed(1)} min)`;
}

function writeSessionReport(state: SessionState): void {
  const sessDir = resolve(homedir(), ".sentinel", "sessions");
  mkdirSync(sessDir, { recursive: true });
  const reportPath = resolve(sessDir, `session-${state.sessionNumber}-report.md`);

  const duration = ((Date.now() - new Date(state.startedAt).getTime()) / 60000).toFixed(1);
  const date = new Date(state.startedAt).toISOString().slice(0, 10);
  const engage = state.phases.engage.result || {};
  const lines: string[] = [];

  lines.push(`# Sentinel Session ${state.sessionNumber} — ${date}`);
  lines.push("");
  lines.push(`**Duration:** ${duration} min | **Posts:** ${state.posts.length} | **Reactions:** ${engage.reactions_cast || 0} (${engage.agrees || 0} agree, ${engage.disagrees || 0} disagree)`);
  lines.push("");

  // AUDIT
  const audit = state.phases.audit.result || {};
  lines.push(`## 1. AUDIT${phaseDuration(state, "audit")}`);
  if (audit.stats) {
    const s = audit.stats;
    lines.push(`- ${s.total_entries || 0} entries audited`);
    const errVal = s.avg_prediction_error;
    const errStr = errVal !== undefined ? `${errVal >= 0 ? "+" : ""}${errVal.toFixed(1)}` : "N/A";
    lines.push(`- Avg prediction error: ${errStr}`);
    lines.push(`- Scores: ${s.score_distribution ? Object.entries(s.score_distribution).map(([k, v]) => `${k}x${v}`).join(", ") : "N/A"}`);
  } else {
    lines.push("- Skipped");
  }
  lines.push("");

  // SCAN
  const scan = state.phases.scan.result || {};
  lines.push(`## 2. SCAN${phaseDuration(state, "scan")}`);
  if (scan.activity) {
    lines.push(`- ${scan.activity.level || "?"} activity (${scan.activity.posts_per_hour ?? "?"} posts/hr)`);
    if (scan.heat?.topic) lines.push(`- Hot topic: ${scan.heat.topic} (${scan.heat.reactions || 0} reactions)`);
    if (scan.gaps?.topics?.length) lines.push(`- ${scan.gaps.topics.length} gap topics: ${scan.gaps.topics.slice(0, 6).join(", ")}${scan.gaps.topics.length > 6 ? "..." : ""}`);
  } else {
    lines.push("- Skipped");
  }
  lines.push("");

  // ENGAGE
  lines.push(`## 3. ENGAGE${phaseDuration(state, "engage")}`);
  if (engage.reactions_cast !== undefined) {
    lines.push(`- ${engage.reactions_cast} reactions: ${engage.agrees || 0} agree, ${engage.disagrees || 0} disagree`);
    const targets = engage.targets || [];
    for (const t of targets.slice(0, 8)) {
      lines.push(`  - ${t.reaction} ${(t.txHash || "").slice(0, 12)}... (${t.author || "?"}, ${t.topic || "?"})`);
    }
  } else {
    lines.push("- Skipped");
  }
  lines.push("");

  // GATE
  const gate = state.phases.gate.result || {};
  const gatePosts = gate.posts || [];
  lines.push(`## 4. GATE${phaseDuration(state, "gate")}`);
  if (gatePosts.length > 0) {
    lines.push(`- ${gatePosts.length} post(s) gated`);
    for (let i = 0; i < gatePosts.length; i++) {
      const gp = gatePosts[i];
      const items = gp.gateResult?.items || [];
      const passed = items.filter((c: any) => c.status === "pass").length;
      lines.push(`- Post ${i + 1}: ${gp.topic} (${gp.category}, confidence ${gp.confidence}) — ${passed}/${items.length} checks`);
    }
  } else {
    lines.push("- No posts gated");
  }
  lines.push("");

  // PUBLISH
  const publish = state.phases.publish.result || {};
  const txHashes = publish.txHashes || [];
  lines.push(`## 5. PUBLISH${phaseDuration(state, "publish")}`);
  if (txHashes.length > 0) {
    for (let i = 0; i < txHashes.length; i++) {
      const tx = txHashes[i];
      const gp = gatePosts[i] || {};
      lines.push(`- ${tx.slice(0, 16)}... (${gp.category || "?"}, predicted: ${gp.confidence || "?"} reactions)`);
    }
  } else {
    lines.push("- No posts published");
  }
  lines.push("");

  // VERIFY
  const verify = state.phases.verify.result || {};
  lines.push(`## 6. VERIFY${phaseDuration(state, "verify")}`);
  if (verify.skipped) {
    lines.push("- Skipped (no posts)");
  } else if (verify.summary) {
    lines.push(`- ${verify.summary.verified || 0}/${verify.summary.total || 0} verified in feed`);
  } else {
    lines.push("- Skipped");
  }
  lines.push("");

  // REVIEW
  const review = state.phases.review.result || {};
  lines.push(`## 7. REVIEW${phaseDuration(state, "review")}`);
  const reviewStats = review.session_stats || review.stats;
  if (reviewStats) {
    const rs = reviewStats;
    lines.push(`- ${rs.total_posts || 0} posts reviewed | Avg score: ${rs.avg_score || "N/A"} | Avg reactions: ${rs.avg_reactions || "N/A"}`);
  }
  if (review.q2_suggestions?.length) {
    lines.push(`- Suggestions: ${review.q2_suggestions.join("; ")}`);
  }
  if (!reviewStats && !review.q2_suggestions?.length) {
    lines.push("- No improvements proposed");
  }
  lines.push("");

  writeFileSync(reportPath, lines.join("\n"));
  info(`Session report written to ${reportPath}`);
}

// ── Dry Run ────────────────────────────────────────

function dryRun(sessionNumber: number, flags: RunnerFlags, startPhase: PhaseName | null): void {
  banner(sessionNumber);
  console.log("  MODE: dry-run (no execution)\n");

  const phases = getPhaseOrder();
  let started = startPhase === null;

  for (const phase of phases) {
    if (!started && phase === startPhase) started = true;
    if (!started) {
      console.log(`  ${PHASE_LABELS[phase].index}. ${phase.toUpperCase()} — SKIPPED`);
      continue;
    }

    const info = PHASE_LABELS[phase];
    const tool = getToolCommand(phase, flags);
    console.log(`  ${info.index}. ${phase.toUpperCase()} (${info.mode}) — ${tool}`);
  }
  console.log();
}

function getToolCommand(phase: PhaseName, flags: RunnerFlags): string {
  switch (phase) {
    case "audit":   return `audit.ts --update --log ${flags.log} --env ${flags.env}`;
    case "scan":    return `room-temp.ts --json --env ${flags.env}`;
    case "engage":  return `engage.ts --max 5 --json --env ${flags.env}`;
    case "gate":    return `gate.ts --topic <prompted> --json --env ${flags.env}`;
    case "publish": return "(manual — operator publishes, runner captures txHash)";
    case "verify":  return `verify.ts <txHashes> --json --log ${flags.log} --env ${flags.env}`;
    case "review":  return `session-review.ts --json --log ${flags.log}`;
  }
}

// ── Main Orchestrator ──────────────────────────────

async function main(): Promise<void> {
  const flags = parseArgs();

  // Determine session state
  let state: SessionState;
  let sessionNumber: number;
  let startPhase: PhaseName | null = null;

  if (flags.resume) {
    const active = findActiveSession();
    if (!active) {
      console.error("Error: no active session to resume. Start a new session without --resume.");
      process.exit(1);
    }
    state = active;
    sessionNumber = state.sessionNumber;

    // Re-acquire lock for this process (Codex review HIGH-1).
    // acquireLock uses O_CREAT|O_EXCL — if lock exists it checks staleness.
    // Dead PID → recovers lock. Live PID → throws (another runner active).
    try {
      acquireLock(sessionNumber);
    } catch (e: any) {
      if (e.message.includes("is locked by PID")) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      }
      throw e; // Unexpected error
    }

    // Update PID in state to this process
    state.pid = process.pid;
    saveState(state);

    startPhase = getNextPhase(state);
    if (!startPhase) {
      console.log("Session already complete — nothing to resume.");
      clearState(sessionNumber);
      process.exit(0);
    }
    info(`Resuming session ${sessionNumber} from ${startPhase.toUpperCase()}`);
  } else {
    sessionNumber = getNextSessionNumber();

    if (flags.skipTo) {
      // Validate --force-skip-audit requirement
      const phases = getPhaseOrder();
      const auditIdx = phases.indexOf("audit");
      const skipIdx = phases.indexOf(flags.skipTo);

      if (skipIdx > auditIdx && !flags.forceSkipAudit) {
        console.error(
          `Error: --skip-to ${flags.skipTo} skips AUDIT phase.\n` +
          `AGENT.yaml hard rule: "Never skip audit phase."\n` +
          `Add --force-skip-audit to explicitly acknowledge skipping AUDIT.`
        );
        process.exit(1);
      }
      startPhase = flags.skipTo;
    }

    // Dry run mode
    if (flags.dryRun) {
      dryRun(sessionNumber, flags, startPhase);
      process.exit(0);
    }

    // Start new session
    state = startSession(sessionNumber);
    info(`Started session ${sessionNumber}`);

    // Mark skipped phases as completed
    if (startPhase) {
      const phases = getPhaseOrder();
      for (const phase of phases) {
        if (phase === startPhase) break;
        completePhase(state, phase, { skipped: true, reason: `--skip-to ${startPhase}` });
      }
    }
  }

  banner(sessionNumber);

  // Set up Ctrl+C handler
  let shuttingDown = false;
  process.on("SIGINT", () => {
    if (shuttingDown) {
      process.exit(1); // Force exit on double Ctrl+C
    }
    shuttingDown = true;
    console.log("\n\n  ⚠️ Interrupted — saving state...");
    saveState(state);
    console.log(`  Resume with: npx tsx tools/session-runner.ts --resume --pretty`);
    console.log();
    process.exit(0);
  });

  // Create readline interface for interactive phases
  const rl = createInterface({ input: stdin, output: stdout });

  // Phase execution loop
  const phases = getPhaseOrder();
  const startIdx = startPhase ? phases.indexOf(startPhase) : 0;

  try {
    for (let i = startIdx; i < phases.length; i++) {
      const phase = phases[i];

      // Skip already-completed phases (resume case)
      if (state.phases[phase].status === "completed") continue;

      phaseHeader(phase);
      beginPhase(state, phase);

      try {
        switch (phase) {
          case "audit":
            await runAudit(state, flags);
            break;
          case "scan":
            await runScan(state, flags);
            break;
          case "engage":
            await runEngage(state, flags);
            break;
          case "gate":
            await runGate(state, flags, rl);
            break;
          case "publish":
            await runPublish(state, flags, rl);
            break;
          case "verify":
            await runVerify(state, flags);
            break;
          case "review":
            await runReview(state, flags, rl);
            break;
        }
      } catch (e: any) {
        failPhase(state, phase, e.message);
        phaseError(e.message);
        console.error(`\n  Session state saved. Resume with: npx tsx tools/session-runner.ts --resume --pretty`);
        rl.close();
        process.exit(1);
      }
    }

    // Session complete
    rl.close();

    // Display summary
    const duration = ((Date.now() - new Date(state.startedAt).getTime()) / 60000).toFixed(1);
    console.log("\n" + "═".repeat(50));
    console.log("  SESSION COMPLETE");
    console.log("═".repeat(50));
    console.log(`  Session: ${sessionNumber}`);
    console.log(`  Duration: ${duration} min`);
    console.log(`  Posts: ${state.posts.length}`);

    const engageResult = state.phases.engage.result || {};
    console.log(`  Reactions: ${engageResult.reactions_cast || 0} (${engageResult.agrees || 0} agree, ${engageResult.disagrees || 0} disagree)`);

    const verifyResult = state.phases.verify.result || {};
    if (!verifyResult.skipped) {
      console.log(`  Verified: ${verifyResult.summary?.verified || 0}/${verifyResult.summary?.total || 0}`);
    }
    console.log("═".repeat(50) + "\n");

    // Write persistent session report (non-fatal)
    try {
      writeSessionReport(state);
    } catch (e: any) {
      info(`Warning: could not write session report: ${e.message}`);
    }

    // Increment session number and clear state
    incrementSessionNumber();
    clearState(sessionNumber);
    info("Session state cleared.");
  } catch (e: any) {
    rl.close();
    saveState(state);
    console.error(`\nFATAL: ${e.message}`);
    console.error(`Session state saved. Resume with: npx tsx tools/session-runner.ts --resume --pretty`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
});
