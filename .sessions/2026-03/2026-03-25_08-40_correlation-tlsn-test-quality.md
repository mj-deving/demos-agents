# Session: Correlation Analysis, TLSN Reactivation, Test Quality Enforcement

**Date:** 2026-03-25 08:40
**Duration:** ~4 hours (spanning 2026-03-24 evening to 2026-03-25 morning)
**Mode:** full
**Working Directory:** ~/projects/demos-agents

## Summary

Massive productivity session: ran 6 agent sessions to validate transcripts and collect quality data, performed correlation analysis on 68 posts proving predicted_reactions is useless, fixed 7 bugs found through real session runs + Codex review, reactivated TLSN (2.3x reaction multiplier), and shipped a two-layer anti-vibe-testing enforcement system.

## Work Done

- Ran 6 sessions: sentinel 42-45, pioneer 36-37 (4 posts published, all verified)
- Validated H2 transcript pipeline end-to-end (JSONL + query CLI working)
- Collected 12 quality_score data points (6 sentinel, 6 pioneer)
- Correlation analysis (n=68): predicted_reactions r=-0.002, TLSN 14.0 vs DAHR 6.1 avg rx
- Fixed attestation policy bypass (claim-driven path ignored dahr_only)
- Fixed tlsn_only silent fallback to DAHR
- Fixed improvement dedup (exact→fuzzy, strips numbers/hashes)
- Fixed EMA bounds (OFFSET_MIN -5→-15 for pioneer calibration)
- Fixed DefiLlama URL (compound→compound-finance) + buildCandidates URL param extraction + broadcast
- Fixed CLI empty output (retry once with 3s delay)
- Lowered predictedReactionsThreshold 7→1 across all agents (data-driven)
- Reactivated TLSN (dahr_only→tlsn_preferred, MPC-TLS back online)
- Purged 115 stale improvements, rejected 2 orphans
- Shipped test quality enforcement: vitest globalSetup (hard gate) + PostToolUse hook (write-time)
- Evaluated H3/H1 mini-agent patterns: implement neither (phases causally coupled)
- Updated all documentation: INDEX.md, CLAUDE.md, loop-heuristics.md, MEMORY.md

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Lower threshold to 1 (not 0) | Keeps gate infrastructure for future quality_score replacement | Remove entirely, lower to 5 |
| tlsn_preferred (not tlsn_only) | DAHR fallback on failure is safer for availability | tlsn_only (rejected: too brittle) |
| Fuzzy dedup via numeric stripping | Prevents "13.0rx" vs "10.6rx" duplicates | Semantic similarity (too complex), exact match (broken) |
| Broadcast URL params to all aliases | Resolution order check (vars.asset before vars.protocol) defeats single-var merge | Only set extracted var (broken by resolution order) |
| Anti-vibe-testing: 2 layers | Hard gate at test time + early warning at write time | Hook only (can be bypassed), test only (late feedback) |
| H3/H1: implement neither | Phases causally coupled, publish latency is blockchain (52%), not orchestration | Implement H3 (parallel phases), implement H1 (LLM ordering) |

## Key Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| src/actions/attestation-executor.ts | edited | attestationMode option, tlsn_only no-fallback |
| src/lib/improvement-utils.ts | edited | Fuzzy dedup, OFFSET_MIN -5→-15 |
| src/lib/sources/providers/declarative-engine.ts | edited | URL param extraction + broadcast in buildCandidates |
| src/lib/llm-provider.ts | edited | CLIProvider retry on empty output, stdin EPIPE handling |
| src/lib/test-quality-validator.ts | created | Assertion density analysis with brace-aware parser |
| tests/setup-test-quality.ts | created | vitest globalSetup enforcement gate |
| tests/test-quality-validator.test.ts | created | 12 tests for validator including edge cases |
| tests/cli-provider.test.ts | created | 5 tests for CLIProvider |
| agents/*/persona.yaml | edited | predictedReactionsThreshold 7→1, dahr_only→tlsn_preferred |
| config/sources/catalog.json | edited | DefiLlama compound→compound-finance |
| ~/.claude/hooks/TestQualityGuard.hook.ts | created | PostToolUse write-time assertion check |

## Learnings

- The LLM cannot predict social dynamics — systematic 6.0rx over-prediction
- Attestation type (TLSN vs DAHR) is the strongest engagement signal, not content quality
- Declarative engine URL template overrides source.url entirely — need explicit param extraction
- Variable resolution order in YAML specs defeats single-var merges — broadcast to all aliases
- Improvement systems need fuzzy dedup from day 1, not after 60 duplicates accumulate
- "Markdown instructions are suggestions; code modules are laws" (PairCoder principle)
- vitest globalSetup is the right enforcement point — runs before all tests, can't be bypassed

## Open Items

- [ ] Monitor TLSN attestation success rates in upcoming sessions
- [ ] Collect 20+ quality_score entries with actuals for meaningful correlation
- [ ] Quality review A/B trial: Fabric review_code vs /simplify
- [ ] Algorithm + dev workflow integration gap (PAI project)
- [ ] Disagree enforcement (minDisagreePerSession config without mechanism)

## Context for Next Session

TLSN is reactivated — first sessions with `tlsn_preferred` will validate attestation success rates. Quality gate effectively disabled (threshold=1), test quality enforcement active. 89 suites, 1383 tests. All docs updated. Next priority: run TLSN sessions and monitor, continue quality_score data collection.
