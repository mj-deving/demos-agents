# Codex Review: Phase 2 — Core Loop Refactor

**Reviewer:** Codex (gpt-5.3-codex)
**Date:** 2026-03-13
**Session:** 019ce76c-a904-7a70-aef6-e1fc03b277ee
**Type check:** `npx tsc --noEmit` — PASS
**Status:** All findings FIXED (see below)

---

## P0 (Critical)
- None.

## P1 (High)

### 1. [FIXED] V2 gate path calls v1 scan accessor — `state.phases.scan` doesn't exist in v2

**References:** session-runner.ts:2539, :2543, :1358, :993

```ts
await runGateAutonomous(state as any, flags);
// runGateAutonomous → extractTopicsFromScan(state, flags.log)
// extractTopicsFromScan:
const scan = state.phases.scan.result || {};
```

**Impact:** V2 state uses `phases.sense`, not `phases.scan`. The `as any` cast masks this mismatch. Gate sees no scan data → no topics extracted → no posts gated → publish always skipped in v2.

**Fix:** Bridge scan data before calling v1 gate handlers:
```ts
// Before calling runGateAutonomous in v2:
(state as any).phases.scan = state.phases.sense;
```
Or refactor `extractTopicsFromScan` to use `getScanResult(state)` accessor.

**Resolution:** Widened `extractTopicsFromScan`, `runGateAutonomous`, `runGateApprove`, `runPublishAutonomous`, `runPublishManual`, `getStateFilePath` to accept `AnySessionState`. Used `getScanResult()`/`getGateResult()` accessors throughout. Added v1-compat fallback in `getGateResult()` for v2 (reads `(state as any).phases.gate` where v1 handlers write during ACT). Removed `as any` casts on v2→v1 handler calls.

### 2. [FIXED] `--resume` in v2 re-runs full loop instead of resuming from next phase

**References:** session-runner.ts:2829, :2904, :2457, :2467

```ts
startPhase = getNextPhase(state) as PhaseName | null;
// ...
await runV2Loop(state, flags, sessionsDir, rl);
// runV2Loop always starts with calibrate + SENSE regardless of completed phases
```

**Impact:** After interruption, `--resume` re-runs completed phases (SENSE, engage substage) including side effects (reactions cast, redundant API calls).

**Fix:** Add phase-skip logic inside `runV2Loop` that checks `state.phases[phase].status === "completed"` before executing each phase/substage.

**Resolution:** Added `senseCompleted`/`actCompleted`/`confirmCompleted` checks at top of each phase block. Completed phases are skipped with info message on resume. Calibrate extension also skipped when sense is completed.

## P2 (Medium)

### 1. [FIXED] `--skip-to` accepted but silently ignored for v2

**References:** session-runner.ts:147, :2852, :2867

```ts
const validPhases = getPhaseOrder(); // returns v1 phases at parse time
// ...
if (startPhase && !isV2(state)) { ... } // skip logic only for v1
```

**Impact:** Operator passes `--skip-to gate --loop-version 2`, no error emitted but skip is ignored — confusing.

**Fix:** Either reject `--skip-to` when `--loop-version 2` (like `--shadow` validates), or implement v2-aware skip logic.

**Resolution:** Added validation in `parseArgs()` that rejects `--skip-to` with `--loop-version 2` with a clear error message suggesting `--resume` instead.

## P3 (Low)

### 1. [FIXED] Unused `V2_SUBSTAGE_BUDGETS` constant

**Reference:** session-runner.ts:432

```ts
const V2_SUBSTAGE_BUDGETS: Record<string, number> = {
  engage: 300,
  gate: 300,
  publish: 900,
};
```

**Impact:** Dead code. No references anywhere.

**Fix:** Remove or wire into substage budget checks.

**Resolution:** Removed the unused constant.
