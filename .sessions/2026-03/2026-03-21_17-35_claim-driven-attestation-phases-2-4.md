# Session: Claim-Driven Attestation Phases 2-4

**Date:** 2026-03-21 17:35
**Duration:** ~2.5 hours
**Mode:** full
**Working Directory:** /home/mj/projects/demos-agents

## Summary

Implemented claim-driven attestation Phases 2-4 (surgical URL construction, attestation planner/executor, value verifier) and wired it into the session-runner publish loop. Ran a live session to validate. Expanded YAML spec coverage from 3 to 8 providers with `claimTypes`. Defined T0 source expansion task.

## Work Done

- **Phase 2:** SurgicalCandidate type, buildSurgicalUrl on ProviderAdapter, claimTypes + extractionPath on OperationSpec with {var} interpolation
- **Phase 3:** AttestationPlanner (src/lib/, portable) with budget limits + AttestationExecutor (src/actions/, platform-bound) with rate limiting + TLSN→DAHR fallback
- **Phase 4:** verifyAttestedValues with tolerance (2% price, 5% metric), fail-closed on missing data
- **Pipeline wiring:** preAttested in PublishOptions, session-runner insertion between match and publish with full fallback chain
- **Simplify review:** replaced duplicate jsonPathExtract, extracted TLSN_MAX_SIZE_BYTES constant, fixed opName lookup
- **Codex reviews (2):** Fixed planner budget enforcement (plannedMethod), verifier fail-closed, entity canonicalization via inferAssetAlias, observe() in catch block
- **YAML specs:** Added claimTypes to defillama, kraken, dexscreener, alternative-fng, blockstream (8 total)
- **Documentation:** Backfilled 2 missing sessions, marked Phase 5 complete, updated CLAUDE.md/INDEX.md/MEMORY.md
- **Live test:** Session 38 completed successfully, claim path correctly fell back (post had no numeric claims)
- **Tuning task:** Defined T0-T5 with T0 (source registry expansion 200+ sources) as HIGH PRIORITY

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| plannedMethod on SurgicalCandidate | Planner must record budget decisions, executor shouldn't re-derive | Store in plan-level metadata (more indirection) |
| Fail-closed on missing attestation data | Missing data = broken attestation, should not silently pass | Fail-open (original design, too permissive) |
| inferAssetAlias for entity canonicalization | "BTC" → "bitcoin" for CoinGecko API compatibility | Map in YAML spec (duplicate across specs) |
| Additive try/catch with observe() | Never block publish on claim failure, but make failures visible | Narrower catch per step (more boilerplate) |
| preAttested in PublishOptions | Avoids breaking attestAndPublish signature and its typed wrappers | New positional param (breaks action-executor.ts + event-runner.ts) |

## Key Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| src/lib/sources/providers/types.ts | edited | SurgicalCandidate interface, buildSurgicalUrl on ProviderAdapter, plannedMethod |
| src/lib/sources/providers/declarative-engine.ts | edited | buildSurgicalUrl closure, claimTypes/extractionPath on OperationSpec, entity canonicalization |
| src/lib/attestation-planner.ts | created | buildAttestationPlan, resolveAttestationBudget, verifyAttestedValues |
| src/actions/attestation-executor.ts | created | executeAttestationPlan with rate limiting |
| src/actions/publish-pipeline.ts | edited | preAttested in PublishOptions, multi-attestation mapping |
| src/lib/agent-config.ts | edited | budget field in attestation config |
| src/index.ts | edited | barrel exports for planner + verifier |
| cli/session-runner.ts | edited | Claim extraction → plan → execute → verify between match and publish |
| 8 YAML specs | edited | claimTypes + extractionPath added |
| 3 test files | created | 39 tests covering surgical URL, planner, executor, verifier |

## Learnings

- Planner/executor decoupling is a known anti-pattern — record decisions, don't let consumers re-derive them
- Codex runtime probing (running adapters with edge inputs) catches issues that static code review misses
- /simplify and Codex are complementary: simplify catches code duplication, Codex catches cross-module path gaps
- CoinGecko `ids=btc` resolves to Bitcoin Cash, not Bitcoin — ticker-to-canonical mapping is essential
- Posts without numeric claims ($, %) don't trigger claim extraction — LLM prompt nudge needed

## Open Items

- [ ] T0: Source registry expansion — 200+ active sources across 12 domains (HIGH PRIORITY)
- [ ] T1: Add Binance sources to catalog
- [ ] T2: LLM prompt nudge for verifiable claims
- [ ] T4: Log claim extraction stats (observe() when claims extracted)
- [ ] Catalog has 70+ invalid entries (indices 138-208) — need cleanup

## Context for Next Session

Claim-driven attestation is fully implemented and wired into session-runner. Live session 38 confirmed it falls back correctly. The surgical path doesn't fire yet because (a) LLM posts lack numeric claims and (b) catalog needs more sources with matching adapter.operations. T0 source expansion is the next high-priority task — target 200+ active sources. Tuning plan at docs/claim-attestation-tuning.md.
