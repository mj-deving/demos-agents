# Session: Signal Detection Core + RTK/Serena Research

**Date:** 2026-03-23 12:22
**Duration:** ~5.5 hours
**Mode:** full
**Working Directory:** /home/mj/projects/omniweb-agents

## Summary

Implemented Phase 1 of intent-driven scanning (signal detection core library) with full TDD, Codex design review, and 3-agent /simplify review. Then conducted deep research on RTK (Rust Token Killer) and Serena MCP as potential PAI optimizations — both assessed and shelved.

## Work Done

- Implemented `src/lib/signal-detection.ts` — 556 lines, pure library with threshold/change detection, baseline persistence, MAD outlier rejection, staleness guards
- Wrote `tests/signal-detection.test.ts` — 53 tests across 8 describe blocks, all passing
- Incorporated council review findings: keyed JSON baselines, N>=3 sample guard, domain-specific thresholds, ISO string prune optimization, median memoization
- Ran Codex design review (10 findings, 8 pre-addressed, 2 deferred by decision)
- Ran 3-agent /simplify review: fixed 6 issues (dead code, unused import, DRY constant, samples counter, prune optimization, median cache)
- Full test suite: 84 suites, 1287 tests, 0 failures (up from 83/1234)
- Committed and pushed: `dba6a3b` feat + `a536ea3` docs
- Deep RTK research: 9 parallel agents + Twitter signal + 4 direct source fetches. Found ~17% real overall savings (not 60-90%), critical shell injection vulnerability, default telemetry. Recommendation: WAIT.
- Deep Serena MCP research: 2 agents + 5 direct doc fetches. Found WSL2 crash bugs (#529), 24K token overhead, no verified benchmarks. Recommendation: DO NOT INSTALL.
- Created reference docs for both tools in memory

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Strength uncapped in signal detection | Preserves magnitude info for sorting; downstream can normalize | Clamp to 3-5 (Codex suggestion) |
| Change strength = \|pct\|/threshold - 1 | Signal at exact threshold = 0 (barely interesting) | pct/threshold without offset |
| winsorize() exported but unwired | Phase 2 will wire into updateBaseline; tested and ready | Wire immediately |
| RTK: WAIT | Critical shell injection, ~17% real savings, alpha quality | Install now |
| Serena: DO NOT INSTALL | WSL2 crash bugs, 24K token overhead, unverified claims | Try with workarounds |

## Key Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| src/lib/signal-detection.ts | created | Signal detection core — types, detection engine, baselines, MAD |
| tests/signal-detection.test.ts | created | 53 comprehensive tests |
| CLAUDE.md | edited | Updated test counts (84 suites, 1287 tests) |
| reference_rtk_rust_token_killer.md | created | RTK reference doc with PAI adaptation plan |
| reference_serena_mcp.md | created | Serena MCP reference doc with WSL2 blockers |
| MEMORY.md | edited | Updated focus, next steps, test counts, memory file index |

## Learnings

- Research agents take 2-5 minutes each; direct WebFetch of primary sources is faster for authoritative data
- The "60-90% token savings" marketing pattern is common — always check what the percentage actually measures (subset vs total)
- AI research agents can generate plausible-sounding false claims (Serena MCP initially assessed as hallucination, turned out to be real)
- The six-layer token optimization model is a useful framework: conversation management > CLI compression > code navigation > tool schemas > IDE-native > neural pruning
- A well-maintained CLAUDE.md + MEMORY.md system provides most of the orientation value that tools like Serena's onboarding/memory offer

## Open Items

- [ ] Phase 2: Source scanner CLI + intent spec (next build task)
- [ ] Wire winsorize() into updateBaseline() (quick, Phase 2 of signal detection)
- [ ] Quality score data collection (10+ sessions needed)
- [ ] SourceUsageTracker wiring in session-runner.ts
- [ ] Revisit RTK at v1.0 when shell injection is fixed

## Context for Next Session

Signal detection Phase 1 is shipped and passing (84 suites, 1287 tests). Design doc at `docs/design-intent-driven-scanning.md` with council review. Next build: Phase 2 (source scanner CLI + intent spec, merged per council). RTK and Serena MCP both assessed and shelved — reference docs saved for future revisit.
