import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { PublishResult, ToolResult } from "../../../src/toolkit/types.js";
import { connect } from "./connect.js";
import type { ConnectOptions, OmniWeb } from "./colony.js";
import type { MinimalAttestationPlan } from "./minimal-attestation-plan.js";
import type { PublishVisibilityResult } from "./publish-visibility.js";
import { verifyPublishVisibility } from "./publish-visibility.js";

export type MinimalAgentState = Record<string, unknown>;
export type MinimalAuditSection = Record<string, unknown>;

export interface MinimalAuditPayload {
  inputs?: MinimalAuditSection;
  selectedEvidence?: MinimalAuditSection;
  promptPacket?: MinimalAuditSection;
  notes?: string[];
}

export interface MinimalCycleSummary {
  id: string;
  iteration: number;
  startedAt: string;
  finishedAt: string;
  decisionKind: MinimalObserveResult["kind"];
  status: MinimalCycleStatus;
  txHash?: string;
  verificationPath?: PublishVisibilityResult["verificationPath"];
  visible?: boolean;
  indexedVisible?: boolean;
  errorStage?: MinimalErrorStage;
  errorMessage?: string;
}

export interface MinimalAgentMemory<TState extends MinimalAgentState = MinimalAgentState> {
  state: TState | null;
  lastCycle: MinimalCycleSummary | null;
}

export interface MinimalCycleContext {
  id: string;
  iteration: number;
  startedAt: string;
  stateDir: string;
  dryRun: boolean;
}

export interface MinimalObserveContext<TState extends MinimalAgentState = MinimalAgentState> {
  omni: OmniWeb;
  cycle: MinimalCycleContext;
  memory: MinimalAgentMemory<TState>;
}

interface BaseDecision<TState extends MinimalAgentState = MinimalAgentState> {
  facts?: Record<string, unknown>;
  audit?: MinimalAuditPayload;
  attestationPlan?: MinimalAttestationPlan;
  nextState?: TState;
}

export interface SkipDecision<TState extends MinimalAgentState = MinimalAgentState> extends BaseDecision<TState> {
  kind: "skip";
  reason: string;
}

export interface PublishDecision<TState extends MinimalAgentState = MinimalAgentState> extends BaseDecision<TState> {
  kind: "publish";
  category: string;
  text: string;
  attestUrl: string;
  tags?: string[];
  confidence?: number;
}

export interface ReplyDecision<TState extends MinimalAgentState = MinimalAgentState> extends BaseDecision<TState> {
  kind: "reply";
  parentTxHash: string;
  text: string;
  attestUrl: string;
  category?: string;
}

export type MinimalObserveResult<TState extends MinimalAgentState = MinimalAgentState> =
  | SkipDecision<TState>
  | PublishDecision<TState>
  | ReplyDecision<TState>;

export type MinimalObserveFn<TState extends MinimalAgentState = MinimalAgentState> = (
  ctx: MinimalObserveContext<TState>,
) => Promise<MinimalObserveResult<TState>>;

export type MinimalCycleStatus = "skipped" | "dry_run" | "published" | "replied" | "failed";

export type MinimalErrorStage = "connect" | "observe" | "execute" | "verify";

export interface MinimalVerificationOptions {
  timeoutMs?: number;
  pollMs?: number;
  limit?: number;
}

interface MinimalRuntimeSharedOptions<TState extends MinimalAgentState = MinimalAgentState> {
  connectOptions?: ConnectOptions;
  connectFn?: (opts?: ConnectOptions) => Promise<OmniWeb>;
  stateDir?: string;
  cwd?: string;
  dryRun?: boolean;
  verification?: MinimalVerificationOptions;
  now?: () => number;
}

export interface RunMinimalAgentCycleOptions<TState extends MinimalAgentState = MinimalAgentState>
  extends MinimalRuntimeSharedOptions<TState> {
  cycleId?: string;
  omni?: OmniWeb;
}

export interface RunMinimalAgentLoopOptions<TState extends MinimalAgentState = MinimalAgentState>
  extends MinimalRuntimeSharedOptions<TState> {
  intervalMs?: number;
  maxIterations?: number;
  omni?: OmniWeb;
  sleep?: (ms: number) => Promise<void>;
}

