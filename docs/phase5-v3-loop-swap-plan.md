# Phase 5: V3 Loop Swap — Complete Implementation Plan

> **Referenced from:** `docs/design-loop-v3.md` Phase 5 section
> **Status:** Architecture complete, ready for implementation
> **Date:** 2026-03-31

## Executive Summary

Replace the V2 `runV2Loop()` (460 lines, 3 phases + 3 substages) with a clean V3 `runV3Loop()` driven entirely by the strategy engine. The V2 loop's ENGAGE/GATE/PUBLISH substages become redundant — the strategy engine already decides all actions (Phases 3b/3c). The key new module is `cli/publish-executor.ts` (Option B), which wraps the full attestation pipeline for PUBLISH/REPLY actions while ENGAGE/TIP continue through the existing lightweight `cli/action-executor.ts`.

## Key Decision: Option B — Two Executors

ENGAGE/TIP are simple chain ops (1 call each) → existing `cli/action-executor.ts`.
PUBLISH/REPLY are complex multi-step pipelines (LLM → claims → attestation → verify → publish) → new `cli/publish-executor.ts`.

**Why not one executor?** Forcing both through the same interface pretends they're equally simple. ENGAGE is 1 chain call. PUBLISH is 10 steps with error recovery at each. Two executors for two different levels of complexity.

## V3 Loop Flow

```
runV3Loop(state, flags, sessionsDir, extensionRegistry, deps)
  │
  ├── using bridge = initStrategyBridge(...)     // auto-dispose via Disposable
  │
  ├── [beforeSense hooks]                        // calibrate, signals, prices, etc.
  │
  ├── SENSE
  │   ├── runSubprocess("cli/scan-feed.ts")      // populates colony cache
  │   └── bridge.sense(sourceView)               // ColonyState + evidence
  │
  ├── ACT
  │   ├── bridge.plan(senseResult)               // → StrategyAction[]
  │   ├── partition: light (ENGAGE+TIP) / heavy (PUBLISH+REPLY)
  │   ├── executeStrategyActions(light)           // existing executor
  │   ├── executePublishActions(heavy)            // NEW publish executor
  │   └── [afterAct hooks]
  │
  └── CONFIRM
      ├── runSubprocess("cli/verify.ts")         // verify published posts
      ├── bridge.computePerformance()            // V3 scoring
      └── [afterConfirm hooks]
```

---

## Module 1: `cli/v3-loop.ts` (new file, ~250 lines)

The core new module. Contains `runV3Loop()` and nothing else — all heavy lifting is delegated.

### Function Signature

```typescript
export interface V3LoopFlags {
  agent: string;
  env: string;
  log: string;
  dryRun: boolean;
  pretty: boolean;
  shadow: boolean;
  oversight: "full" | "approve" | "autonomous";
}

export interface V3LoopDeps {
  /** Injected for testability — wraps runToolAndParse */
  runSubprocess: (script: string, args: string[], label: string) => Promise<unknown>;
  /** Injected for testability — wallet connection */
  connectWallet: (envPath: string) => Promise<{ demos: any; address: string }>;
  /** Injected for testability — LLM provider resolution */
  resolveProvider: (envPath: string) => LLMProvider | null;
  /** Agent config (resolved by caller) */
  agentConfig: AgentConfig;
  /** Source view loader */
  getSourceView: () => AgentSourceView;
  /** Observer function */
  observe: (type: string, message: string, meta?: Record<string, unknown>) => void;
}

export async function runV3Loop(
  state: V3SessionState,
  flags: V3LoopFlags,
  sessionsDir: string,
  extensionRegistry: ExtensionHookRegistry,
  deps: V3LoopDeps,
): Promise<void>;
```

### Design Decisions

1. **`using bridge = initStrategyBridge(...)`** scopes the entire loop. The `finally` cleanup in V2 (lines 3770-3775) becomes automatic.
2. **Dependency injection via `V3LoopDeps`** — the V2 loop uses module-level globals (`agentConfig`, `cachedSourceView`, `runToolAndParse`). V3 injects these for testability.
3. **No readline/rl parameter** — V3 is autonomous-only. The `--oversight` flag is accepted but only "autonomous" is supported.
4. **No substages in state** — `V3SessionState` drops the `substages: ActSubstageState[]` field.

### Internal Flow (pseudocode)

