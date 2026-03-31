# Phase 5 — Step C1: V3 Loop + Session Runner Wiring

## Task

Create `cli/v3-loop.ts` with `runV3Loop()` and wire it into `cli/session-runner.ts`. Create `tests/cli/v3-loop.test.ts`.

## Context

This is the final step of Phase 5. All prior steps must be merged:
- A1: V3SessionState, isV3(), validateResumeVersion() in state.ts
- A2: Hook types widened to AnySessionState, plugin guards updated
- B1: cli/publish-executor.ts with executePublishActions()

## What to Do

### 1. Create `cli/v3-loop.ts` (~250 lines)

**CRITICAL DESIGN DECISIONS (from Codex review):**

1. **Wallet connected BEFORE bridge init** — not lazily inside ACT. This ensures `computePerformance()` in CONFIRM always has the real wallet address, not a placeholder.
2. **`let actResult` at function scope** — not inside the `if (actions.length > 0)` block. The afterAct hook needs access regardless of whether actions executed.
3. **`using bridge`** for automatic disposal via Disposable protocol.

**Interfaces:**

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
  runSubprocess: (script: string, args: string[], label: string) => Promise<unknown>;
  connectWallet: (envPath: string) => Promise<{ demos: any; address: string }>;
  resolveProvider: (envPath: string) => LLMProvider | null;
  agentConfig: AgentConfig;
  getSourceView: () => AgentSourceView;
  observe: (type: string, message: string, meta?: Record<string, unknown>) => void;
}
```

**Flow (pseudocode with bugs fixed):**

```typescript
export async function runV3Loop(state, flags, sessionsDir, extensionRegistry, deps) {
  // Connect wallet early — needed for bridge AND computePerformance()
  const { demos, address } = await deps.connectWallet(flags.env);

  using bridge = initStrategyBridge(
    flags.agent,
    deps.agentConfig.paths.strategyYaml,
    address, // real wallet address from the start
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
    const scanResult = await deps.runSubprocess("cli/scan-feed.ts", [...scanArgs], "scan-feed");
    const sourceView = deps.getSourceView();
    const senseResult = sense(bridge, sourceView);
    completePhase(state, "sense", { scan: scanResult, strategy: senseResult }, sessionsDir);
  }

  // ── ACT ──
  let actResult: unknown = undefined; // function-scoped for afterAct hooks

  if (state.phases.act.status !== "completed") {
    beginPhase(state, "act", sessionsDir);
    const senseResult = extractSenseResult(state);
    const planResult = await plan(bridge, senseResult, (state.engagements || []).length);

    if (planResult.actions.length > 0 && !flags.shadow) {
      const light = planResult.actions.filter(a => a.type === "ENGAGE" || a.type === "TIP");
      const heavy = planResult.actions.filter(a => a.type === "PUBLISH" || a.type === "REPLY");

      // Light actions — existing executor
      const sdkBridge = createSdkBridge(demos, undefined, AUTH_PENDING_TOKEN);
      const lightResult = await executeStrategyActions(light, { ... });

      // Heavy actions — publish executor
      const provider = deps.resolveProvider(flags.env);
      const heavyResult = await executePublishActions(heavy, { ... });

      actResult = mergeExecutionResults(lightResult, heavyResult);
    } else {
      actResult = { skipped: true, reason: flags.shadow ? "shadow" : "no actions" };
    }

    completePhase(state, "act", actResult, sessionsDir);

    await runAfterAct(extensionRegistry, deps.agentConfig.loopExtensions, {
      state, config: deps.agentConfig, actResult,
      flags: { agent: flags.agent, env: flags.env, log: flags.log, dryRun: flags.dryRun, pretty: flags.pretty },
      logger: hookLogger,
    });
  }

  // ── CONFIRM ──
  if (state.phases.confirm.status !== "completed") {
    beginPhase(state, "confirm", sessionsDir);
    if (state.posts.length > 0) {
      const txHashes = state.posts.map(p => typeof p === "string" ? p : p.txHash);
      const verifyResult = await deps.runSubprocess("cli/verify.ts",
        [...txHashes, "--json", "--log", flags.log, "--env", flags.env], "verify");
      const perfScores = computePerformance(bridge);
      completePhase(state, "confirm", { verify: verifyResult, performance: perfScores }, sessionsDir);
    } else {
      completePhase(state, "confirm", { skipped: true, reason: "no posts" }, sessionsDir);
    }

    if (state.publishedPosts && state.publishedPosts.length > 0) {
      await runAfterConfirm(extensionRegistry, deps.agentConfig.loopExtensions, {
        state, config: deps.agentConfig,
        publishedPosts: state.publishedPosts,
        confirmResult: state.phases.confirm?.result,
        logger: hookLogger,
      });
    }
  }
  // bridge auto-disposed here via `using`
}
```

**Import the strategy bridge functions:**
```typescript
import { initStrategyBridge, sense, plan, computePerformance } from "./v3-strategy-bridge.js";
import type { StrategyBridge } from "./v3-strategy-bridge.js";
```

### 2. Update `cli/session-runner.ts`

**2a. Flag parsing — allow `--shadow` for V3 (Codex review HIGH-3):**

Find the `--shadow` validation guard (around line 323-335) that rejects shadow for non-V2. Change it to allow V2 AND V3:
```typescript
// Before: if (flags.shadow && loopVersion !== 2) { error + exit }
// After: if (flags.shadow && loopVersion === 1) { error + exit }
```

**2b. `--skip-to` validation for V3:**

The `--skip-to` parser validates against `getPhaseOrder()`. Since Step A1 already updated `getPhaseOrder()` to return `CORE_PHASE_ORDER` for V3, this should work automatically. But verify: if `parseArgs()` calls `getPhaseOrder()` before `loopVersion` is determined, there may be an ordering issue. Fix if needed.

**2c. Flag default — V3 is now default:**

```typescript
let loopVersion: LoopVersion = 3; // was 2
```

**2d. `--legacy-loop` sugar:**
```typescript
if (flags["legacy-loop"] === "true") {
  loopVersion = 2;
}
```

**2e. Entry point dispatch** (around line 4068):

Add V3 dispatch BEFORE the existing V2 check:
```typescript
if (isV3(state)) {
  await runV3Loop(state as V3SessionState, {
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
  // existing V2 path unchanged
}
```

**2f. Resume guard wiring:**

In the resume path (around line 3976 where `stateVersion` is computed), replace:
```typescript
const stateVersion = isV2(active) ? 2 : 1;
```
with:
```typescript
import { validateResumeVersion } from "../src/lib/state.js";
// ... in resume logic:
validateResumeVersion(active, loopVersion);
```

**2g. V3 session report:**

Add `writeV3SessionReport()` — simpler than V2, 3 sections (SENSE, ACT, CONFIRM). ACT lists executed actions by type. No substage breakdown.

**2h. Help text:**

Update `printHelp()` to document `--legacy-loop` and the V3 default.

### 3. Create `tests/cli/v3-loop.test.ts`

Test the following (mock all deps via V3LoopDeps injection):
- Full SENSE → ACT → CONFIRM flow with mocked deps
- Resume from sense completed (skips sense, runs act + confirm)
- Resume from act completed (skips sense + act, runs confirm)
- Shadow mode — actions planned but not executed, actResult = { skipped: true, reason: "shadow" }
- No actions — actResult = { skipped: true, reason: "no actions" }
- `using` bridge disposal on success path
- `using` bridge disposal on error path (error thrown mid-loop)
- Hook execution order: beforeSense → afterAct → afterConfirm
- V3 does NOT call beforePublishDraft or afterPublishDraft hooks
- Wallet connected before bridge initialization

## Constraints

- Do NOT modify any V2 or V1 loop code — V2 path must remain untouched
- All chain operations MUST use `executeChainTx()` from `src/toolkit/chain/tx-pipeline.ts`
- `npx tsc --noEmit` must pass
- `npm test` must pass — all 2166+ existing tests plus new tests
- The V3 loop is autonomous-only — `--oversight` is accepted but only "autonomous" is supported
