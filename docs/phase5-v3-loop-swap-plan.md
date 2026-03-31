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
  using bridge = initStrategyBridge(
    flags.agent,
    deps.agentConfig.paths.strategyYaml,
    flags.agent, // lazy wallet placeholder
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
  if (state.phases.act.status !== "completed") {
    beginPhase(state, "act", sessionsDir);
    const senseResult = extractSenseResult(state);
    const planResult = await plan(bridge, senseResult, (state.engagements || []).length);

    if (planResult.actions.length > 0 && !flags.shadow) {
      const { demos, address } = await deps.connectWallet(flags.env);
      bridge.updateWalletAddress(address); // <-- fixes the TODO from Phase 3

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

      const actResult = mergeExecutionResults(lightResult, heavyResult);
      completePhase(state, "act", actResult, sessionsDir);
    } else {
      completePhase(state, "act", { skipped: true, reason: flags.shadow ? "shadow" : "no actions" }, sessionsDir);
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
}

/**
 * Execute PUBLISH and REPLY strategy actions through the full attestation pipeline.
 *
 * For each action:
 * 1. Rate limit check (write-rate-limit guard)
 * 2. Source resolution (from action.evidence or catalog lookup)
 * 3. Source data pre-fetch for LLM context
 * 4. LLM text generation (generatePost)
 * 5. Quality checks (min length, predicted reactions)
 * 6. Claim extraction + attestation plan + execution
 * 7. Fallback to single-attestation if claim path fails
 * 8. publishPost on-chain
 * 9. State persistence (posts, publishedPosts)
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

## Implementation Sequence

```
1. src/lib/state.ts              — V3SessionState, isV3(), LoopVersion update
   (no deps on other changes)

2. cli/publish-executor.ts       — new module
   (depends on: state.ts for V3SessionState)
   (imports from: attestation pipeline, publish pipeline, sources — all existing)

3. cli/v3-loop.ts                — new module
   (depends on: state.ts, publish-executor.ts, action-executor.ts, v3-strategy-bridge.ts)

4. cli/session-runner.ts         — wiring
   (depends on: v3-loop.ts, state.ts)

5. src/lib/util/extensions.ts    — deprecation annotations
   (independent, can be done anytime)

6. tests/*                       — all test files
   (depend on: modules 1-4)
```

Steps 1 and 5 can be done in parallel. Steps 2 and 3 are sequential. Step 4 depends on 3. Step 6 depends on 1-4.

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

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Strategy engine produces no PUBLISH actions for a topic the V2 gate would have passed | Strategy YAML rules tunable without code changes. The 10-session `--legacy-loop` window provides comparison data. |
| Source resolution from `action.evidence[]` is less robust than the 4-path V2 fallback | Publish executor keeps catalog-lookup fallback (Path 2). Only the extension-hook paths (`beforePublishDraft`/`afterPublishDraft`) are removed. The sources plugin's matching logic was layered on top of catalog lookup anyway. |
| `using` declaration behavior with async functions | Already verified — StrategyBridge implements `Disposable` and `using` works with Node 22 + tsx. `using` provides synchronous disposal at block exit, sufficient for closing SQLite colony DB. |
| V3 state files cannot be resumed as V2 | Version mismatch guard at session-runner.ts line 3952 handles this cleanly — blocks cross-version resume with clear error message. |
| `selectSourceForTopicV2()` is defined inside session-runner.ts (not exported) | Extract to a shared module or import from session-runner. Minor refactor. |

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
- `src/lib/state.ts` — add `V3SessionState`, `isV3()`, update `LoopVersion`, `AnySessionState`, `startSession`, `normalizeState`
- `cli/session-runner.ts` — flag parsing, entry point dispatch, V3 report writer, help text
- `src/lib/util/extensions.ts` — deprecation JSDoc on `beforePublishDraft`/`afterPublishDraft`

### New
- `cli/v3-loop.ts` — V3 loop function (~250 lines)
- `cli/publish-executor.ts` — PUBLISH/REPLY action executor (~200 lines)
- `tests/cli/v3-loop.test.ts` (~200 lines)
- `tests/cli/publish-executor.test.ts` (~300 lines)
- `tests/cli/v3-state.test.ts` (~50 lines)

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