```typescript
export async function runV3Loop(state, flags, sessionsDir, extensionRegistry, deps) {
  // Connect wallet early — needed for bridge AND computePerformance() (Codex review HIGH-2)
  const { demos, address } = await deps.connectWallet(flags.env);

  using bridge = initStrategyBridge(
    flags.agent,
    deps.agentConfig.paths.strategyYaml,
    address, // real wallet address from the start (fixes HIGH-2 wallet placeholder bug)
  );

  // ── beforeSense hooks ──
  await runBeforeSense(extensionRegistry, deps.agentConfig.loopExtensions, {
    state, config: deps.agentConfig,
    flags: { agent: flags.agent, env: flags.env, log: flags.log, dryRun: flags.dryRun, pretty: flags.pretty },
    logger: hookLogger,
  });

  // ── SENSE ──
  if (state.phases.sense.status !== "completed") {
    beginPhase(state, "sense", sessionsDir);
    const scanResult = await deps.runSubprocess("cli/scan-feed.ts", [...], "scan-feed");
    const sourceView = deps.getSourceView();
    const senseResult = sense(bridge, sourceView);
    completePhase(state, "sense", { scan: scanResult, strategy: senseResult }, sessionsDir);
  }

  // ── ACT ──
  // actResult declared at function scope so afterAct hooks can access it (Codex review HIGH-2)
  let actResult: unknown = undefined;

  if (state.phases.act.status !== "completed") {
    beginPhase(state, "act", sessionsDir);
    const senseResult = extractSenseResult(state);
    const planResult = await plan(bridge, senseResult, (state.engagements || []).length);

    if (planResult.actions.length > 0 && !flags.shadow) {
      const light = planResult.actions.filter(a => a.type === "ENGAGE" || a.type === "TIP");
      const heavy = planResult.actions.filter(a => a.type === "PUBLISH" || a.type === "REPLY");

      // Light actions — existing executor
      const sdkBridge = createSdkBridge(demos, undefined, AUTH_PENDING_TOKEN);
      const lightResult = await executeStrategyActions(light, {
        bridge: { publishHiveReaction: sdkBridge.publishHiveReaction.bind(sdkBridge), ... },
        dryRun: flags.dryRun,
        observe: deps.observe,
      });

      // Heavy actions — publish executor with full attestation pipeline
      const provider = deps.resolveProvider(flags.env);
      const heavyResult = await executePublishActions(heavy, {
        demos,
        walletAddress: address,
        provider,
        agentConfig: deps.agentConfig,
        sourceView: deps.getSourceView(),
        state,
        sessionsDir,
        observe: deps.observe,
        dryRun: flags.dryRun,
      });

      actResult = mergeExecutionResults(lightResult, heavyResult);
      completePhase(state, "act", actResult, sessionsDir);
    } else {
      actResult = { skipped: true, reason: flags.shadow ? "shadow" : "no actions" };
      completePhase(state, "act", actResult, sessionsDir);
    }

    await runAfterAct(extensionRegistry, deps.agentConfig.loopExtensions, {
      state, config: deps.agentConfig, actResult, flags: { ... }, logger: hookLogger,
    });
  }

  // ── CONFIRM ──
  if (state.phases.confirm.status !== "completed") {
    beginPhase(state, "confirm", sessionsDir);
    if (state.posts.length > 0) {
      const args = [...state.posts.map(getPostTxHash), "--json", "--log", flags.log, "--env", flags.env];
      const verifyResult = await deps.runSubprocess("cli/verify.ts", args, "verify");
      const perfScores = computePerformance(bridge);
      completePhase(state, "confirm", { verify: verifyResult, performance: perfScores }, sessionsDir);
    } else {
      completePhase(state, "confirm", { skipped: true, reason: "no posts" }, sessionsDir);
    }

    if (state.publishedPosts && state.publishedPosts.length > 0) {
      await runAfterConfirm(extensionRegistry, deps.agentConfig.loopExtensions, {
        state, config: deps.agentConfig, publishedPosts: state.publishedPosts,
        confirmResult: state.phases.confirm?.result, logger: hookLogger,
      });
    }
  }
  // bridge auto-disposed here via `using`
}
```

---

## Module 2: `cli/publish-executor.ts` (new file, ~200 lines)

Dedicated executor for PUBLISH and REPLY strategy actions. Wraps the full attestation pipeline.

### Function Signature

```typescript
export interface PublishActionResult {
  action: StrategyAction;
  success: boolean;
  txHash?: string;
  category?: string;
  textLength?: number;
  attestationType?: "DAHR" | "TLSN" | "none";
  error?: string;
}

export interface PublishExecutionResult {
  executed: PublishActionResult[];
  skipped: Array<{ action: StrategyAction; reason: string }>;
}

export interface PublishExecutorDeps {
  demos: Demos;
  walletAddress: string;
  provider: LLMProvider | null;
  agentConfig: AgentConfig;
  sourceView: AgentSourceView;
  state: V3SessionState;
  sessionsDir: string;
  observe: (type: string, message: string, meta?: Record<string, unknown>) => void;
  dryRun: boolean;
  // --- Added per Codex review findings 3-4 ---
  stateStore: FileStateStore;              // for checkAndRecordWrite() / getWriteRateRemaining()
  colonyDb?: ColonyDatabase;               // for reply-context loading (Finding 3)
  calibrationOffset: number;               // from calibrate plugin beforeSense result
  scanContext: { activity_level: string; posts_per_hour: number; gaps?: string[] };
  adapters?: Map<string, ProviderAdapter>; // for buildAttestationPlan()
  usageTracker?: SourceUsageTracker;       // for buildAttestationPlan() cross-action dedup
  logSession: (entry: unknown) => void;    // appendSessionLog wrapper
  logQuality: (data: unknown) => void;     // logQualityData wrapper
}

/**
 * Execute PUBLISH and REPLY strategy actions through the full attestation pipeline.
 *
 * For each action:
 * 1.  Rate limit check (checkAndRecordWrite via stateStore)
 * 2.  Reply context loading — if REPLY, fetch parent from colonyDb (Finding 3)
 * 3.  Source resolution (from action.evidence or catalog lookup)
 * 4.  Source data pre-fetch for LLM context
 * 5.  LLM text generation (generatePost with scanContext + calibrationOffset)
 * 6.  Quality checks (min length, predicted reactions)
 * 7.  Substantiation gate — verify draft matches source claims (Finding 2)
 * 8.  Claim extraction + attestation plan + execution (with adapters/tracker)
 * 9.  Verification (verifyAttestedValues)
 * 10. Fallback to single-attestation if claim path fails
 * 11. publishPost on-chain
 * 12. State persistence + logging (logSession, logQuality)
 */
export async function executePublishActions(
  actions: StrategyAction[],
  deps: PublishExecutorDeps,
): Promise<PublishExecutionResult>;
```

### What Moves From `runPublishAutonomous` Into This Module

The 563-line `runPublishAutonomous` currently mixes concerns. Here is how it decomposes:

**Stays in `runPublishAutonomous` (V2 legacy path):** The entire function stays as-is behind `--legacy-loop`. No modifications.

