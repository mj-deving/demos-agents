# Session: Source Routing Diversity, Quality Logger, Intent-Driven Scanning Design

**Date:** 2026-03-23 00:01
**Duration:** ~90 min
**Mode:** full
**Working Directory:** /home/mj/projects/demos-agents

## Summary

Implemented three interconnected features (source routing diversity, URL parameter extraction, quality data JSONL logger), designed intent-driven source scanning as a new capability, and ran both Codex review and a 5-perspective council debate on the design.

## Work Done

- Replaced first-match-wins attestation planning with scored selection (health + status + usage penalty + diversity bonus) in `src/lib/attestation-planner.ts`
- Added `extractUrlParams()` to `src/lib/sources/providers/declarative-engine.ts` — parses source URLs against spec urlTemplates for path segments and query params (including inline template placeholders)
- Added `logQualityData()` to `src/lib/quality-score.ts` — persists quality_score + predicted_reactions to JSONL for correlation analysis
- Wired quality logger into `cli/session-runner.ts` publish pipeline
- Wrote intent-driven source scanning design at `docs/design-intent-driven-scanning.md`
- Created architecture diagram at `~/.agent/diagrams/intent-driven-scanning-architecture.html`
- Fixed HIGH Codex finding: `publishInput` undefined in session-runner.ts (replaced with `gp.replyTo?.txHash`)
- Fixed MEDIUM Codex finding: inline query template extraction + `AttestationMethodPlan` type rename
- Ran /simplify review (3 agents: reuse, quality, efficiency) — fixed `require()` → ES imports, removed unnecessary `as any` cast
- Ran 5-perspective council debate on intent scanning design

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Scored selection over round-robin for source routing | Deterministic, testable, naturally diverse via usage penalty | Round-robin (fragile state), weighted random (non-deterministic) |
| Quality score logged pre-attestation with `hasAttestation: false` | Attestation hasn't happened yet at quality score calculation time | Post-attestation logging (would require restructuring publish flow) |
| Anti-signal detection deferred to Phase 3 of intent scanning | Highest value but highest risk — needs baseline infrastructure first | Ship anti-signals first (council rejected — blast radius too high) |
| Keyed JSON baseline store (not JSONL) | Council consensus: JSONL is O(n) at 200+ sources, needs keyed lookup | JSONL with rotation (original design, rejected) |
| `AttestationPlan` renamed to `AttestationMethodPlan` in policy.ts | Resolves duplicate identifier with attestation-planner.ts type | Rename the planner type (less impactful — planner is newer/more used) |

## Key Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| src/lib/attestation-planner.ts | edited | Scored selection, SourceUsageTracker, fallback candidates |
| src/lib/sources/providers/declarative-engine.ts | edited | extractUrlParams() + inline template query extraction |
| src/lib/quality-score.ts | edited | QualityDataEntry interface + logQualityData() function |
| cli/session-runner.ts | edited | Wired logQualityData, fixed publishInput bug |
| src/lib/attestation-policy.ts | edited | Renamed AttestationPlan → AttestationMethodPlan |
| src/index.ts | edited | New exports (createUsageTracker, scoreSurgicalCandidate, etc.) |
| docs/design-intent-driven-scanning.md | created | Full design doc with council review findings |
| tests/url-params.test.ts | created | 16 tests for URL parameter extraction |
| tests/attestation-planner.test.ts | edited | 7 new tests for scoring, rotation, diversity |
| tests/quality-score.test.ts | edited | 3 new tests for JSONL logger |

## Learnings

- Multi-armed bandit framing for source selection — usage penalty creates natural rotation without randomization
- `publishInput` was never defined in `runPublishAutonomous` scope — pre-existing bug exposed by new code
- `new URL()` encodes `{`/`}` as `%7B`/`%7D` — need `decodeURIComponent` on template segments
- Council identified baseline poisoning as critical risk — one bad fetch corrupts 30 days of change detection
- Anti-signals are the highest-engagement feature but also highest-risk — need cross-source confirmation + staleness checks

## Open Items

- [ ] Wire SourceUsageTracker at session level in session-runner.ts (currently only intra-plan)
- [ ] Implement fallback retry logic in attestation-executor.ts
- [ ] Implement intent-driven scanning Phase 1: signal detection core
- [ ] Preflight top-N candidates (ISC-20 from source routing — descoped)
- [ ] Verify macro claim routing hasn't regressed (needs runtime session test)

## Context for Next Session

Three implementations shipped and pushed (source routing diversity, URL param extraction, quality logger). Intent-driven scanning has a complete design doc with council review findings at `docs/design-intent-driven-scanning.md`. Next implementation work is Phase 1 of intent scanning: signal detection core (`src/lib/signal-detection.ts`) with threshold + change detection, keyed JSON baseline store, and N>=3 sample validation.
