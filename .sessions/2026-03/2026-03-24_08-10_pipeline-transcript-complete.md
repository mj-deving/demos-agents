# Session: Signal Pipeline + Session Transcript — Full Delivery

**Date:** 2026-03-24 08:10
**Duration:** ~9 hours (spanning 2026-03-23 evening to 2026-03-24 morning)
**Mode:** full
**Working Directory:** ~/projects/demos-agents

## Summary

Massive session: shipped all 5 phases of the intent-driven scanning pipeline, ran + audited 5 live agent sessions, fixed all operational issues, researched mini-swe-agent patterns, ran a 4-perspective council debate, designed + implemented the session transcript (H2), and corrected the dev workflow. 20+ commits, 68 new tests.

## Work Done

**Signal Detection Pipeline (Phases 2-5):**
- Phase 2: Source scanner CLI + intent spec (ScanIntent, deriveIntentsFromTopics, selectSourcesByIntent)
- Phase 2b: Winsorize in baseline querying (MAD-based outlier rejection on read path)
- Phase 3: Anti-signal detection (detectAntiSignals, confirmAntiSignals, entity field, cross-source confirmation)
- Phase 4: Session loop integration (runSourceScan, mergeAndDedup, wired into SCAN+GATE phases)
- Phase 5: Z-score adaptive thresholds (cold-start protocol), multi-window baselines, convergence detection

**Live Session Runs:**
- 5 sessions: 2 sentinel (40-41), 3 pioneer (33-35)
- 100% publish+verify rate, 5rx each (all from own ENGAGE phase)
- Session audit: pioneer calibration fixed (-10), HARDEN JSON parse fixed

**Operational Hardening:**
- SourceUsageTracker wired into buildAttestationPlan
- Attestation retry with 2s backoff on DAHR failure
- Anti-signal double-fetch verification (60s gap, 5% drift threshold)

**Dev Workflow Corrections:**
- Fabric review_code for Tier 2+ (A/B trial with /simplify)
- Fabric summarize_git_diff on ALL commits
- Fix-all-findings rule: never defer review findings
- Algorithm + dev workflow gap documented for PAI project

**Mini-SWE-Agent Research:**
- Explored GitHub repo, mapped architecture
- Creative + Science ideation: 5 hypotheses generated
- Council debate: 4 perspectives × 3 rounds → H2 unanimous

**Session Transcript (H2):**
- Council-validated design doc with Codex plan review (8 findings)
- src/lib/transcript.ts: emit/read/prune, schema v1 with versioning
- 6 emit points in session-runner V1 loop
- Phase-specific metrics extraction (verified against actual result shapes)
- cli/transcript-query.ts: latency bars, aggregates, --pretty/--json
- Retroactive Codex review of Steps 1+2 (workflow violation caught + corrected)
- All review findings fixed: utimesSync race, chmod on creation, session-complete in error path, section numbering

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| H2 transcript first (council unanimous) | Additive, zero risk, enables measurement | H3 (protocol phases), H1 (LLM ordering) — conditional on data |
| H4 (exception signals) rejected | Exceptions for control flow is anti-pattern | |
| H5 (50-line runner) rejected | Destroys reproducibility, 3952 lines is earned complexity | |
| Fabric + Codex complementary | Different detection domains (perf vs correctness) | Use only one |
| Fix all findings always | Quality over speed | Defer "non-blocking" items |
| Z-score unscaled (no 1.4826) | Simpler, threshold calibrated to formula | Standard modified z-score |

## Key Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| `src/lib/signal-detection.ts` | edited | Phases 3+5: anti-signals, z-scores, convergence, multi-window |
| `src/lib/source-scanner.ts` | created+edited | Phases 2+4: intents, selection, orchestration, merge, double-fetch |
| `src/lib/transcript.ts` | created | H2: transcript event logger |
| `cli/source-scan.ts` | created | Phase 2: standalone CLI |
| `cli/transcript-query.ts` | created | H2: transcript query CLI |
| `cli/session-runner.ts` | edited | Phase 4 wiring, transcript integration, metrics extraction |
| `src/actions/attestation-executor.ts` | edited | Retry with 2s backoff |
| `agents/pioneer/persona.yaml` | edited | Calibration offset 0 → -10 |
| `docs/design-intent-driven-scanning.md` | edited | Status: all 5 phases implemented |
| `docs/design-session-transcript.md` | created | H2 design doc, council-validated |
| `docs/INDEX.md` | edited | Full project evolution update |

## Learnings

- Fabric review_code and Codex commit review catch different things — run both for Tier 2+
- Entity data should be typed fields, not parsed from display strings
- Every commit needs Codex review before push — no exceptions (retroactive review caught test race)
- Fix ALL review findings immediately — deferred findings accumulate as tech debt
- Source scan producing 0 signals on first run is expected (baselines need population)
- 3952-line session-runner is earned complexity, not bloat (council consensus)
- mini-swe-agent proves radical simplicity works for coding tasks, but demos-agents has hard safety constraints

## Open Items

- [ ] Run test sessions to verify transcript JSONL output
- [ ] Collect 10+ sessions of quality_score data for correlation study
- [ ] Fabric vs /simplify A/B trial (1 data point, 9 more needed)
- [ ] Evaluate H3/H1 based on transcript data
- [ ] Algorithm + dev workflow integration (PAI project)

## Context for Next Session

Signal detection pipeline (5 phases) and session transcript (H2) are both shipped and production-wired. 87 suites, 1355 tests. The immediate next step is running 1-2 sessions to verify transcript JSONL output is produced correctly, then using the transcript-query CLI to analyze the data. After 10-20 sessions, evaluate whether H3 (protocol phases) or H1 (LLM ordering) is warranted based on the transcript data. The dev workflow is corrected: Fabric review_code for Tier 2+, summarize_git_diff on all commits, fix all findings.