**Extracted into `publish-executor.ts`:** The per-action inner loop logic (lines 2132-2627 of session-runner.ts) is refactored into `executePublishActions`. Key differences from V2:

- **No gate dependency** — V2 reads `gatePosts` from a prior substage. V3 receives `StrategyAction[]` directly. The strategy engine already decided what to publish.
- **Source resolution from action metadata** — Instead of extension hooks (`beforePublishDraft`/`afterPublishDraft`), the publish executor resolves sources from `action.evidence[]` and `action.metadata`.
- **No `beforePublishDraft`/`afterPublishDraft` hooks** — Only the sources plugin uses them. V3 replaces with direct source resolution from strategy evidence.

### Source Resolution Strategy (simplified from V2's 4-path)

```typescript
async function resolveSourceForAction(
  action: StrategyAction,
  sourceView: AgentSourceView,
  agentConfig: AgentConfig,
): Promise<{ url: string; method: AttestationType; sourceName: string } | null> {
  // Path 1: Evidence from strategy engine (action.evidence[0] maps to source catalog)
  if (action.evidence?.length) {
    const source = findSourceByEvidence(action.evidence[0], sourceView);
    if (source) return source;
  }

  // Path 2: Topic-based catalog lookup (legacy fallback)
  const topic = action.metadata?.topics?.[0] ?? action.target ?? action.reason;
  const plan = resolveAttestationPlan(topic, agentConfig);
  const selection = selectSourceForTopicV2(topic, sourceView, plan.required);
  if (selection) {
    return { url: selection.url, method: plan.required, sourceName: selection.source.name };
  }

  return null; // Action skipped — no source
}
```

2 paths instead of 4. The `beforePublishDraft`/`afterPublishDraft` hook paths are eliminated.

### Reused Functions (zero refactoring needed)

| Function | Module | Type |
|----------|--------|------|
| `extractStructuredClaimsAuto()` | `src/lib/attestation/claim-extraction.ts` | Pure + LLM |
| `buildAttestationPlan()` | `src/lib/attestation/attestation-planner.ts` | Pure |
| `verifyAttestedValues()` | `src/lib/attestation/attestation-planner.ts` | Pure |
| `executeAttestationPlan()` | `src/actions/attestation-executor.ts` | Chain |
| `attestDahr()` | `src/actions/publish-pipeline.ts` | Chain |
| `attestTlsn()` | `src/actions/publish-pipeline.ts` | Chain |
| `publishPost()` | `src/actions/publish-pipeline.ts` | Chain |
| `generatePost()` | `src/actions/llm.ts` | LLM |
| `checkAndRecordWrite()` | `src/toolkit/guards/write-rate-limit.ts` | State |
| `getWriteRateRemaining()` | `src/toolkit/guards/write-rate-limit.ts` | State |
| `selectSourceForTopicV2()` | `cli/session-runner.ts` | Pure |
| `resolveAttestationPlan()` | `src/lib/attestation/attestation-policy.ts` | Pure |

---

## Module 3: Changes to `cli/session-runner.ts`

### 3a. Flag Parsing Changes

```typescript
// state.ts: Change LoopVersion
export type LoopVersion = 1 | 2 | 3;

// session-runner.ts parseArgs(): Change default and validation
let loopVersion: LoopVersion = 3;  // V3 is now default
if (flags["loop-version"]) {
  const val = Number(flags["loop-version"]);
  if (val !== 1 && val !== 2 && val !== 3) {
    console.error(`Error: --loop-version must be 1, 2, or 3`);
    process.exit(1);
  }
  loopVersion = val as LoopVersion;
}
// --legacy-loop is sugar for --loop-version 2
if (flags["legacy-loop"] === "true") {
  loopVersion = 2;
}
```

### 3b. Entry Point Dispatch

At line 4068, after `if (isV2(state))`:

```typescript
if (isV3(state)) {
  await runV3Loop(state, {
    agent: flags.agent, env: flags.env, log: flags.log,
    dryRun: flags.dryRun, pretty: flags.pretty, shadow: flags.shadow,
    oversight: flags.oversight,
  }, sessionsDir, extensionRegistry, {
    runSubprocess: runToolAndParse,
    connectWallet,
    resolveProvider,
    agentConfig,
    getSourceView,
    observe: (type, msg, meta) => observe(type as ObservationType, msg, meta as ObserveOptions),
  });
} else if (isV2(state)) {
  await runV2Loop(state as V2SessionState, flags, sessionsDir, rl, extensionRegistry);
} else {
  // V1
  ...
}
```

### 3c. Session Report Format

New `writeV3SessionReport()` alongside existing `writeV2SessionReport()`. Simpler — 3 sections (SENSE, ACT, CONFIRM), ACT lists executed actions by type, no substage breakdown.

### 3d. Help Text

Update `printHelp()` to document `--legacy-loop` and the new V3 default.

---

## Module 4: Changes to `src/lib/state.ts`

### V3SessionState

```typescript
export interface V3SessionState {
  loopVersion: 3;
  sessionNumber: number;
  agentName: string;
  startedAt: string;
  pid: number;
  phases: Record<CorePhase, PhaseState>;
  // No substages field — strategy actions replace substages
  posts: Array<string | SessionPostRecord>;
  engagements: Record<string, unknown>[];
  publishSuppressed?: boolean;
  publishedPosts?: PublishedPostRecord[];
  signalSnapshot?: unknown;
  priceSnapshot?: unknown;
  oracleSnapshot?: unknown;
  briefingContext?: string;
  pendingMentions?: PendingMentionRecord[];
  /** V3: Strategy execution results persisted for resume/reporting */
  strategyResults?: {
    senseResult?: unknown;
    planResult?: unknown;
    executionResult?: unknown;
  };
}

export type LoopVersion = 1 | 2 | 3;
export type AnySessionState = SessionState | V2SessionState | V3SessionState;

export function isV3(state: AnySessionState): state is V3SessionState {
  return "loopVersion" in state && state.loopVersion === 3;
}
```

