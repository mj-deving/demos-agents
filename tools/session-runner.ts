#!/usr/bin/env npx tsx
/**
 * Session Runner — Sentinel Phase 3 orchestrator
 *
 * Runs the full 8-phase Sentinel loop from a single command.
 * Supports three oversight levels: full (interactive), approve (semi-auto), autonomous (fully automated).
 * State persists between phases for --resume capability.
 *
 * Phase sequence: AUDIT → SCAN → ENGAGE → GATE → PUBLISH → VERIFY → REVIEW → HARDEN
 *
 * Usage:
 *   npx tsx tools/session-runner.ts [--env PATH] [--log PATH] [--oversight LEVEL] [--resume] [--skip-to PHASE] [--dry-run] [--pretty]
 *
 * Oversight levels:
 *   full       (default) GATE interactive, PUBLISH manual, REVIEW interactive
 *   approve    GATE auto-suggests from scan, PUBLISH manual, REVIEW auto-proposes
 *   autonomous GATE auto-picks, PUBLISH auto (LLM + attest + post), REVIEW auto-proposes
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
import { saveReviewFindings, loadLatestFindings } from "./lib/review-findings.js";
import { generatePost, type PostDraft } from "./lib/llm.js";
import { resolveProvider, type LLMProvider } from "./lib/llm-provider.js";
import { connectWallet } from "./lib/sdk.js";
import { attestAndPublish, type PublishResult } from "./lib/publish-pipeline.js";
import { resolveAgentName, loadAgentConfig, type AgentConfig } from "./lib/agent-config.js";

// ── Constants ──────────────────────────────────────

// Resolved at runtime based on --agent flag
let IMPROVEMENTS_PATH = resolve(homedir(), ".sentinel-improvements.json");
let agentConfig: AgentConfig;

type OversightLevel = "full" | "approve" | "autonomous";

function getPhaseMode(phase: PhaseName, oversight: OversightLevel): string {
  if (oversight === "full") {
    switch (phase) {
      case "gate": return "interactive";
      case "publish": return "manual";
      case "review": return "interactive";
      case "harden": return "interactive";
      default: return "automatic";
    }
  }
  if (oversight === "approve") {
    switch (phase) {
      case "gate": return "auto-suggest";
      case "publish": return "manual";
      case "review": return "auto-propose";
      case "harden": return "auto-apply";
      default: return "automatic";
    }
  }
  // autonomous
  switch (phase) {
    case "gate": return "auto-pick";
    case "publish": return "auto (LLM + attest + post)";
    case "review": return "auto-propose";
    case "harden": return "automatic";
    default: return "automatic";
  }
}

// ── Arg Parsing ────────────────────────────────────

interface RunnerFlags {
  agent: string;
  env: string;
  log: string;
  resume: boolean;
  skipTo: PhaseName | null;
  forceSkipAudit: boolean;
  dryRun: boolean;
  pretty: boolean;
  oversight: OversightLevel;
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

  // Parse oversight level
  let oversight: OversightLevel = "full";
  if (flags["oversight"]) {
    const val = flags["oversight"].toLowerCase();
    if (!["full", "approve", "autonomous"].includes(val)) {
      console.error(`Error: --oversight must be one of: full, approve, autonomous`);
      process.exit(1);
    }
    oversight = val as OversightLevel;
  }

  const agentName = resolveAgentName(flags);

  return {
    agent: agentName,
    env: resolve(flags.env || ".env"),
    log: resolveLogPath(flags.log, agentName),
    resume: flags.resume === "true",
    skipTo,
    forceSkipAudit: flags["force-skip-audit"] === "true",
    dryRun: flags["dry-run"] === "true",
    pretty: flags.pretty === "true",
    oversight,
  };
}

function printHelp(): void {
  console.log(`
Session Runner — Agent 8-phase loop orchestrator

USAGE:
  npx tsx tools/session-runner.ts [flags]

FLAGS:
  --agent NAME           Agent name (default: sentinel)
  --env PATH             Path to .env file (default: .env in cwd)
  --log PATH             Session log path (default: ~/.{agent}-session-log.jsonl)
  --oversight LEVEL      Oversight level: full|approve|autonomous (default: full)
  --resume               Resume interrupted session from last completed phase
  --skip-to PHASE        Start from specific phase (audit|scan|engage|gate|publish|verify|review|harden)
  --force-skip-audit     Required with --skip-to when skipping AUDIT phase
  --dry-run              Show what would run without executing
  --pretty               Human-readable output (default for interactive)
  --help, -h             Show this help

OVERSIGHT LEVELS:
  full        (default) GATE interactive, PUBLISH manual, REVIEW interactive
  approve     GATE auto-suggests topics from scan, PUBLISH manual, REVIEW auto-proposes improvements
  autonomous  GATE auto-picks topics, PUBLISH auto (LLM text gen + DAHR attest + post), REVIEW auto-proposes

  In ALL modes: strategy/persona files never auto-modified (AGENT.yaml hard rule).
  AUDIT always loads previous review findings and pending improvements.

PHASE SEQUENCE:
  1. AUDIT    (auto)     — Audit previous posts, load review findings + pending improvements
  2. SCAN     (auto)     — Room temperature scan
  3. ENGAGE   (auto)     — Cast reactions (max 5)
  4. GATE     (varies)   — Quality gate check (interactive/auto-suggest/auto-pick)
  5. PUBLISH  (varies)   — Publish posts (manual/auto)
  6. VERIFY   (auto)     — Verify published posts in feed
  7. REVIEW   (varies)   — Session review + improvements (interactive/auto-propose)
  8. HARDEN   (varies)   — Classify and apply REVIEW findings via improvement lifecycle

EXAMPLES:
  npx tsx tools/session-runner.ts --pretty
  npx tsx tools/session-runner.ts --oversight approve --pretty
  npx tsx tools/session-runner.ts --oversight autonomous --pretty
  npx tsx tools/session-runner.ts --resume --pretty
  npx tsx tools/session-runner.ts --dry-run --oversight autonomous
`);
}

// ── Display Helpers ────────────────────────────────

function banner(sessionNumber: number, oversight: OversightLevel): void {
  console.log("\n" + "═".repeat(50));
  console.log(`  SENTINEL SESSION ${sessionNumber}`);
  console.log(`  Oversight: ${oversight}`);
  console.log("═".repeat(50));
}

function phaseHeader(phase: PhaseName, oversight: OversightLevel): void {
  const phases = getPhaseOrder();
  const idx = phases.indexOf(phase) + 1;
  const mode = getPhaseMode(phase, oversight);
  console.log(`\nPhase ${idx}/${phases.length}: ${phase.toUpperCase()} (${mode})`);
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

function getNextSessionNumber(): number {
  if (!existsSync(IMPROVEMENTS_PATH)) return 1;
  try {
    const data = JSON.parse(readFileSync(IMPROVEMENTS_PATH, "utf-8"));
    return data.nextSession || 1;
  } catch {
    return 1;
  }
}

function incrementSessionNumber(): void {
  try {
    let data: any = { version: 1, nextSession: 1, items: [] };
    if (existsSync(IMPROVEMENTS_PATH)) {
      data = JSON.parse(readFileSync(IMPROVEMENTS_PATH, "utf-8"));
    }
    data.nextSession = (data.nextSession || 1) + 1;
    writeFileSync(IMPROVEMENTS_PATH, JSON.stringify(data, null, 2));
    info(`Session number incremented to ${data.nextSession}`);
  } catch (e: any) {
    info(`Warning: could not increment session number: ${e.message}`);
  }
}

// ── Readline Helpers ───────────────────────────────

async function ask(
  rl: ReturnType<typeof createInterface>,
  prompt: string
): Promise<string> {
  try {
    const answer = await rl.question(prompt);
    return answer ?? "";
  } catch {
    return "";
  }
}

// ── Phase Handlers ─────────────────────────────────

async function runToolAndParse(
  toolPath: string,
  args: string[],
  label: string
): Promise<any> {
  info(`Running ${label}...`);
  const result = await runTool(toolPath, args, {
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    timeout: 180_000,
  });

  if (result.stderr.trim()) {
    for (const line of result.stderr.trim().split("\n")) {
      console.error(`  ${line}`);
    }
  }

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
  // Load and display previous review findings
  const prevFindings = loadLatestFindings(agentConfig.paths.findingsFile);
  if (prevFindings) {
    console.log(`\n  Previous review (session ${prevFindings.sessionNumber}):`);
    if (prevFindings.q1_failures.length > 0) {
      console.log(`    Failures: ${prevFindings.q1_failures.length}`);
      for (const f of prevFindings.q1_failures.slice(0, 3)) {
        console.log(`      - ${f.txHash ? f.txHash.slice(0, 8) : (f as any).type || "?"}: ${f.reason}`);
      }
    }
    if (prevFindings.q2_suggestions.length > 0) {
      console.log(`    Suggestions:`);
      for (const s of prevFindings.q2_suggestions) {
        console.log(`      - ${s}`);
      }
    }
    if (prevFindings.q3_insights.length > 0) {
      console.log(`    Insights: ${prevFindings.q3_insights.length} outperformers`);
    }
  }

  // Load and display pending improvements
  if (existsSync(IMPROVEMENTS_PATH)) {
    try {
      const impData = JSON.parse(readFileSync(IMPROVEMENTS_PATH, "utf-8"));
      const pending = (impData.items || []).filter((i: any) => i.status === "proposed" || i.status === "approved");
      if (pending.length > 0) {
        console.log(`\n  Pending improvements (${pending.length}):`);
        for (const imp of pending) {
          console.log(`    ${imp.id} [${imp.status.toUpperCase()}]: ${imp.description}`);
        }
      }
    } catch { /* non-fatal */ }
  }

  const args = ["--agent", flags.agent, "--update", "--log", flags.log, "--env", flags.env];
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
  const args = ["--agent", flags.agent, "--json", "--env", flags.env];
  const result = await runToolAndParse("tools/room-temp.ts", args, "room-temp.ts");

  const level = result.activity?.level || "unknown";
  const pph = result.activity?.posts_per_hour ?? "?";
  const gapCount = result.gaps?.topics?.length || 0;
  phaseResult(`${level} activity (${pph} posts/hr) | ${gapCount} gap topics found`);

  completePhase(state, "scan", result);
}

