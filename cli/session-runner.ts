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
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";
import { createInterface } from "node:readline/promises";
import { spawn, spawnSync } from "node:child_process";
import { stdin, stdout } from "node:process";

import { runTool, ToolError, type ToolResult } from "../src/lib/util/subprocess.js";
import { calculateQualityScore, logQualityData } from "../src/lib/scoring/quality-score.js";
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
  isV2,
  CORE_PHASE_ORDER,
  type SessionState,
  type V2SessionState,
  type AnySessionState,
  type PhaseName,
  type CorePhase,
  type LoopVersion,
  type ActSubstageState,
  type SubstageStatus,
} from "../src/lib/state.js";
import { readSessionLog, appendSessionLog, resolveLogPath } from "../src/lib/util/log.js";
import { saveReviewFindings, loadLatestFindings } from "../src/lib/review-findings.js";
import { generatePost, type PostDraft } from "../src/actions/llm.js";
import { resolveProvider, type LLMProvider } from "../src/lib/llm/llm-provider.js";
import { apiCall, connectWallet, setLogAgent } from "../src/lib/network/sdk.js";
// ensureAuth removed — session loop is fully chain-only
import { attestDahr, attestTlsn, publishPost, type PublishResult, type AttestResult } from "../src/actions/publish-pipeline.js";
import { extractStructuredClaimsAuto } from "../src/lib/attestation/claim-extraction.js";
import { buildAttestationPlan, verifyAttestedValues, createUsageTracker, type SourceUsageTracker } from "../src/lib/attestation/attestation-planner.js";
import { executeAttestationPlan } from "../src/actions/attestation-executor.js";
import { loadDeclarativeProviderAdaptersSync } from "../src/lib/sources/providers/declarative-engine.js";
import { resolveAttestationPlan, type AttestationType } from "../src/lib/attestation/attestation-policy.js";
import { resolveAgentName, loadAgentConfig, type AgentConfig } from "../src/lib/agent-config.js";
import { initObserver, setObserverPhase, observe, type SubstageResult, type SubstageFailureCode } from "../src/lib/pipeline/observe.js";
import {
  loadExtensions,
  runBeforeSense,
  runBeforePublishDraft,
  runAfterPublishDraft,
  runAfterAct,
  runAfterConfirm,
  type ExtensionHookRegistry,
  type BeforeSenseContext,
  type HookLogger,
} from "../src/lib/util/extensions.js";
import type { PublishedPostRecord } from "../src/lib/state.js";
import { FileStateStore } from "../src/toolkit/state-store.js";
import { checkAndRecordWrite, getWriteRateRemaining } from "../src/toolkit/guards/write-rate-limit.js";
import { type SignalSnapshot } from "../src/lib/pipeline/signals.js";
import {
  loadAgentSourceView,
  preflight as sourcesPreflight,
  selectSourceForTopicV2,
  type AgentSourceView,
} from "../src/lib/sources/index.js";
import {
  runSourceScan,
  deriveIntentsFromTopics,
  mergeAndDedup,
  type TopicSuggestion,
} from "../src/lib/pipeline/source-scanner.js";
import {
  loadBaselines,
  saveBaselines,
} from "../src/lib/pipeline/signal-detection.js";
import {
  createTranscriptContext,
  emitTranscriptEvent,
  extractTranscriptMetrics,
  pruneOldTranscripts,
  type SourceRelevanceEntry,
  type TranscriptContext,
} from "../src/lib/transcript.js";

// ── Transcript Metric Extraction ────────────────────

/** Extract phase-specific data for transcript from phase result.
 * Paths verified against actual result shapes in session-runner.ts. */
function extractPhaseData(phase: string, result: any, state: any): Record<string, unknown> | undefined {
  switch (phase) {
    case "audit": {
      const stats = result.stats || {};
      return {
        entriesAudited: stats.total_entries || 0,
        avgPredictionError: stats.avg_prediction_error,
        scoreDistribution: stats.score_distribution,
      };
    }
    case "scan":
      return {
        activityLevel: result.activity?.level,
        postsPerHour: result.activity?.posts_per_hour,
        gapCount: result.gaps?.topics?.length || 0,
        sourceSignals: result.sourceSignals,
      };
    case "engage":
      return { reactionsCast: result.reactions_cast || 0, agrees: result.agrees || 0, disagrees: result.disagrees || 0 };
    case "gate": {
      const posts = result.posts || [];
      return {
        topicCount: posts.length,
        topics: posts.map((p: any) => p.topic),
        passCount: posts.filter((p: any) => p.gateResult?.summary?.fail === 0).length,
        failCount: posts.filter((p: any) => p.gateResult?.summary?.fail > 0).length,
      };
    }
    case "publish":
      return {
        postCount: state.posts?.length || 0,
        txHashes: state.posts?.map((p: any) => p.txHash),
        categories: state.posts?.map((p: any) => p.category),
      };
    case "verify": {
      const summary = result.summary || {};
      return { verified: summary.verified || 0, total: summary.total || 0 };
    }
    case "review": {
      const stats = result.stats || {};
      return {
        postsReviewed: stats.total_posts,
        avgScore: stats.avg_score,
        avgReactions: stats.avg_actual,
        suggestions: result.q2_suggestions?.map((s: any) => s.text || s) || [],
      };
    }
    case "harden":
      return {
        findingsCount: result.findings || 0,
        actionable: result.actionable || 0,
        proposed: result.proposed || 0,
        skipped: result.skipped || 0,
      };
    default:
      return undefined;
  }
}

// ── Constants ──────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const TMUX_ADAPTER_ENV = "SESSION_RUNNER_TMUX_ADAPTER";

// Resolved at runtime based on --agent flag
let IMPROVEMENTS_PATH = resolve(homedir(), ".sentinel-improvements.json");
let agentConfig: AgentConfig;
let runnerAgentName = "sentinel";
let runnerExecBackend: ExecBackend = "spawn";
let detectedTmuxAdapter: TmuxAdapter | null = null;
let cachedSourceView: AgentSourceView | null = null;

/** Load source view once per session, cached for gate + publish reuse */
function getSourceView(): AgentSourceView {
  if (cachedSourceView) return cachedSourceView;
  cachedSourceView = loadAgentSourceView(
    agentConfig.name as import("../src/lib/sources/catalog.js").AgentName,
    agentConfig.paths.sourceCatalog,
    agentConfig.paths.sourcesRegistry,
    agentConfig.sourceRegistryMode
  );
  return cachedSourceView;
}

type OversightLevel = "full" | "approve" | "autonomous";
type ExecBackend = "spawn" | "tmux";
type TmuxAdapter = "native" | "tmux-cli";

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
  execBackend: ExecBackend;
  loopVersion: LoopVersion;
  shadow: boolean;
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
  let oversight: OversightLevel = "autonomous";
  if (flags["oversight"]) {
    const val = flags["oversight"].toLowerCase();
    if (!["full", "approve", "autonomous"].includes(val)) {
      console.error(`Error: --oversight must be one of: full, approve, autonomous`);
      process.exit(1);
    }
    oversight = val as OversightLevel;
  }

  let execBackend: ExecBackend = "spawn";
  if (flags["exec-backend"]) {
    const val = flags["exec-backend"].toLowerCase();
    if (!["spawn", "tmux"].includes(val)) {
      console.error(`Error: --exec-backend must be one of: spawn, tmux`);
      process.exit(1);
    }
    execBackend = val as ExecBackend;
  }

  // Parse loop version
  let loopVersion: LoopVersion = 1;
  if (flags["loop-version"]) {
    const val = Number(flags["loop-version"]);
    if (val !== 1 && val !== 2) {
      console.error(`Error: --loop-version must be 1 or 2, got "${flags["loop-version"]}"`);
      process.exit(1);
    }
    loopVersion = val as LoopVersion;
  }

  // Parse shadow mode
  const shadow = flags["shadow"] === "true";
  if (shadow && loopVersion !== 2) {
    console.error("Error: --shadow requires --loop-version 2");
    process.exit(1);
  }

  // --skip-to is not supported in v2 (v2 has different phase names)
  if (skipTo && loopVersion === 2) {
    console.error("Error: --skip-to is not supported with --loop-version 2. Use --resume instead.");
    process.exit(1);
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
    execBackend,
    loopVersion,
    shadow,
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
  --oversight LEVEL      Oversight level: full|approve|autonomous (default: autonomous)
  --resume               Resume interrupted session from last completed phase
  --skip-to PHASE        Start from specific phase (audit|scan|engage|gate|publish|verify|review|harden)
  --force-skip-audit     Required with --skip-to when skipping AUDIT phase
  --loop-version 1|2     Loop version: 1 (8-phase) or 2 (3-phase SENSE/ACT/CONFIRM) (default: 1)
  --shadow               Shadow mode: skip publish substage (requires --loop-version 2)
  --dry-run              Show what would run without executing
  --exec-backend MODE    Subprocess backend: spawn|tmux (default: spawn)
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
  npx tsx tools/session-runner.ts --exec-backend tmux --oversight autonomous --pretty
  SESSION_RUNNER_TMUX_ADAPTER=tmux-cli npx tsx tools/session-runner.ts --exec-backend tmux --pretty
  npx tsx tools/session-runner.ts --resume --pretty
  npx tsx tools/session-runner.ts --dry-run --oversight autonomous
`);
}

// ── Display Helpers ────────────────────────────────

function banner(sessionNumber: number, oversight: OversightLevel, agentName: string): void {
  console.log("\n" + "═".repeat(50));
  console.log(`  ${agentName.toUpperCase()} SESSION ${sessionNumber}`);
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

/** Hook logger — bridges plugin hook output to session-runner CLI formatting */
const hookLogger: HookLogger = { info, result: phaseResult };

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

function shellQuote(input: string): string {
  return `'${input.replace(/'/g, `'\"'\"'`)}'`;
}

function isSafeEnvKey(input: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(input);
}

function commandExists(command: string): boolean {
  const probe = spawnSync(command, ["--help"], { stdio: "ignore" });
  if (probe.error) {
    const err = probe.error as NodeJS.ErrnoException;
    return err.code !== "ENOENT";
  }
  return true;
}

function resolveTmuxAdapter(): TmuxAdapter {
  if (detectedTmuxAdapter) return detectedTmuxAdapter;

  const forced = (process.env[TMUX_ADAPTER_ENV] || "").trim().toLowerCase();
  if (forced === "native" || forced === "tmux-cli") {
    detectedTmuxAdapter = forced as TmuxAdapter;
    return detectedTmuxAdapter;
  }

  detectedTmuxAdapter = commandExists("tmux-cli") ? "tmux-cli" : "native";
  return detectedTmuxAdapter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

// ── Phase Budget Defaults ─────────────────────────

/** Default phase budgets in seconds. Configurable via strategy.yaml phaseBudgets. */
const DEFAULT_PHASE_BUDGETS: Record<PhaseName, number> = {
  audit: 30,      // 30s — API calls only, no LLM
  scan: 30,       // 30s — cached feed + source scan
  engage: 30,     // 30s — reactions are fast API calls
  gate: 30,       // 30s — local checks + 1 source fetch
  publish: 120,   // 2 min — LLM gen + DAHR attest + broadcast (no TLSN)
  verify: 30,     // 30s — single API check + 1 retry
  review: 30,     // 30s — local analysis
  harden: 30,     // 30s — LLM classify (capped at 10 findings)
};

/**
 * Get the budget for a phase in milliseconds.
 * Uses strategy.yaml phaseBudgets if available, otherwise defaults.
 * Returns 0 if no budget should be enforced.
 */
function getPhaseBudgetMs(phase: PhaseName, config: AgentConfig): number {
  const configBudgets = config.phaseBudgets;
  if (configBudgets && typeof configBudgets[phase] === "number") {
    return configBudgets[phase] * 1000;
  }
  const defaultSec = DEFAULT_PHASE_BUDGETS[phase];
  return defaultSec ? defaultSec * 1000 : 0;
}

// ── V2 State Accessors ────────────────────────────

function getScanResult(state: AnySessionState): any {
  if (isV2(state)) return state.phases.sense?.result;
  return state.phases.scan?.result;
}

function getGateResult(state: AnySessionState): any {
  if (isV2(state)) {
    // Prefer act.result.gate (final state), fall back to v1-compat phases.gate
    // written by v1 gate handlers during ACT substage execution.
    const actResult = state.phases.act?.result;
    return actResult?.gate || (state as any).phases.gate?.result;
  }
  return state.phases.gate?.result;
}

function getEngageResult(state: AnySessionState): any {
  if (isV2(state)) {
    const actResult = state.phases.act?.result;
    return actResult?.engage;
  }
  return state.phases.engage?.result;
}

function getVerifyResult(state: AnySessionState): any {
  if (isV2(state)) return state.phases.confirm?.result;
  return state.phases.verify?.result;
}

// ── V2 Phase Budgets ──────────────────────────────

const V2_PHASE_BUDGETS: Record<CorePhase, number> = {
  sense: 180,    // 3 min
  act: 1500,     // 25 min (sum of substages)
  confirm: 120,  // 2 min
};

function getV2PhaseBudgetMs(phase: CorePhase, config: AgentConfig): number {
  const configBudgets = config.phaseBudgets;
  if (configBudgets && typeof configBudgets[phase] === "number") {
    return configBudgets[phase] * 1000;
  }
  return (V2_PHASE_BUDGETS[phase] || 0) * 1000;
}

/** Check v2 phase budget and observe if exceeded */
function checkV2PhaseBudget(phase: CorePhase, durationMs: number): void {
  const budgetMs = getV2PhaseBudgetMs(phase, agentConfig);
  if (budgetMs > 0 && durationMs > budgetMs) {
    const overage = Math.round(((durationMs - budgetMs) / budgetMs) * 100);
    observe("inefficiency", `${phase.toUpperCase()} exceeded budget: ${Math.round(durationMs / 1000)}s vs ${Math.round(budgetMs / 1000)}s (+${overage}%)`, {
      phase, source: "session-runner.ts:phase-budget",
      data: { phase, durationMs, budgetMs, overage },
    });
  }
}

// ── V2 Substage Runner ────────────────────────────

function createSubstage(name: "engage" | "gate" | "publish"): ActSubstageState {
  return {
    substage: name,
    status: "pending" as SubstageStatus,
  };
}

function startSubstage(sub: ActSubstageState): void {
  sub.status = "running";
  sub.startedAt = new Date().toISOString();
}

function completeSubstage(sub: ActSubstageState, result?: any): void {
  sub.status = "completed";
  sub.completedAt = new Date().toISOString();
  sub.durationMs = sub.startedAt ? Date.now() - new Date(sub.startedAt).getTime() : 0;
  sub.result = result;
}

function failSubstage(sub: ActSubstageState, failureCode: string): void {
  sub.status = "failed";
  sub.completedAt = new Date().toISOString();
  sub.durationMs = sub.startedAt ? Date.now() - new Date(sub.startedAt).getTime() : 0;
  sub.failureCode = failureCode;
}

function skipSubstage(sub: ActSubstageState): void {
  sub.status = "skipped";
  sub.durationMs = 0;
}

async function runCommand(
  command: string,
  args: string[] = [],
  options: { cwd?: string; timeout?: number; env?: Record<string, string | undefined> } = {}
): Promise<ToolResult> {
  const { cwd, timeout = 120_000, env = {} } = options;

  return new Promise<ToolResult>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: cwd || process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    let exited = false;
    let settled = false;
    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const settleResolve = (result: ToolResult) => {
      if (settled) return;
      settled = true;
      resolvePromise(result);
    };

    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* no-op */ }
      setTimeout(() => {
        if (!exited) {
          try { child.kill("SIGKILL"); } catch { /* no-op */ }
        }
      }, 2_000);
      settleReject(new ToolError(command, -1, `Timed out after ${timeout}ms`));
    }, timeout);

    child.on("error", (err) => {
      clearTimeout(timer);
      settleReject(new ToolError(command, -1, err.message));
    });

    child.on("close", (code) => {
      exited = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      const exitCode = code ?? 1;

      if (exitCode !== 0) {
        settleReject(new ToolError(command, exitCode, stderr));
        return;
      }
      settleResolve({ stdout, stderr, exitCode });
    });
  });
}