### `startSession()` Update

Add `loopVersion === 3` case:

```typescript
if (loopVersion === 3) {
  const phases = Object.fromEntries(
    CORE_PHASE_ORDER.map((phase) => [phase, { status: "pending" as const }])
  ) as Record<CorePhase, PhaseState>;

  const state: V3SessionState = {
    loopVersion: 3,
    sessionNumber,
    agentName,
    startedAt: new Date().toISOString(),
    pid: process.pid,
    phases,
    posts: [],
    engagements: [],
  };
  saveState(state, sessionsDir);
  return state;
}
```

### `normalizeState()` Update

Add V3 branch:

```typescript
export function normalizeState(state: V3SessionState): V3SessionState;
// ... in implementation:
if (isV3(state)) {
  for (const phase of CORE_PHASE_ORDER) {
    if (!state.phases[phase]) state.phases[phase] = { status: "pending" };
  }
  if (!state.posts) state.posts = [];
  if (!state.engagements) state.engagements = [];
  if (!state.pendingMentions) state.pendingMentions = [];
  return state;
}
```

---

## Module 5: Changes to `src/lib/util/extensions.ts`

Deprecate V2-only hooks with JSDoc:

```typescript
/** @deprecated V3 loop does not use this hook. Retained for V2 --legacy-loop compatibility. */
export interface BeforePublishDraftContext { ... }

/** @deprecated V3 loop does not use this hook. Retained for V2 --legacy-loop compatibility. */
export interface AfterPublishDraftContext { ... }
```

The `LoopExtensionHooks` interface keeps all 5 hooks for V2 backward compatibility. No deletion during migration period.

V3 only invokes 3 hooks:
- `runBeforeSense()` — unchanged
- `runAfterAct()` — unchanged
- `runAfterConfirm()` — unchanged

---

## Extension Hook Simplification

| Hook | V2 | V3 | Plugin Users |
|------|----|----|-------------|
| beforeSense | YES | YES | calibrate, signals, predictions, tips, lifecycle, sc-oracle, sc-prices |
| beforePublishDraft | YES | **NO** | sources plugin only — replaced by strategy evidence |
| afterPublishDraft | YES | **NO** | sources plugin only — replaced by strategy evidence |
| afterAct | YES | YES | tips |
| afterConfirm | YES | YES | predictions |

Only the `sources` plugin uses the deprecated hooks. In V3, the strategy engine's `action.evidence[]` fields replace the preflight/match pattern.

### Plugin Migration Table

| Plugin | Hooks Used | Enabled in Sentinel | V3 Verdict |
|--------|-----------|--------------------|----|
| calibrate | beforeSense | YES | **KEEP** — calibration is core feedback loop |
| sources | beforePublishDraft, afterPublishDraft | YES | **MIGRATE** — replaced by strategy evidence |
| observe | (inline, no hooks) | YES | **KEEP** — observability |
| signals | beforeSense | YES | **KEEP** — signal aggregation pre-sense |
| predictions | beforeSense, afterConfirm | YES | **KEEP** — prediction tracking/calibration |
| tips | beforeSense, afterAct | YES | **KEEP** — autonomous engagement |
| lifecycle | beforeSense | YES | **KEEP** — source health state machine |
| sc-oracle | beforeSense | YES | **KEEP** — oracle data injection |
| sc-prices | beforeSense | YES | **KEEP** — price data injection |
| defi-markets | (DataProvider, no hooks) | NO | **KEEP** — no changes needed |
| infra-ops | (DataProvider, no hooks) | NO | **KEEP** — no changes needed |
| keyword-evaluator | (Factory, no hooks) | NO | **KEEP** — shared utility |
| network-health | (DataProvider, no hooks) | NO | **KEEP** — no changes needed |
| tlsn-attest | (DataProvider, no hooks) | NO | **KEEP** — no changes needed |
| sdk-setup | (DataProvider, no hooks) | NO | **KEEP** — no changes needed |
| demos-wallet | (DataProvider, no hooks) | NO | **KEEP** — no changes needed |
| cci-identity | (DataProvider, no hooks) | NO | **KEEP** — no changes needed |
| chain-query | (DataProvider, no hooks) | NO | **KEEP** — no changes needed |
| demoswork | (DataProvider, no hooks) | NO | **KEEP** — no changes needed |
| address-watch | (DataProvider, no hooks) | NO | **KEEP** — no changes needed |
| sc-predictions-markets | (DataProvider, no hooks) | NO | **KEEP** — no changes needed |
| index | (Barrel export) | N/A | **KEEP** — barrel |

---

## Test Strategy

### New Test Files

**`tests/cli/v3-loop.test.ts`** (~200 lines)
- Test the full SENSE->ACT->CONFIRM flow with mocked deps
- Test resume from each phase (sense completed, act completed)
- Test shadow mode skips publish actions
- Test `using` bridge disposal on success and error paths
- Test hook execution order (beforeSense, afterAct, afterConfirm)
- Test that `beforePublishDraft`/`afterPublishDraft` are NOT called

**`tests/cli/publish-executor.test.ts`** (~300 lines)
- Test PUBLISH action: source resolution -> LLM gen -> claims -> attestation -> publish
- Test REPLY action: same pipeline with replyTo field
- Test rate limit rejection skips action
- Test source resolution fallback (evidence -> catalog)
- Test claim attestation failure falls back to single attestation
- Test dry-run mode logs but doesn't execute
- Test state persistence (posts, publishedPosts updated)
- Test provider missing skips action gracefully