// ── ENGAGE Phase ───────────────────────────────────

async function runEngage(state: SessionState, flags: RunnerFlags): Promise<void> {
  const args = ["--agent", flags.agent, "--max", String(agentConfig.engagement.maxReactionsPerSession), "--json", "--env", flags.env];
  const result = await runToolAndParse("tools/engage.ts", args, "engage.ts");

  phaseResult(
    `${result.reactions_cast || 0} reactions (${result.agrees || 0} agree, ${result.disagrees || 0} disagree) | ${result.errors || 0} errors`
  );

  state.engagements = result.targets || [];
  completePhase(state, "engage", result);
}

// ── GATE Phase ─────────────────────────────────────

interface GatePost {
  topic: string;
  category: string;
  text: string;
  confidence: number;
  gateResult: any;
}

/** Extract post topics from scan results (gaps + heat) */
function extractTopicsFromScan(state: SessionState): Array<{ topic: string; category: string; reason: string }> {
  const scan = state.phases.scan.result || {};
  const topics: Array<{ topic: string; category: string; reason: string }> = [];

  // Hot topic first (highest engagement potential)
  if (scan.heat?.topic) {
    topics.push({
      topic: scan.heat.topic,
      category: "ANALYSIS",
      reason: `hot topic (${scan.heat.reactions || 0} reactions)`,
    });
  }

  // Gap topics (unique signal opportunities)
  const gaps = scan.gaps?.topics || [];
  for (const gap of gaps.slice(0, 3)) {
    if (!topics.some((t) => t.topic === gap)) {
      topics.push({
        topic: gap,
        category: "ANALYSIS",
        reason: "gap in feed coverage",
      });
    }
  }

  return topics.slice(0, 3); // Max 3 per strategy
}

/** Get state file path for --scan-cache */
function getStateFilePath(state: SessionState): string {
  return resolve(homedir(), `.${state.agentName}`, "sessions", `${state.agentName}-${state.sessionNumber}.json`);
}

