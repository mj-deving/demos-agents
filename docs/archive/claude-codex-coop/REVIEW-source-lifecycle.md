# Review: Source Lifecycle Management

## Findings

1. High: The proposed promotion rule cannot be implemented correctly with the current persisted counters.
   The canonical lifecycle says `quarantined ->(3 tests pass)-> active` in [tools/lib/sources/catalog.ts](/home/mj/projects/omniweb-agents/tools/lib/sources/catalog.ts#L22), but the schema only persists cumulative `successCount` and `consecutiveFailures` in [tools/lib/sources/catalog.ts](/home/mj/projects/omniweb-agents/tools/lib/sources/catalog.ts#L91). That is not enough to prove "3 passes since the last failure" across runs. With the proposed `successCount >= 3 && consecutiveFailures === 0` rule, a source that had many old successes, then one failure, then one new success becomes promotable immediately after the first recovery pass. If the intent is really "3 tests pass" as a gate back into the active pool, the catalog needs `consecutiveSuccesses` or a bounded recent-results history, and `updateRating()` plus its tests need to maintain that state.

2. High: The time-based demotions are underspecified in a way that makes `stale` and `deprecated` unreliable or impossible to automate.
   The state machine says `degraded ->(14 days, no recovery)-> stale` and `stale ->(30 days)-> deprecated` in [tools/lib/sources/catalog.ts](/home/mj/projects/omniweb-agents/tools/lib/sources/catalog.ts#L25), but the lifecycle schema only has `promotedAt`, `deprecatedAt`, `archivedAt`, and `lastFailedAt` in [tools/lib/sources/catalog.ts](/home/mj/projects/omniweb-agents/tools/lib/sources/catalog.ts#L104). There is no persisted `degradedAt`, `staleAt`, or general `statusChangedAt`. Using `lastFailedAt` as a proxy is not equivalent: repeated failures would keep pushing the clock forward, so a permanently broken degraded source might never become stale, and `stale -> deprecated after 30 days` cannot be evaluated at all because the catalog never records when the source became stale. This needs additional persisted timestamps before `evaluateTransition()` and `applyTransitions()` can be correct.

3. High: The automation has no explicit recovery path from `degraded`, even though the canonical comment assumes one exists.
   The phrase `degraded ->(14 days, no recovery)-> stale` in [tools/lib/sources/catalog.ts](/home/mj/projects/omniweb-agents/tools/lib/sources/catalog.ts#L25) implies degraded sources can recover, but the proposed automated rules only move statuses downward. That would strand any source that temporarily had three failures or a low score: once degraded, it can only age into `stale` and `deprecated`. Before implementation, the design needs a concrete recovery transition, for example `degraded -> active` after three consecutive successful probes and acceptable rating, or `degraded -> quarantined` if you want re-validation before rejoining the active pool.

4. Medium: The `rating.overall < 40` branch is disconnected from the proposed health-test update flow.
   `rating.overall` is part of the persisted source schema in [tools/lib/sources/catalog.ts](/home/mj/projects/omniweb-agents/tools/lib/sources/catalog.ts#L91), but `testSource()` only returns operational statuses such as `OK`, `FETCH_FAILED`, `NOT_SUPPORTED`, and `UNRESOLVED_VARS` in [tools/lib/sources/health.ts](/home/mj/projects/omniweb-agents/tools/lib/sources/health.ts#L25). The proposed `updateRating()` contract only updates counts and timestamps; it does not define how `overall` or any component score changes after a probe. As written, `active -> degraded` on `rating.overall < 40` either depends on some separate scorer running first or becomes dead logic in PR8. The PR should either define that scoring step explicitly or defer the `overall < 40` transition until that machinery exists.

## Q1-Q5

Q1: `evaluateTransition()` should be pure over persisted source state, not over a mix of state plus an optional fresh `testResult`.
Run the probe first, apply the probe result to a cloned source record, then evaluate transitions from that updated snapshot. That gives one source of truth and avoids ambiguous ordering bugs where `testResult` and `rating/lifecycle` disagree.

Q2: The threshold should be three consecutive passes across runs, not cumulative lifetime passes.
Using cumulative `successCount` is too weak for a quarantine gate. The current schema cannot represent this correctly, so add `consecutiveSuccesses` or recent-result history instead of reusing `successCount`.

Q3: Dry-run plus an explicit `apply` command is sufficient; interactive confirmation is not the right safety mechanism.
This workflow should remain automatable. If promotions need extra friction, use a separate flag or subcommand for promotions rather than an interactive prompt.

Q4: Yes, there should be an automatic recovery path, and it should be explicit in the state machine.
The cleanest version is `degraded -> active` after consecutive successful checks and an acceptable score. Sending recovered sources back through `quarantined` is defensible, but that is a stricter policy choice and should be written down explicitly rather than inferred.

Q5: Keep lifecycle checks serial with a small delay by default, matching the current health CLI behavior in [tools/source-test.ts](/home/mj/projects/omniweb-agents/tools/source-test.ts#L108).
`fetchSource()` already rate-limits, and the existing tool intentionally spaces requests in [tools/source-test.ts](/home/mj/projects/omniweb-agents/tools/source-test.ts#L122). If runtime later becomes a problem, add bounded per-provider concurrency; do not make the first version aggressively parallel across 93 quarantined sources.

## Missing Test Behaviors

- Missing: a contract that proves promotion requires consecutive successful probes, not just `successCount >= 3`.
- Missing: a regression case for "historical successes + recent failure + one recovery pass" to ensure a quarantined source does not promote too early.
- Missing: coverage for whatever recovery path is chosen from `degraded`; the current contracts only test downward transitions.
- Missing: persisted timestamp coverage for status aging. There should be tests for the timestamp used to enter `degraded` and the timestamp used to enter `stale`, not just `lastFailedAt`.
- Missing: a stale-aging regression where repeated failures continue after degradation, to prove the source still becomes stale on the intended schedule.
- Missing: explicit coverage for `stale -> deprecated` timing, because the current schema has no field that records when `stale` began.
- Missing: an ordering test that `runLifecycleCheck()` updates rating/lifecycle state before evaluating transitions, or that `evaluateTransition()` never consumes raw `testResult` directly.
- Missing: tests for non-success statuses such as `NO_ADAPTER`, `NOT_SUPPORTED`, `NO_CANDIDATES`, `UNRESOLVED_VARS`, and `VALIDATION_REJECTED` to ensure they block or reset promotion state appropriately.
- Missing: a contract for the `rating.overall < 40` branch that defines where `overall` is recalculated and verifies lifecycle decisions against that recomputed score.
