# Phase 5 — Step A1: V3 Session State Types

## Task

Add V3 session state support to `src/lib/state.ts` and create `tests/cli/v3-state.test.ts`.

## What to Do

### 1. Update `src/lib/state.ts`

**Add V3SessionState interface** (after V2SessionState, around line 156):

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
```

**Update LoopVersion type** (line 91):
```typescript
export type LoopVersion = 1 | 2 | 3;
```

**Update AnySessionState** (line 158):
```typescript
export type AnySessionState = SessionState | V2SessionState | V3SessionState;
```

**Add isV3 type guard** (after isV2):
```typescript
export function isV3(state: AnySessionState): state is V3SessionState {
  return "loopVersion" in state && state.loopVersion === 3;
}
```

**Update startSession()** (around line 345) — add loopVersion === 3 case BEFORE the existing loopVersion === 2 case:
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

**Update normalizeState()** (around line 265) — add V3 overload and implementation branch:
```typescript
export function normalizeState(state: V3SessionState): V3SessionState;
// ... keep existing overloads ...
```
In the implementation, add an `isV3(state)` branch BEFORE the `isV2(state)` branch:
```typescript
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

**Update getNextPhase()** — add V3 branch (same as V2, uses CORE_PHASE_ORDER):
```typescript
if (isV3(state)) {
  for (const phase of CORE_PHASE_ORDER) {
    const status = state.phases[phase].status;
    if (status === "pending" || status === "in_progress" || status === "failed") {
      return phase;
    }
  }
  return null;
}
```

**Update getPhaseOrder()** — handle V3:
```typescript
export function getPhaseOrder(state?: AnySessionState): (PhaseName | CorePhase)[] {
  if (state && (isV2(state) || isV3(state))) return [...CORE_PHASE_ORDER];
  return [...PHASE_ORDER];
}
```

**Add resume guard** (Finding 6) — a function that rejects resuming a V2 session as V3 or vice versa:
```typescript
/**
 * Validate that a resumed session matches the requested loop version.
 * Prevents cross-version resume (e.g., V2 session resumed with --loop-version 3).
 */
export function validateResumeVersion(state: AnySessionState, requestedVersion: LoopVersion): void {
  const stateVersion: LoopVersion = isV3(state) ? 3 : isV2(state) ? 2 : 1;
  if (stateVersion !== requestedVersion) {
    throw new Error(
      `Cannot resume session ${state.sessionNumber}: session is V${stateVersion} but --loop-version ${requestedVersion} was requested. ` +
      `Use --loop-version ${stateVersion} to resume, or start a new session.`
    );
  }
}
```

**Update saveState()** — ensure V3 states are saved (no change needed if it accepts AnySessionState, but verify the type signature).

### 2. Create `tests/cli/v3-state.test.ts`

Test the following:
- `isV3()` returns true for V3 state, false for V1 and V2
- `isV2()` returns false for V3 state
- `startSession()` with loopVersion 3 creates V3SessionState with correct shape
- `normalizeState()` fills missing V3 phases
- `normalizeState()` fills missing V3 arrays (posts, engagements, pendingMentions)
- `getNextPhase()` works for V3 (returns first non-completed core phase)
- `getPhaseOrder()` returns CORE_PHASE_ORDER for V3
- `validateResumeVersion()` passes when versions match
- `validateResumeVersion()` throws when V2 session resumed as V3
- `validateResumeVersion()` throws when V3 session resumed as V2
- `beginPhase()` and `completePhase()` work with V3 state

Use a temp directory for session state files (cleanup in afterEach).

## Constraints

- Do NOT modify any V2 or V1 behavior — all existing tests must still pass
- Do NOT modify `extensions.ts` or any plugins (that's Step A2)
- Run `npx tsc --noEmit` after changes to verify zero type errors
- Run `npm test` to verify all existing tests pass plus new tests