export interface MinimalCycleRecord<TState extends MinimalAgentState = MinimalAgentState> {
  version: 1;
  cycleId: string;
  iteration: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  dryRun: boolean;
  stateDir: string;
  decision: MinimalObserveResult<TState>;
  memoryBefore: MinimalAgentMemory<TState>;
  memoryAfter: MinimalAgentMemory<TState>;
  outcome: {
    status: MinimalCycleStatus;
    txHash?: string;
    demSpendEstimate?: number;
    verification?: PublishVisibilityResult;
    publishResult?: ToolResult<PublishResult>;
    error?: {
      stage: MinimalErrorStage;
      message: string;
      code?: string;
      retryable?: boolean;
    };
  };
}

interface StoredMinimalState<TState extends MinimalAgentState = MinimalAgentState> {
  version: 1;
  updatedAt: string;
  iteration: number;
  agentState: TState | null;
  lastCycle: MinimalCycleSummary | null;
}

const DEFAULT_INTERVAL_MS = 300_000;
const DEFAULT_STATE_DIR = ".omniweb-agent";
const DEFAULT_VERIFICATION_TIMEOUT_MS = 45_000;
const DEFAULT_VERIFICATION_POLL_MS = 5_000;
const DEFAULT_VERIFICATION_LIMIT = 50;
const PLACEHOLDER_ATTEST_HOSTS = new Set(["example.com", "www.example.com"]);

export function getDefaultMinimalStateDir(cwd?: string): string {
  return resolve(cwd ?? process.cwd(), DEFAULT_STATE_DIR);
}