/** GATE: full oversight — interactive topic/category/text prompts */
async function runGateFull(
  state: SessionState,
  flags: RunnerFlags,
  rl: ReturnType<typeof createInterface>
): Promise<void> {
  const gatePosts: GatePost[] = [];
  let postNum = 1;
  const MAX_POSTS = 3;

  while (postNum <= MAX_POSTS) {
    console.log(`\n  --- Post ${postNum}/${MAX_POSTS} ---`);

    const topic = await ask(rl, "  Topic: ");
    if (!topic || topic.toLowerCase() === "done" || topic.toLowerCase() === "skip") {
      if (postNum === 1) phaseSkipped("No posts gated — skipping to REVIEW");
      break;
    }

    const category = await ask(rl, "  Category (ANALYSIS/PREDICTION): ");
    const text = await ask(rl, "  Draft text (or 'skip'): ");
    const confStr = await ask(rl, "  Confidence (60-100): ");

    const gateArgs = ["--agent", flags.agent, "--topic", topic, "--json", "--env", flags.env, "--scan-cache", getStateFilePath(state)];
    if (category && category.toLowerCase() !== "skip") gateArgs.push("--category", category.toUpperCase());
    if (text && text.toLowerCase() !== "skip") gateArgs.push("--text", text);
    if (confStr && /^\d+$/.test(confStr)) gateArgs.push("--confidence", confStr);

    const result = await runToolAndParse("tools/gate.ts", gateArgs, "gate.ts");

    const checks = Array.isArray(result.checks) ? result.checks : [];
    const passed = checks.filter((c: any) => c.passed).length;
    console.log(`\n  Gate result: ${passed}/${checks.length} checks passed`);
    for (const check of checks) {
      console.log(`    ${check.passed ? "✓" : "✗"} ${check.name}: ${check.detail || ""}`);
    }

    const proceed = await ask(rl, "\n  Proceed to publish? (y/n/skip): ");
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
      console.log("  (enter 'y' to proceed, 'n' to re-try, 'skip' to finish gating)");
    }
  }

  completePhase(state, "gate", { posts: gatePosts });
}

/** GATE: approve oversight — auto-suggest topics from scan, operator confirms */
async function runGateApprove(
  state: SessionState,
  flags: RunnerFlags,
  rl: ReturnType<typeof createInterface>
): Promise<void> {
  const gatePosts: GatePost[] = [];
  const suggestions = extractTopicsFromScan(state);

  if (suggestions.length === 0) {
    phaseSkipped("No topics found in scan — skipping gate");
    completePhase(state, "gate", { posts: [] });
    return;
  }

  console.log(`\n  Auto-suggested ${suggestions.length} topic(s) from scan:`);
  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i];
    console.log(`    ${i + 1}. ${s.topic} (${s.category}) — ${s.reason}`);
  }

  for (const suggestion of suggestions) {
    const gateArgs = ["--agent", flags.agent, "--topic", suggestion.topic, "--category", suggestion.category, "--json", "--env", flags.env, "--scan-cache", getStateFilePath(state)];
    const result = await runToolAndParse("tools/gate.ts", gateArgs, "gate.ts");

    const checks = Array.isArray(result.checks) ? result.checks : [];
    const passed = checks.filter((c: any) => c.passed).length;
    console.log(`\n  Gate: ${suggestion.topic} — ${passed}/${checks.length} checks`);

    const proceed = await ask(rl, `  Approve "${suggestion.topic}"? (y/n): `);
    if (proceed.toLowerCase() === "y" || proceed.toLowerCase() === "yes") {
      gatePosts.push({
        topic: suggestion.topic,
        category: suggestion.category,
        text: "", // Text generated by LLM in PUBLISH or provided manually
        confidence: 0,
        gateResult: result,
      });
    }
  }

  if (gatePosts.length === 0) phaseSkipped("No topics approved");
  completePhase(state, "gate", { posts: gatePosts });
}

/** GATE: autonomous oversight — auto-pick topics from scan, auto-accept if 5/6+ */
async function runGateAutonomous(
  state: SessionState,
  flags: RunnerFlags
): Promise<void> {
  const gatePosts: GatePost[] = [];
  const suggestions = extractTopicsFromScan(state);

  if (suggestions.length === 0) {
    phaseSkipped("No topics found in scan — skipping gate");
    completePhase(state, "gate", { posts: [] });
    return;
  }

  for (const suggestion of suggestions) {
    const gateArgs = ["--agent", flags.agent, "--topic", suggestion.topic, "--category", suggestion.category, "--json", "--env", flags.env, "--scan-cache", getStateFilePath(state)];
    const result = await runToolAndParse("tools/gate.ts", gateArgs, "gate.ts");

    const checks = Array.isArray(result.checks) ? result.checks : [];
    const passed = checks.filter((c: any) => c.passed).length;
    const total = checks.length;

    if (total > 0 && passed >= Math.ceil(total * 5 / 6)) {
      info(`Gate PASS: ${suggestion.topic} (${passed}/${total})`);
      gatePosts.push({
        topic: suggestion.topic,
        category: suggestion.category,
        text: "",
        confidence: 0,
        gateResult: result,
      });
    } else {
      info(`Gate FAIL: ${suggestion.topic} (${passed}/${total}) — skipping`);
    }
  }

  if (gatePosts.length === 0) phaseSkipped("No topics passed auto-gate");
  else phaseResult(`${gatePosts.length} topic(s) auto-gated`);
  completePhase(state, "gate", { posts: gatePosts });
}

// ── PUBLISH Phase ──────────────────────────────────

/** PUBLISH: full/approve oversight — manual with log capture */
async function runPublishManual(
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
  console.log(`\n  Gated ${gatePosts.length} post(s):`);
  for (const gp of gatePosts) {
    console.log(`    - ${gp.topic} (${gp.category}, confidence: ${gp.confidence})`);
  }

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
    const txHash = await ask(rl, "  Enter txHash (or 'done' to stop): ");
    if (!txHash || txHash.toLowerCase() === "done") break;
    if (!/^[a-fA-F0-9]+$/.test(txHash)) {
      console.log("  ⚠️ txHash should be hex characters only. Skipping.");
      continue;
    }

    const predStr = await ask(rl, "  Predicted reactions: ");
    const predicted = /^\d+$/.test(predStr) ? Number(predStr) : 0;

    if (existingTxHashes.has(txHash)) {
      console.log("  ⚠️ txHash already in session log — skipping");
      continue; // Skip duplicate entirely (Codex HIGH-1)
    }

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

    publishedHashes.push(txHash);
    state.posts.push(txHash);
    saveState(state);
  }

  phaseResult(`${publishedHashes.length} post(s) captured`);
  completePhase(state, "publish", { txHashes: publishedHashes });
}

