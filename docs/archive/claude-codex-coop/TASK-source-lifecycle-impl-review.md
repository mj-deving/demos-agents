# Codex Review: Source Lifecycle (Implementation Review)

## Context

PR8: Source lifecycle automation. Library module `tools/lib/sources/lifecycle.ts` + CLI `tools/source-lifecycle.ts`. Implements full state machine with recovery path. Added `statusChangedAt` to catalog schema. 32 new tests.

## Changes Made

1. `tools/lib/sources/catalog.ts`: Added `statusChangedAt?: string` to lifecycle interface
2. `tools/lib/sources/lifecycle.ts`: `evaluateTransition()`, `updateRating()`, `applyTransitions()` + state machine validation
3. `tools/source-lifecycle.ts`: CLI with `check` and `apply` commands
4. `tests/lifecycle.test.ts`: 32 tests covering evaluateTransition, updateRating, applyTransitions
5. `package.json`: Added `source-lifecycle` script

## Questions for Review

Q1: Is the state machine correctly implemented? Verify all transitions from catalog.ts comments are covered, including the recovery path (degraded→active).

Q2: Does `updateRating()` correctly reset `successCount` on failure (consecutive enforcement)?

Q3: Is the `statusChangedAt` approach correct for time-based transitions? It replaces the need for separate `degradedAt`/`staleAt` fields.

Q4: Does `applyTransitions()` correctly validate against VALID_TRANSITIONS and refuse invalid transitions?

Q5: Any edge cases in the CLI's `apply` flow (atomic write, full catalog update, rating preservation)?

## Files to Read

```bash
cat tools/lib/sources/lifecycle.ts
cat tools/source-lifecycle.ts
cat tests/lifecycle.test.ts
sed -n '100,115p' tools/lib/sources/catalog.ts
```

## Output Format

Write findings to `claude-codex-coop/REVIEW-source-lifecycle-impl.md`. Answer Q1-Q5. Do NOT modify source code.