export async function runMinimalAgentCycle<TState extends MinimalAgentState = MinimalAgentState>(
  observe: MinimalObserveFn<TState>,
  opts: RunMinimalAgentCycleOptions<TState> = {},
): Promise<MinimalCycleRecord<TState>> {
  const now = opts.now ?? Date.now;
  const stateDir = resolveStateDir(opts.stateDir, opts.cwd);
  const previous = await loadStoredState<TState>(stateDir);
  const memoryBefore: MinimalAgentMemory<TState> = {
    state: previous.agentState,
    lastCycle: previous.lastCycle,
  };
  const iteration = previous.iteration + 1;
  const startedAtMs = now();
  const startedAt = new Date(startedAtMs).toISOString();
  const cycleId = opts.cycleId ?? buildCycleId(iteration, startedAtMs);
  const cycle: MinimalCycleContext = {
    id: cycleId,
    iteration,
    startedAt,
    stateDir,
    dryRun: opts.dryRun === true,
  };

  let omni = opts.omni;
  if (!omni) {
    try {
      omni = await (opts.connectFn ?? connect)(opts.connectOptions);
    } catch (error) {
      const record = buildFailureRecord({
        cycle,
        startedAtMs,
        now,
        memoryBefore,
        decision: {
          kind: "skip",
          reason: "connect_failed",
          facts: {},
        } as MinimalObserveResult<TState>,
        error,
        stage: "connect",
      });
      await persistCycleArtifacts(stateDir, record);
      return record;
    }
  }

  let decision: MinimalObserveResult<TState>;
  try {
    decision = await observe({
      omni,
      cycle,
      memory: memoryBefore,
    });
  } catch (error) {
    const record = buildFailureRecord({
      cycle,
      startedAtMs,
      now,
      memoryBefore,
      decision: {
        kind: "skip",
        reason: "observe_failed",
        facts: {},
      } as MinimalObserveResult<TState>,
      error,
      stage: "observe",
    });
    await persistCycleArtifacts(stateDir, record);
    return record;
  }

  if (decision.kind === "skip") {
    const record = buildCompletedRecord({
      cycle,
      startedAtMs,
      now,
      memoryBefore,
      nextState: decision.nextState ?? memoryBefore.state,
      decision,
      outcome: {
        status: "skipped",
        demSpendEstimate: 0,
      },
    });
    await persistCycleArtifacts(stateDir, record);
    return record;
  }

  if (cycle.dryRun) {
    const record = buildCompletedRecord({
      cycle,
      startedAtMs,
      now,
      memoryBefore,
      nextState: decision.nextState ?? memoryBefore.state,
      decision,
      outcome: {
        status: "dry_run",
        demSpendEstimate: 0,
      },
    });
    await persistCycleArtifacts(stateDir, record);
    return record;
  }

  const attestationGuardError = validateAttestationDecision(decision);
  if (attestationGuardError) {
    const record = buildCompletedRecord({
      cycle,
      startedAtMs,
      now,
      memoryBefore,
      nextState: decision.nextState ?? memoryBefore.state,
      decision,
      outcome: {
        status: "failed",
        demSpendEstimate: 0,
        error: {
          stage: "execute",
          message: attestationGuardError,
          retryable: false,
        },
      },
    });
    await persistCycleArtifacts(stateDir, record);
    return record;
  }

  let publishResult: ToolResult<PublishResult>;
  try {
    publishResult = decision.kind === "publish"
      ? await omni.colony.publish({
          text: decision.text,
          category: decision.category,
          attestUrl: decision.attestUrl,
          tags: decision.tags,
          confidence: decision.confidence,
        })
      : await omni.colony.reply({
          parentTxHash: decision.parentTxHash,
          text: decision.text,
          attestUrl: decision.attestUrl,
          category: decision.category,
        });
  } catch (error) {
    const record = buildFailureRecord({
      cycle,
      startedAtMs,
      now,
      memoryBefore,
      decision,
      error,
      stage: "execute",
      nextState: decision.nextState ?? memoryBefore.state,
    });
    await persistCycleArtifacts(stateDir, record);
    return record;
  }

  if (!publishResult.ok) {
    const record = buildCompletedRecord({
      cycle,
      startedAtMs,
      now,
      memoryBefore,
      nextState: decision.nextState ?? memoryBefore.state,
      decision,
      outcome: {
        status: "failed",
        publishResult,
        demSpendEstimate: 0,
        error: {
          stage: "execute",
          message: publishResult.error?.message ?? "publish_failed",
          code: publishResult.error?.code,
          retryable: publishResult.error?.retryable,
        },
      },
    });
    await persistCycleArtifacts(stateDir, record);
    return record;
  }

  const txHash = publishResult.data?.txHash;
  let verification: PublishVisibilityResult | undefined;
  try {
    verification = await verifyPublishVisibility(
      omni,
      txHash,
      decision.text,
      {
        timeoutMs: opts.verification?.timeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS,
        pollMs: opts.verification?.pollMs ?? DEFAULT_VERIFICATION_POLL_MS,
        limit: opts.verification?.limit ?? DEFAULT_VERIFICATION_LIMIT,
      },
    );
  } catch (error) {
    verification = {
      attempted: true,
      visible: false,
      indexedVisible: false,
      polls: 0,
      elapsedMs: 0,
      txHash,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const record = buildCompletedRecord({
    cycle,
    startedAtMs,
    now,
    memoryBefore,
    nextState: decision.nextState ?? memoryBefore.state,
    decision,
    outcome: {
      status: decision.kind === "publish" ? "published" : "replied",
      txHash,
      demSpendEstimate: 1,
      publishResult,
      verification,
    },
  });
  await persistCycleArtifacts(stateDir, record);
  return record;
}

export async function runMinimalAgentLoop<TState extends MinimalAgentState = MinimalAgentState>(
  observe: MinimalObserveFn<TState>,
  opts: RunMinimalAgentLoopOptions<TState> = {},
): Promise<void> {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const maxIterations = opts.maxIterations ?? Number.POSITIVE_INFINITY;
  const sleep = opts.sleep ?? defaultSleep;
  const sharedOmni = opts.omni ?? await (opts.connectFn ?? connect)(opts.connectOptions);
  let running = true;

  const shutdown = () => {
    running = false;
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    let completed = 0;
    while (running && completed < maxIterations) {
      completed += 1;
      await runMinimalAgentCycle(observe, {
        ...opts,
        omni: sharedOmni,
      });
      if (running && completed < maxIterations) {
        await sleep(intervalMs);
      }
    }
  } finally {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
  }
}

function resolveStateDir(stateDir: string | undefined, cwd: string | undefined): string {
  if (stateDir) return resolve(stateDir);
  return getDefaultMinimalStateDir(cwd);
}

async function loadStoredState<TState extends MinimalAgentState>(
  stateDir: string,
): Promise<StoredMinimalState<TState>> {
  const path = stateFilePath(stateDir);
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<StoredMinimalState<TState>>;
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
      iteration: typeof parsed.iteration === "number" ? parsed.iteration : 0,
      agentState: isRecord(parsed.agentState) ? parsed.agentState as TState : null,
      lastCycle: isCycleSummary(parsed.lastCycle) ? parsed.lastCycle : null,
    };
  } catch (error) {
    if (isMissingFile(error)) {
      return {
        version: 1,
        updatedAt: new Date(0).toISOString(),
        iteration: 0,
        agentState: null,
        lastCycle: null,
      };
    }
    throw error;
  }
}