**`tests/cli/v3-state.test.ts`** (~50 lines)
- Test `isV3()` type guard
- Test `normalizeState()` for V3
- Test `startSession()` with loopVersion 3

### Existing Tests — No Changes Needed

- `tests/cli/action-executor.test.ts` — covers ENGAGE/TIP, unchanged
- `tests/cli/strategy-text-generator.test.ts` — covers text gen adapter, unchanged
- All attestation/publish pipeline tests — unchanged (functions reused as-is)
- All extension/plugin tests — unchanged

---

## Implementation Sequence (revised per Codex pre-implementation review, 2026-03-31)

> **Codex review findings incorporated (6 findings, 2 questions resolved):**
> - HIGH-1: getNextPhase()/getPhaseOrder() must handle V3 → expanded into Step 1
> - HIGH-2: actResult scope bug + wallet placeholder in shadow path → fixed in Step 4 pseudocode
> - HIGH-3: --shadow rejected for V3 → fix parser guard in Step 5
> - MED-4: Step 3 (substantiation.ts) unnecessary — preflight()/match() already exported → Step 3 ELIMINATED
> - MED-5: Cross-resume guard in session-runner.ts → validateResumeVersion() in state.ts, called from session-runner
> - MED-6: lookupPost() nonexistent → use getPost() from src/toolkit/colony/posts.ts

```
1. src/lib/state.ts                    — V3SessionState, isV3(), LoopVersion=1|2|3,
                                         getNextPhase() V3 branch, getPhaseOrder() V3 branch,
                                         normalizeState() V3 branch, startSession() V3 branch,
                                         validateResumeVersion() (new export)
   + tests/cli/v3-state.test.ts        — including cross-resume rejection, phase ordering
   (atomic commit — MUST ship before any V3 loop code)

2. src/lib/util/extensions.ts          — widen hook contexts to AnySessionState (Finding 1)
   + src/plugins/*.ts (4 plugins)      — update loopVersion guards to >= 2
   (must ship before V3 loop to avoid silent plugin breakage)

3. [ELIMINATED — preflight()/match() already exported from src/lib/sources/index.ts.
    publish-executor imports them directly. No new module needed.]

4. cli/publish-executor.ts             — new module, expanded deps
   + tests/cli/publish-executor.test.ts
   (depends on: state.ts; uses getPost() from toolkit/colony/posts.ts,
    preflight() from lib/sources/policy.ts, match() from lib/sources/matcher.ts)

5. cli/v3-loop.ts                      — new module (fix: actResult scope, wallet before bridge)
   + cli/session-runner.ts             — wiring, flag defaults, --shadow guard for V3,
                                         --skip-to validation for V3, V3 report
   + tests/cli/v3-loop.test.ts
   (depends on: state.ts, publish-executor.ts, action-executor.ts, v3-strategy-bridge.ts)
```

Steps 1 and 2 can be parallel. Steps 3→4→5 are sequential (3 is now just step 4). Each step is a separate commit with tests.

### Revised Batch Plan (for Codex delegation)

- **Batch A** (parallel): Step 1 (A1: state.ts) + Step 2 (A2: hooks+plugins)
- **Batch B** (sequential): Step 4 (B1: publish-executor.ts)
- **Batch C** (sequential): Step 5 (C1: v3-loop.ts + session-runner wiring)

---

## Migration Plan (3 phases)

### Phase A: Ship V3 as opt-in (1-2 sessions)
- V3 loop code ships but default remains `--loop-version 2`
- Operators can test with `--loop-version 3`
- V2 loop untouched

### Phase B: V3 becomes default (this deliverable)
- Default changes from 2 to 3 in `parseArgs()`
- `--legacy-loop` flag maps to `--loop-version 2`
- V2 code stays fully intact

### Phase C: V2 sunset (after 10 successful V3 sessions)
- `--legacy-loop` emits a deprecation warning
- V1 loop (`runFullLoop`) can be removed (already dead code for all agents)
- V2 loop retained but frozen — no new features
- Proceed to Step 5d (dead code deletion)

### Rollback

If V3 has issues:
1. Change default back to 2 in `parseArgs()` — single line change
2. All V2 code is untouched, no merge conflicts
3. V2 state files are still valid (different `loopVersion` discriminator)
4. V3 state files cannot be resumed as V2 (version mismatch check at line 3952 handles this)

---

## Review Findings (Fabric Design Review + Codex Review, 2026-03-31)

Both reviews validated Option B (two executors) as architecturally sound. Codex caught 6 findings (2 high, 4 medium). Fabric caught 2 additional (1 medium, 1 low). All 8 are addressed below with plan amendments.

### Finding 1 — HIGH: V3 hooks typed against V2 state, plugins silently break

**Problem:** `BeforeSenseContext` is typed against `V2SessionState`. Plugins like `signals`, `sc-prices`, `sc-oracle` branch on `loopVersion === 2` and write `signalSnapshot`, `priceSnapshot`, etc. V3 state wouldn't get populated.

**Fix:** Update `BeforeSenseContext`, `AfterActContext`, `AfterConfirmContext` in `src/lib/util/extensions.ts` to accept `AnySessionState` (not just `V2SessionState`). Update plugin guards: change `loopVersion === 2` checks to `loopVersion >= 2` or remove the guard entirely (all V2+ loops use the same state fields). This is a **prerequisite** — must ship in Step 1 alongside `V3SessionState`.

**Files affected:** `src/lib/util/extensions.ts`, `src/plugins/signals-plugin.ts`, `src/plugins/tips-plugin.ts`, `src/plugins/sc-prices-plugin.ts`, `src/plugins/sc-oracle-plugin.ts`, `src/plugins/predictions-plugin.ts`, `src/plugins/calibrate-plugin.ts`

### Finding 2 — HIGH: Dropping publish hooks removes substantiation gate

