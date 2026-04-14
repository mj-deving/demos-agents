# PR1 Implementation Review

Files read per task:
- `tools/lib/signals.ts`
- `tools/lib/predictions.ts`
- `tools/lib/write-rate-limit.ts`
- `tools/lib/spending-policy.ts`
- `git diff HEAD~1 -- tools/lib/state.ts`
- `git diff HEAD~1 -- tools/lib/extensions.ts`
- `git diff HEAD~1 -- tools/lib/llm.ts`
- `git diff HEAD~1 -- tools/session-runner.ts`
- `git diff HEAD~1 -- agents/sentinel/persona.yaml agents/pioneer/persona.yaml agents/crawler/persona.yaml`
- `claude-codex-coop/REVIEW-pr1-signals-predictions.md`

Additional verification:
- `npm exec tsc --noEmit` passed.

## Q1. Signals Module Correctness

- `P2` `scoreSignalAlignment()` is implemented but never used in gating or topic ranking, so signal modifiers do not affect candidate selection. The only live integration is prompt enrichment. References: `tools/lib/signals.ts:156-198`, `tools/session-runner.ts:72`, `tools/session-runner.ts:1637-1652`.
- `P2` Topic matching in the publish path is weaker than the matching logic in `signals.ts`. `runPublishAutonomous()` uses whole-string `includes()` checks, which creates false negatives for related phrasings and false positives for short substrings. References: `tools/session-runner.ts:1622-1626`, `tools/lib/signals.ts:164-181`, `tools/lib/signals.ts:206-225`.
- `P3` `fetchSignals()` itself handles API, parse, and shape failures gracefully by returning `null` and observing the failure. No correctness issue there. References: `tools/lib/signals.ts:48-93`.
- `P3` `signalSnapshot` is attached to v2 state and will persist on the next state save, but it is stored as `unknown` and not saved immediately after fetch. A crash between `beforeSense` and the next `saveState()` loses the snapshot. References: `tools/lib/state.ts:127-130`, `tools/session-runner.ts:2608-2643`, `tools/session-runner.ts:3094-3115`.

## Q2. Predictions Module Correctness

- `P1` Deadline extraction and resolution are inconsistent. The extractor stores free-text deadlines such as `Q2 2026`, `March 2026`, or `EOY`, but resolution uses `new Date(pred.deadline)`. Invalid or locale-sensitive strings will never expire, or will expire inconsistently by environment. References: `tools/lib/predictions.ts:189-204`, `tools/lib/predictions.ts:307-317`.
- `P2` `reportResolution()` ignores non-OK API responses. `apiCall()` returns `{ ok: false }` for 401/500/network cases instead of throwing, and `reportResolution()` only logs thrown exceptions, so remote resolution failures are silent. References: `tools/lib/predictions.ts:202-204`, `tools/lib/predictions.ts:329-345`, `tools/lib/sdk.ts:111-167`.
- `P2` Prediction calibration is computed but not applied. The `beforeSense` hook logs `getCalibrationAdjustment(store)`, but publish still loads calibration only from the improvements file. References: `tools/lib/predictions.ts:238-250`, `tools/session-runner.ts:1551-1557`, `tools/session-runner.ts:3116-3128`.
- `P3` The store format itself is sound for PR1: versioned JSON, keyed by `txHash`, with atomic save and idempotent registration on resume. References: `tools/lib/predictions.ts:51-56`, `tools/lib/predictions.ts:85-114`, `tools/lib/predictions.ts:126-166`.

## Q3. Write Rate Limit Correctness

- `P1` The ledger design is address-scoped, but the runner discards the `address` returned by `connectWallet()` and instead keys the ledger off `(demos as any).address`. If the SDK instance does not expose that property, all sessions collapse onto `write-rate-.json`. References: `tools/lib/sdk.ts:97-102`, `tools/session-runner.ts:1560-1578`, `tools/lib/write-rate-limit.ts:65-67`.
- `P1` The shared ledger is not concurrency-safe. Saves are atomic renames, but there is no lock or compare-and-swap, so two agents can both pass `canPublish()` and then overwrite each other's increments. References: `tools/lib/write-rate-limit.ts:138-143`, `tools/session-runner.ts:1582-1592`, `tools/session-runner.ts:1852-1854`.
- `P2` Corrupted ledger files reset silently to a fresh zero-count ledger. That is resilient, but it undercounts publishes immediately after corruption and can allow the wallet to exceed the intended cap. References: `tools/lib/write-rate-limit.ts:118-129`.
- `P2` Daily resets are UTC-based, while hourly resets are based on local clock rounding and then serialized to UTC. That makes hourly and daily windows inconsistent across timezone changes and DST boundaries. References: `tools/lib/write-rate-limit.ts:84-95`, `tools/lib/write-rate-limit.ts:239-252`.
- `P3` The `14/day` and `4/hour` margins are reasonable and conservative versus `15/day` and `5/hour`. References: `tools/lib/write-rate-limit.ts:25-29`.