async function persistCycleArtifacts<TState extends MinimalAgentState>(
  stateDir: string,
  record: MinimalCycleRecord<TState>,
): Promise<void> {
  const day = record.startedAt.slice(0, 10);
  const jsonPath = resolve(stateDir, "runs", day, `${record.cycleId}.json`);
  const markdownPath = resolve(stateDir, "runs", day, `${record.cycleId}.md`);
  const latestPath = resolve(stateDir, "runs", "latest.json");
  const statePath = stateFilePath(stateDir);
  const summary = summarizeCycle(record);

  const storedState: StoredMinimalState<TState> = {
    version: 1,
    updatedAt: record.finishedAt,
    iteration: record.iteration,
    agentState: record.memoryAfter.state,
    lastCycle: summary,
  };

  await writeJson(jsonPath, record);
  await writeText(markdownPath, renderCycleSummary(record));
  await writeJson(latestPath, record);
  await writeJson(statePath, storedState);
}

function buildCompletedRecord<TState extends MinimalAgentState>(args: {
  cycle: MinimalCycleContext;
  startedAtMs: number;
  now: () => number;
  memoryBefore: MinimalAgentMemory<TState>;
  nextState: TState | null;
  decision: MinimalObserveResult<TState>;
  outcome: MinimalCycleRecord<TState>["outcome"];
}): MinimalCycleRecord<TState> {
  const finishedAtMs = args.now();
  const finishedAt = new Date(finishedAtMs).toISOString();
  const summary = summarizeCycleFields({
    cycle: args.cycle,
    finishedAt,
    decision: args.decision,
    outcome: args.outcome,
  });

  return {
    version: 1,
    cycleId: args.cycle.id,
    iteration: args.cycle.iteration,
    startedAt: args.cycle.startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAtMs - args.startedAtMs),
    dryRun: args.cycle.dryRun,
    stateDir: args.cycle.stateDir,
    decision: args.decision,
    memoryBefore: args.memoryBefore,
    memoryAfter: {
      state: args.nextState,
      lastCycle: summary,
    },
    outcome: args.outcome,
  };
}

function buildFailureRecord<TState extends MinimalAgentState>(args: {
  cycle: MinimalCycleContext;
  startedAtMs: number;
  now: () => number;
  memoryBefore: MinimalAgentMemory<TState>;
  decision: MinimalObserveResult<TState>;
  error: unknown;
  stage: MinimalErrorStage;
  nextState?: TState | null;
}): MinimalCycleRecord<TState> {
  const message = args.error instanceof Error ? args.error.message : String(args.error);
  return buildCompletedRecord({
    cycle: args.cycle,
    startedAtMs: args.startedAtMs,
    now: args.now,
    memoryBefore: args.memoryBefore,
    nextState: args.nextState ?? args.memoryBefore.state,
    decision: args.decision,
    outcome: {
      status: "failed",
      demSpendEstimate: 0,
      error: {
        stage: args.stage,
        message,
      },
    },
  });
}

function summarizeCycle<TState extends MinimalAgentState>(
  record: MinimalCycleRecord<TState>,
): MinimalCycleSummary {
  return summarizeCycleFields({
    cycle: {
      id: record.cycleId,
      iteration: record.iteration,
      startedAt: record.startedAt,
      stateDir: record.stateDir,
      dryRun: record.dryRun,
    },
    finishedAt: record.finishedAt,
    decision: record.decision,
    outcome: record.outcome,
  });
}

function summarizeCycleFields<TState extends MinimalAgentState>(args: {
  cycle: MinimalCycleContext;
  finishedAt: string;
  decision: MinimalObserveResult<TState>;
  outcome: MinimalCycleRecord<TState>["outcome"];
}): MinimalCycleSummary {
  return {
    id: args.cycle.id,
    iteration: args.cycle.iteration,
    startedAt: args.cycle.startedAt,
    finishedAt: args.finishedAt,
    decisionKind: args.decision.kind,
    status: args.outcome.status,
    txHash: args.outcome.txHash,
    verificationPath: args.outcome.verification?.verificationPath,
    visible: args.outcome.verification?.visible,
    indexedVisible: args.outcome.verification?.indexedVisible,
    errorStage: args.outcome.error?.stage,
    errorMessage: args.outcome.error?.message,
  };
}

