---
task: Implement unified loop v2 Phase 0A and 0B
slug: 20260313-163000_implement-loop-v2-phase-0a-0b
effort: advanced
phase: complete
progress: 28/28
mode: interactive
started: 2026-03-13T16:30:00Z
updated: 2026-03-13T16:32:00Z
---

## Context

Implementing the first two phases of the unified loop architecture v2 plan (`Plans/unified-loop-architecture-v2.md`). These phases ship additive improvements into the CURRENT 8-phase loop with zero architectural risk.

**Phase 0A (Codex implements):** Publish preflight — `sources.preflight(topic)` check before LLM draft call in `runPublishAutonomous()`. Skips topics early when no attestable source exists, saving LLM costs and time.

**Phase 0B (Isidore implements):** Observability infrastructure — `tools/lib/observe.ts` (append-only JSONL), `observe()` calls in publish-pipeline.ts/room-temp.ts/session-runner.ts, per-phase deadline wrappers, substage-level failure codes.

Both phases are additive only — no existing behavior changes. Validates API shapes before core refactor in Phase 2.

### Risks
- Codex drift: may build meta-infrastructure instead of the specific preflight check
- observe.ts must be zero-overhead in the hot path (no LLM, no file reads, just append)
- Phase budgets must not kill autonomous sessions if a phase legitimately takes longer

## Criteria

### Phase 0A — Publish Preflight (implemented by Isidore — Codex unavailable)
- [x] ISC-1: `sources.preflight(topic, sources, config)` function exists in attestation-policy.ts
- [x] ISC-2: preflight returns `{pass: boolean, reason: string, reasonCode: string}`
- [x] ISC-3: reasonCode enum: NO_MATCHING_SOURCE, TLSN_REQUIRED_NO_TLSN_SOURCE, SOURCE_PRECHECK_HTTP_ERROR
- [x] ISC-4: preflight called in runPublishAutonomous() BEFORE generatePost() call
- [x] ISC-5: preflight called in runGateAutonomous() BEFORE gate.ts subprocess call
- [x] ISC-6: failed preflight skips topic with reason logged to console
- [x] ISC-7: passed preflight does not change existing publish behavior
- [x] ISC-8: preflight uses existing selectSourceForTopic + resolveAttestationPlan
- [x] ISC-9: preflight checks both required and fallback attestation methods
- [x] ISC-10: dynamic discovery attempted when static sources fail preflight

### Phase 0B — Observability (Isidore)
- [x] ISC-11: `tools/lib/observe.ts` module exists with `observe()` export
- [x] ISC-12: observe() appends JSONL to `~/.{agent}/observations.jsonl`
- [x] ISC-13: observation entry has id, ts, session, phase, type, text fields
- [x] ISC-14: observation id format: `obs-{session}-{unixSec}-{4hex}`
- [x] ISC-15: observation type enum: error, pattern, insight, inefficiency, source-issue
- [x] ISC-16: observe() is synchronous append — no async, no LLM, no network
- [x] ISC-17: observe() calls added to publish-pipeline.ts for DAHR/TLSN errors and fallbacks
- [x] ISC-18: observe() calls added to room-temp.ts for scan inefficiencies
- [x] ISC-19: observe() calls added to session-runner.ts for phase failures and skips
- [x] ISC-20: per-phase deadline wrapper function exists in session-runner.ts
- [x] ISC-21: deadline wrapper logs warning when phase exceeds budget (does not kill)
- [x] ISC-22: phase budgets configurable via strategy.yaml (with sensible defaults)
- [x] ISC-23: substage failure codes defined as TypeScript string union type
- [x] ISC-24: ENGAGE substage emits failure code on error (ENGAGE_NO_TARGETS, ENGAGE_RATE_LIMITED)
- [x] ISC-25: GATE substage emits failure code on error (GATE_DUPLICATE, GATE_LOW_SIGNAL, GATE_NO_SOURCE, GATE_NOVELTY_FAIL)
- [x] ISC-26: PUBLISH substage emits failure codes (PUBLISH_TLSN_TIMEOUT, PUBLISH_DAHR_REJECT, PUBLISH_NO_MATCHING_SOURCE, PUBLISH_LLM_FAIL, PUBLISH_BROADCAST_FAIL)
- [x] ISC-27: phase duration + failure code emitted to session report
- [x] ISC-28: existing tests (if any) still pass after changes

### Anti-Criteria
- [x] ISC-A1: No changes to the 8-phase PHASE_ORDER or state.ts PhaseName type
- [x] ISC-A2: No changes to strategy.yaml format (new fields additive only)
- [x] ISC-A3: observe() never blocks or slows down the publish pipeline

## Decisions

## Verification