async function runToolViaTmux(
  toolPath: string,
  args: string[] = [],
  options: { cwd?: string; timeout?: number; env?: Record<string, string | undefined> } = {}
): Promise<ToolResult> {
  const { cwd = REPO_ROOT, timeout = 120_000, env = {} } = options;
  const resolvedTool = resolve(cwd, toolPath);
  const tempDir = mkdtempSync(resolve(tmpdir(), "session-runner-tmux-"));
  const stdoutPath = resolve(tempDir, "stdout.log");
  const stderrPath = resolve(tempDir, "stderr.log");
  const exitPath = resolve(tempDir, "exit.code");
  const sessionName = `${runnerAgentName}-runner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    .replace(/[^a-zA-Z0-9_-]/g, "-");

  const quotedCommand = ["npx", "tsx", resolvedTool, ...args].map(shellQuote).join(" ");
  const envPrefix = Object.entries(env)
    .filter(([key, value]) => isSafeEnvKey(key) && value !== undefined)
    .map(([key, value]) => `${key}=${shellQuote(value as string)}`)
    .join(" ");
  const execCommand = envPrefix ? `${envPrefix} ${quotedCommand}` : quotedCommand;
  const shellCommand =
    `cd ${shellQuote(cwd)} && ` +
    `${execCommand} > ${shellQuote(stdoutPath)} 2> ${shellQuote(stderrPath)}; ` +
    `printf '%s' $? > ${shellQuote(exitPath)}`;

  try {
    await runCommand(
      "tmux",
      ["new-session", "-d", "-P", "-F", "#{session_name}", "-s", sessionName, shellCommand],
      { cwd, timeout: 10_000 }
    );

    const deadline = Date.now() + timeout;
    while (!existsSync(exitPath) && Date.now() < deadline) {
      await sleep(250);
    }

    if (!existsSync(exitPath)) {
      throw new ToolError(toolPath, -1, `Timed out after ${timeout}ms`);
    }

    const stdout = existsSync(stdoutPath) ? readFileSync(stdoutPath, "utf-8") : "";
    const stderr = existsSync(stderrPath) ? readFileSync(stderrPath, "utf-8") : "";
    const exitRaw = readFileSync(exitPath, "utf-8").trim();
    const exitCode = Number.parseInt(exitRaw, 10);
    if (Number.isNaN(exitCode)) {
      throw new ToolError(toolPath, -1, "tmux backend did not report an exit code");
    }
    if (exitCode !== 0) {
      throw new ToolError(toolPath, exitCode, stderr);
    }

    return { stdout, stderr, exitCode };
  } finally {
    try {
      await runCommand("tmux", ["kill-session", "-t", sessionName], { timeout: 5_000 });
    } catch {
      // Session may already have exited or been cleaned up.
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup.
    }
  }
}

async function runToolViaTmuxCli(
  toolPath: string,
  args: string[] = [],
  options: { cwd?: string; timeout?: number; env?: Record<string, string | undefined> } = {}
): Promise<ToolResult> {
  const { cwd = REPO_ROOT, timeout = 120_000, env = {} } = options;
  const resolvedTool = resolve(cwd, toolPath);
  const tempDir = mkdtempSync(resolve(tmpdir(), "session-runner-tmux-cli-"));
  const stdoutPath = resolve(tempDir, "stdout.log");
  const stderrPath = resolve(tempDir, "stderr.log");
  const exitPath = resolve(tempDir, "exit.code");

  const quotedCommand = ["npx", "tsx", resolvedTool, ...args].map(shellQuote).join(" ");
  const envPrefix = Object.entries(env)
    .filter(([key, value]) => isSafeEnvKey(key) && value !== undefined)
    .map(([key, value]) => `${key}=${shellQuote(value as string)}`)
    .join(" ");
  const execCommand = envPrefix ? `${envPrefix} ${quotedCommand}` : quotedCommand;
  const shellCommand =
    `cd ${shellQuote(cwd)} && ` +
    `${execCommand} > ${shellQuote(stdoutPath)} 2> ${shellQuote(stderrPath)}; ` +
    `printf '%s' $? > ${shellQuote(exitPath)}`;

  const timeoutSeconds = Math.max(1, Math.ceil(timeout / 1000));

  try {
    await runCommand("tmux-cli", ["execute", shellCommand, `--timeout=${timeoutSeconds}`], {
      cwd,
      timeout: timeout + 15_000,
    });

    const deadline = Date.now() + 2_000;
    while (!existsSync(exitPath) && Date.now() < deadline) {
      await sleep(100);
    }

    if (!existsSync(exitPath)) {
      throw new ToolError(toolPath, -1, `tmux-cli backend did not report an exit code`);
    }

    const stdout = existsSync(stdoutPath) ? readFileSync(stdoutPath, "utf-8") : "";
    const stderr = existsSync(stderrPath) ? readFileSync(stderrPath, "utf-8") : "";
    const exitRaw = readFileSync(exitPath, "utf-8").trim();
    const exitCode = Number.parseInt(exitRaw, 10);
    if (Number.isNaN(exitCode)) {
      throw new ToolError(toolPath, -1, "tmux-cli backend returned an invalid exit code");
    }
    if (exitCode !== 0) {
      throw new ToolError(toolPath, exitCode, stderr);
    }

    return { stdout, stderr, exitCode };
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup.
    }
  }
}

async function runToolWithBackend(
  toolPath: string,
  args: string[] = [],
  options: { cwd?: string; timeout?: number; env?: Record<string, string | undefined> } = {}
): Promise<ToolResult> {
  if (runnerExecBackend === "tmux") {
    if (resolveTmuxAdapter() === "tmux-cli") {
      return runToolViaTmuxCli(toolPath, args, options);
    }
    return runToolViaTmux(toolPath, args, options);
  }
  return runTool(toolPath, args, options);
}

async function runToolAndParse(
  toolPath: string,
  args: string[],
  label: string
): Promise<any> {
  info(`Running ${label}...`);
  const result = await runToolWithBackend(toolPath, args, {
    cwd: REPO_ROOT,
    timeout: 180_000,
    env: { AGENT_NAME: runnerAgentName },
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
  const result = await runToolAndParse("cli/audit.ts", args, "audit.ts");

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
  // Mode 1: Feed scan (existing — subprocess)
  const args = ["--agent", flags.agent, "--json", "--env", flags.env];
  const result = await runToolAndParse("cli/scan-feed.ts", args, "scan-feed.ts");

  const level = result.activity?.level || "unknown";
  const pph = result.activity?.posts_per_hour ?? "?";
  const gapCount = result.gaps?.topics?.length || 0;
  phaseResult(`${level} activity (${pph} posts/hr) | ${gapCount} gap topics found`);

  // Mode 2: Source scan (NEW — inline, non-fatal)
  try {
    const topics = agentConfig.topics ?? { primary: [], secondary: [] };
    const intents = deriveIntentsFromTopics(topics);

    if (intents.length > 0) {
      const sourceView = getSourceView();
      const baselinePath = resolve(homedir(), ".config", "demos", `baselines-${flags.agent}.json`);
      const baselineStore = loadBaselines(baselinePath);

      const scanResult = await runSourceScan(sourceView, intents, baselineStore, {
        maxSources: 10,
        minSignalStrength: 0.3,
        dryRun: flags.dryRun,
      });

      // Convert signals to session-runner TopicSuggestions
      // (signals already filtered by minSignalStrength in runSourceScan)
      const sourceSuggestions = scanResult.signals
        .map(s => ({
          topic: s.evidence.topics?.[0] ?? s.summary,
          category: s.rule.type === "anti-signal" ? "OPINION" : "ANALYSIS",
          reason: `source-scan: ${s.summary} (strength ${s.strength.toFixed(2)})`,
        }));

      // Store source scan results alongside feed scan
      result.sourceSignals = {
        signalCount: scanResult.signals.length,
        sourcesFetched: scanResult.sourcesFetched,
        baselinesUpdated: scanResult.baselinesUpdated,
        suggestions: sourceSuggestions,
      };

      // Save updated baselines
      if (!flags.dryRun && scanResult.baselinesUpdated > 0) {
        saveBaselines(baselinePath, baselineStore);
      }

      info(`Source scan: ${scanResult.sourcesFetched} sources fetched, ${scanResult.signals.length} signals detected`);
    }
  } catch (err: any) {
    // Source scan failure is non-fatal — log and continue
    info(`Source scan error (non-fatal): ${err.message}`);
  }

  completePhase(state, "scan", result);
}

// ── ENGAGE Phase ───────────────────────────────────

async function runEngage(state: SessionState, flags: RunnerFlags): Promise<void> {
  const args = ["--agent", flags.agent, "--max", String(agentConfig.engagement.maxReactionsPerSession), "--json", "--env", flags.env];
  const result = await runToolAndParse("cli/engage.ts", args, "engage.ts");

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
  replyTo?: {
    txHash: string;
    author: string;
    text: string;
  };
}

type GateItemStatus = "pass" | "fail" | "manual" | "warning";

interface NormalizedGateCheck {
  name: string;
  detail: string;
  status: GateItemStatus;
  passed: boolean;
}

interface NormalizedGateEval {
  checks: NormalizedGateCheck[];
  passed: number;
  total: number;
  fail: number;
  warning: number;
  manual: number;
}

function normalizeGateResult(result: any): NormalizedGateEval {
  if (Array.isArray(result?.items)) {
    const checks: NormalizedGateCheck[] = result.items.map((item: any) => {
      const status: GateItemStatus =
        item?.status === "pass" || item?.status === "fail" || item?.status === "manual" || item?.status === "warning"
          ? item.status
          : "fail";
      return {
        name: String(item?.name || "check"),
        detail: String(item?.detail || ""),
        status,
        passed: status === "pass",
      };
    });

    const autoChecks = checks.filter((c) => c.status !== "manual");
    return {
      checks,
      passed: autoChecks.filter((c) => c.passed).length,
      total: autoChecks.length,
      fail: checks.filter((c) => c.status === "fail").length,
      warning: checks.filter((c) => c.status === "warning").length,
      manual: checks.filter((c) => c.status === "manual").length,
    };
  }

  const legacyChecksRaw = Array.isArray(result?.checks) ? result.checks : [];
  const checks: NormalizedGateCheck[] = legacyChecksRaw.map((c: any) => ({
    name: String(c?.name || "check"),
    detail: String(c?.detail || ""),
    status: c?.passed ? "pass" : "fail",
    passed: Boolean(c?.passed),
  }));
  return {
    checks,
    passed: checks.filter((c) => c.passed).length,
    total: checks.length,
    fail: checks.filter((c) => c.status === "fail").length,
    warning: 0,
    manual: 0,
  };
}

function gateIcon(status: GateItemStatus): string {
  switch (status) {
    case "pass": return "✓";
    case "manual": return "?";
    case "warning": return "!";
    case "fail":
    default:
      return "✗";
  }
}

function shouldAutoPassGate(result: any, normalized: NormalizedGateEval): boolean {
  // New gate.ts result shape has explicit fail count — treat this as authoritative.
  if (typeof result?.summary?.fail === "number") {
    if (result.summary.fail === 0) return true;

    // Pioneer-friendly soft-pass: allow exactly one fail when the only failed
    // item is Signal strength and safety checks still pass.
    if (result.summary.fail === 1 && Array.isArray(result?.items)) {
      const items = result.items;
      const failed = items.filter((i: any) => i?.status === "fail");
      const onlySignalFail =
        failed.length === 1 &&
        String(failed[0]?.name || "").toLowerCase() === "signal strength";
      if (onlySignalFail) {
        const novelty = items.find((i: any) => String(i?.name || "").toLowerCase() === "novelty");
        const category = items.find((i: any) => String(i?.name || "").toLowerCase() === "category");
        const duplicate = items.find((i: any) => String(i?.name || "").toLowerCase() === "not duplicate");
        const safetyPass =
          novelty?.status === "pass" &&
          category?.status === "pass" &&
          duplicate?.status === "pass";
        if (safetyPass) return true;
      }
    }
    return false;
  }

  // Legacy fallback: keep historical "5/6+" behavior.
  if (normalized.total === 0) return false;
  return normalized.passed >= Math.ceil(normalized.total * 5 / 6);
}

function tokenizeTopicText(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

interface ScanTopicStats {
  count: number;
  totalReactions: number;
  attestedCount: number;
  uniqueAuthors: string[];
  avgScore: number;
  newestTimestamp: number;
}

interface ScanAgentStats {
  address: string;
  avgScore: number;
}

function normalizeScanTopicIndex(raw: any): Array<{ topic: string; stats: ScanTopicStats }> {
  if (!raw || typeof raw !== "object") return [];

  const out: Array<{ topic: string; stats: ScanTopicStats }> = [];
  for (const [topicRaw, statsRaw] of Object.entries(raw)) {
    const topic = String(topicRaw || "").trim().toLowerCase();
    if (!topic) continue;
    const statsObj = statsRaw as any;
    out.push({
      topic,
      stats: {
        count: Number(statsObj?.count || 0),
        totalReactions: Number(statsObj?.totalReactions || 0),
        attestedCount: Number(statsObj?.attestedCount || 0),
        uniqueAuthors: Array.isArray(statsObj?.uniqueAuthors)
          ? statsObj.uniqueAuthors.map((a: unknown) => String(a || "").toLowerCase()).filter(Boolean)
          : [],
        avgScore: Number(statsObj?.avgScore || 0),
        newestTimestamp: Number(statsObj?.newestTimestamp || 0),
      },
    });
  }
  return out;
}

function normalizeScanAgentIndex(raw: any): Map<string, ScanAgentStats> {
  const out = new Map<string, ScanAgentStats>();
  if (!raw || typeof raw !== "object") return out;

  for (const [keyRaw, statsRaw] of Object.entries(raw)) {
    const key = String(keyRaw || "").toLowerCase();
    if (!key) continue;
    const statsObj = statsRaw as any;
    out.set(key, {
      address: key,
      avgScore: Number(statsObj?.avgScore || 0),
    });
  }
  return out;
}

/**
 * Extract post topics from scan results.
 * Standard mode: preserve previous heat+gaps behavior.
 * Pioneer mode: prefer frontier/focus-aligned topics and filter generic feed noise.
 * TopicSuggestion type imported from source-scanner.ts (shared definition).
 */

/**
 * Static topic expansion map — splits overly generic topics into specific,
 * attestable subtopics. Each subtopic should map to at least one source in
 * the catalog for attestation.
 *
 * TODO: Evolve to dynamic expansion — during scan, look at tags/assets
 * co-occurring with generic topics and derive subtopics from actual feed data.
 * Static map is the starting point; dynamic expansion using feed analysis is the goal.
 */
const TOPIC_EXPANSIONS: Record<string, string[]> = {
  tech: ["ai-infrastructure", "dev-tools", "open-source", "blockchain-security", "cloud-computing"],
  crypto: ["bitcoin-markets", "ethereum-defi", "stablecoin-flows", "protocol-governance", "crypto-derivatives"],
  defi: ["lending-protocols", "dex-volume", "yield-farming", "stablecoin-flows", "tvl-trends"],
  macro: ["interest-rates", "commodity-prices", "forex-dynamics", "geopolitical-risk", "trade-policy"],
  ai: ["ai-infrastructure", "llm-research", "ai-policy", "ml-ops", "ai-agents"],
  science: ["quantum-computing", "biotech-research", "space-exploration", "climate-science", "materials-science"],
  infrastructure: ["network-health", "node-operations", "rpc-reliability", "chain-upgrades", "validator-economics"],
};

/**
 * Expand a generic topic into a specific subtopic that has a matching source.
 * Returns the original topic if no expansion is needed or no subtopic passes preflight.
 */
function expandGenericTopic(
  topic: string,
  usedTopics: Set<string>
): string {
  const expansions = TOPIC_EXPANSIONS[topic.toLowerCase()];
  if (!expansions) return topic;

  const sv = getSourceView();
  for (const sub of expansions) {
    if (usedTopics.has(sub)) continue;
    const pf = sourcesPreflight(sub, sv, agentConfig);
    if (pf.pass) return sub;
  }
  return topic; // No expansion found, keep original
}

function extractTopicsFromScan(
  state: AnySessionState,
  sessionLogPath?: string
): TopicSuggestion[] {
  const scan = getScanResult(state) || {};
  const mode = agentConfig.gate.mode === "pioneer" ? "pioneer" : "standard";
  const topics: TopicSuggestion[] = [];
  const topicIndex = normalizeScanTopicIndex(scan.topicIndex);
  const agentIndex = normalizeScanAgentIndex(scan.agentIndex);

  const allAuthorsLowQuality = (stats: ScanTopicStats): boolean => {
    if (!Array.isArray(stats.uniqueAuthors) || stats.uniqueAuthors.length === 0) return false;
    let known = 0;
    for (const author of stats.uniqueAuthors) {
      const agent = agentIndex.get(author.toLowerCase());
      if (!agent) return false;
      known++;
      if (agent.avgScore >= 70) return false;
    }
    return known > 0;
  };

  if (topicIndex.length > 0) {
    const focusTopics = [...agentConfig.topics.primary, ...agentConfig.topics.secondary]
      .map((t) => String(t).toLowerCase().trim())
      .filter(Boolean);
    const focusTokens = new Set<string>();
    for (const ft of focusTopics) {
      for (const tok of tokenizeTopicText(ft)) focusTokens.add(tok);
    }

    if (mode === "pioneer") {
      // Pre-filter: expand generic topics, then check source availability
      const sourceView = getSourceView();
      const pioneerExpandUsed = new Set<string>();
      const ranked = topicIndex
        .filter((entry) => !allAuthorsLowQuality(entry.stats))
        .map((entry) => {
          // Expand generic topics BEFORE preflight
          const expanded = expandGenericTopic(entry.topic, pioneerExpandUsed);
          if (expanded !== entry.topic) pioneerExpandUsed.add(expanded.toLowerCase());
          return { ...entry, topic: expanded, originalTopic: entry.topic };
        })
        .filter((entry) => {
          const pf = sourcesPreflight(entry.topic, sourceView, agentConfig);
          return pf.pass;
        })
        .map((entry) => {
          const topicTokens = tokenizeTopicText(entry.topic);
          const focusOverlap = topicTokens.filter((t) => focusTokens.has(t)).length;
          let score = entry.stats.attestedCount > 0
            ? entry.stats.totalReactions / entry.stats.attestedCount
            : entry.stats.totalReactions * 2;
          const reasons: string[] = [
            `opportunity=${entry.stats.totalReactions}/${Math.max(1, entry.stats.attestedCount)}`
          ];

          if (entry.stats.count < 5 && (focusTopics.includes(entry.topic) || focusOverlap > 0)) {
            score += 2;
            reasons.push("underexplored+focus");
          }
          if (focusTopics.includes(entry.topic)) {
            score += 1.5;
            reasons.push("focus-exact");
          } else if (focusOverlap > 0) {
            score += 0.75;
            reasons.push("focus-overlap");
          }

          return { topic: entry.topic, score, reasons };
        })
        .sort((a, b) => b.score - a.score);

      for (const item of ranked.slice(0, 3)) {
        topics.push({
          topic: item.topic,
          category: "QUESTION",
          reason: `topic-index pioneer (${item.reasons.slice(0, 3).join(", ")})`,
        });
      }
      if (topics.length > 0) {
        // Merge source-scan suggestions for pioneer mode too
        const sourceSignals = scan.sourceSignals?.suggestions;
        if (Array.isArray(sourceSignals) && sourceSignals.length > 0) {
          return mergeAndDedup(topics, sourceSignals).slice(0, 3);
        }
        return topics;
      }
    } else {
      const sv = getSourceView();
      const expandUsed = new Set<string>();
      const ranked = topicIndex
        .filter((entry) => !allAuthorsLowQuality(entry.stats))
        .map((entry) => {
          // Expand generic topics BEFORE preflight so expanded subtopics can pass
          const expanded = expandGenericTopic(entry.topic, expandUsed);
          if (expanded !== entry.topic) expandUsed.add(expanded.toLowerCase());
          return { ...entry, topic: expanded, originalTopic: entry.topic };
        })
        .filter((entry) => sourcesPreflight(entry.topic, sv, agentConfig).pass)
        .sort((a, b) =>
          b.stats.totalReactions - a.stats.totalReactions ||
          b.stats.count - a.stats.count ||
          b.stats.newestTimestamp - a.stats.newestTimestamp
        );

      // Bucket 1: max 1 from topicIndex (quota-based mixing)
      if (ranked.length > 0) {
        const r = ranked[0];
        if (r.originalTopic !== r.topic) info(`Topic expansion: "${r.originalTopic}" → "${r.topic}"`);
        topics.push({
          topic: r.topic,
          category: "ANALYSIS",
          reason: `topic-index (${r.stats.totalReactions} reactions, ${r.stats.attestedCount} attested)`,
        });
      }
    }
  }

  if (mode === "standard") {
    const usedTopics = new Set(topics.map((t) => t.topic.toLowerCase()));

    // Bucket 1 (PRIORITY): reply candidate — replies get 2x reactions (13.6 vs 8.2 avg)
    const minReplyReactions = agentConfig.engagement.replyMinParentReactions || 3;
    const rawPosts = Array.isArray(scan.rawPosts) ? scan.rawPosts : [];
    if (rawPosts.length > 0) {
      const countRx = (p: any): number => (p.reactions?.agree || 0) + (p.reactions?.disagree || 0);

      let best: { post: any; rx: number } | null = null;
      for (const p of rawPosts) {
        if (!p.txHash || !p.author) continue;
        const rx = countRx(p);
        if (rx >= minReplyReactions && (!best || rx > best.rx)) {
          best = { post: p, rx };
        }
      }

      if (best) {
        const candidate = best.post;
        const text = String(candidate.payload?.text || candidate.textPreview || "").slice(0, 300);
        const topicTag = candidate.payload?.tags?.[0] || candidate.tags?.[0] || "reply";
        const replyTopic = String(topicTag).toLowerCase();
        if (!usedTopics.has(replyTopic)) {
          topics.push({
            topic: replyTopic,
            category: "ANALYSIS",
            reason: `reply target (${best.rx}rx)`,
            replyTo: {
              txHash: String(candidate.txHash),
              author: String(candidate.author),
              text,
            },
          });
          usedTopics.add(replyTopic);
        }
      }
    }

    // Bucket 2: heat or gap/opinion (1 slot) — only if no reply target found
    if (topics.length === 0 || !topics.some(t => t.replyTo)) {
      let bucket2Filled = false;
      if (scan.heat?.topic && !usedTopics.has(scan.heat.topic.toLowerCase())) {
        topics.push({
          topic: scan.heat.topic,
          category: "ANALYSIS",
          reason: `hot topic (${scan.heat.reactions || 0} reactions)`,
        });
        usedTopics.add(scan.heat.topic.toLowerCase());
        bucket2Filled = true;
      }

      if (!bucket2Filled) {
        const gaps = scan.gaps?.topics || [];
        for (const gap of gaps.slice(0, 1)) {
          if (!usedTopics.has(gap.toLowerCase())) {
            const category = !scan.heat?.topic ? "OPINION" : "ANALYSIS";
            topics.push({
              topic: gap,
              category,
              reason: category === "OPINION" ? "gap — opinion opportunity" : "gap in feed coverage",
            });
            usedTopics.add(gap.toLowerCase());
          }
        }
      }
    }

    // Expand generic topics into specific subtopics with attestation sources
    const expandedUsed = new Set(topics.map(t => t.topic.toLowerCase()));
    for (const t of topics) {
      const expanded = expandGenericTopic(t.topic, expandedUsed);
      if (expanded !== t.topic) {
        info(`Topic expansion: "${t.topic}" → "${expanded}"`);
        t.topic = expanded;
        expandedUsed.add(expanded.toLowerCase());
      }
    }

    // Merge source-scan suggestions (Phase 4 — source-first priority)
    const sourceSignals = scan.sourceSignals?.suggestions;
    if (Array.isArray(sourceSignals) && sourceSignals.length > 0) {
      const merged = mergeAndDedup(topics, sourceSignals);
      return merged.slice(0, 3); // Max 3 per strategy
    }

    return topics.slice(0, 3); // Max 3 per strategy
  }

  // Pioneer mode
  const focusTopics = [...agentConfig.topics.primary, ...agentConfig.topics.secondary]
    .map((t) => String(t).toLowerCase().trim())
    .filter(Boolean);
  const focusTokenSet = new Set<string>();
  for (const ft of focusTopics) {
    for (const tok of tokenizeTopicText(ft)) focusTokenSet.add(tok);
  }

  const genericLowSignal = new Set([
    "opinion", "action", "analysis", "prediction", "question", "signal", "refuted", "meta", "news",
  ]);

  const recentSelfTopics = new Set<string>();
  if (sessionLogPath) {
    const now = Date.now();
    const windowMs = (agentConfig.gate.duplicateWindowHours || 24) * 60 * 60 * 1000;
    for (const entry of readSessionLog(sessionLogPath)) {
      const ts = Date.parse(String(entry.timestamp || ""));
      if (!Number.isFinite(ts) || now - ts > windowMs) continue;
      if (entry.topic) recentSelfTopics.add(String(entry.topic).toLowerCase());
      for (const tag of entry.tags || []) {
        recentSelfTopics.add(String(tag).toLowerCase());
      }
    }
  }

  const candidateMap = new Map<string, { score: number; reasons: string[] }>();
  const addCandidate = (rawTopic: string, baseScore: number, reason: string): void => {
    const topic = String(rawTopic || "").trim().toLowerCase();
    if (!topic) return;

    const topicTokens = tokenizeTopicText(topic);
    if (topicTokens.length === 0) return;

    let score = baseScore;
    const reasons = [reason];

    if (genericLowSignal.has(topic)) {
      score -= 5;
      reasons.push("generic");
    }
    if (recentSelfTopics.has(topic)) {
      // Penalize recent self-topics instead of hard-excluding them so gate doesn't starve.
      score -= 2;
      reasons.push("recent-self");
    }
    if (/^[a-z]{1,3}$/i.test(topic)) {
      score -= 3;
      reasons.push("too-short");
    }

    const focusOverlap = topicTokens.filter((t) => focusTokenSet.has(t)).length;
    if (focusTopics.includes(topic)) {
      score += 4;
      reasons.push("focus-exact");
    } else if (focusOverlap > 0) {
      const bonus = Math.min(3, focusOverlap + 1);
      score += bonus;
      reasons.push(`focus-overlap+${bonus}`);
    } else {
      score -= 1;
      reasons.push("off-focus");
    }

    if (topic.includes("-") && topic.length >= 8) {
      score += 1;
      reasons.push("specific");
    }

    const existing = candidateMap.get(topic);
    if (!existing || score > existing.score) {
      candidateMap.set(topic, { score, reasons });
    } else if (existing) {
      existing.reasons.push(...reasons);
    }
  };

  if (scan.heat?.topic) {
    addCandidate(
      scan.heat.topic,
      2,
      `heat ${scan.heat.reactions || 0}rx`
    );
  }

  const gaps = Array.isArray(scan.gaps?.topics) ? scan.gaps.topics : [];
  for (const gap of gaps.slice(0, 15)) {
    addCandidate(gap, 5, "gap");
  }

  if (scan.convergence?.topic) {
    addCandidate(
      scan.convergence.topic,
      2,
      `convergence ${scan.convergence.agent_count || 0} agents`
    );
  }

  const ranked = [...candidateMap.entries()]
    .map(([topic, meta]) => ({ topic, ...meta }))
    .filter((c) => c.score >= 3)
    .sort((a, b) => b.score - a.score);

  for (const c of ranked.slice(0, 3)) {
    topics.push({
      topic: c.topic,
      category: "QUESTION",
      reason: `pioneer scoop (${c.reasons.slice(0, 3).join(", ")})`,
    });
  }

  // Fallback to configured frontier topics if scan candidates are weak.
  if (topics.length === 0) {
    for (const ft of agentConfig.topics.secondary.slice(0, 3)) {
      const lowered = String(ft).toLowerCase();
      topics.push({
        topic: lowered,
        category: "QUESTION",
        reason: recentSelfTopics.has(lowered)
          ? "pioneer fallback focus topic (recent-self)"
          : "pioneer fallback focus topic",
      });
      if (topics.length >= 3) break;
    }
  }

  if (topics.length === 0) {
    const fallback =
      String(scan.heat?.topic || scan.convergence?.topic || scan.gaps?.topics?.[0] || "").toLowerCase() ||
      String(agentConfig.topics.secondary[0] || agentConfig.topics.primary[0] || "frontier-tech").toLowerCase();
    topics.push({
      topic: fallback,
      category: "QUESTION",
      reason: "pioneer hard fallback (never empty)",
    });
  }

  // Expand generic topics into specific subtopics with attestation sources
  const expandedUsedPioneer = new Set(topics.map(t => t.topic.toLowerCase()));
  for (const t of topics) {
    const expanded = expandGenericTopic(t.topic, expandedUsedPioneer);
    if (expanded !== t.topic) {
      info(`Topic expansion: "${t.topic}" → "${expanded}"`);
      t.topic = expanded;
      expandedUsedPioneer.add(expanded.toLowerCase());
    }
  }

  return topics.slice(0, 3); // Max 3 per strategy
}

/** Get state file path for --scan-cache */
function getStateFilePath(state: AnySessionState): string {
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

    const mode = agentConfig.gate.mode === "pioneer" ? "pioneer" : "standard";
    const categoryPrompt = mode === "pioneer"
      ? "  Category (ANALYSIS/PREDICTION/QUESTION/OPINION): "
      : "  Category (ANALYSIS/PREDICTION/OPINION): ";
    const category = await ask(rl, categoryPrompt);
    const text = await ask(rl, "  Draft text (or 'skip'): ");
    const confStr = await ask(rl, "  Confidence (60-100): ");

    const gateArgs = ["--agent", flags.agent, "--topic", topic, "--json", "--env", flags.env, "--scan-cache", getStateFilePath(state)];
    if (category && category.toLowerCase() !== "skip") gateArgs.push("--category", category.toUpperCase());
    if (text && text.toLowerCase() !== "skip") gateArgs.push("--text", text);
    if (confStr && /^\d+$/.test(confStr)) gateArgs.push("--confidence", confStr);

    const result = await runToolAndParse("cli/gate.ts", gateArgs, "gate.ts");

    const gateEval = normalizeGateResult(result);
    console.log(`\n  Gate result: ${gateEval.passed}/${gateEval.total} automated checks passed`);
    for (const check of gateEval.checks) {
      console.log(`    ${gateIcon(check.status)} ${check.name}: ${check.detail}`);
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
  state: AnySessionState,
  flags: RunnerFlags,
  rl: ReturnType<typeof createInterface>
): Promise<{ posts: GatePost[] }> {
  const gatePosts: GatePost[] = [];
  const suggestions = extractTopicsFromScan(state, flags.log);

  if (suggestions.length === 0) {
    phaseSkipped("No topics found in scan — skipping gate");
    const result = { posts: [] as GatePost[] };
    if (!isV2(state)) completePhase(state, "gate", result);
    return result;
  }

  console.log(`\n  Auto-suggested ${suggestions.length} topic(s) from scan:`);
  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i];
    console.log(`    ${i + 1}. ${s.topic} (${s.category}) — ${s.reason}`);
  }

  for (const suggestion of suggestions) {
    const gateArgs = ["--agent", flags.agent, "--topic", suggestion.topic, "--category", suggestion.category, "--json", "--env", flags.env, "--scan-cache", getStateFilePath(state)];
    if (suggestion.replyTo?.txHash) {
      gateArgs.push("--reply-to", suggestion.replyTo.txHash);
    }
    const result = await runToolAndParse("cli/gate.ts", gateArgs, "gate.ts");

    const gateEval = normalizeGateResult(result);
    console.log(`\n  Gate: ${suggestion.topic} — ${gateEval.passed}/${gateEval.total} automated checks`);

    const proceed = await ask(rl, `  Approve "${suggestion.topic}"? (y/n): `);
    if (proceed.toLowerCase() === "y" || proceed.toLowerCase() === "yes") {
      gatePosts.push({
        topic: suggestion.topic,
        category: suggestion.category,
        text: "", // Text generated by LLM in PUBLISH or provided manually
        confidence: 0,
        gateResult: result,
        replyTo: suggestion.replyTo,
      });
    }
  }

  if (gatePosts.length === 0) phaseSkipped("No topics approved");
  const result = { posts: gatePosts };
  if (!isV2(state)) completePhase(state, "gate", result);
  return result;
}

/**
 * LLM reasoning fallback for topic selection.
 * Called when heuristic extractTopicsFromScan returns 0 viable topics.
 * Asks the LLM to suggest topics that bridge feed activity with available sources.
 */
async function suggestTopicsWithReasoning(
  state: AnySessionState,
  sourceView: AgentSourceView,
  flags: RunnerFlags,
): Promise<TopicSuggestion[]> {
  const scan = getScanResult(state) || {};
  const mode = agentConfig.gate.mode === "pioneer" ? "pioneer" : "standard";

  try {
    const provider = resolveProvider(flags.env);
    if (!provider) {
      info("Reasoning fallback: no LLM provider — skipping");
      return [];
    }

    // Build context for the LLM — topicIndex is a Record<string, stats>, normalize it
    const topicIndex = normalizeScanTopicIndex(scan.topicIndex);
    const feedTopics = topicIndex
      .slice(0, 15)
      .map((t) => `${t.topic} (${t.stats.totalReactions}rx)`)
      .join(", ");

    const hotTopic = scan.heat?.topic
      ? `${scan.heat.topic} (${scan.heat.reactions || 0}rx)`
      : "none";

    const sourceTopics = new Set<string>();
    for (const s of sourceView.sources) {
      for (const t of s.topics || []) sourceTopics.add(t);
      for (const a of s.topicAliases || []) sourceTopics.add(a);
    }
    const availableSources = [...sourceTopics].sort().join(", ");

    const agentFocus = [
      ...agentConfig.topics.primary,
      ...agentConfig.topics.secondary,
    ].join(", ");

    const category = mode === "pioneer" ? "QUESTION" : "ANALYSIS";

    const prompt = `You are a topic selector for a SuperColony agent (${agentConfig.name}, focus: ${agentFocus}).

The feed is active but heuristic topic selection found 0 publishable topics — either no matching data sources or topics failed quality gates.

Feed hot topics: ${feedTopics || "none"}
Hottest topic: ${hotTopic}
Agent's available data source topics: ${availableSources}

Suggest 1-3 topics that:
1. Are active or trending in the feed (relevant to what other agents are discussing)
2. Have matching data sources from the available list above
3. Align with the agent's focus areas

Return ONLY a JSON array of objects: [{"topic": "lowercase-kebab-case", "reason": "brief reason"}]
No markdown, no explanation outside the JSON.`;

    const response = await provider.complete(prompt, { maxTokens: 256 });
    let trimmed = response.trim().replace(/^```json?\s*/, "").replace(/\s*```$/, "");
    // Extract JSON array if LLM includes preamble/trailing text
    if (!trimmed.startsWith("[")) {
      const start = trimmed.indexOf("[");
      if (start >= 0) trimmed = trimmed.slice(start);
    }
    if (trimmed.lastIndexOf("]") > 0) {
      trimmed = trimmed.slice(0, trimmed.lastIndexOf("]") + 1);
    }
    const parsed = JSON.parse(trimmed);

    if (!Array.isArray(parsed)) return [];

    const results: TopicSuggestion[] = [];
    for (const item of parsed.slice(0, 3)) {
      const topic = String(item.topic || "").trim().toLowerCase();
      if (!topic || topic.length < 2) continue;

      // Validate source availability
      const pf = sourcesPreflight(topic, sourceView, agentConfig);
      if (!pf.pass) {
        info(`Reasoning suggestion "${topic}" rejected: ${pf.reason}`);
        continue;
      }

      results.push({
        topic,
        category,
        reason: `reasoning fallback (${String(item.reason || "LLM suggested").slice(0, 60)})`,
      });
    }

    if (results.length > 0) {
      info(`Reasoning fallback: ${results.length} topic(s) suggested`);
      observe("insight", `Reasoning fallback suggested ${results.length} topic(s): ${results.map(r => r.topic).join(", ")}`, {
        phase: "gate", substage: "gate",
        source: "session-runner.ts:suggestTopicsWithReasoning",
      });
    } else {
      info("Reasoning fallback: LLM returned 0 viable topics");
    }
    return results;
  } catch (e: any) {
    info(`Reasoning fallback failed (non-fatal): ${e.message}`);
    observe("error", `Reasoning fallback failed: ${e.message}`, {
      phase: "gate", substage: "gate",
      source: "session-runner.ts:suggestTopicsWithReasoning",
    });
    return [];
  }
}

/** GATE: autonomous oversight — auto-pick topics from scan, auto-accept by gate summary */
async function runGateAutonomous(
  state: AnySessionState,
  flags: RunnerFlags
): Promise<{ posts: GatePost[] }> {
  const gatePosts: GatePost[] = [];
  const suggestions = extractTopicsFromScan(state, flags.log);

  // Load source view (cached per session — shared with publish phase, refreshed on discovery)
  let sourceView = getSourceView();
  info(`Gate: ${sourceView.sources.length} sources available (catalog v${sourceView.catalogVersion})`);

  // If heuristic extraction returned 0 topics, try LLM reasoning fallback
  let effectiveSuggestions = suggestions;
  let reasoningAlreadyRan = false;
  if (effectiveSuggestions.length === 0) {
    info("Heuristic topic selection returned 0 — trying LLM reasoning fallback");
    effectiveSuggestions = await suggestTopicsWithReasoning(state, sourceView, flags);
    reasoningAlreadyRan = true;
  }

  if (effectiveSuggestions.length === 0) {
    observe("insight", "No topics found (heuristic + reasoning) — gate skipped", {
      phase: "gate", substage: "gate",
      source: "session-runner.ts:runGateAutonomous",
    });
    phaseSkipped("No topics found in scan — skipping gate");
    const result = { posts: [] as GatePost[] };
    if (!isV2(state)) completePhase(state, "gate", result);
    return result;
  }

  for (const suggestion of effectiveSuggestions) {
    // Source-availability pre-check via preflight (v2 — uses catalog index)
    let preflightResult = sourcesPreflight(suggestion.topic, sourceView, agentConfig);
    if (!preflightResult.pass && preflightResult.reasonCode === "NO_MATCHING_SOURCE") {
      // Try dynamic source discovery before giving up
      try {
        const { discoverSourceForTopic, persistSourceToCatalog } = await import("../src/lib/pipeline/source-discovery.js");
        const discovered = await discoverSourceForTopic(suggestion.topic, preflightResult.plan.required, 8000);
        if (discovered) {
          info(`Discovery: found source "${discovered.source.name}" for "${suggestion.topic}" (relevance: ${discovered.relevanceScore})`);
          // Persist to catalog so future sessions benefit
          if (!flags.dryRun) {
            persistSourceToCatalog(agentConfig.paths.sourceCatalog, discovered);
          }
          // Retry preflight with refreshed source view
          cachedSourceView = null;
          sourceView = getSourceView();
          preflightResult = sourcesPreflight(suggestion.topic, sourceView, agentConfig);
        }
      } catch (e: any) {
        info(`Discovery failed for "${suggestion.topic}": ${e.message}`);
      }
    }
    if (!preflightResult.pass) {
      observe("insight", `Gate preflight rejected topic "${suggestion.topic}": ${preflightResult.reason}`, {
        phase: "gate", substage: "gate",
        source: "session-runner.ts:runGateAutonomous",
        data: { topic: suggestion.topic, reasonCode: preflightResult.reasonCode },
      });
      info(`Gate SKIP: ${suggestion.topic} — ${preflightResult.reason} (${preflightResult.reasonCode})`);
      continue;
    }

    const gateArgs = ["--agent", flags.agent, "--topic", suggestion.topic, "--category", suggestion.category, "--json", "--env", flags.env, "--scan-cache", getStateFilePath(state), "--scan-trusted", "true"];
    if (suggestion.replyTo?.txHash) {
      gateArgs.push("--reply-to", suggestion.replyTo.txHash);
    }
    const result = await runToolAndParse("cli/gate.ts", gateArgs, "gate.ts");

    const gateEval = normalizeGateResult(result);
    const passed = gateEval.passed;
    const total = gateEval.total;
    const failCount = typeof result?.summary?.fail === "number" ? result.summary.fail : gateEval.fail;
    const canPublish = shouldAutoPassGate(result, gateEval);

    if (canPublish) {
      info(`Gate PASS: ${suggestion.topic} (${passed}/${total}, fail=${failCount})`);
      gatePosts.push({
        topic: suggestion.topic,
        category: suggestion.category,
        text: "",
        confidence: 0,
        gateResult: result,
        replyTo: suggestion.replyTo,
      });
    } else {
      info(`Gate FAIL: ${suggestion.topic} (${passed}/${total}, fail=${failCount}) — skipping`);
    }
  }

  // If all suggestions failed gate, try LLM reasoning as last resort (skip if already ran)
  if (gatePosts.length === 0 && effectiveSuggestions.length > 0 && !reasoningAlreadyRan) {
    info("All heuristic topics failed gate — trying LLM reasoning fallback");
    const reasoningSuggestions = await suggestTopicsWithReasoning(state, sourceView, flags);
    for (const suggestion of reasoningSuggestions) {
      const preflightResult = sourcesPreflight(suggestion.topic, sourceView, agentConfig);
      if (!preflightResult.pass) {
        info(`Reasoning SKIP: ${suggestion.topic} — ${preflightResult.reason}`);
        continue;
      }
      const gateArgs = ["--agent", flags.agent, "--topic", suggestion.topic, "--category", suggestion.category, "--json", "--env", flags.env, "--scan-cache", getStateFilePath(state)];
      const gResult = await runToolAndParse("cli/gate.ts", gateArgs, "gate.ts");
      const gateEval = normalizeGateResult(gResult);
      if (shouldAutoPassGate(gResult, gateEval)) {
        info(`Reasoning PASS: ${suggestion.topic} (${gateEval.passed}/${gateEval.total})`);
        gatePosts.push({
          topic: suggestion.topic,
          category: suggestion.category,
          text: "",
          confidence: 0,
          gateResult: gResult,
        });
        break; // One reasoning-backed topic is enough
      }
    }
  }

  // Fallback guarantee: if all gate checks fail, pick agent's top primary topic
  // and bypass gate entirely. Every session should produce at least 1 post.
  if (gatePosts.length === 0) {
    const primaryTopics = agentConfig.topics?.primary || [];
    if (primaryTopics.length > 0) {
      const fallbackTopic = primaryTopics[0];
      // Verify source exists for fallback topic before committing
      const fallbackPreflight = sourcesPreflight(fallbackTopic, sourceView, agentConfig);
      if (fallbackPreflight.pass) {
        info(`Fallback: primary topic "${fallbackTopic}", gate bypassed`);
        observe("insight", `Gate fallback: all checks failed, using primary topic "${fallbackTopic}"`, {
          phase: "act", substage: "gate", source: "session-runner.ts:gate-fallback",
        });
        gatePosts.push({
          topic: fallbackTopic,
          category: "ANALYSIS",
          text: "",
          confidence: 0,
          gateResult: { items: [], summary: { pass: 0, fail: 0, manual: 0, warning: 0, total: 0, recommendation: "FALLBACK — primary topic, gate bypassed" } },
        });
      } else {
        info(`Fallback: primary topic "${fallbackTopic}" has no matching source — cannot publish`);
      }
    }
  }

  if (gatePosts.length === 0) phaseSkipped("No topics passed auto-gate");
  else phaseResult(`${gatePosts.length} topic(s) auto-gated`);
  const result = { posts: gatePosts };
  if (!isV2(state)) completePhase(state, "gate", result);
  return result;
}

// ── PUBLISH Phase ──────────────────────────────────

/** PUBLISH: full/approve oversight — manual with log capture */
async function runPublishManual(
  state: AnySessionState,
  flags: RunnerFlags,
  rl: ReturnType<typeof createInterface>
): Promise<{ txHashes: string[] }> {
  const gateResult = getGateResult(state) || { posts: [] };
  const gatePosts = gateResult.posts || [];

  if (gatePosts.length === 0) {
    phaseSkipped("No posts gated — nothing to publish");
    const result = { txHashes: [] as string[] };
    if (!isV2(state)) completePhase(state, "publish", result);
    return result;
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
        text_length: (gp.text || "").length,
        tags: [],
      },
      flags.log
    );
    existingTxHashes.add(txHash);
    info(`Logged ${txHash.slice(0, 16)}...`);

    publishedHashes.push(txHash);
    state.posts.push(txHash);

    // Build partial PublishedPostRecord for afterConfirm hooks (PR1)
    const v2State = state as import("../src/lib/state.js").V2SessionState;
    if (!v2State.publishedPosts) v2State.publishedPosts = [];
    // Manual flow cannot recover the operator's final published text/category/tags,
    // so afterConfirm hooks receive the gated suggestion rather than the exact post.
    v2State.publishedPosts.push({
      txHash,
      topic: gp.topic || "",
      category: gp.category || "ANALYSIS",
      text: gp.text || "",
      confidence: gp.confidence || 0,
      predictedReactions: predicted,
      tags: [],
      publishedAt: new Date().toISOString(),
      attestationType: "unknown",
    });
    saveState(state);
  }

  phaseResult(`${publishedHashes.length} post(s) captured`);
  const result = { txHashes: publishedHashes };
  if (!isV2(state)) completePhase(state, "publish", result);
  return result;
}

/** PUBLISH: autonomous oversight — LLM text gen + attestation + publish */
async function runPublishAutonomous(
  state: AnySessionState,
  flags: RunnerFlags,
  extensionRegistry: ExtensionHookRegistry,
  transcript?: TranscriptContext,
): Promise<{ txHashes: string[]; sourceRelevance: SourceRelevanceEntry[] }> {
  const gateResult = getGateResult(state) || { posts: [] };
  const gatePosts: GatePost[] = gateResult.posts || [];
  const scanResult = getScanResult(state) || {};

  if (gatePosts.length === 0) {
    phaseSkipped("No posts gated — nothing to publish");
    const result = { txHashes: [] as string[], sourceRelevance: [] as SourceRelevanceEntry[] };
    if (!isV2(state)) completePhase(state, "publish", result);
    return result;
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
  const { demos, address: walletAddress } = await connectWallet(flags.env);

  // Load source view (cached per session — shared with gate phase)
  const sourceView = getSourceView();

  // Load declarative provider adapters for claim-driven attestation
  const declarativeAdapters = loadDeclarativeProviderAdaptersSync({
    specDir: resolve(dirname(fileURLToPath(import.meta.url)), "../src/lib/sources/providers/specs"),
  });

  let existingLog: any[] = [];
  try {
    existingLog = readSessionLog(flags.log);
  } catch { /* non-fatal */ }
  const existingTxHashes = new Set(existingLog.map((e: any) => e.txHash));
  const publishedHashes: string[] = [];

  // Per-topic publish ledger — tracks status for resume and reporting
  type TopicLedgerEntry = { topic: string; category: string; status: "published" | "skipped" | "failed"; txHash?: string; error?: string };
  const topicLedger: TopicLedgerEntry[] = [];
  const sourceRelevance: SourceRelevanceEntry[] = [];

  // Resolve enabled extensions for hook dispatch
  const enabledExtensions = agentConfig.loopExtensions;
  const writeRateStore = new FileStateStore();

  // Source usage tracker — penalizes repeated source selection within a session
  const usageTracker = createUsageTracker();

  for (const gp of gatePosts) {
    try {
      // Step -1: Write rate limit check (PR1 — before any work for this topic)
      const rateError = await checkAndRecordWrite(writeRateStore, walletAddress, false);
      if (rateError) {
        const remaining = await getWriteRateRemaining(writeRateStore, walletAddress);
        observe("insight", `Write rate limit reached for "${gp.topic}": ${rateError.message}`, {
          phase: "publish", substage: "publish",
          source: "session-runner.ts:runPublishAutonomous",
          data: { topic: gp.topic, dailyRemaining: remaining.dailyRemaining, hourlyRemaining: remaining.hourlyRemaining },
        });
        info(`Rate limit SKIP: ${gp.topic} — ${rateError.message} (daily: ${remaining.dailyRemaining}, hourly: ${remaining.hourlyRemaining})`);
        topicLedger.push({ topic: gp.topic, category: gp.category, status: "skipped", error: rateError.message });
        continue;
      }

      // Step 0: Preflight via extension hooks (Phase 4 — adapter-based URL generation)
      const preflightDecision = await runBeforePublishDraft(extensionRegistry, enabledExtensions, {
        topic: gp.topic,
        category: gp.category || "ANALYSIS",
        config: agentConfig,
        state,
        sourceView,
      });
      if (preflightDecision && !preflightDecision.pass) {
        observe("insight", `Preflight rejected topic "${gp.topic}": ${preflightDecision.reason}`, {
          phase: "publish",
          substage: "publish",
          source: "session-runner.ts:runPublishAutonomous",
          data: { topic: gp.topic, reasonCode: preflightDecision.reasonCode },
        });
        info(`Preflight SKIP: ${gp.topic} — ${preflightDecision.reason} (${preflightDecision.reasonCode})`);
        topicLedger.push({ topic: gp.topic, category: gp.category, status: "skipped", error: `preflight: ${preflightDecision.reason}` });
        continue;
      }

      // Step 1: Generate post text via LLM
      const provider = resolveProvider(flags.env);
      if (!provider) {
        throw new Error("Autonomous publish requires an LLM provider. Set LLM_PROVIDER or ANTHROPIC_API_KEY.");
      }
      info(`Generating text for "${gp.topic}" via ${provider.name}...`);
      // PR1: Build signal context for LLM from snapshot
      const signalSnapshot = (state as any).signalSnapshot as SignalSnapshot | undefined;
      let signalContext: { direction: string; confidence: number; agentCount: number; divergence: boolean } | undefined;
      if (signalSnapshot) {
        const topicLower = gp.topic.toLowerCase();
        const matchedSignal = signalSnapshot.topics.find(s =>
          topicLower.includes(s.topic.toLowerCase()) || s.topic.toLowerCase().includes(topicLower)
        );
        if (matchedSignal) {
          signalContext = {
            direction: matchedSignal.direction,
            confidence: matchedSignal.confidence,
            agentCount: matchedSignal.agentCount,
            divergence: matchedSignal.divergence,
          };
        }
      }

      // Pre-fetch source data for LLM context (before generation, not after)
      // The response is cached in prefetchedResponses to avoid double-fetching in match()
      // Falls back to next preflight candidate on failure (Improvement 5)
      let attestedData: { source: string; url: string; summary: string } | undefined;
      const prefetchedResponses = new Map<string, any>();
      const candidates = preflightDecision?.candidates || [];
      // Import once before loop (not per-candidate)
      let fetchSourceFn: typeof import("../src/lib/sources/fetch.js")["fetchSource"] | null = null;
      let getAdapterFn: typeof import("../src/lib/sources/providers/index.js")["getProviderAdapter"] | null = null;
      if (candidates.length > 0) {
        fetchSourceFn = (await import("../src/lib/sources/fetch.js")).fetchSource;
        getAdapterFn = (await import("../src/lib/sources/providers/index.js")).getProviderAdapter;
      }
      for (let ci = 0; ci < Math.min(candidates.length, 3) && !attestedData; ci++) {
        const candidate = candidates[ci];
        try {
          const adapter = getAdapterFn!(candidate.source.provider);
          const fetchResult = await fetchSourceFn!(candidate.url, candidate.source, {
            rateLimitBucket: adapter?.rateLimit.bucket,
            rateLimitRpm: adapter?.rateLimit.maxPerMinute,
            rateLimitRpd: adapter?.rateLimit.maxPerDay,
          });
          if (fetchResult.ok && fetchResult.response) {
            prefetchedResponses.set(candidate.url, fetchResult.response);

            let summary: string;
            try {
              const parsed = adapter?.parseResponse(candidate.source, fetchResult.response);
              if (parsed && parsed.entries.length > 0) {
                summary = parsed.entries.slice(0, 5).map((e: any) => {
                  const parts: string[] = [];
                  if (e.title) parts.push(e.title);
                  if (e.bodyText && e.bodyText !== e.title) parts.push(e.bodyText.slice(0, 200));
                  if (e.metrics) parts.push(`Metrics: ${JSON.stringify(e.metrics)}`);
                  return parts.join(" — ");
                }).join("\n");
              } else {
                summary = fetchResult.response.bodyText.slice(0, 800);
              }
            } catch {
              summary = fetchResult.response.bodyText.slice(0, 800);
            }

            // Reject source data too thin for LLM to generate quality output
            const MIN_SOURCE_CHARS = 50;
            if (summary.length < MIN_SOURCE_CHARS) {
              info(`Source data too thin for "${candidate.sourceId}" (${summary.length} chars < ${MIN_SOURCE_CHARS})${ci < candidates.length - 1 ? " — trying next candidate" : ""}`);
              continue;
            }

            attestedData = {
              source: candidate.source.name || candidate.sourceId,
              url: candidate.url,
              summary,
            };
            info(`Source data fetched for LLM: ${attestedData.source} (${summary.length} chars)${ci > 0 ? ` [fallback #${ci}]` : ""}`);
          } else {
            info(`Source pre-fetch returned ok=false for "${candidate.sourceId}": ${fetchResult.error || "unknown"}${ci < candidates.length - 1 ? " — trying next candidate" : ""}`);
          }
        } catch (e: any) {
          info(`Source pre-fetch failed for "${candidate.sourceId}" (non-fatal): ${e.message}${ci < candidates.length - 1 ? " — trying next candidate" : ""}`);
          if (ci > 0) {
            observe("insight", `Pre-fetch fallback #${ci} for "${gp.topic}": ${e.message}`, {
              phase: "publish", substage: "publish",
              source: "session-runner.ts:runPublishAutonomous",
              data: { topic: gp.topic, candidateIndex: ci, sourceId: candidate.sourceId },
            });
          }
        }
      }

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
          signalContext,
          briefingContext: (state as any).briefingContext as string | undefined,
          attestedData,
          replyTo: gp.replyTo,
        },
        provider,
        {
          personaMdPath: agentConfig.paths.personaMd,
          strategyYamlPath: agentConfig.paths.strategyYaml,
          agentName: agentConfig.name,
        }
      );

      const targetCategory = (gp.category || (agentConfig.gate.mode === "pioneer" ? "QUESTION" : "ANALYSIS")).toUpperCase();
      if (draft.category.toUpperCase() !== targetCategory) {
        info(`Category override: LLM=${draft.category} -> gate=${targetCategory} for topic "${gp.topic}"`);
        draft.category = targetCategory as PostDraft["category"];
      }

      // Hard quality checks before any publish attempt.
      if (draft.text.length < 200) {
        throw new Error(`Rejected draft: text too short (${draft.text.length} chars, need >=200)`);
      }
      if (draft.predicted_reactions < (agentConfig.gate.predictedReactionsThreshold || 0)) {
        throw new Error(
          `Rejected draft: predicted reactions ${draft.predicted_reactions} below threshold ${agentConfig.gate.predictedReactionsThreshold}`
        );
      }
      if (agentConfig.gate.mode === "pioneer" && draft.category === "QUESTION" && !/\?/.test(draft.text)) {
        throw new Error(`Rejected draft: QUESTION category requires at least one question mark`);
      }

      // Hybrid quality score (parallel logger — data collection, not blocking yet)
      const isReplyPost = !!gp.replyTo?.txHash;
      const qualityResult = calculateQualityScore({
        text: draft.text,
        isReply: isReplyPost,
        hasAttestation: false, // not yet attested at this point — updated post-attestation
      });

      console.log(`\n  LLM draft for "${gp.topic}":`);
      console.log(`    Category: ${draft.category}`);
      console.log(`    Text: ${draft.text.slice(0, 120)}...`);
      console.log(`    Tags: ${draft.tags.join(", ")}`);
      console.log(`    Confidence: ${draft.confidence}`);
      console.log(`    Predicted: ${draft.predicted_reactions} reactions`);
      console.log(`    Quality: ${qualityResult.score}/${qualityResult.maxScore} (attest=${qualityResult.attestationGate}) [${Object.entries(qualityResult.breakdown).filter(([,v]) => v !== 0).map(([k,v]) => `${k}:${v > 0 ? '+' : ''}${v}`).join(', ')}]`);

      // Quality data logged post-publish (below) with txHash for join capability

      // Step 2: Post-generation source matching via extension hooks (Phase 4)
      const matchDecision = await runAfterPublishDraft(extensionRegistry, enabledExtensions, {
        topic: gp.topic,
        postText: draft.text,
        postTags: draft.tags,
        category: draft.category,
        config: agentConfig,
        state,
        preflightCandidates: preflightDecision?.candidates,
        sourceView,
        llm: provider,
        prefetchedResponses: prefetchedResponses.size > 0 ? prefetchedResponses : undefined,
        transcript,
      });
      if (matchDecision?.considered?.length) {
        sourceRelevance.push(...matchDecision.considered);
      }

      // Resolve source selection from match/preflight/legacy
      //
      // Three cases:
      //   1. matchDecision.pass=true → use match result (evidence-backed)
      //   2. matchDecision.pass=false → SKIP publish (post not substantiated)
      //   3. matchDecision=undefined → no sources extension; use preflight or legacy
      let selectedUrl: string;
      let selectedMethod: AttestationType;
      let selectedSourceName: string;

      if (matchDecision?.pass && matchDecision.best) {
        // Case 1: Evidence-based match succeeded
        selectedUrl = matchDecision.best.url;
        selectedMethod = matchDecision.best.method;
        selectedSourceName = matchDecision.best.sourceId;
        info(`Match PASS: source "${selectedSourceName}" score ${matchDecision.best.score} for "${gp.topic}"`);
      } else if (matchDecision && !matchDecision.pass) {
        // Case 2: Match explicitly failed — skip publish (P0 fix: don't fall through)
        observe("insight", `Match rejected post for "${gp.topic}": ${matchDecision.reason}`, {
          phase: "publish",
          substage: "publish",
          source: "session-runner.ts:runPublishAutonomous",
          data: { topic: gp.topic, reasonCode: matchDecision.reasonCode },
        });
        info(`Match SKIP: ${gp.topic} — ${matchDecision.reason}`);
        topicLedger.push({ topic: gp.topic, category: gp.category, status: "skipped", error: `match: ${matchDecision.reason}` });
        continue;
      } else if (preflightDecision?.candidates && preflightDecision.candidates.length > 0) {
        // Case 3a: No match extension — use preflight's best candidate
        const best = preflightDecision.candidates[0];
        selectedUrl = best.url;
        selectedMethod = best.method;
        selectedSourceName = best.source?.name || best.sourceId;
      } else {
        // Case 3b: No hooks returned anything — legacy direct lookup
        const plan = resolveAttestationPlan(gp.topic, agentConfig);
        const legacySelection = selectSourceForTopicV2(gp.topic, sourceView, plan.required);
        if (!legacySelection) {
          observe("insight", `No source for topic "${gp.topic}" after all lookups`, {
            phase: "publish",
            substage: "publish",
            source: "session-runner.ts:runPublishAutonomous",
            data: { topic: gp.topic, reasonCode: "PUBLISH_NO_MATCHING_SOURCE" },
          });
          throw new Error(`No matching source for topic "${gp.topic}"`);
        }
        selectedUrl = legacySelection.url;
        selectedMethod = plan.required;
        selectedSourceName = legacySelection.source.name;
      }

      info(`Attesting (${selectedMethod}) source "${selectedSourceName}" for topic "${gp.topic}"`);

      // ── Claim-driven attestation (additive, between match and publish) ──
      // Extract claims from draft text, build surgical attestation plan,
      // execute per-claim attestations, verify values. Falls back to existing
      // single-attestation path when no surgical candidates exist.
      let claimAttestedResults: AttestResult[] | null = null;
      try {
        const claims = await extractStructuredClaimsAuto(draft.text, provider);
        if (claims.length > 0) {
          const claimPlan = buildAttestationPlan(claims, sourceView, agentConfig, declarativeAdapters, usageTracker);
          if (claimPlan) {
            info(`Claim plan: ${1 + claimPlan.secondary.length} attestations (${claimPlan.unattested.length} unattested), est ${claimPlan.estimatedCost} DEM`);
            const execution = await executeAttestationPlan(claimPlan, demos, {
              attestationMode: agentConfig.attestation.defaultMode,
            });
            if (execution.results.length > 0) {
              const allCandidates = [claimPlan.primary, ...claimPlan.secondary];
              const verifications = verifyAttestedValues(execution.results, allCandidates);
              const anyFailed = verifications.some((v) => !v.verified);
              if (anyFailed) {
                const failures = verifications.filter((v) => !v.verified);
                info(`Claim verification failed (${failures.length}): ${failures.map((f) => f.failureReason).join("; ")} — falling back to source attestation`);
                observe("insight", `Claim verification failed, falling back`, {
                  phase: "publish",
                  substage: "publish",
                  source: "session-runner.ts:claimAttestation",
                  data: { topic: gp.topic, failures: failures.map((f) => f.failureReason) },
                });
              } else {
                claimAttestedResults = execution.results;
                info(`Claim attestation succeeded: ${execution.results.length} attestations verified`);
              }
            }
          }
        }
      } catch (err: any) {
        // Claim-driven attestation is additive — never block publish on failure
        // But log as observe() so broken claim mode is detectable in session review
        const errMsg = String(err?.message || err);
        info(`Claim attestation error (non-fatal): ${errMsg}`);
        observe("error", `Claim attestation failed: ${errMsg}`, {
          phase: "publish",
          substage: "publish",
          source: "session-runner.ts:claimAttestation",
          data: { topic: gp.topic, error: errMsg },
        });
      }

      let attested: AttestResult;
      let pubResult: PublishResult;

      if (claimAttestedResults && claimAttestedResults.length > 0) {
        // Claim-driven path: use multi-attestation results
        attested = claimAttestedResults[0]; // Primary for reporting
        const published = await publishPost(
          demos,
          {
            text: draft.text,
            category: draft.category,
            tags: draft.tags,
            confidence: draft.confidence,
            replyTo: draft.replyTo,
            sourceAttestations: claimAttestedResults
              .filter((a) => a.type === "dahr")
              .map((a) => ({
                url: a.url,
                responseHash: String(a.responseHash || ""),
                txHash: a.txHash,
                timestamp: Date.now(),
              })),
            tlsnAttestations: claimAttestedResults
              .filter((a) => a.type === "tlsn")
              .map((a) => ({
                url: a.url,
                txHash: a.txHash,
                timestamp: Date.now(),
              })),
          },
          { skipIndexerCheck: true }
        );
        pubResult = { ...published, attestation: attested };
      } else {
        // Existing single-attestation path (fallback)
        if (selectedMethod === "TLSN") {
          try {
            attested = await attestTlsn(demos, selectedUrl);
          } catch (err: any) {
            // Try DAHR fallback if available
            const plan = resolveAttestationPlan(gp.topic, agentConfig);
            const fallbackCandidate = preflightDecision?.candidates?.find(
              (c: any) => c.method === "DAHR"
            );
            if (plan.fallback === "DAHR" && fallbackCandidate) {
              info(`TLSN failed (${String(err?.message || err)}), falling back to DAHR`);
              selectedUrl = fallbackCandidate.url;
              selectedMethod = "DAHR";
              attested = await attestDahr(demos, selectedUrl);
            } else {
              throw err;
            }
          }
        } else {
          attested = await attestDahr(demos, selectedUrl);
        }

        const published = await publishPost(
          demos,
          {
            text: draft.text,
            category: draft.category,
            tags: draft.tags,
            confidence: draft.confidence,
            replyTo: draft.replyTo,
            sourceAttestations: attested.type === "dahr" ? [{
              url: attested.url,
              responseHash: String(attested.responseHash || ""),
              txHash: attested.txHash,
              timestamp: Date.now(),
            }] : undefined,
            tlsnAttestations: attested.type === "tlsn" ? [{
              url: attested.url,
              txHash: attested.txHash,
              timestamp: Date.now(),
            }] : undefined,
          },
          { skipIndexerCheck: true }
        );
        pubResult = { ...published, attestation: attested };
      }
      for (const warning of pubResult.warnings || []) {
        info(`Publish warning: ${warning}`);
      }

      phaseResult(`Published: ${pubResult.txHash.slice(0, 16)}... (${pubResult.category}, ${pubResult.textLength} chars)`);

      // Step 4: Log to session log
      if (!existingTxHashes.has(pubResult.txHash)) {
        appendSessionLog(
          {
            timestamp: new Date().toISOString(),
            txHash: pubResult.txHash,
            category: draft.category,
            attestation_type: pubResult.attestation
              ? (pubResult.attestation.type === "tlsn" ? "TLSN" : "DAHR")
              : "none",
            attestation_url: pubResult.attestation?.url,
            attestation_requested_url: pubResult.attestation?.requestedUrl,
            hypothesis: draft.hypothesis || "",
            predicted_reactions: draft.predicted_reactions,
            agents_referenced: [],
            topic: gp.topic,
            confidence: draft.confidence,
            text_preview: draft.text.slice(0, 100),
            text_length: draft.text.length,
            tags: draft.tags,
          },
          flags.log
        );
        existingTxHashes.add(pubResult.txHash);
      }

      // Persist quality data post-publish with txHash for correlation join
      logQualityData({
        timestamp: new Date().toISOString(),
        agent: flags.agent,
        topic: gp.topic,
        category: draft.category,
        quality_score: qualityResult.score,
        quality_max: qualityResult.maxScore,
        quality_breakdown: qualityResult.breakdown,
        predicted_reactions: draft.predicted_reactions,
        confidence: draft.confidence,
        text_length: draft.text.length,
        isReply: isReplyPost,
        hasAttestation: !!pubResult.attestation,
        txHash: pubResult.txHash,
      });

      // Record publish in write-rate ledger (PR1 — persistent tracking)
      const recordError = await checkAndRecordWrite(writeRateStore, walletAddress, true);
      if (recordError) {
        info(`Warning: failed to record publish in rate limiter: ${recordError.message}`);
      }

      publishedHashes.push(pubResult.txHash);
      state.posts.push(pubResult.txHash);
      topicLedger.push({ topic: gp.topic, category: gp.category, status: "published", txHash: pubResult.txHash });

      // Build full PublishedPostRecord for afterConfirm hooks (PR1)
      const v2State = state as import("../src/lib/state.js").V2SessionState;
      if (!v2State.publishedPosts) v2State.publishedPosts = [];
      v2State.publishedPosts.push({
        txHash: pubResult.txHash,
        topic: gp.topic,
        category: draft.category,
        text: draft.text,
        confidence: draft.confidence,
        predictedReactions: draft.predicted_reactions,
        hypothesis: draft.hypothesis,
        tags: draft.tags,
        replyTo: draft.replyTo,
        publishedAt: new Date().toISOString(),
        attestationType: selectedMethod,
      });
      saveState(state);
    } catch (e: any) {
      // Classify the publish failure for observability
      const msg = e.message || "";
      let failureCode: SubstageFailureCode = "PUBLISH_BROADCAST_FAIL";
      if (msg.includes("TLSN") || msg.includes("timeout")) failureCode = "PUBLISH_TLSN_TIMEOUT";
      else if (msg.includes("DAHR") || msg.includes("HTTP")) failureCode = "PUBLISH_DAHR_REJECT";
      else if (msg.includes("No matching") || msg.includes("no attestable")) failureCode = "PUBLISH_NO_MATCHING_SOURCE";
      else if (msg.includes("LLM") || msg.includes("provider")) failureCode = "PUBLISH_LLM_FAIL";

      observe("error", `Publish failed for "${gp.topic}": ${msg}`, {
        phase: "publish",
        substage: "publish",
        source: "session-runner.ts:runPublishAutonomous",
        data: { topic: gp.topic, failureCode },
      });
      phaseError(`Failed to auto-publish "${gp.topic}": ${e.message}`);
      topicLedger.push({ topic: gp.topic, category: gp.category, status: "failed", error: e.message });
      // Continue with next post — don't fail entire phase
    }
  }

  phaseResult(`${publishedHashes.length}/${gatePosts.length} post(s) auto-published`);

  if (publishedHashes.length === 0 && gatePosts.length > 0) {
    if (!isV2(state)) failPhase(state, "publish", `All ${gatePosts.length} posts failed to publish`);
    throw new Error(`Autonomous publish failed: 0/${gatePosts.length} posts succeeded`);
  }

  const result = { txHashes: publishedHashes, topicLedger, sourceRelevance };
  if (!isV2(state)) completePhase(state, "publish", result);
  return result;
}