function renderCycleSummary<TState extends MinimalAgentState>(
  record: MinimalCycleRecord<TState>,
): string {
  const lines = [
    `# Cycle ${record.cycleId}`,
    "",
    `- Iteration: ${record.iteration}`,
    `- Started: ${record.startedAt}`,
    `- Finished: ${record.finishedAt}`,
    `- DurationMs: ${record.durationMs}`,
    `- Decision: ${record.decision.kind}`,
    `- Outcome: ${record.outcome.status}`,
    `- DryRun: ${record.dryRun}`,
  ];

  if (record.decision.kind === "skip") {
    lines.push(`- SkipReason: ${record.decision.reason}`);
  } else {
    lines.push(`- Text: ${truncate(record.decision.text, 180)}`);
    if ("category" in record.decision && typeof record.decision.category === "string") {
      lines.push(`- Category: ${record.decision.category}`);
    }
  }

  if (record.outcome.txHash) {
    lines.push(`- TxHash: ${record.outcome.txHash}`);
  }

  if (record.outcome.verification) {
    lines.push(`- Visible: ${record.outcome.verification.visible}`);
    lines.push(`- IndexedVisible: ${record.outcome.verification.indexedVisible}`);
    lines.push(`- VerificationPath: ${record.outcome.verification.verificationPath ?? "none"}`);
    lines.push(`- VerificationPolls: ${record.outcome.verification.polls}`);
    if (record.outcome.verification.error) {
      lines.push(`- VerificationNote: ${record.outcome.verification.error}`);
    }
  }

  if (record.outcome.error) {
    lines.push(`- ErrorStage: ${record.outcome.error.stage}`);
    lines.push(`- Error: ${record.outcome.error.message}`);
  }

  const factKeys = Object.keys(record.decision.facts ?? {});
  if (factKeys.length > 0) {
    lines.push(`- FactKeys: ${factKeys.join(", ")}`);
  }

  if (record.decision.attestationPlan) {
    lines.push(
      `- AttestationPlan: ${record.decision.attestationPlan.ready ? "ready" : "blocked"} (${record.decision.attestationPlan.reason})`,
    );
  }

  const auditSections = collectAuditSections(record.decision.audit);
  if (auditSections.length > 0) {
    lines.push(`- AuditSections: ${auditSections.join(", ")}`);
  }

  const nextStateKeys = Object.keys(record.memoryAfter.state ?? {});
  if (nextStateKeys.length > 0) {
    lines.push(`- NextStateKeys: ${nextStateKeys.join(", ")}`);
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildCycleId(iteration: number, nowMs: number): string {
  const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, "-");
  return `${stamp}-i${String(iteration).padStart(4, "0")}`;
}

function stateFilePath(stateDir: string): string {
  return resolve(stateDir, "state", "current.json");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf-8");
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectAuditSections(audit: MinimalAuditPayload | undefined): string[] {
  if (!audit) return [];

  const sections: string[] = [];
  if (hasKeys(audit.inputs)) sections.push("inputs");
  if (hasKeys(audit.selectedEvidence)) sections.push("selectedEvidence");
  if (hasKeys(audit.promptPacket)) sections.push("promptPacket");
  if (Array.isArray(audit.notes) && audit.notes.length > 0) sections.push("notes");
  return sections;
}

function hasKeys(value: Record<string, unknown> | undefined): boolean {
  if (!value) return false;
  return Object.keys(value).length > 0;
}

function validateAttestationDecision<TState extends MinimalAgentState>(
  decision: MinimalObserveResult<TState>,
): string | null {
  const plan = decision.attestationPlan;
  if (plan && !plan.ready) {
    return `attestation_plan_not_ready:${plan.reason}`;
  }

  if (decision.kind === "publish" || decision.kind === "reply") {
    if (isPlaceholderAttestUrl(decision.attestUrl)) {
      return `placeholder_attest_url:${decision.attestUrl}`;
    }

    const plannedUrl = plan?.primary?.url;
    if (plannedUrl && plannedUrl !== decision.attestUrl) {
      return `attest_url_mismatch:${decision.attestUrl}`;
    }
  }

  return null;
}

function isPlaceholderAttestUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (PLACEHOLDER_ATTEST_HOSTS.has(parsed.hostname)) return true;
    return parsed.pathname.includes("example") || parsed.pathname.includes("placeholder");
  } catch {
    return true;
  }
}

function isCycleSummary(value: unknown): value is MinimalCycleSummary {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.iteration === "number"
    && typeof value.startedAt === "string"
    && typeof value.finishedAt === "string"
    && typeof value.decisionKind === "string"
    && typeof value.status === "string";
}

function isMissingFile(error: unknown): boolean {
  const candidate = error as { code?: unknown } | null;
  return Boolean(error)
    && typeof error === "object"
    && candidate?.code === "ENOENT";
}
