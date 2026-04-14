# Source Lifecycle Implementation Review

## Findings

1. Medium: `apply` drops rating updates when no status transition occurs.
   In `tools/source-lifecycle.ts:166-188`, catalog persistence is gated on `changes.length > 0`. `runLifecycleCheck()` still updates `testCount`, `lastTestedAt`, `successCount`, `consecutiveFailures`, and `lastFailedAt` for every tested source, but those updates are discarded if no source changes status. That breaks the bookkeeping needed for consecutive-pass / consecutive-failure enforcement.

2. Medium: `VALID_TRANSITIONS` does not match the authoritative lifecycle comments.
   `tools/lib/sources/catalog.ts:19-27` documents `any -> archived (manual)` plus `archived -> quarantined`. `tools/lib/sources/lifecycle.ts:59-66` only allows `archived -> quarantined`; no transition to `archived` is considered valid. As written, `applyTransitions()` refuses a documented valid manual transition.

## Q1-Q5

**Q1. Is the state machine correctly implemented?**

Partially. The automated paths are present:

- `quarantined -> active`
- `active -> degraded`
- `degraded -> active` recovery
- `degraded -> stale`
- `stale -> deprecated`

The recovery path is implemented correctly in `evaluateTransition()` (`tools/lib/sources/lifecycle.ts:178-191`).

The gap is that the full lifecycle documented in `catalog.ts` is not fully represented in `VALID_TRANSITIONS`, because manual `* -> archived` transitions are missing. So the implementation is correct for the automated lifecycle, but not for the full documented state machine.

**Q2. Does `updateRating()` correctly reset `successCount` on failure (consecutive enforcement)?**

Yes. On `FETCH_FAILED` and `PARSE_FAILED`, `updateRating()` sets `rating.successCount = 0` before incrementing `consecutiveFailures` (`tools/lib/sources/lifecycle.ts:107-110`). That correctly enforces "consecutive passes" for both quarantine promotion and degraded recovery. The tests at `tests/lifecycle.test.ts:336-367` cover this.

**Q3. Is the `statusChangedAt` approach correct for time-based transitions?**

Yes, with one caveat. For the current timed transitions, a single `statusChangedAt` field is sufficient because both timers are based on entry into the current status:

- degraded timer starts when the source becomes `degraded`
- stale timer starts when the source becomes `stale`

That means separate `degradedAt` / `staleAt` fields are not necessary. The fallback to `lastFailedAt` also helps older records without `statusChangedAt`.

The caveat is semantic: this models "time in current status," not a separate notion of "days failing." If the intended rule is literally continuous failure duration rather than "14 days in degraded without recovery," `statusChangedAt` alone would not encode that distinction.

**Q4. Does `applyTransitions()` correctly validate against `VALID_TRANSITIONS` and refuse invalid transitions?**

Yes for the transitions listed in `VALID_TRANSITIONS`. It validates against the source's actual current status and silently skips disallowed transitions (`tools/lib/sources/lifecycle.ts:264-270`), which is why the invalid test in `tests/lifecycle.test.ts:543-556` passes.

The limitation is the same one noted above: because `VALID_TRANSITIONS` is incomplete relative to `catalog.ts`, `applyTransitions()` also refuses documented manual transitions to `archived`.

**Q5. Any edge cases in the CLI's `apply` flow (atomic write, full catalog update, rating preservation)?**

Mostly sound, with one important edge case:

- Atomic write is fine: temp file plus `renameSync()` on the same path (`tools/source-lifecycle.ts:180-188`).
- Full catalog update is correct when a write happens: it merges updated ratings back into the full catalog before applying transitions (`tools/source-lifecycle.ts:168-178`).
- Rating preservation is correct when a write happens: transitioned sources keep the rating object produced by `updateRating()`, and untouched sources are preserved.

The bug is that none of those rating updates are persisted when `changes.length === 0`, because the write path is skipped entirely (`tools/source-lifecycle.ts:166-188`). So `apply` currently behaves like a dry run for rating fields unless at least one source also changes status.
