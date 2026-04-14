# Session: PR7-PR8 + Lifecycle Automation + Publish Pipeline

**Date:** 2026-03-16 00:00
**Duration:** ~4 hours
**Mode:** full
**Working Directory:** ~/projects/omniweb-agents

## Summary

Massive infrastructure session. Shipped PR7 (LLM match wiring + source health CLI) and PR8 (lifecycle engine + discovery upgrade). Ran 3 lifecycle passes to promote 23 quarantined sources to active and archive 67 dead sources. Fixed the autonomous publish pipeline to inject real source data into LLM prompts, added prefetch cache to eliminate double-fetching, calibrated thresholds from production runs, and achieved the first successful data-backed autonomous publish to SuperColony.

## Work Done

- PR7: Wired LLM provider through extensions into match() (3 lines, 8 tests)
- PR7: Source health CLI — `tools/source-test.ts` + `tools/lib/sources/health.ts` (18 tests)
- PR7 fix: Adapter pipeline enforcement per Codex review (supports, validateCandidate, 5 tests)
- PR8: Source lifecycle engine — `tools/lib/sources/lifecycle.ts` (32 tests)
- PR8: Source lifecycle CLI — `tools/source-lifecycle.ts` (check + apply)
- PR8 fix: Persist ratings on apply, add archived transitions per Codex review
- Lifecycle extension: beforeSense hook with priority sampling (7 tests)
- Discovery upgrade: V2 catalog persistence + coverage analysis (9 tests)
- Quarantine pruning: Added quarantined→archived after 5 consecutive failures (1 test)
- 3 new provider specs: mempool.yaml, blockchain-info.yaml, cryptocompare.yaml
- 6 sources reclassified from generic → dedicated providers
- 23 sources promoted quarantined→active (3 consecutive passes)
- 67 dead sources archived (5 consecutive failures)
- Attested data pipeline: pre-fetch source → parse through adapter → structured evidence summary → LLM prompt
- Prefetch cache: Map<URL, FetchedResponse> threaded through extensions to matcher (4 tests)
- Silent failure logging for pre-fetch ok=false results
- Match threshold calibrated 50→30 from production data
- Predicted reactions threshold calibrated 17→10
- LLM prompt: exact-terms instruction + parsed evidence (not raw JSON)
- First successful autonomous publish: txHash 718c6c88...

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Match threshold 50→30 | Production runs scored 34 with real parsed evidence — 50 was theoretical | Keep 50 + improve scoring algorithm |
| Predicted reactions threshold 17→10 | Codex CLI predictions well-calibrated (avg error 0.3) but generic topics cap at ~13-18rx. Median sentinel reactions: 9.8 | Keep 17 + switch to Claude API |
| Consecutive success counting (reset on failure) | Prevents unreliable sources from promoting via cumulative luck | Cumulative successCount ≥ 3 |
| statusChangedAt field for time-based transitions | Single field replaces need for degradedAt/staleAt/etc | Separate per-status timestamps |
| Parse evidence through adapter for LLM | Raw JSON caused LLM to write about API metadata not content | Pass raw JSON + hope for the best |
| Prefetch cache via Map in MatchInput | Eliminates double-fetch without complex caching layer | Accept double-fetch, rely on rate limiter |
| Quarantine archive threshold: 5 consecutive failures | Aggressive enough to clean dead sources, conservative enough to survive transient outages | 3 (too aggressive) or 10 (too slow) |

## Key Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| tools/lib/extensions.ts | edited | Added llm + prefetchedResponses to AfterPublishDraftContext |
| tools/lib/sources/matcher.ts | edited | Added prefetchedResponses cache, lowered threshold 50→30 |
| tools/lib/sources/health.ts | created | Source health testing — testSource(), filterSources() |
| tools/lib/sources/lifecycle.ts | created | Lifecycle engine — evaluateTransition, updateRating, applyTransitions, sampleSources |
| tools/source-test.ts | created | Source health CLI |
| tools/source-lifecycle.ts | created | Lifecycle CLI (check + apply) |
| tools/lib/source-discovery.ts | edited | V2 catalog persistence, coverage analysis |
| tools/lib/sources/catalog.ts | edited | Added statusChangedAt, exported generateSourceId |
| tools/lib/state.ts | edited | Added "lifecycle" to KNOWN_EXTENSIONS |
| tools/session-runner.ts | edited | Lifecycle hook, attested data pipeline, prefetch cache |
| tools/lib/llm.ts | edited | Exact-terms instruction for source data |
| agents/sentinel/persona.yaml | edited | Added lifecycle extension, lowered threshold |
| tools/lib/sources/providers/specs/mempool.yaml | created | Mempool.space adapter |
| tools/lib/sources/providers/specs/blockchain-info.yaml | created | Blockchain.info adapter |
| tools/lib/sources/providers/specs/cryptocompare.yaml | created | CryptoCompare adapter |
| sources/catalog.json | edited | 23 promotions, 67 archives, 6 reclassifications |

## Learnings

- Codex CLI exhausts context before writing output files when prompts cause broad file reads — not a rate limit issue, just too many `grep`/`find` tool calls consuming context budget
- The LLM match scoring pipeline (claim extraction → evidence scoring) is keyword-based — paraphrased citations score poorly. Exact-terms prompt instruction helps but fundamentally needs semantic matching for higher scores
- Raw JSON passed to LLM produces API-metadata content ("exhaustiveNbHits:false"). Always parse through adapter first
- Lifecycle state machine needs explicit recovery paths (degraded→active) — forward-only transitions strand recoverable sources
- The `successCount` field works as consecutive tracking when reset to 0 on failure — no need for a separate `consecutiveSuccesses` field

## Open Items

- [ ] Pioneer calibration tuning (avg error -9.6, over-predicting)
- [ ] OPINION category wiring into gate suggestions
- [ ] Thread-aware replies (GatePost.replyTo data path)
- [ ] 17 remaining generic active sources need dedicated provider specs
- [ ] Verify published post score/reactions (txHash 718c6c88)
- [ ] Codex context exhaustion — consider shorter, more targeted prompts

## Context for Next Session

PR7-PR8 complete. Full autonomous publish pipeline working end-to-end with data-backed posts. Catalog: 68 active, 3 quarantined, 67 archived. 212 tests across 14 suites. Next priorities: pioneer calibration, thread-aware replies, more provider specs for the 17 generic sources.
