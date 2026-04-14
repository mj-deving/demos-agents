# Codex Review Round 2: Phase 2 — Core Loop Refactor

**Reviewer:** Codex (gpt-5.3-codex)
**Date:** 2026-03-13
**Type check:** `npx tsc --noEmit` — PASS
**Status:** All findings FIXED

---

## P1 (High)

### 1. [FIXED] gate.ts scan-cache reads v1 `phases.scan.result` — misses v2 `phases.sense`

**References:** gate.ts:686, session-runner.ts:1399

**Impact:** `--scan-cache` passes v2 session state, but `gate.ts` only reads `phases.scan.result`. V2 stores scan in `phases.sense.result`.

**Resolution:** Added `phases.sense.result` to fallback chain in gate.ts scan-cache reader.

### 2. [FIXED] Resume skips top-level phases but replays completed ACT substages

**References:** session-runner.ts:2513-2574

**Impact:** `state.substages` persisted after each substage, but `runV2Loop` recreated `[]` and reran all substages. Interrupted ACT resume would repeat reactions, gate calls, publish.

**Resolution:** Restore substages from `state.substages` on entry. Added `ensureSubstage()` helper that finds existing substage or creates new. Each substage checks `status === "completed"` before executing.

## P2 (Medium)

### 3. [FIXED] v2 writes stray v1 phase keys (`audit`/`gate`/`publish`) via shared handlers

**References:** session-runner.ts:1427, 1351, 1509, 1769, 2479

**Impact:** Gate/publish handlers called `completePhase(state, "gate"|"publish", ...)` on v2 state, writing invalid v1 phase keys. Calibrate extension called `runAudit()` which wrote `state.phases.audit`.

**Resolution:**
- Gate handlers (`runGateAutonomous`, `runGateApprove`) now return `{ posts: GatePost[] }` and guard `completePhase` with `!isV2(state)`.
- Publish handlers (`runPublishAutonomous`, `runPublishManual`) now return `{ txHashes: string[] }` and guard `completePhase`/`failPhase` with `!isV2(state)`.
- V2 caller uses returned values directly instead of reading `(state as any).phases.*`.
- Calibrate extension now calls `audit.ts` tool directly instead of `runAudit()`, avoiding any state writes.
