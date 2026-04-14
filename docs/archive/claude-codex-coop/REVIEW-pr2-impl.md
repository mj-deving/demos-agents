# PR2 Implementation Review

## Q1: `fetchLatestBriefing` correctness

- Low: `fetchLatestBriefing()` returns `null` on exceptions without logging anything, unlike `fetchSignals()`. That means network or unexpected parse failures become invisible in production and look identical to "briefing unavailable". Refs: `tools/lib/signals.ts:103-125`.
- No higher-severity correctness issue found here. The `null`-on-failure contract is consistent with the surrounding fetch helpers, and the four-field shape probe is reasonable for the stated API wrappers. Refs: `tools/lib/signals.ts:103-125`.

## Q2: Briefing integration in the session loop

- Low: briefing state is written and read through `(state as any).briefingContext`, but `V2SessionState` does not declare that field. Runtime behavior is fine because extra JSON fields survive persistence, but this is not type-safe and makes the persisted state shape implicit. Refs: `tools/session-runner.ts:1663`, `tools/session-runner.ts:3099-3100`, `tools/lib/state.ts:115-130`.
- No material runtime issue found with the hook placement or truncation. Piggybacking on the existing `beforeSense` auth-dependent fetch is reasonable, and prompt truncation to 500 chars is a sensible bound. Refs: `tools/session-runner.ts:3081-3107`, `tools/lib/llm.ts:174-175`.

## Q3: Auto-registration correctness

- High: the existence check treats every failed profile lookup as "profile missing", then logs success for registration without checking the POST result. `apiCall()` does not throw on HTTP or network failure; it returns `{ ok: false, status, data }`. So a transient `401`, `500`, or network failure on either request can produce a false `Auto-registered agent profile` log even though no profile was created. Refs: `tools/session-runner.ts:3176-3186`, `tools/lib/sdk.ts:111-166`.
- Medium: `loadAuthCache()` is called without an address, which means this path uses the legacy top-level cached entry instead of an address-scoped lookup. In a mixed-wallet environment, the code can check or attempt to register the wrong agent profile. Refs: `tools/session-runner.ts:3172-3176`, `tools/lib/auth.ts:31-56`.
- No issue found with `specialties: agentConfig.topics?.primary || []`; `topics.primary` is validated as `string[]`. The fallback description is also reasonable. Refs: `tools/session-runner.ts:3180-3184`, `tools/lib/agent-config.ts:24-27`, `tools/lib/agent-config.ts:386-392`.
- Placement before `runV2Loop()` is appropriate in principle; the problems are in the failure handling and cache scoping, not where it runs. Refs: `tools/session-runner.ts:3169-3194`.

## Q4: `parseFlexibleDeadline` correctness

- High: `parseFlexibleDeadline()` does a raw `new Date(deadline)` before the custom quarter/month logic. That breaks at least two of the requested cases. `"March 2026"` parses as March 1, 2026, so the function returns the first day of the month instead of March 31. `"end of year 2027"` parses as January 1, 2027, so the explicit-year case is wrong as well. Refs: `tools/lib/predictions.ts:277-305`.
- High: even when the custom month/quarter/EOY/EOQ branches are used, they construct dates at local midnight on the last day and `resolvePendingPredictions()` expires when `deadlineDate <= now`. That causes predictions to expire at the start of the deadline day, not after the deadline day has finished. This affects `"Q2 2026"`, `"Q4"`, `"December"`, `"EOY"`, and `"EOQ"`. Refs: `tools/lib/predictions.ts:190-191`, `tools/lib/predictions.ts:290`, `tools/lib/predictions.ts:299`, `tools/lib/predictions.ts:304`, `tools/lib/predictions.ts:310`.
- Result by case:
  - `"Q2 2026"`: calendar date resolves to June 30, 2026, but effective expiry is too early because it triggers at `2026-06-30 00:00` local time.
  - `"March 2026"`: incorrect, resolves to March 1, 2026 because of the direct parse short-circuit.
  - `"EOY"`: current-year December 31 is returned, but again expires at the start of that day.
  - `"Q4"` and `"December"`: both resolve to the correct calendar day for the current year, but expire at the start of that day.
  - `"end of year 2027"`: incorrect, because the direct parse wins and returns January 1, 2027.

## Q5: Manual publish `publishedPosts`

- Medium: the manual path builds `PublishedPostRecord` from the gate suggestion, not from the actual text/category/tags that were manually published. If the operator edits the post before publishing, `afterConfirm` hooks consume stale data. That matters immediately for predictions, because `registerPrediction()` extracts structure and deadlines from `post.text`. Refs: `tools/session-runner.ts:1504-1540`, `tools/lib/predictions.ts:126-150`.
- Low: `attestationType` is hardcoded to `"DAHR"` even though the manual flow explicitly allows any external publish tool and never asks which attestation method was used. That makes the persisted record inaccurate for TLSN or unattested manual posts. Refs: `tools/session-runner.ts:1471-1472`, `tools/session-runner.ts:1538-1539`, `tools/lib/state.ts:98-112`.
- Low: the cast to `V2SessionState` is runtime-safe but type-unsafe when `runPublishManual()` is used from V1 flows. It writes `publishedPosts` onto a state shape that only V2 declares. Refs: `tools/session-runner.ts:1528-1530`, `tools/lib/state.ts:115-130`.

## Overall

Live session deployment confidence: low.

Q1 and Q2 are mostly fine. The blockers are Q3 and Q4:

- Q3 can silently fail or target the wrong profile while reporting success.
- Q4 can expire predictions on the wrong date and, for end-of-period strings, often a full day early.