**Problem:** V2's `beforePublishDraft`/`afterPublishDraft` don't just pick sources — they preflight candidates, prefetch data, run post-generation `match()`, and **reject unsubstantiated drafts**. The plan's `action.evidence[0]` replacement is behaviorally weaker. V3 could publish drafts V2 would reject.

**Fix:** Port the substantiation gate into `publish-executor.ts` as an explicit step between LLM generation and attestation:
```
Step 5 (revised): Substantiation gate
  - After LLM draft generation, run source preflight on the draft text
  - Verify at least one source candidate matches the draft's claims
  - If no substantiation: skip action with reason "unsubstantiated draft"
  - This replaces the `afterPublishDraft` hook with explicit inline logic
```
The preflight/match functions from `sources-plugin.ts` (lines 40-90) should be extracted into a shared `src/lib/sources/substantiation.ts` module that both the V2 hook path and V3 publish-executor can call.

**Files affected:** New `src/lib/sources/substantiation.ts`, `cli/publish-executor.ts`, `src/plugins/sources-plugin.ts` (delegates to shared module)

### Finding 3 — MEDIUM: REPLY path missing parent context

**Problem:** `generatePost()` needs `replyTo: { txHash, author, text }` but `StrategyAction` only has `target` (txHash) and sparse metadata. The `reply_with_evidence` rule only emits target + evidence IDs + topics + reply count.

**Fix:** Add a reply-context loading step in `publish-executor.ts` before LLM generation:
```typescript
// For REPLY actions: fetch parent post from colony cache
if (action.type === "REPLY" && action.target) {
  const parentPost = deps.colonyDb
    ? getPost(deps.colonyDb, action.target)  // from src/toolkit/colony/posts.ts (Codex review MED-6)
    : null;
  replyContext = parentPost
    ? { txHash: action.target, author: parentPost.author, text: parentPost.text }
    : { txHash: action.target, author: action.metadata?.author ?? "unknown", text: action.reason };
}
```
Add `colonyDb?: ColonyDatabase` to `PublishExecutorDeps`. The V3 loop already has the colony DB via the strategy bridge — pass `bridge.db` to the publish executor.

**Files affected:** `cli/publish-executor.ts` (add reply-context loading), `PublishExecutorDeps` (add `colonyDb`)

### Finding 4 — MEDIUM: `PublishExecutorDeps` too narrow

**Problem:** Missing: calibration offset, `scanContext`, declarative adapters for `buildAttestationPlan()`, `FileStateStore` for write limits, source fetch functions, log sinks (`appendSessionLog`, `logQualityData`).

**Fix:** Expand `PublishExecutorDeps`:
```typescript
export interface PublishExecutorDeps {
  demos: Demos;
  walletAddress: string;
  provider: LLMProvider | null;
  agentConfig: AgentConfig;
  sourceView: AgentSourceView;
  state: V3SessionState;
  sessionsDir: string;
  observe: (type: string, message: string, meta?: Record<string, unknown>) => void;
  dryRun: boolean;
  // --- Added per review ---
  stateStore: FileStateStore;              // for checkAndRecordWrite()
  colonyDb?: ColonyDatabase;               // for reply-context loading (Finding 3)
  calibrationOffset: number;               // from calibrate plugin beforeSense
  scanContext: { activity_level: string; posts_per_hour: number; gaps?: string[] };  // from SENSE result
  adapters?: Map<string, ProviderAdapter>; // for buildAttestationPlan()
  usageTracker?: SourceUsageTracker;       // for buildAttestationPlan()
  logSession: (entry: unknown) => void;    // appendSessionLog wrapper
  logQuality: (data: unknown) => void;     // logQualityData wrapper
}
```

### Finding 5 — MEDIUM: "Reused as-is" count inaccurate

**Problem:** Plan says 9, table lists 12. Several need extra wiring at the seam. `selectSourceForTopicV2()` location is wrong.

**Fix:** Correct the inventory. Functions truly reusable as-is (no extra wiring at call site):
- `attestDahr()`, `attestTlsn()`, `publishPost()`, `attestAndPublish()` — direct calls
- `extractStructuredClaimsAuto()` — direct call
- `verifyAttestedValues()` — direct call

Functions reusable but need wiring (deps must provide prerequisites):
- `generatePost()` — needs full `GeneratePostInput` (assembled from action + scanContext + calibrationOffset)
- `buildAttestationPlan()` — needs adapter maps + usage tracker (from `PublishExecutorDeps`)
- `executeAttestationPlan()` — needs `Demos` instance (from deps)
- `checkAndRecordWrite()` / `getWriteRateRemaining()` — needs `FileStateStore` (from deps)
- `selectSourceForTopicV2()` — already exported from `src/lib/sources/index.ts`, NOT from session-runner

**Total: 6 direct + 5 wired = 11 reusable functions. Zero need refactoring.**

### Finding 6 — MEDIUM: Rollback guard doesn't know V3 yet

**Problem:** Current code computes `stateVersion = isV2(active) ? 2 : 1`. V3 state would be misidentified as V1. All state/resume code must be updated together.

**Fix:** Step 1 (state.ts changes) MUST include:
- `LoopVersion = 1 | 2 | 3`
- `isV3()` type guard
- `startSession()` V3 case
- `normalizeState()` V3 branch
- Resume guard: `stateVersion = isV3(active) ? 3 : isV2(active) ? 2 : 1`

These ship as one atomic commit BEFORE any V3 loop code. Add a test in `tests/cli/v3-state.test.ts`:
```typescript
it("resume guard rejects V2→V3 cross-resume", () => { ... });
it("resume guard rejects V3→V2 cross-resume", () => { ... });
```

### Finding 7 — MEDIUM: `AUTH_PENDING_TOKEN` naming misleading (Fabric)