/** PUBLISH: autonomous oversight — LLM text gen + DAHR attest + publish */
async function runPublishAutonomous(
  state: SessionState,
  flags: RunnerFlags
): Promise<void> {
  const gateResult = state.phases.gate.result || { posts: [] };
  const gatePosts: GatePost[] = gateResult.posts || [];
  const scanResult = state.phases.scan.result || {};

  if (gatePosts.length === 0) {
    phaseSkipped("No posts gated — nothing to publish");
    completePhase(state, "publish", { posts: [] });
    return;
  }

  // Load calibration offset from improvements file
  let calibrationOffset = 0;
  if (existsSync(IMPROVEMENTS_PATH)) {
    try {
      const impData = JSON.parse(readFileSync(IMPROVEMENTS_PATH, "utf-8"));
      calibrationOffset = impData.calibrationOffset || 0;
    } catch { /* use default */ }
  }

  // Connect wallet for publishing (no auth needed — publish uses on-chain TX, not API)
  const { demos } = await connectWallet(flags.env);

  let existingLog: any[] = [];
  try {
    existingLog = readSessionLog(flags.log);
  } catch { /* non-fatal */ }
  const existingTxHashes = new Set(existingLog.map((e: any) => e.txHash));
  const publishedHashes: string[] = [];

  for (const gp of gatePosts) {
    try {
      // Step 1: Generate post text via LLM
      const provider = resolveProvider(flags.env);
      if (!provider) {
        throw new Error("Autonomous publish requires an LLM provider. Set LLM_PROVIDER or ANTHROPIC_API_KEY.");
      }
      info(`Generating text for "${gp.topic}" via ${provider.name}...`);
      const draft: PostDraft = await generatePost(
        {
          topic: gp.topic,
          category: gp.category || "ANALYSIS",
          scanContext: {
            activity_level: scanResult.activity?.level || "unknown",
            posts_per_hour: scanResult.activity?.posts_per_hour || 0,
            hot_topic: scanResult.heat?.topic,
            hot_reactions: scanResult.heat?.reactions,
            gaps: scanResult.gaps?.topics,
            meta_saturation: scanResult.meta_saturation?.detected,
          },
          calibrationOffset,
        },
        provider,
        {
          personaMdPath: agentConfig.paths.personaMd,
          strategyYamlPath: agentConfig.paths.strategyYaml,
          agentName: agentConfig.name,
        }
      );

      console.log(`\n  LLM draft for "${gp.topic}":`);
      console.log(`    Category: ${draft.category}`);
      console.log(`    Text: ${draft.text.slice(0, 120)}...`);
      console.log(`    Tags: ${draft.tags.join(", ")}`);
      console.log(`    Confidence: ${draft.confidence}`);
      console.log(`    Predicted: ${draft.predicted_reactions} reactions`);

      // Step 2: DAHR attest (using a default data source for the topic)
      // For now, use CoinGecko for crypto topics, or skip attestation
      let attestUrl: string | undefined;
      const topicLower = gp.topic.toLowerCase();
      if (topicLower.includes("btc") || topicLower.includes("bitcoin") || topicLower.includes("crypto")) {
        attestUrl = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";
      } else if (topicLower.includes("eth") || topicLower.includes("ethereum")) {
        attestUrl = "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";
      } else if (topicLower.includes("gold") || topicLower.includes("oil") || topicLower.includes("commodity")) {
        attestUrl = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"; // Fallback
      }

      // Step 3: Attest + Publish
      const pubResult: PublishResult = await attestAndPublish(
        demos,
        {
          text: draft.text,
          category: draft.category,
          tags: draft.tags,
          confidence: draft.confidence,
          replyTo: draft.replyTo,
        },
        attestUrl
      );

      phaseResult(`Published: ${pubResult.txHash.slice(0, 16)}... (${pubResult.category}, ${pubResult.textLength} chars)`);

      // Step 4: Log to session log
      if (!existingTxHashes.has(pubResult.txHash)) {
        appendSessionLog(
          {
            timestamp: new Date().toISOString(),
            txHash: pubResult.txHash,
            category: draft.category,
            attestation_type: pubResult.attestation ? "DAHR" : "none",
            hypothesis: draft.hypothesis || "",
            predicted_reactions: draft.predicted_reactions,
            agents_referenced: [],
            topic: gp.topic,
            confidence: draft.confidence,
            text_preview: draft.text.slice(0, 100),
            tags: draft.tags,
          },
          flags.log
        );
        existingTxHashes.add(pubResult.txHash);
      }

      publishedHashes.push(pubResult.txHash);
      state.posts.push(pubResult.txHash);
      saveState(state);
    } catch (e: any) {
      phaseError(`Failed to auto-publish "${gp.topic}": ${e.message}`);
      // Continue with next post — don't fail entire phase
    }
  }

  phaseResult(`${publishedHashes.length}/${gatePosts.length} post(s) auto-published`);

  if (publishedHashes.length === 0 && gatePosts.length > 0) {
    failPhase(state, "publish", `All ${gatePosts.length} posts failed to publish`);
    throw new Error(`Autonomous publish failed: 0/${gatePosts.length} posts succeeded`);
  }

  completePhase(state, "publish", { txHashes: publishedHashes });
}

// ── VERIFY Phase ───────────────────────────────────

