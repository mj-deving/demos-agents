# Session: Intent-Driven Signal Detection Pipeline — Complete

**Date:** 2026-03-23 23:25
**Duration:** ~7 hours
**Mode:** full
**Working Directory:** ~/projects/demos-agents

## Summary

Shipped all 5 phases of the intent-driven scanning pipeline in a single session, plus ran 5 agent sessions, audited results, and fixed all operational findings. The pipeline adds source-first investigative scanning alongside existing feed scanning, with z-score adaptive thresholds and cross-source convergence detection.

## Work Done

- **Phase 2:** Source scanner CLI + intent spec (`src/lib/source-scanner.ts`, `cli/source-scan.ts`) — ScanIntent types, deriveIntentsFromTopics, selectSourcesByIntent, signalsToSuggestions
- **Phase 2b:** Wired winsorize into `getBaselineMedian()` for MAD-based outlier rejection on read path
- **Phase 3:** Anti-signal detection (`detectAntiSignals`, `confirmAntiSignals`) — claim vs source divergence >10%, cross-source confirmation, entity field on DetectedSignal
- **Phase 4:** Session loop integration — `runSourceScan()`, `mergeAndDedup()`, wired into session-runner.ts SCAN+GATE phases
- **Phase 5:** Z-score adaptive thresholds, multi-window baselines, `detectConvergence()` for 3+ source agreement
- **5 agent sessions:** 2 sentinel (sessions 40-41), 3 pioneer (sessions 33-35) — all published, all verified
- **Session audit:** 6 findings investigated, 2 code fixes (pioneer calibration offset, HARDEN JSON parse), 4 confirmed non-bugs
- **Operational fixes:** SourceUsageTracker wired, attestation retry with 2s backoff, anti-signal double-fetch verification
- **Workflow corrections:** Fabric review_code for Tier 2+ (A/B trial), summarize_git_diff on all commits, fix-all-findings rule

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Anti-signal as standalone function (not in detectSignals switch) | Operates on claims x entries, not rules x metrics | Wire into existing switch |
| Z-score unscaled (no 1.4826 constant) | Simpler, threshold calibrated to unscaled version | Standard modified z-score |
| Convergence dedup per-source in avgChange | Prevents double-counting when source has multiple metrics | Average all signals |
| TopicSuggestion consolidated in source-scanner.ts | Eliminate duplicate types between session-runner and source-scanner | Keep both |
| Fabric + Codex are complementary, not redundant | Fabric caught perf issue, Codex caught correctness issue | Use only one |

## Key Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| `src/lib/signal-detection.ts` | edited | Phases 3+5: anti-signals, z-scores, convergence, multi-window |
| `src/lib/source-scanner.ts` | created+edited | Phases 2+4: intents, source selection, scan orchestration, merge, double-fetch |
| `cli/source-scan.ts` | created | Phase 2: standalone CLI entry point |
| `cli/session-runner.ts` | edited | Phase 4: source scan in SCAN, merge in GATE, usage tracker |
| `src/actions/attestation-executor.ts` | edited | Retry with 2s backoff |
| `agents/pioneer/persona.yaml` | edited | Calibration offset 0 → -10 |
| `tests/signal-detection.test.ts` | edited | +49 tests across phases |
| `tests/source-scanner.test.ts` | created+edited | 21 tests |
| `tests/anti-signal-verify.test.ts` | created | 6 tests for double-fetch |
| `tests/attestation-executor.test.ts` | edited | +2 retry tests |

## Learnings

- Fabric review_code and Codex commit review catch different things — complementary for Tier 2+
- Entity data should be a typed field, not parsed from display strings (regex coupling)
- Pre-filtering loops (numeric claims, entries with metrics) is cleaner and faster
- Source scan producing 0 signals on first run is expected — baselines need population first
- 5 reactions per session = own ENGAGE phase, not organic reactions
- HARDEN LLM classification breaks when claude --print wraps output in PAI mode headers

## Open Items

- [ ] Quality score data collection (10+ sessions needed for correlation study)
- [ ] Fabric vs /simplify A/B trial (1 data point collected, 9 more needed)
- [ ] Algorithm + dev workflow integration gap (PAI project, ~/my-pai)

## Context for Next Session

All 5 phases of the intent-driven scanning pipeline are shipped and production-wired. 86 suites, 1341 tests. The operational work items (SourceUsageTracker, retry, double-fetch) are also done. Remaining work is ongoing data collection (quality scores, A/B trial) and the PAI system-level fix for Algorithm + dev workflow nesting. Next productive session: run more agent sessions to populate baselines so z-scores and convergence can activate.