**Problem:** The constant name suggests pending auth, but it's actually the chain-only path (no API auth needed for on-chain operations).

**Fix:** Rename to `CHAIN_ONLY_TOKEN` or add a doc comment:
```typescript
/**
 * Token placeholder for chain-only SDK bridge operations.
 * No API authentication needed — all operations go through on-chain TX pipeline.
 * NOT a security placeholder — this is the intended production value for chain-only paths.
 */
export const AUTH_PENDING_TOKEN = "__AUTH_PENDING__";
```
Renaming is preferred but touches more files. At minimum, add the doc comment during Phase 5 implementation.

### Finding 8 — LOW: Extract `selectSourceForTopicV2()` to shared module (Fabric)

**Problem:** Plan incorrectly states this function is in session-runner.ts. It's already exported from `src/lib/sources/index.ts`.

**Fix:** No extraction needed — the plan was wrong about its location. Update the plan's reference. The publish-executor imports from `src/lib/sources/index.ts` directly.

### Finding 9 — HIGH: Resume semantics for `strategyResults` undefined (Codex review 2)

**Problem:** `V3SessionState.strategyResults` is declared for resume/reporting, but the pseudocode writes SENSE output into `completePhase(state, "sense", { scan, strategy })` without specifying where `planResult` or `executionResult` are persisted. `extractSenseResult(state)` is called but never defined. ACT resume is ambiguous — if the phase crashes mid-execution, what state is recoverable?

**Fix:** Define an explicit persisted-state contract for V3:
```
After SENSE:  state.phases.sense.result = { scan: scanResult, colony: { colonyState, evidence } }
              state.strategyResults.senseResult = colonyState + evidence (serializable subset)

After PLAN:   state.strategyResults.planResult = { actions: [...], log: decisionLog }
              saveState(state, sessionsDir)  // <-- persist BEFORE execution starts

After each executed action:
              state.strategyResults.executionResult.push(actionResult)
              saveState(state, sessionsDir)  // <-- persist incrementally

ACT resume:   if strategyResults.planResult exists but executionResult is partial,
              skip already-executed actions (by txHash dedup) and continue with remaining
```

Add `extractSenseResult()` as a helper that reads `state.phases.sense.result.colony` or falls back to re-running sense if the result is malformed.

### Finding 10 — HIGH: Partial V3 sessions stranded on rollback (Codex review 2)

**Problem:** If a V3 session partially executes ACT (some posts published, some pending), then rollback to V2 is requested, the V3 state file is stranded. Cross-version resume is blocked. Operators have no recovery path beyond manual JSON editing.

**Fix:** Add a `--abandon-session` flag that:
1. Marks all incomplete phases as `failed` with reason `"abandoned"`
2. Releases the session lock
3. Starts a fresh session with the requested loop version

Also add a `--clear-session` variant (already exists in V2) that deletes the state file entirely.

Document in help text:
```
If a V3 session is stranded after rollback to V2:
  npx tsx cli/session-runner.ts --agent sentinel --abandon-session
  npx tsx cli/session-runner.ts --agent sentinel --loop-version 2 --pretty
```

### Finding 11 — MEDIUM: No shared contract between light and heavy executors (Codex review 2)

**Problem:** Both executors share one planning result, one wallet, one merge step, and one ACT phase result. But there's no defined contract for ordering, idempotency, observation format, or state-update responsibilities.

**Fix:** Define a shared `ActionExecutionSummary` interface:
```typescript
export interface ActionExecutionSummary {
  type: ActionType;
  success: boolean;
  txHash?: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
  durationMs: number;
}
```

Both `executeStrategyActions()` and `executePublishActions()` return results that map to this interface. The `mergeExecutionResults()` function in `v3-loop.ts` normalizes both into a unified `ActionExecutionSummary[]` before persisting.

**Ordering contract:** Light actions execute first (ENGAGE/TIP are faster, and their reactions may influence colony state). Heavy actions execute second. This matches the V2 substage order (engage → gate → publish).

**Idempotency:** Each executed action is identified by `{ type, target }`. On resume, skip actions whose `{ type, target }` already appears in `state.strategyResults.executionResult`.

### Finding 12 — MEDIUM: `PublishExecutorDeps` doesn't inject side-effecting operations for unit testing (Codex review 2)

**Problem:** `generatePost`, `attestDahr`, `attestTlsn`, `executeAttestationPlan`, `publishPost` are all imported directly in the publish executor. Tests would need `vi.mock()` for every module, making them brittle.

**Fix:** Add injectable function deps for the expensive operations:
```typescript
export interface PublishExecutorDeps {
  // ... existing deps ...
  // --- Added per Finding 12 ---
  generatePost: (input: GeneratePostInput, provider: LLMProvider, config?: LLMConfig) => Promise<PostDraft>;
  executeAttestationPlan: (plan: AttestationPlan, demos: Demos, options?: ExecutionOptions) => Promise<ExecutionResult>;
  publishPost: (demos: Demos, input: PublishInput, options?: PublishOptions) => Promise<PublishResult>;
  attestDahr: (demos: Demos, url: string, method?: string) => Promise<AttestResult>;
  attestTlsn: (demos: Demos, url: string, method?: string) => Promise<AttestResult>;
}
```

The V3 loop wires the real implementations; tests inject mocks directly without `vi.mock()`. This follows the same DI pattern as `V3LoopDeps`.

---

## Risks and Mitigations (updated with review findings)