async function runVerify(state: SessionState, flags: RunnerFlags): Promise<void> {
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

// ── REVIEW Phase ───────────────────────────────────

/** Auto-propose Q2 suggestions as improvements */
async function autoPropose(
  result: any,
  sessionNumber: number
): Promise<number> {
  const suggestions: string[] = result.q2_suggestions || [];
  if (suggestions.length === 0) return 0;

  let proposed = 0;
  for (const suggestion of suggestions) {
    // Skip generic "no patterns" suggestions
    if (suggestion.includes("No systemic patterns")) continue;

    try {
      const impArgs = [
        "propose", suggestion,
        "--agent", agentConfig.name,
        "--evidence", `auto-detected in session ${sessionNumber} review`,
        "--target", "workflow",
        "--source", "Q2",
      ];
      await runTool("tools/improvements.ts", impArgs, {
        cwd: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
        timeout: 30_000,
      });
      proposed++;
      info(`Auto-proposed: ${suggestion}`);
    } catch (e: any) {
      info(`Warning: could not auto-propose "${suggestion}": ${e.message}`);
    }
  }
  return proposed;
}

/** REVIEW: full oversight — interactive prompts */
async function runReviewFull(
  state: SessionState,
  flags: RunnerFlags,
  rl: ReturnType<typeof createInterface>
): Promise<void> {
  const args = ["--json", "--log", flags.log];
  const result = await runToolAndParse("tools/session-review.ts", args, "session-review.ts");

  if (result.stats) {
    const s = result.stats;
    console.log(`\n  Session Stats:`);
    console.log(`    Posts: ${s.total_posts || 0} | Avg score: ${s.avg_score || "N/A"} | Avg reactions: ${s.avg_actual || "N/A"}`);
  }

  // Display Q1-Q4
  if (result.q1_failures?.length > 0) {
    console.log(`\n  Q1 Failures (${result.q1_failures.length}):`);
    for (const f of result.q1_failures.slice(0, 5)) {
      console.log(`    - ${f.txHash ? f.txHash.slice(0, 8) : (f.type || "?")}: ${f.reason}`);
    }
  }
  if (result.q2_suggestions?.length > 0) {
    console.log(`\n  Q2 Suggestions:`);
    for (const s of result.q2_suggestions) {
      console.log(`    - ${s}`);
    }
  }

  // Prompt for manual improvement
  const improvementDesc = await ask(rl, "\n  Any improvements to propose? (describe or 'none'): ");
  if (improvementDesc && improvementDesc.toLowerCase() !== "none") {
    const evidence = await ask(rl, "  Evidence for this improvement: ");
    const target = await ask(rl, "  Target file/component: ");
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

  // Persist review findings
  persistReviewFindings(state.sessionNumber, result);

  completePhase(state, "review", result);
}

/** REVIEW: approve/autonomous — auto-propose from Q2 */
async function runReviewAuto(
  state: SessionState,
  flags: RunnerFlags
): Promise<void> {
  const args = ["--json", "--log", flags.log];
  const result = await runToolAndParse("tools/session-review.ts", args, "session-review.ts");

  if (result.stats) {
    const s = result.stats;
    console.log(`\n  Session Stats:`);
    console.log(`    Posts: ${s.total_posts || 0} | Avg score: ${s.avg_score || "N/A"} | Avg reactions: ${s.avg_actual || "N/A"}`);
  }

  // Auto-propose Q2 suggestions
  const proposed = await autoPropose(result, state.sessionNumber);
  if (proposed > 0) {
    phaseResult(`${proposed} improvement(s) auto-proposed from Q2 analysis`);
  } else {
    phaseResult("Review complete — no actionable improvements detected");
  }

  // Persist review findings
  persistReviewFindings(state.sessionNumber, result);

  completePhase(state, "review", result);
}

/** Save review Q1-Q4 data for next session's AUDIT */
function persistReviewFindings(sessionNumber: number, result: any): void {
  try {
    saveReviewFindings({
      sessionNumber,
      timestamp: new Date().toISOString(),
      q1_failures: (result.q1_failures || []).map((f: any) => ({
        txHash: f.txHash || undefined,
        category: f.category || undefined,
        reason: f.reason || "",
        type: f.type || "score_miss",
      })),
      q2_suggestions: result.q2_suggestions || [],
      q3_insights: (result.q3_insights || []).map((i: any) => ({
        txHash: i.txHash || "",
        category: i.category || "",
        delta: i.delta || 0,
      })),
      q4_stale: (result.q4_stale || []).map((s: any) => ({
        txHash: s.txHash || undefined,
        description: s.description || "",
        type: s.type || "unaudited",
      })),
    }, agentConfig.paths.findingsFile);
    info("Review findings persisted for next session's AUDIT");
  } catch (e: any) {
    info(`Warning: could not persist review findings: ${e.message}`);
  }
}

// ── HARDEN Phase ──────────────────────────────────

type HardenType = "CODE-FIX" | "GUARDRAIL" | "GOTCHA" | "PLAYBOOK" | "STRATEGY" | "INFO";

interface HardenFinding {
  source: "q1" | "q2" | "q3" | "q4" | "phase_error";
  type: HardenType;
  text: string;
  rawData?: any;
}

/** Classify a REVIEW finding into a HARDEN type using rule-based defaults */
function classifyFinding(source: string, subtype?: string): HardenType {
  switch (source) {
    case "q1":
      switch (subtype) {
        case "gate_fail": return "CODE-FIX";
        case "publish_error": return "CODE-FIX";
        case "attest_error": return "GUARDRAIL";
        case "score_miss":
        default: return "INFO";
      }
    case "q2": return "CODE-FIX"; // suggestions are actionable
    case "q3": return "PLAYBOOK"; // new patterns → document
    case "q4":
      switch (subtype) {
        case "calibration_drift": return "PLAYBOOK";
        case "assumption_conflict": return "STRATEGY";
        case "unaudited":
        default: return "INFO";
      }
    case "phase_error":
      switch (subtype) {
        case "gate_fail": return "CODE-FIX";
        case "publish_error": return "CODE-FIX";
        case "attest_error": return "GUARDRAIL";
        default: return "CODE-FIX";
      }
    default: return "INFO";
  }
}

/** Collect findings from REVIEW result + session state */
function collectHardenFindings(state: SessionState): HardenFinding[] {
  const findings: HardenFinding[] = [];
  const reviewResult = state.phases.review?.result || {};

  // Q1 failures
  for (const f of (reviewResult.q1_failures || [])) {
    findings.push({
      source: "q1",
      type: classifyFinding("q1", f.type),
      text: `Q1: ${f.reason}${f.txHash ? ` (tx: ${f.txHash.slice(0, 8)})` : ""}`,
      rawData: f,
    });
  }

  // Q2 suggestions
  for (const s of (reviewResult.q2_suggestions || [])) {
    if (s.includes("No systemic patterns")) continue;
    findings.push({
      source: "q2",
      type: classifyFinding("q2"),
      text: `Q2: ${s}`,
    });
  }

  // Q3 insights
  for (const i of (reviewResult.q3_insights || [])) {
    findings.push({
      source: "q3",
      type: classifyFinding("q3"),
      text: `Q3: ${i.txHash?.slice(0, 8) || "?"} outperformed by +${i.delta}rx (${i.category})`,
      rawData: i,
    });
  }

  // Q4 stale items
  for (const s of (reviewResult.q4_stale || [])) {
    findings.push({
      source: "q4",
      type: classifyFinding("q4", s.type),
      text: `Q4: ${s.description}`,
      rawData: s,
    });
  }

  // Phase errors from current session (enrichment from state — not available to session-review.ts)
  const phases = getPhaseOrder();
  for (const phase of phases) {
    if (phase === "harden") continue;
    const p = state.phases[phase];
    if (p?.status === "failed" && p.error) {
      const subtype = phase === "gate" ? "gate_fail" : phase === "publish" ? "publish_error" : "attest_error";
      findings.push({
        source: "phase_error",
        type: classifyFinding("phase_error", subtype),
        text: `Phase ${phase.toUpperCase()} failed: ${p.error}`,
        rawData: { phase, error: p.error },
      });
    }
  }

  return findings;
}

/** Use LLM to reclassify findings (if available) */
async function llmClassify(findings: HardenFinding[], provider: LLMProvider): Promise<HardenFinding[]> {
  const prompt = `Classify each finding into exactly one type: CODE-FIX, GUARDRAIL, GOTCHA, PLAYBOOK, STRATEGY, or INFO.

Types:
- CODE-FIX: Broken flag, wrong default, missing alias — needs code change
- GUARDRAIL: Safe default to prevent known failure — add validation/cap
- GOTCHA: Verified pattern to document — add to playbook gotchas
- PLAYBOOK: Factual/technical operational insight — update playbook
- STRATEGY: Topic selection, scoring approach, engagement model — needs human review
- INFO: Platform stats, one-off observations — log only

Findings:
${findings.map((f, i) => `${i + 1}. [${f.type}] ${f.text}`).join("\n")}

Respond with ONLY a JSON array of types, one per finding. Example: ["CODE-FIX","INFO","STRATEGY"]`;

  try {
    const response = await provider.complete(prompt, { maxTokens: 256 });
    let jsonStr = response.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const types = JSON.parse(jsonStr) as string[];
    const validTypes = new Set<string>(["CODE-FIX", "GUARDRAIL", "GOTCHA", "PLAYBOOK", "STRATEGY", "INFO"]);
    for (let i = 0; i < findings.length && i < types.length; i++) {
      if (validTypes.has(types[i])) {
        findings[i].type = types[i] as HardenType;
      }
    }
  } catch (e: any) {
    info(`LLM classification failed (using rule-based defaults): ${e.message}`);
  }
  return findings;
}

/**
 * Propose an improvement via the improvements.ts subprocess.
 * NOTE: improvements.ts is a TRACKER, not an executor. "propose" records
 * the finding for human review and future application. Actual file edits
 * are not performed here — that requires LLM-generated diffs (future work).
 */
async function proposeImprovement(
  description: string,
  evidence: string,
  target: string,
  source: string
): Promise<void> {
  const impArgs = [
    "propose", description,
    "--agent", agentConfig.name,
    "--evidence", evidence,
    "--target", target,
    "--source", source,
  ];
  await runTool("tools/improvements.ts", impArgs, {
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    timeout: 30_000,
  });
}

/** HARDEN: full oversight — show each finding, ask y/n */
async function runHardenFull(
  state: SessionState,
  flags: RunnerFlags,
  rl: ReturnType<typeof createInterface>
): Promise<void> {
  let findings = collectHardenFindings(state);

  if (findings.length === 0) {
    phaseSkipped("No findings to harden");
    completePhase(state, "harden", { findings: 0, classified: 0, actionable: 0, proposed: 0, skipped: 0 });
    return;
  }

  // Try LLM classification
  const provider = resolveProvider(flags.env);
  if (provider) {
    info(`Classifying ${findings.length} findings via ${provider.name}...`);
    findings = await llmClassify(findings, provider);
  }

  let actionable = 0; // CODE-FIX/GUARDRAIL/GOTCHA/PLAYBOOK proposed for action
  let proposed = 0;   // STRATEGY proposed for human review
  let skipped = 0;

  for (const f of findings) {
    console.log(`\n  [${f.type}] ${f.text}`);

    if (f.type === "INFO") {
      console.log("    → INFO: logged only");
      skipped++;
      continue;
    }

    if (f.type === "STRATEGY") {
      const proceed = await ask(rl, "    Propose for human review? (y/n): ");
      if (proceed.toLowerCase() === "y") {
        try {
          await proposeImprovement(f.text, `HARDEN finding from session ${state.sessionNumber}`, "strategy.yaml", f.source);
          proposed++;
          phaseResult(`Proposed (STRATEGY): ${f.text.slice(0, 60)}...`);
        } catch (e: any) {
          info(`Warning: could not propose: ${e.message}`);
          skipped++;
        }
      } else {
        skipped++;
      }
      continue;
    }

    // CODE-FIX, GUARDRAIL, GOTCHA, PLAYBOOK — propose as actionable
    const proceed = await ask(rl, "    Propose as actionable? (y/n): ");
    if (proceed.toLowerCase() === "y") {
      try {
        await proposeImprovement(f.text, `HARDEN actionable, session ${state.sessionNumber}`, "workflow", f.source);
        actionable++;
        phaseResult(`Proposed (${f.type}): ${f.text.slice(0, 60)}...`);
      } catch (e: any) {
        info(`Warning: could not propose: ${e.message}`);
        skipped++;
      }
    } else {
      skipped++;
    }
  }

  phaseResult(`${findings.length} findings: ${actionable} actionable, ${proposed} strategy, ${skipped} skipped`);
  completePhase(state, "harden", {
    findings: findings.length,
    classified: findings.length,
    actionable,
    proposed,
    skipped,
  });
}

/** HARDEN: approve oversight — auto-propose non-STRATEGY, ask for STRATEGY */
async function runHardenApprove(
  state: SessionState,
  flags: RunnerFlags,
  rl: ReturnType<typeof createInterface>
): Promise<void> {
  let findings = collectHardenFindings(state);

  if (findings.length === 0) {
    phaseSkipped("No findings to harden");
    completePhase(state, "harden", { findings: 0, classified: 0, actionable: 0, proposed: 0, skipped: 0 });
    return;
  }

  const provider = resolveProvider(flags.env);
  if (provider) {
    info(`Classifying ${findings.length} findings via ${provider.name}...`);
    findings = await llmClassify(findings, provider);
  }

  let actionable = 0;
  let proposed = 0;
  let skipped = 0;

  for (const f of findings) {
    if (f.type === "INFO") {
      skipped++;
      continue;
    }

    if (f.type === "STRATEGY") {
      // STRATEGY: always ask human, even in approve mode
      console.log(`\n  [STRATEGY] ${f.text}`);
      const proceed = await ask(rl, "    Propose for human review? (y/n): ");
      if (proceed.toLowerCase() === "y") {
        try {
          await proposeImprovement(f.text, `HARDEN finding, session ${state.sessionNumber}`, "strategy.yaml", f.source);
          proposed++;
        } catch (e: any) {
          info(`Warning: could not propose: ${e.message}`);
          skipped++;
        }
      } else {
        skipped++;
      }
      continue;
    }

    // Auto-propose CODE-FIX, GUARDRAIL, GOTCHA, PLAYBOOK as actionable
    try {
      await proposeImprovement(f.text, `HARDEN actionable, session ${state.sessionNumber}`, "workflow", f.source);
      actionable++;
    } catch (e: any) {
      info(`Warning: could not propose "${f.text.slice(0, 40)}": ${e.message}`);
      skipped++;
    }
  }

  phaseResult(`${findings.length} findings: ${actionable} actionable, ${proposed} strategy, ${skipped} skipped`);
  completePhase(state, "harden", {
    findings: findings.length,
    classified: findings.length,
    actionable,
    proposed,
    skipped,
  });
}

/** HARDEN: autonomous oversight — auto-apply non-STRATEGY, propose STRATEGY for next session */
async function runHardenAutonomous(
  state: SessionState,
  flags: RunnerFlags
): Promise<void> {
  let findings = collectHardenFindings(state);

  if (findings.length === 0) {
    phaseSkipped("No findings to harden");
    completePhase(state, "harden", { findings: 0, classified: 0, actionable: 0, proposed: 0, skipped: 0 });
    return;
  }

  const provider = resolveProvider(flags.env);
  if (provider) {
    info(`Classifying ${findings.length} findings via ${provider.name}...`);
    findings = await llmClassify(findings, provider);
  }

  let actionable = 0;
  let proposed = 0;
  let skipped = 0;

  for (const f of findings) {
    if (f.type === "INFO") {
      skipped++;
      continue;
    }

    if (f.type === "STRATEGY") {
      // STRATEGY: propose only, NEVER auto-apply (AGENT.yaml hard rule)
      try {
        await proposeImprovement(f.text, `HARDEN autonomous propose, session ${state.sessionNumber}`, "strategy.yaml", f.source);
        proposed++;
        info(`Proposed STRATEGY: ${f.text.slice(0, 60)}...`);
      } catch (e: any) {
        info(`Warning: could not propose: ${e.message}`);
        skipped++;
      }
      continue;
    }

    // CODE-FIX, GUARDRAIL, GOTCHA, PLAYBOOK — propose as actionable
    // Note: proposeImprovement() records the finding in the tracker;
    // it does not auto-edit files. "Actionable" means tracked for action.
    try {
      await proposeImprovement(f.text, `HARDEN actionable, session ${state.sessionNumber}`, "workflow", f.source);
      actionable++;
    } catch (e: any) {
      info(`Warning: could not propose: ${e.message}`);
      skipped++;
    }
  }

  phaseResult(`${findings.length} findings: ${actionable} actionable, ${proposed} strategy, ${skipped} skipped`);
  completePhase(state, "harden", {
    findings: findings.length,
    classified: findings.length,
    actionable,
    proposed,
    skipped,
  });
}

// ── Session Report ─────────────────────────────────

function phaseDuration(state: SessionState, phase: PhaseName): string {
  const p = state.phases[phase];
  if (!p.startedAt || !p.completedAt) return "";
  const ms = new Date(p.completedAt).getTime() - new Date(p.startedAt).getTime();
  return ` (${(ms / 60000).toFixed(1)} min)`;
}

function writeSessionReport(state: SessionState, oversight: OversightLevel, sessionsDir?: string): void {
  const sessDir = sessionsDir || resolve(homedir(), `.${state.agentName}`, "sessions");
  mkdirSync(sessDir, { recursive: true });
  const reportPath = resolve(sessDir, `session-${state.sessionNumber}-report.md`);

  const duration = ((Date.now() - new Date(state.startedAt).getTime()) / 60000).toFixed(1);
  const date = new Date(state.startedAt).toISOString().slice(0, 10);
  const engage = state.phases.engage.result || {};
  const lines: string[] = [];

  lines.push(`# ${state.agentName.charAt(0).toUpperCase() + state.agentName.slice(1)} Session ${state.sessionNumber} — ${date}`);
  lines.push("");
  lines.push(`**Duration:** ${duration} min | **Posts:** ${state.posts.length} | **Reactions:** ${engage.reactions_cast || 0} (${engage.agrees || 0} agree, ${engage.disagrees || 0} disagree) | **Oversight:** ${oversight}`);
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
      const items = gp.gateResult?.items || gp.gateResult?.checks || [];
      const passed = items.filter((c: any) => c.status === "pass" || c.passed).length;
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
      lines.push(`- ${tx.slice(0, 16)}... (${gp.category || "?"}, confidence: ${gp.confidence || "?"}%)`);
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
  const reviewStats = review.stats;
  if (reviewStats) {
    lines.push(`- ${reviewStats.total_posts || 0} posts reviewed | Avg score: ${reviewStats.avg_score || "N/A"} | Avg reactions: ${reviewStats.avg_actual || "N/A"}`);
  }
  if (review.q2_suggestions?.length) {
    lines.push(`- Suggestions: ${review.q2_suggestions.join("; ")}`);
  }
  if (!reviewStats && !review.q2_suggestions?.length) {
    lines.push("- No improvements proposed");
  }
  lines.push("");

  // HARDEN
  const harden = state.phases.harden?.result || {};
  lines.push(`## 8. HARDEN${phaseDuration(state, "harden")}`);
  if (harden.findings !== undefined) {
    lines.push(`- ${harden.findings} findings classified`);
    lines.push(`- Actionable: ${harden.actionable || 0} | Proposed: ${harden.proposed || 0} | Skipped: ${harden.skipped || 0}`);
  } else {
    lines.push("- Skipped");
  }
  lines.push("");

  writeFileSync(reportPath, lines.join("\n"));
  info(`Session report written to ${reportPath}`);
}

// ── Dry Run ────────────────────────────────────────

function dryRun(sessionNumber: number, flags: RunnerFlags, startPhase: PhaseName | null): void {
  banner(sessionNumber, flags.oversight);
  console.log("  MODE: dry-run (no execution)\n");

  const phases = getPhaseOrder();
  let started = startPhase === null;

  for (const phase of phases) {
    if (!started && phase === startPhase) started = true;
    if (!started) {
      console.log(`  ${getPhaseOrder().indexOf(phase) + 1}. ${phase.toUpperCase()} — SKIPPED`);
      continue;
    }

    const mode = getPhaseMode(phase, flags.oversight);
    console.log(`  ${getPhaseOrder().indexOf(phase) + 1}. ${phase.toUpperCase()} (${mode})`);
  }
  console.log();
}

// ── Main Orchestrator ──────────────────────────────

async function main(): Promise<void> {
  const flags = parseArgs();

  agentConfig = loadAgentConfig(flags.agent);
  IMPROVEMENTS_PATH = agentConfig.paths.improvementsFile;
  const sessionsDir = agentConfig.paths.sessionDir;

  let state: SessionState;
  let sessionNumber: number;
  let startPhase: PhaseName | null = null;

  if (flags.resume) {
    const active = findActiveSession(sessionsDir, flags.agent);
    if (!active) {
      console.error("Error: no active session to resume. Start a new session without --resume.");
      process.exit(1);
    }
    state = active;
    sessionNumber = state.sessionNumber;

    try {
      acquireLock(sessionNumber, sessionsDir, flags.agent);
    } catch (e: any) {
      if (e.message.includes("is locked by PID")) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      }
      throw e;
    }

    state.pid = process.pid;
    saveState(state, sessionsDir);

    startPhase = getNextPhase(state);
    if (!startPhase) {
      console.log("Session already complete — nothing to resume.");
      clearState(sessionNumber, sessionsDir, flags.agent);
      process.exit(0);
    }
    info(`Resuming session ${sessionNumber} from ${startPhase.toUpperCase()}`);
  } else {
    sessionNumber = getNextSessionNumber();

    if (flags.skipTo) {
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

    if (flags.dryRun) {
      dryRun(sessionNumber, flags, startPhase);
      process.exit(0);
    }

    state = startSession(sessionNumber, flags.agent, sessionsDir);
    info(`Started session ${sessionNumber}`);

    if (startPhase) {
      const phases = getPhaseOrder();
      for (const phase of phases) {
        if (phase === startPhase) break;
        completePhase(state, phase, { skipped: true, reason: `--skip-to ${startPhase}` }, sessionsDir);
      }
    }
  }

  banner(sessionNumber, flags.oversight);

  let shuttingDown = false;
  process.on("SIGINT", () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    console.log("\n\n  ⚠️ Interrupted — saving state...");
    saveState(state, sessionsDir);
    console.log(`  Resume with: npx tsx tools/session-runner.ts --agent ${flags.agent} --resume --pretty`);
    console.log();
    process.exit(0);
  });

  // Only create readline for modes that need it
  const needsReadline = flags.oversight !== "autonomous";
  const rl = needsReadline
    ? createInterface({ input: stdin, output: stdout })
    : null;

  const phases = getPhaseOrder();
  const startIdx = startPhase ? phases.indexOf(startPhase) : 0;

  try {
    for (let i = startIdx; i < phases.length; i++) {
      const phase = phases[i];
      if (state.phases[phase].status === "completed") continue;

      phaseHeader(phase, flags.oversight);
      beginPhase(state, phase, sessionsDir);

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
            if (flags.oversight === "full") await runGateFull(state, flags, rl!);
            else if (flags.oversight === "approve") await runGateApprove(state, flags, rl!);
            else await runGateAutonomous(state, flags);
            break;
          case "publish":
            if (flags.oversight === "autonomous") await runPublishAutonomous(state, flags);
            else await runPublishManual(state, flags, rl!);
            break;
          case "verify":
            await runVerify(state, flags);
            break;
          case "review":
            if (flags.oversight === "full") await runReviewFull(state, flags, rl!);
            else await runReviewAuto(state, flags);
            break;
          case "harden":
            if (flags.oversight === "full") await runHardenFull(state, flags, rl!);
            else if (flags.oversight === "approve") await runHardenApprove(state, flags, rl!);
            else await runHardenAutonomous(state, flags);
            break;
        }
      } catch (e: any) {
        failPhase(state, phase, e.message, sessionsDir);
        phaseError(e.message);
        console.error(`\n  Session state saved. Resume with: npx tsx tools/session-runner.ts --agent ${flags.agent} --resume --pretty`);
        rl?.close();
        process.exit(1);
      }
    }

    rl?.close();

    // Display summary
    const duration = ((Date.now() - new Date(state.startedAt).getTime()) / 60000).toFixed(1);
    console.log("\n" + "═".repeat(50));
    console.log("  SESSION COMPLETE");
    console.log("═".repeat(50));
    console.log(`  Session: ${sessionNumber}`);
    console.log(`  Oversight: ${flags.oversight}`);
    console.log(`  Duration: ${duration} min`);
    console.log(`  Posts: ${state.posts.length}`);

    const engageResult = state.phases.engage.result || {};
    console.log(`  Reactions: ${engageResult.reactions_cast || 0} (${engageResult.agrees || 0} agree, ${engageResult.disagrees || 0} disagree)`);

    const verifyResult = state.phases.verify.result || {};
    if (!verifyResult.skipped) {
      console.log(`  Verified: ${verifyResult.summary?.verified || 0}/${verifyResult.summary?.total || 0}`);
    }
    console.log("═".repeat(50) + "\n");

    try {
      writeSessionReport(state, flags.oversight, sessionsDir);
    } catch (e: any) {
      info(`Warning: could not write session report: ${e.message}`);
    }

    incrementSessionNumber();
    clearState(sessionNumber, sessionsDir, flags.agent);
    info("Session state cleared.");
  } catch (e: any) {
    rl?.close();
    saveState(state, sessionsDir);
    console.error(`\nFATAL: ${e.message}`);
    console.error(`Session state saved. Resume with: npx tsx tools/session-runner.ts --agent ${flags.agent} --resume --pretty`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
});
