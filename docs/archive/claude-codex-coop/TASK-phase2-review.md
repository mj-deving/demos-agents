# Codex Review: Phase 2 — Core Loop Refactor (8→3 phases)

## Context

This is the Phase 2 implementation of the unified loop architecture v2 for omniweb-agents. The change refactors the existing 8-phase session loop (AUDIT→SCAN→ENGAGE→GATE→PUBLISH→VERIFY→REVIEW→HARDEN) into a 3-phase v2 loop (SENSE→ACT→CONFIRM), with the v1 loop fully preserved.

**Plan reference:** `Plans/unified-loop-architecture-v2.md`

## Files Changed (6 files, +753/-125 lines)

1. **`agents/{crawler,pioneer,sentinel}/persona.yaml`** — Added `loop.extensions` config (calibrate, sources, observe)
2. **`tools/lib/agent-config.ts`** — Added `loopExtensions` to AgentConfig, extension validation against KNOWN_EXTENSIONS
3. **`tools/lib/state.ts`** — Added V2 types (V2SessionState, CorePhase, ActSubstageState, SubstageStatus), V2 state management (normalizeState, startSession, getNextPhase overloads), exported KNOWN_EXTENSIONS
4. **`tools/session-runner.ts`** — V2 loop orchestrator (`runV2Loop`), v2 state accessors, v2 phase budgets, substage lifecycle (create/start/complete/fail/skip), v2 session report, v2 wiring in main()

## What to Review

### Architecture
- Is the v1/v2 coexistence clean? Feature flag via `--loop-version 2`, shadow mode via `--shadow`
- Are the `as any` casts in runV2Loop justified? (v2 state passed to v1 handlers that expect SessionState)
- Is `isV2()` type guard pattern robust?

### State Management
- V2SessionState has `phases: Record<CorePhase, PhaseState>` plus `substages: ActSubstageState[]`
- Substage state tracks: status, timing, failureCode, result
- normalizeState handles both v1 and v2 via overloads
- Incremental substage persistence (saveState after each substage completes)

### Extension System
- `loop.extensions` in persona.yaml → validated against KNOWN_EXTENSIONS constant
- KNOWN_EXTENSIONS exported from state.ts, imported by agent-config.ts (single source of truth)
- Currently: calibrate (runs audit), sources (placeholder), observe (placeholder)

### Error Handling
- Engage failure is non-critical (continues to gate)
- Gate failure skips publish
- Publish failure doesn't throw (continues to CONFIRM for verification)
- CONFIRM failure throws (terminal)

### V2 Phase Budgets
- Separate budget system (V2_PHASE_BUDGETS, V2_SUBSTAGE_BUDGETS)
- checkV2PhaseBudget uses observe() for budget overruns (warn-only, same as v1)

### Session Report
- writeV2SessionReport generates markdown summary with substage breakdown
- Reports include duration, posts, oversight level, loop version

## Specific Concerns

1. **`as any` casts:** runV2Loop calls `runAudit(state as any, flags)`, `runGateAutonomous(state as any, flags)`, `runPublishAutonomous(state as any, flags)`, `runPublishManual(state as any, flags, rl)`. These v1 handlers write to `state.phases.gate`, `state.phases.publish` etc. which don't exist on V2SessionState. Is this safe or will it corrupt state?

2. **Extension placeholder:** calibrate extension calls runAudit then discards result ("informational only"). But runAudit calls `completePhase(state, "audit", result)` which would set `(state as any).phases.audit` on a v2 state. Side effect?

3. **Gate result extraction:** `gateResult = (state as any).phases.gate?.result || { posts: [] }` — relies on v1 gate handlers having written to a v1-shaped key on a v2 state object. Fragile?

4. **KNOWN_EXTENSIONS as const:** Exported as `readonly ["calibrate", "sources", "observe"]`. Import in agent-config.ts creates a `Set<string>` from it. Type widening OK?

5. **Shadow mode validation:** `--shadow` requires `--loop-version 2` (checked at parse time). Any other invariants needed?

## How to Review

```bash
# View the full diff
git diff

# Type check
npx tsc --noEmit

# Run a dry-run v2 session
npx tsx tools/session-runner.ts --agent sentinel --loop-version 2 --dry-run --pretty

# Run a shadow v2 session (no publish)
npx tsx tools/session-runner.ts --agent sentinel --loop-version 2 --shadow --oversight autonomous --pretty
```

## Output Format

Please provide findings as:
- **P0 (Critical):** Data loss, security, crashes
- **P1 (High):** Logic errors, state corruption, type safety
- **P2 (Medium):** Edge cases, missing guards, code quality
- **P3 (Low):** Style, naming, docs