| Risk | Mitigation |
|------|-----------|
| Strategy engine produces no PUBLISH actions for a topic V2 gate would have passed | Strategy YAML rules tunable without code. 10-session `--legacy-loop` window for comparison. |
| **Substantiation gate removal weakens post quality (Finding 2)** | **Port preflight+match into publish-executor as explicit substantiation step. Extract shared module from sources-plugin.** |
| **V3 hooks break plugin data injection (Finding 1)** | **Widen hook context types to `AnySessionState`. Update plugin `loopVersion` guards to `>= 2`.** |
| **REPLY actions lose parent context (Finding 3)** | **Load parent post from colony cache in publish-executor. Pass `colonyDb` in deps.** |
| **Rollback guard misidentifies V3 state (Finding 6)** | **Ship all state.ts changes as atomic Step 1 with cross-resume rejection tests.** |
| `using` declaration behavior with async functions | Already verified — StrategyBridge implements Disposable, `using` works with Node 22 + tsx. |
| `selectSourceForTopicV2()` location | Already in `src/lib/sources/index.ts` (Finding 8 — plan was wrong). |
| `AUTH_PENDING_TOKEN` naming confusion (Finding 7) | Add doc comment or rename to `CHAIN_ONLY_TOKEN`. |
| **Partial V3 session stranded on rollback (Finding 10)** | **Add `--abandon-session` flag to mark incomplete phases as failed and release lock.** |
| **Resume crashes mid-ACT with partial execution (Finding 9)** | **Persist plan + execution results incrementally. Resume skips by txHash dedup.** |
| **Light/heavy executor drift (Finding 11)** | **Shared `ActionExecutionSummary` interface + `mergeExecutionResults()` normalizer.** |
| **Publish executor hard to unit-test (Finding 12)** | **Inject `generatePost`, `attestDahr`, `publishPost` etc. via deps, not module imports.** |

---

## What Gets Deleted vs. Kept

### Deleted (in Phase C sunset, NOT in this deliverable)
- Nothing. All V2 code is retained behind `--legacy-loop`.

### Kept As-Is (no modifications)
- `cli/action-executor.ts` — ENGAGE/TIP executor
- `cli/v3-strategy-bridge.ts` — strategy bridge (already Disposable)
- `cli/strategy-text-generator.ts` — text generation callback
- `src/actions/publish-pipeline.ts` — `attestDahr`, `attestTlsn`, `publishPost`
- `src/actions/attestation-executor.ts` — `executeAttestationPlan`
- `src/lib/attestation/claim-extraction.ts` — `extractStructuredClaimsAuto`
- `src/lib/attestation/attestation-planner.ts` — `buildAttestationPlan`, `verifyAttestedValues`
- All 22 plugins (`src/plugins/*.ts`)
- All test files for reused modules

### Modified
- `src/lib/state.ts` — add `V3SessionState`, `isV3()`, update `LoopVersion`, `AnySessionState`, `startSession`, `normalizeState`, resume guard (Finding 6)
- `cli/session-runner.ts` — flag parsing, entry point dispatch, V3 report writer, help text, resume guard update
- `src/lib/util/extensions.ts` — widen hook context types to `AnySessionState` (Finding 1), deprecation JSDoc on publish hooks
- `src/plugins/signals-plugin.ts` — update `loopVersion` guard to `>= 2` (Finding 1)
- `src/plugins/sc-prices-plugin.ts` — update `loopVersion` guard to `>= 2` (Finding 1)
- `src/plugins/sc-oracle-plugin.ts` — update `loopVersion` guard to `>= 2` (Finding 1)
- `src/plugins/tips-plugin.ts` — update `loopVersion` guard to `>= 2` (Finding 1)
- `src/plugins/predictions-plugin.ts` — update `loopVersion` guard to `>= 2` (Finding 1)
- `src/plugins/calibrate-plugin.ts` — update `loopVersion` guard to `>= 2` (Finding 1)
- `src/plugins/sources-plugin.ts` — extract preflight/match into shared module (Finding 2)

### New
- `cli/v3-loop.ts` — V3 loop function (~250 lines)
- `cli/publish-executor.ts` — PUBLISH/REPLY action executor (~250 lines, expanded per Findings 2-4)
- `src/lib/sources/substantiation.ts` — extracted substantiation gate logic (Finding 2)
- `tests/cli/v3-loop.test.ts` (~200 lines)
- `tests/cli/publish-executor.test.ts` (~350 lines, expanded for substantiation + reply context)
- `tests/cli/v3-state.test.ts` (~80 lines, expanded for cross-resume rejection tests)

---

## Publish Pipeline Analysis (from exploration)

### V2 `runPublishAutonomous()` — 563 lines, mixed concerns

The V2 publish function handles: wallet connection, rate limits, extension hook preflight, LLM generation, source matching (4 fallback paths), quality checks, claim extraction, attestation planning, attestation execution, value verification, single-attestation fallback, on-chain publishing, session logging, quality data persistence, state updates.

### V3 `executePublishActions()` — ~200 lines, single concern

The V3 version only handles the per-action pipeline. Wallet connection, rate limits, and state are injected via deps. Source matching is 2 paths (evidence + catalog). No extension hooks.

### Reusability Summary

| Component | Lines | Chain Op | Reusable |
|-----------|-------|----------|----------|
| `attestDahr()` | 85 | YES | As-is |
| `attestTlsn()` | 35 | YES | As-is |
| `publishPost()` | 131 | YES | As-is |
| `attestAndPublish()` | 72 | YES | As-is |
| `buildAttestationPlan()` | 100 | NO | As-is |
| `verifyAttestedValues()` | 96 | NO | As-is |
| `executeAttestationPlan()` | 77 | YES | As-is |
| `extractStructuredClaimsAuto()` | 13 | NO | As-is |
| `extractStructuredClaims()` | 43 | NO | As-is |
| `runGateAutonomous()` | 150 | NO | NOT needed in V3 (strategy engine replaces gate) |
| `runPublishAutonomous()` | 563 | YES | NOT needed in V3 (replaced by publish-executor) |