## Q4. Session Runner Integration

- `P1` `runPublishManual()` never populates `state.publishedPosts`, so `afterConfirm` prediction registration only works for autonomous publishing. Approve/manual oversight sessions skip this feature entirely. References: `tools/session-runner.ts:1456-1532`, `tools/session-runner.ts:2831-2839`.
- `P1` Verification results are available after CONFIRM, but they are never mapped back into `PublishedPostRecord.verified`, and the predictions hook ignores `confirmResult`. Failed or not-found posts are still registered as pending predictions. References: `tools/lib/state.ts:98-113`, `tools/verify.ts:254-263`, `tools/session-runner.ts:2813-2820`, `tools/session-runner.ts:2831-2839`, `tools/session-runner.ts:3137-3148`.
- `P2` Hook order is correct for the configured extensions. Dispatch is sequential, and all three persona files declare `calibrate -> signals -> predictions -> sources -> observe`. References: `tools/lib/extensions.ts:202-211`, `agents/sentinel/persona.yaml:45-51`, `agents/pioneer/persona.yaml:50-56`, `agents/crawler/persona.yaml:45-51`.
- `P2` The write-rate check does happen before preflight, LLM generation, attestation, and publish, but not before wallet connect and log/source loading. If "before any work" is literal, the implementation is only partially there. References: `tools/session-runner.ts:1560-1578`, `tools/session-runner.ts:1582-1592`.
- `P2` `PublishedPostRecord` is only partially populated even on the autonomous path. `deadline` is defined in the state type but never set, and `verified` is never updated. References: `tools/lib/state.ts:99-113`, `tools/session-runner.ts:1860-1875`, `tools/session-runner.ts:2813-2839`.

## Q5. Extension System

- `P2` `afterConfirm` is the right hook point for prediction registration. It keeps the extension surface narrower than a generic phase event bus and aligns with the confirm/verify seam. References: `tools/lib/extensions.ts:62-69`, `tools/lib/extensions.ts:259-273`.
- `P2` `runAfterConfirm()` does not actually guarantee "all hooks execute". A single thrown error aborts the loop and prevents later hooks from running, despite the comment saying there is no short-circuit. References: `tools/lib/extensions.ts:259-273`.
- `P2` Resume behavior is unsafe for future non-idempotent hooks. The runner invokes `runAfterConfirm()` whenever `state.publishedPosts` exists, even if CONFIRM was already completed on a prior run. References: `tools/session-runner.ts:2799-2801`, `tools/session-runner.ts:2831-2846`.
- `P3` `AfterConfirmContext` is functionally enough for the current predictions hook, but it is under-typed for general extension use because `confirmResult` is `unknown` and the state also stores signal data as `unknown`. References: `tools/lib/extensions.ts:62-69`, `tools/lib/state.ts:127-130`.

## Overall Assessment

Implementation matches the earlier design review only partially. The core pieces are present: new modules exist, persona wiring is correct, the hook seam is in place, and the codebase still typechecks. The gaps are in the safety-critical integration details: verified-only prediction registration is missing, manual/approve publish paths do not populate `publishedPosts`, write-rate enforcement is race-prone and may be keyed off the wrong address source, and signal scoring never feeds topic ranking.

There are no obvious schema-breaking external changes because the new state fields are optional, but the current behavior can mis-track failed posts as active predictions and can mis-scope or undercount wallet publish limits in live multi-agent use.

Confidence for live sessions is `low` until the P1 items are fixed. After that, I would still want one hardening pass for concurrent ledger access and resume-safe `afterConfirm` behavior before calling this production-safe. One additional design mismatch remains outside Q1-Q5: `spending-policy.ts` persists by agent path rather than by address, so it does not yet satisfy the earlier address-scoped ledger requirement. References: `tools/lib/spending-policy.ts:237-299`.