// ── VERIFY Phase ───────────────────────────────────

async function runVerify(state: SessionState, flags: RunnerFlags): Promise<void> {
  if (state.posts.length === 0) {
    phaseSkipped("No posts to verify — skipping");
    completePhase(state, "verify", { skipped: true, reason: "no posts" });
    return;
  }

  const args = [...state.posts, "--json", "--log", flags.log, "--env", flags.env];
  const result = await runToolAndParse("cli/verify.ts", args, "verify.ts");

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
      await runToolWithBackend("cli/improvements.ts", impArgs, {
        cwd: REPO_ROOT,
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
  const result = await runToolAndParse("cli/session-review.ts", args, "session-review.ts");

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
      await runToolAndParse("cli/improvements.ts", impArgs, "improvements.ts propose");
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
  const result = await runToolAndParse("cli/session-review.ts", args, "session-review.ts");

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

const MAX_HARDEN_FINDINGS = 10;
const SENSE_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

/** Collect findings from REVIEW result + session state, capped at MAX_HARDEN_FINDINGS.
 *  Phase errors are always included regardless of cap. */
function collectHardenFindings(state: SessionState): HardenFinding[] {
  const findings: HardenFinding[] = [];
  const phaseErrors: HardenFinding[] = [];
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

  // Phase errors from current session — always included, never capped
  const phases = getPhaseOrder() as PhaseName[];
  for (const phase of phases) {
    if (phase === "harden") continue;
    const p = state.phases[phase as PhaseName];
    if (p?.status === "failed" && p.error) {
      const subtype = phase === "gate" ? "gate_fail" : phase === "publish" ? "publish_error" : "attest_error";
      phaseErrors.push({
        source: "phase_error",
        type: classifyFinding("phase_error", subtype),
        text: `Phase ${phase.toUpperCase()} failed: ${p.error}`,
        rawData: { phase, error: p.error },
      });
    }
  }

  // Cap non-phase_error findings, prioritize by source: q1 > q2 > q3 > q4
  const capped = findings.slice(0, MAX_HARDEN_FINDINGS);
  if (findings.length > MAX_HARDEN_FINDINGS) {
    info(`Harden: capped findings from ${findings.length} to ${MAX_HARDEN_FINDINGS} (${phaseErrors.length} phase_errors exempt)`);
  }

  return [...phaseErrors, ...capped];
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
    // Strip markdown code fences
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    // Strip PAI mode headers (claude --print may wrap output in PAI format)
    const jsonMatch = jsonStr.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
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
  await runToolWithBackend("cli/improvements.ts", impArgs, {
    cwd: REPO_ROOT,
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

/** HARDEN: autonomous oversight — classify + log findings, skip proposal subprocess for speed */
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

  // In autonomous mode: log all findings but skip proposeImprovement subprocess calls.
  // Findings are captured in the session report via completePhase result.
  for (const f of findings) {
    if (f.type === "INFO") {
      skipped++;
      continue;
    }

    if (f.type === "STRATEGY") {
      proposed++;
      info(`[log-only] STRATEGY: ${f.text.slice(0, 80)}`);
      continue;
    }

    // CODE-FIX, GUARDRAIL, GOTCHA, PLAYBOOK — log as actionable
    actionable++;
    info(`[log-only] ${f.type}: ${f.text.slice(0, 80)}`);
  }

  phaseResult(`${findings.length} findings: ${actionable} actionable, ${proposed} strategy, ${skipped} skipped (log-only, no proposals)`);
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
  const budgetMs = getPhaseBudgetMs(phase, agentConfig);
  const overBudget = budgetMs > 0 && ms > budgetMs;
  const suffix = overBudget ? ` ⚠️ +${Math.round(((ms - budgetMs) / budgetMs) * 100)}% over budget` : "";
  return ` (${(ms / 60000).toFixed(1)} min${suffix})`;
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

// ── V2 Loop ─────────────────────────────────────────

function v2PhaseHeader(phase: CorePhase, substage?: string): void {
  const idx = CORE_PHASE_ORDER.indexOf(phase) + 1;
  const label = substage ? `${phase.toUpperCase()} → ${substage.toUpperCase()}` : phase.toUpperCase();
  console.log(`\nPhase ${idx}/${CORE_PHASE_ORDER.length}: ${label}`);
}

async function runV2Loop(
  state: V2SessionState,
  flags: RunnerFlags,
  sessionsDir: string,
  rl: ReturnType<typeof createInterface> | null,
  extensionRegistry: ExtensionHookRegistry
): Promise<void> {
  // Determine which phases to skip on resume
  const senseCompleted = state.phases.sense?.status === "completed";
  const actCompleted = state.phases.act?.status === "completed";

  // Extension hooks: beforeSense (e.g., calibrate runs audit)
  // Each hook is isolated with its own try/catch and timeout (see extensions.ts)
  if (!senseCompleted) {
    const hookCtx: BeforeSenseContext = {
      state,
      config: agentConfig,
      flags: { agent: flags.agent, env: flags.env, log: flags.log, dryRun: flags.dryRun, pretty: flags.pretty },
      logger: hookLogger,
    };
    await runBeforeSense(extensionRegistry, agentConfig.loopExtensions, hookCtx);

    // Log any hook failures/timeouts as observations
    for (const err of hookCtx.hookErrors || []) {
      const label = err.isTimeout ? "timeout" : "error";
      observe(err.isTimeout ? "inefficiency" : "error", `beforeSense hook "${err.hook}" ${label}: ${err.error}`, {
        phase: "sense", substage: "beforeSense",
        source: "session-runner.ts:runV2Loop",
        data: { hook: err.hook, elapsed: err.elapsed, isTimeout: err.isTimeout },
      });
      phaseError(`beforeSense hook "${err.hook}" ${label} (${err.elapsed}ms, non-critical)`);
    }
  }

  // ── SENSE ──────────────────────────────────────
  // Cache: if sense has a fresh result from a prior failed attempt (<5 min old), reuse it
  const senseCacheAgeMs = state.phases.sense?.startedAt
    ? Date.now() - new Date(state.phases.sense.startedAt).getTime()
    : Infinity;
  const senseHasFreshCache = !senseCompleted
    && state.phases.sense?.result
    && state.phases.sense?.startedAt
    && senseCacheAgeMs < SENSE_CACHE_MAX_AGE_MS;

  if (senseCompleted) {
    info("SENSE already completed — skipping (resume)");
  } else if (senseHasFreshCache) {
    info(`SENSE cache fresh (${Math.round(senseCacheAgeMs / 1000)}s old) — reusing cached results`);
    const cachedResult = state.phases.sense!.result;
    const level = cachedResult.activity?.level || "unknown";
    const gapCount = cachedResult.gaps?.topics?.length || 0;
    phaseResult(`${level} activity (cached) | ${gapCount} gap topics found`);
    completePhase(state, "sense" as any, cachedResult, sessionsDir);
  } else {
    v2PhaseHeader("sense");
    setObserverPhase("sense");
    beginPhase(state, "sense" as any, sessionsDir);
    const senseStartMs = Date.now();
    try {
      const scanArgs = ["--agent", flags.agent, "--json", "--env", flags.env];
      const scanResult = await runToolAndParse("cli/scan-feed.ts", scanArgs, "scan-feed.ts (SENSE)");

      const level = scanResult.activity?.level || "unknown";
      const pph = scanResult.activity?.posts_per_hour ?? "?";
      const gapCount = scanResult.gaps?.topics?.length || 0;
      phaseResult(`${level} activity (${pph} posts/hr) | ${gapCount} gap topics found`);

      observe("insight", `SENSE complete: ${level} activity, ${gapCount} gaps`, {
        phase: "sense",
        source: "session-runner.ts:runV2Loop",
      });

      completePhase(state, "sense" as any, scanResult, sessionsDir);
    } catch (e: any) {
      observe("error", `SENSE failed: ${e.message}`, { phase: "sense", source: "session-runner.ts:runV2Loop" });
      failPhase(state, "sense" as any, e.message, sessionsDir);
      throw e;
    }

    checkV2PhaseBudget("sense", Date.now() - senseStartMs);
  }

  // ── ACT ────────────────────────────────────────
  if (actCompleted) {
    info("ACT already completed — skipping (resume)");
  } else {
  v2PhaseHeader("act");
  setObserverPhase("act");
  beginPhase(state, "act" as any, sessionsDir);
  const actStartMs = Date.now();

  // Restore substages from persisted state on resume, or start fresh
  const substages: ActSubstageState[] = (state.substages && state.substages.length > 0)
    ? state.substages.map(s => ({ ...s }))
    : [];

  function ensureSubstage(name: "engage" | "gate" | "publish"): ActSubstageState {
    const existing = substages.find(s => s.substage === name);
    if (existing) return existing;
    const created = createSubstage(name);
    substages.push(created);
    return created;
  }

  let engageResult: any = {};
  let gateResult: any = { posts: [] };
  let publishResult: any = { txHashes: [] };

  // ACT substage 1: ENGAGE
  const engageSub = ensureSubstage("engage");
  if (engageSub.status === "completed") {
    engageResult = engageSub.result || {};
    info("ACT/engage already completed — skipping (resume)");
  } else if (engageSub.status === "skipped") {
    info("ACT/engage already skipped — skipping (resume)");
  } else {
    try {
      v2PhaseHeader("act", "engage");
      startSubstage(engageSub);
      const args = ["--agent", flags.agent, "--max", String(agentConfig.engagement.maxReactionsPerSession), "--json", "--env", flags.env];
      engageResult = await runToolAndParse("cli/engage.ts", args, "engage.ts (ACT/engage)");
      phaseResult(
        `${engageResult.reactions_cast || 0} reactions (${engageResult.agrees || 0} agree, ${engageResult.disagrees || 0} disagree)`
      );
      state.engagements = engageResult.targets || [];
      completeSubstage(engageSub, engageResult);
      // Bridge substage result to state.phases.act.result for getEngageResult()
      if (isV2(state)) {
        if (!state.phases.act.result) state.phases.act.result = {};
        state.phases.act.result.engage = engageResult;
      }
      state.substages = substages;
      saveState(state, sessionsDir);
    } catch (e: any) {
      // engage fails → continue to gate (non-critical)
      failSubstage(engageSub, e.message);
      state.substages = substages;
      saveState(state, sessionsDir);
      observe("error", `ACT/engage failed: ${e.message}`, { phase: "act", substage: "engage", source: "session-runner.ts:runV2Loop" });
      phaseError(`Engage failed (non-critical): ${e.message}`);
    }
  }

  // ACT substage 2: GATE
  const gateSub = ensureSubstage("gate");
  if (gateSub.status === "completed") {
    gateResult = gateSub.result || getGateResult(state) || { posts: [] };
    // Bridge on resume too — getGateResult reads state.phases.act.result.gate
    if (isV2(state)) {
      if (!state.phases.act.result) state.phases.act.result = {};
      state.phases.act.result.gate = gateResult;
    }
    info("ACT/gate already completed — skipping (resume)");
  } else {
    try {
      v2PhaseHeader("act", "gate");
      startSubstage(gateSub);
      if (flags.oversight === "full" && rl) {
        gateResult = await runGateAutonomous(state, flags);
      } else if (flags.oversight === "approve" && rl) {
        gateResult = await runGateApprove(state, flags, rl);
      } else {
        gateResult = await runGateAutonomous(state, flags);
      }
      completeSubstage(gateSub, gateResult);
      // Publish reads gate result via getGateResult → state.phases.act.result.gate.
      // completeSubstage stores in substage object only — bridge to state so
      // runPublishAutonomous/runPublishManual can find the gated posts.
      if (isV2(state)) {
        if (!state.phases.act.result) state.phases.act.result = {};
        state.phases.act.result.gate = gateResult;
      }
      state.substages = substages;
      saveState(state, sessionsDir);
    } catch (e: any) {
      // gate fails → skip publish
      failSubstage(gateSub, e.message);
      state.substages = substages;
      saveState(state, sessionsDir);
      observe("error", `ACT/gate failed: ${e.message}`, { phase: "act", substage: "gate", source: "session-runner.ts:runV2Loop" });
      phaseError(`Gate failed: ${e.message} — skipping publish`);
    }
  }

  // ACT substage 3: PUBLISH
  const publishSub = ensureSubstage("publish");
  if (publishSub.status === "completed" || publishSub.status === "skipped") {
    publishResult = publishSub.result || { txHashes: [] };
    info(`ACT/publish already ${publishSub.status} — skipping (resume)`);
  } else if (flags.shadow) {
    // Shadow mode: hard skip — no LLM calls, no wallet, no API
    skipSubstage(publishSub);
    state.publishSuppressed = true;
    observe("insight", "Publish skipped (shadow mode)", { phase: "act", substage: "publish", source: "session-runner.ts:runV2Loop" });
    phaseSkipped("Publish skipped (shadow mode)");
  } else if (gateSub.status === "failed") {
    // Gate failed → skip publish
    skipSubstage(publishSub);
    phaseSkipped("Publish skipped (gate failed)");
  } else if ((gateResult.posts || []).length === 0) {
    skipSubstage(publishSub);
    phaseSkipped("No posts gated — skipping publish");
  } else {
    try {
      v2PhaseHeader("act", "publish");
      startSubstage(publishSub);
      if (flags.oversight === "autonomous") {
        publishResult = await runPublishAutonomous(state, flags, extensionRegistry);
      } else if (rl) {
        publishResult = await runPublishManual(state, flags, rl);
      }
      completeSubstage(publishSub, publishResult);
      state.substages = substages;
      saveState(state, sessionsDir);
    } catch (e: any) {
      failSubstage(publishSub, e.message);
      state.substages = substages;
      saveState(state, sessionsDir);
      observe("error", `ACT/publish failed: ${e.message}`, { phase: "act", substage: "publish", source: "session-runner.ts:runV2Loop" });
      phaseError(`Publish failed: ${e.message}`);
    }
  }

  // Save substages to state
  state.substages = substages;

  // Determine ACT phase status
  const actResult = {
    engage: engageResult,
    gate: gateResult,
    publish: publishResult,
    substages: substages.map(s => ({ substage: s.substage, status: s.status, durationMs: s.durationMs, failureCode: s.failureCode })),
  };

  if (publishSub.status === "failed") {
    failPhase(state, "act" as any, publishSub.failureCode || "publish failed", sessionsDir);
    // Don't throw — continue to CONFIRM for verification of whatever was published
  } else {
    completePhase(state, "act" as any, actResult, sessionsDir);
  }

  checkV2PhaseBudget("act", Date.now() - actStartMs);

  try {
    await runAfterAct(extensionRegistry, agentConfig.loopExtensions, {
      state,
      config: agentConfig,
      actResult,
      flags: { agent: flags.agent, env: flags.env, log: flags.log, dryRun: flags.dryRun, pretty: flags.pretty },
      logger: hookLogger,
    });
  } catch (e: any) {
    observe("error", `afterAct hooks failed: ${e.message}`, {
      phase: "act",
      source: "session-runner.ts:runV2Loop",
    });
  }
  } // end ACT else block

  // ── CONFIRM ────────────────────────────────────
  const confirmCompleted = state.phases.confirm?.status === "completed";
  if (confirmCompleted) {
    info("CONFIRM already completed — skipping (resume)");
  } else {
    v2PhaseHeader("confirm");
    setObserverPhase("confirm");
    beginPhase(state, "confirm" as any, sessionsDir);
    const confirmStartMs = Date.now();

    try {
      if (state.posts.length === 0) {
        phaseSkipped("No posts to verify — skipping");
        completePhase(state, "confirm" as any, { skipped: true, reason: "no posts" }, sessionsDir);
      } else {
        const args = [...state.posts, "--json", "--log", flags.log, "--env", flags.env];
        const verifyResult = await runToolAndParse("cli/verify.ts", args, "verify.ts (CONFIRM)");
        const summary = verifyResult.summary || {};
        phaseResult(`${summary.verified || 0}/${summary.total || 0} verified`);
        observe("insight", `CONFIRM: ${summary.verified || 0}/${summary.total || 0} verified`, {
          phase: "confirm", source: "session-runner.ts:runV2Loop",
        });
        completePhase(state, "confirm" as any, verifyResult, sessionsDir);
      }
    } catch (e: any) {
      observe("error", `CONFIRM failed: ${e.message}`, { phase: "confirm", source: "session-runner.ts:runV2Loop" });
      failPhase(state, "confirm" as any, e.message, sessionsDir);
      throw e;
    }

    checkV2PhaseBudget("confirm", Date.now() - confirmStartMs);
  }

  // ── AFTER CONFIRM — extension hooks (PR1: prediction tracking) ──
  if (state.publishedPosts && state.publishedPosts.length > 0) {
    try {
      await runAfterConfirm(extensionRegistry, agentConfig.loopExtensions, {
        state,
        config: agentConfig,
        publishedPosts: state.publishedPosts,
        confirmResult: state.phases.confirm?.result,
        logger: hookLogger,
      });
    } catch (e: any) {
      observe("error", `afterConfirm hooks failed: ${e.message}`, {
        phase: "confirm", source: "session-runner.ts:runV2Loop",
      });
      // Non-fatal — don't throw, just log
    }
  }
}

// ── V2 Session Report ─────────────────────────────

function writeV2SessionReport(state: V2SessionState, oversight: OversightLevel, sessionsDir?: string): void {
  const sessDir = sessionsDir || resolve(homedir(), `.${state.agentName}`, "sessions");
  mkdirSync(sessDir, { recursive: true });
  const reportPath = resolve(sessDir, `session-${state.sessionNumber}-report.md`);

  const duration = ((Date.now() - new Date(state.startedAt).getTime()) / 60000).toFixed(1);
  const date = new Date(state.startedAt).toISOString().slice(0, 10);
  const lines: string[] = [];

  lines.push(`# ${state.agentName.charAt(0).toUpperCase() + state.agentName.slice(1)} Session ${state.sessionNumber} — ${date} (v2)`);
  lines.push("");
  lines.push(`**Duration:** ${duration} min | **Posts:** ${state.posts.length} | **Oversight:** ${oversight} | **Loop:** v2${state.publishSuppressed ? " (shadow)" : ""}`);
  lines.push("");

  // SENSE
  const sense = state.phases.sense?.result || {};
  lines.push(`## 1. SENSE`);
  if (sense.activity) {
    lines.push(`- ${sense.activity.level || "?"} activity (${sense.activity.posts_per_hour ?? "?"} posts/hr)`);
    if (sense.heat?.topic) lines.push(`- Hot topic: ${sense.heat.topic} (${sense.heat.reactions || 0} reactions)`);
    if (sense.gaps?.topics?.length) lines.push(`- ${sense.gaps.topics.length} gap topics`);
  } else {
    lines.push("- No scan data");
  }
  lines.push("");

  // ACT (with substage breakdown)
  const actResult = state.phases.act?.result || {};
  lines.push(`## 2. ACT`);

  for (const sub of state.substages || []) {
    const icon = sub.status === "completed" ? "✓" : sub.status === "skipped" ? "⊘" : sub.status === "failed" ? "✗" : "?";
    const dur = sub.durationMs !== undefined ? ` (${(sub.durationMs / 1000).toFixed(1)}s)` : "";
    const fail = sub.failureCode ? ` — ${sub.failureCode}` : "";
    lines.push(`- ${icon} ${sub.substage.toUpperCase()}: ${sub.status}${dur}${fail}`);
  }

  const engage = actResult.engage || {};
  if (engage.reactions_cast !== undefined) {
    lines.push(`- Reactions: ${engage.reactions_cast} (${engage.agrees || 0} agree, ${engage.disagrees || 0} disagree)`);
  }

  const gate = actResult.gate || {};
  const gatePosts = gate.posts || [];
  if (gatePosts.length > 0) {
    lines.push(`- ${gatePosts.length} post(s) gated`);
  }

  if (state.posts.length > 0) {
    for (const tx of state.posts) {
      lines.push(`- Published: ${tx.slice(0, 16)}...`);
    }
  }

  if (state.publishSuppressed) {
    lines.push("- **Shadow mode: publish suppressed**");
  }
  lines.push("");

  // CONFIRM
  const confirm = state.phases.confirm?.result || {};
  lines.push(`## 3. CONFIRM`);
  if (confirm.skipped) {
    lines.push("- Skipped (no posts)");
  } else if (confirm.summary) {
    lines.push(`- ${confirm.summary.verified || 0}/${confirm.summary.total || 0} verified in feed`);
  } else {
    lines.push("- No verification data");
  }
  lines.push("");

  writeFileSync(reportPath, lines.join("\n"));
  info(`V2 session report written to ${reportPath}`);
}

// ── V2 Dry Run ────────────────────────────────────

function dryRunV2(sessionNumber: number, flags: RunnerFlags): void {
  banner(sessionNumber, flags.oversight, flags.agent);
  console.log(`  MODE: dry-run (v2 loop, 3 phases)${flags.shadow ? " [SHADOW]" : ""}\n`);

  for (let i = 0; i < CORE_PHASE_ORDER.length; i++) {
    const phase = CORE_PHASE_ORDER[i];
    if (phase === "act") {
      console.log(`  ${i + 1}. ${phase.toUpperCase()}`);
      console.log(`     a. ENGAGE`);
      console.log(`     b. GATE`);
      if (flags.shadow) {
        console.log(`     c. PUBLISH — SKIPPED (shadow mode)`);
      } else {
        console.log(`     c. PUBLISH`);
      }
    } else {
      console.log(`  ${i + 1}. ${phase.toUpperCase()}`);
    }
  }

  if (agentConfig.loopExtensions.length > 0) {
    console.log(`\n  Extensions: ${agentConfig.loopExtensions.join(", ")}`);
  }
  console.log();
}

// ── Dry Run ────────────────────────────────────────

function dryRun(sessionNumber: number, flags: RunnerFlags, startPhase: PhaseName | null): void {
  banner(sessionNumber, flags.oversight, flags.agent);
  console.log("  MODE: dry-run (no execution)\n");

  const phases = getPhaseOrder() as PhaseName[];
  let started = startPhase === null;

  for (const phase of phases) {
    if (!started && phase === startPhase) started = true;
    if (!started) {
      console.log(`  ${phases.indexOf(phase) + 1}. ${phase.toUpperCase()} — SKIPPED`);
      continue;
    }

    const mode = getPhaseMode(phase, flags.oversight);
    console.log(`  ${phases.indexOf(phase) + 1}. ${phase.toUpperCase()} (${mode})`);
  }
  console.log();
}

// ── Main Orchestrator ──────────────────────────────

async function main(): Promise<void> {
  const flags = parseArgs();
  runnerAgentName = flags.agent;
  runnerExecBackend = flags.execBackend;
  if (runnerExecBackend === "tmux") {
    info(`tmux backend adapter: ${resolveTmuxAdapter()}`);
  }
  setLogAgent(flags.agent);

  agentConfig = loadAgentConfig(flags.agent);
  IMPROVEMENTS_PATH = agentConfig.paths.improvementsFile;
  const sessionsDir = agentConfig.paths.sessionDir;

  let state: AnySessionState;
  let sessionNumber: number;
  let startPhase: PhaseName | null = null;

  if (flags.resume) {
    const active = findActiveSession(sessionsDir, flags.agent);
    if (!active) {
      console.error("Error: no active session to resume. Start a new session without --resume.");
      process.exit(1);
    }

    // Resume guard: block cross-version resume (Codex #6)
    const stateVersion = isV2(active) ? 2 : 1;
    if (stateVersion !== flags.loopVersion) {
      console.error(
        `Error: saved state is loop version ${stateVersion} but --loop-version ${flags.loopVersion} was requested.\n` +
        `Cross-version resume is not supported. Either:\n` +
        `  - Resume with --loop-version ${stateVersion}\n` +
        `  - Clear the session state and start fresh with --loop-version ${flags.loopVersion}`
      );
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

    startPhase = getNextPhase(state) as PhaseName | null;
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
      if (flags.loopVersion === 2) {
        dryRunV2(sessionNumber, flags);
      } else {
        dryRun(sessionNumber, flags, startPhase);
      }
      process.exit(0);
    }

    state = startSession(sessionNumber, flags.agent, sessionsDir, flags.loopVersion);
    info(`Started session ${sessionNumber} (loop v${flags.loopVersion})`);

    if (startPhase && !isV2(state)) {
      const phases = getPhaseOrder();
      for (const phase of phases) {
        if (phase === startPhase) break;
        completePhase(state, phase, { skipped: true, reason: `--skip-to ${startPhase}` }, sessionsDir);
      }
    }
  }

  // Initialize observation logging for this session
  initObserver(flags.agent, sessionNumber);

  // Build extension hook registry from plugin files (Phase 5 — skill loader).
  // Dynamic imports keep SDK transitive deps out of the extensions.ts module graph.
  const extensionRegistry = await loadExtensions({
    enabledExtensions: agentConfig.loopExtensions,
    runTool: runToolAndParse,
  });

  banner(sessionNumber, flags.oversight, flags.agent);
  if (isV2(state)) {
    console.log(`  Loop: v2 (SENSE → ACT → CONFIRM)${flags.shadow ? " [SHADOW]" : ""}`);
  }

  // Session-level hard timeout — 180s (3 min) without TLSN, sessions should be <60s
  const SESSION_TIMEOUT_MS = 180_000;
  const sessionTimer = setTimeout(() => {
    console.error(`\n  ⏰ SESSION TIMEOUT (${SESSION_TIMEOUT_MS / 1000}s) — saving state and exiting`);
    saveState(state, sessionsDir);
    console.error(`  Resume with: npx tsx cli/session-runner.ts --agent ${flags.agent} --resume --pretty`);
    process.exit(2);
  }, SESSION_TIMEOUT_MS);
  sessionTimer.unref(); // Don't prevent clean exit

  let shuttingDown = false;
  process.on("SIGINT", () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    console.log("\n\n  ⚠️ Interrupted — saving state...");
    saveState(state, sessionsDir);
    console.log(`  Resume with: npx tsx tools/session-runner.ts --agent ${flags.agent} --resume${isV2(state) ? " --loop-version 2" : ""} --pretty`);
    console.log();
    process.exit(0);
  });

  // Only create readline for modes that need it
  const needsReadline = flags.oversight !== "autonomous";
  const rl = needsReadline
    ? createInterface({ input: stdin, output: stdout })
    : null;

  try {
    if (isV2(state)) {
      // PR2: Auto-register agent profile on first session (non-fatal)
      try {
        const { loadAuthCache } = await import("../src/lib/auth/auth.js");
        const { apiCall } = await import("../src/lib/network/sdk.js");
        const sessionAddress =
          (state as Partial<{ walletAddress: string; address: string }>).walletAddress ||
          (state as Partial<{ walletAddress: string; address: string }>).address;
        // V2 state does not persist a wallet address before publish runs, so when
        // session context lacks one this falls back to the legacy top-level cache entry.
        const cached = loadAuthCache(sessionAddress);
        if (cached) {
          const profileRes = await apiCall(`/api/agent/${cached.address}`, cached.token);
          const profileMissing = profileRes.status === 404 || (profileRes.ok && !profileRes.data?.name);
          if (profileMissing) {
            const registerRes = await apiCall("/api/agents/register", cached.token, {
              method: "POST",
              body: JSON.stringify({
                name: agentConfig.name,
                description: agentConfig.displayName || `${agentConfig.name} agent`,
                specialties: agentConfig.topics?.primary || [],
              }),
            });
            if (registerRes.ok) {
              info(`Auto-registered agent profile: ${agentConfig.name}`);
            } else {
              info(`Auto-registration failed for ${agentConfig.name}: HTTP ${registerRes.status}`);
            }
          } else if (!profileRes.ok) {
            info(`Auto-registration skipped: profile lookup failed for ${agentConfig.name} (HTTP ${profileRes.status})`);
          }
        }
      } catch {
        // Non-fatal — agent can operate without profile
      }

      // ── V2 Loop ────────────────────────────────
      await runV2Loop(state, flags, sessionsDir, rl, extensionRegistry);

      rl?.close();

      // V2 summary
      const duration = ((Date.now() - new Date(state.startedAt).getTime()) / 60000).toFixed(1);
      console.log("\n" + "═".repeat(50));
      console.log("  SESSION COMPLETE (v2)");
      console.log("═".repeat(50));
      console.log(`  Session: ${sessionNumber}`);
      console.log(`  Oversight: ${flags.oversight}`);
      console.log(`  Duration: ${duration} min`);
      console.log(`  Posts: ${state.posts.length}`);
      if (state.publishSuppressed) console.log("  Shadow: publish suppressed");

      const engResult = getEngageResult(state) || {};
      console.log(`  Reactions: ${engResult.reactions_cast || 0} (${engResult.agrees || 0} agree, ${engResult.disagrees || 0} disagree)`);

      const verResult = getVerifyResult(state) || {};
      if (!verResult.skipped) {
        console.log(`  Verified: ${verResult.summary?.verified || 0}/${verResult.summary?.total || 0}`);
      }

      // Substage breakdown
      for (const sub of state.substages || []) {
        const icon = sub.status === "completed" ? "✓" : sub.status === "skipped" ? "⊘" : sub.status === "failed" ? "✗" : "?";
        const dur = sub.durationMs !== undefined ? ` (${(sub.durationMs / 1000).toFixed(1)}s)` : "";
        console.log(`  ${icon} ${sub.substage}: ${sub.status}${dur}`);
      }
      console.log("═".repeat(50) + "\n");

      try {
        writeV2SessionReport(state, flags.oversight, sessionsDir);
      } catch (e: any) {
        info(`Warning: could not write session report: ${e.message}`);
      }
    } else {
      // ── V1 Loop ────────────────────────────────
      const v1State = state as SessionState;
      const phases = getPhaseOrder();
      const startIdx = startPhase ? phases.indexOf(startPhase) : 0;

      // Session transcript — append-only JSONL event logger
      const transcriptDir = resolve(homedir(), ".config", "demos", "transcripts", flags.agent);
      pruneOldTranscripts(transcriptDir, 30);
      const transcript = createTranscriptContext(flags.agent, v1State.sessionNumber, transcriptDir);
      emitTranscriptEvent(transcript, { type: "session-start", phase: null, data: { oversight: flags.oversight, phaseCount: phases.length } });

      for (let i = startIdx; i < phases.length; i++) {
        const phase = phases[i] as PhaseName;
        if (v1State.phases[phase].status === "completed") continue;

        phaseHeader(phase, flags.oversight);
        setObserverPhase(phase);
        beginPhase(v1State, phase, sessionsDir);
        const phaseStartMs = Date.now();
        emitTranscriptEvent(transcript, { type: "phase-start", phase });

        try {
          switch (phase) {
            case "audit":
              await runAudit(v1State, flags);
              break;
            case "scan":
              await runScan(v1State, flags);
              break;
            case "engage":
              await runEngage(v1State, flags);
              break;
            case "gate":
              if (flags.oversight === "full") await runGateFull(v1State, flags, rl!);
              else if (flags.oversight === "approve") await runGateApprove(v1State, flags, rl!);
              else await runGateAutonomous(v1State, flags);
              break;
            case "publish":
              if (flags.oversight === "autonomous") await runPublishAutonomous(v1State, flags, extensionRegistry, transcript);
              else await runPublishManual(v1State, flags, rl!);
              break;
            case "verify":
              await runVerify(v1State, flags);
              break;
            case "review":
              if (flags.oversight === "full") await runReviewFull(v1State, flags, rl!);
              else await runReviewAuto(v1State, flags);
              break;
            case "harden":
              if (flags.oversight === "full") await runHardenFull(v1State, flags, rl!);
              else if (flags.oversight === "approve") await runHardenApprove(v1State, flags, rl!);
              else await runHardenAutonomous(v1State, flags);
              break;
          }

          // Phase deadline check — warn (don't kill) if phase exceeded its budget
          const phaseDurationMs = Date.now() - phaseStartMs;
          const budgetMs = getPhaseBudgetMs(phase, agentConfig);
          if (budgetMs > 0 && phaseDurationMs > budgetMs) {
            const overagePercent = Math.round(((phaseDurationMs - budgetMs) / budgetMs) * 100);
            observe("inefficiency", `Phase ${phase} exceeded budget: ${Math.round(phaseDurationMs / 1000)}s vs ${Math.round(budgetMs / 1000)}s budget (+${overagePercent}%)`, {
              phase,
              source: "session-runner.ts:phase-budget",
              data: { phase, durationMs: phaseDurationMs, budgetMs, overagePercent },
            });
            info(`⚠️ Phase ${phase} exceeded budget: ${Math.round(phaseDurationMs / 1000)}s (budget: ${Math.round(budgetMs / 1000)}s, +${overagePercent}%)`);
          }

          // Transcript: phase-complete with metrics extracted from phase result
          const phaseResult = v1State.phases[phase]?.result || {};
          emitTranscriptEvent(transcript, {
            type: "phase-complete",
            phase,
            durationMs: Date.now() - phaseStartMs,
            data: extractPhaseData(phase, phaseResult, v1State),
            metrics: extractTranscriptMetrics(phase, phaseResult, v1State),
          });
        } catch (e: any) {
          // Transcript: phase-error
          emitTranscriptEvent(transcript, {
            type: "phase-error",
            phase,
            durationMs: Date.now() - phaseStartMs,
            data: { error: e.message },
          });

          // Observe phase failure before exiting
          observe("error", `Phase ${phase} failed: ${e.message}`, {
            phase,
            source: "session-runner.ts:main-loop",
            data: { phase, durationMs: Date.now() - phaseStartMs },
          });
          failPhase(v1State, phase, e.message, sessionsDir);
          phaseError(e.message);
          // Emit session-complete before exit so transcript is never truncated
          emitTranscriptEvent(transcript, {
            type: "session-complete",
            phase: null,
            durationMs: Date.now() - new Date(v1State.startedAt).getTime(),
            data: { posts: v1State.posts.length, error: e.message, failedPhase: phase },
          });
          console.error(`\n  Session state saved. Resume with: npx tsx tools/session-runner.ts --agent ${flags.agent} --resume --pretty`);
          rl?.close();
          process.exit(1);
        }
      }

      // Transcript: session-complete
      emitTranscriptEvent(transcript, {
        type: "session-complete",
        phase: null,
        durationMs: Date.now() - new Date(v1State.startedAt).getTime(),
        data: { posts: v1State.posts.length },
      });

      rl?.close();

      // Display summary
      const duration = ((Date.now() - new Date(v1State.startedAt).getTime()) / 60000).toFixed(1);
      console.log("\n" + "═".repeat(50));
      console.log("  SESSION COMPLETE");
      console.log("═".repeat(50));
      console.log(`  Session: ${sessionNumber}`);
      console.log(`  Oversight: ${flags.oversight}`);
      console.log(`  Duration: ${duration} min`);
      console.log(`  Posts: ${v1State.posts.length}`);

      const engageResult = v1State.phases.engage.result || {};
      console.log(`  Reactions: ${engageResult.reactions_cast || 0} (${engageResult.agrees || 0} agree, ${engageResult.disagrees || 0} disagree)`);

      const verifyResult = v1State.phases.verify.result || {};
      if (!verifyResult.skipped) {
        console.log(`  Verified: ${verifyResult.summary?.verified || 0}/${verifyResult.summary?.total || 0}`);
      }
      console.log("═".repeat(50) + "\n");

      try {
        writeSessionReport(v1State, flags.oversight, sessionsDir);
      } catch (e: any) {
        info(`Warning: could not write session report: ${e.message}`);
      }
    }

    clearTimeout(sessionTimer);
    incrementSessionNumber();
    clearState(sessionNumber, sessionsDir, flags.agent);
    info("Session state cleared.");
  } catch (e: any) {
    rl?.close();
    saveState(state, sessionsDir);
    console.error(`\nFATAL: ${e.message}`);
    console.error(`Session state saved. Resume with: npx tsx tools/session-runner.ts --agent ${flags.agent} --resume${isV2(state) ? " --loop-version 2" : ""} --pretty`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
});
