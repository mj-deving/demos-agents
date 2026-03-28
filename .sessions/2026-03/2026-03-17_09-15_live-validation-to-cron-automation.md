# Session: Live Validation to Cron Automation

**Date:** 2026-03-17 09:15
**Duration:** ~3 hours
**Mode:** full
**Working Directory:** ~/projects/demos-agents

## Summary

Took all 3 SuperColony agents (sentinel, pioneer, crawler) from "never published in V2 autonomous mode" to "all publishing and scheduled on cron every 6 hours." Fixed 7 bugs, shipped LLM reasoning fallback for topic selection, built multi-agent dashboard, and set up production scheduling.

## Work Done

- Sprint 1: Ran all 3 agents live (V2 autonomous). All completed but 0 posts — uncovered V2 gate→publish handoff bug
- Sprint 2: Fixed 7 bugs blocking publishing:
  - V2 gate→publish state bridge (critical — `state.phases.act.result.gate` never set)
  - V2 resume path also missing state bridge (Codex HIGH)
  - Source selection DAHR tiebreak (prefer richer sources for DAHR)
  - Attestation mode `tlsn_preferred` → `dahr_only` (TLSN broken server-side)
  - Pioneer calibration offset -10 → 0 (avg error -9.4 confirmed too aggressive)
  - Match threshold 30 → 10 (financial/numeric sources score 10-21)
  - Source-aware topic selection (filter topics without matching sources before gate)
- Sprint 2.5: LLM reasoning fallback when heuristic topic selection returns 0 viable topics
- Sprint 3: `scripts/scheduled-run.sh` + `scripts/rotate-logs.sh` + crontab every 6h UTC
- Sprint 4: `tools/multi-agent-report.ts` cross-agent dashboard, calibration assessed
- LLM provider switched from codex-cli auto-detect to `claude --print` (OAuth subscription) for cron compatibility

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Use session-runner.ts over run-loop.ts for scheduling | run-loop bypasses extension system (calibration, signals, predictions, tips) | Refactoring run-loop to delegate to session-runner |
| V2 loop over V1 for autonomous | V2 has extension hooks; V1 has REVIEW/HARDEN but no extensions | V1 with manual REVIEW periodically |
| Match threshold 30→10 | Financial sources score 10-21; DAHR attestation proves provenance | Improving matcher claim extraction for numeric data |
| dahr_only attestation | TLSN broken server-side; DAHR works fine | Waiting for TLSN fix |
| claude --print for cron LLM | Uses OAuth subscription, no API key needed, works non-interactively | Setting up ANTHROPIC_API_KEY |

## Key Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| tools/session-runner.ts | edited | V2 gate→publish handoff, engage bridge, reasoning fallback, source-aware topics |
| tools/lib/sources/policy.ts | edited | DAHR tiebreak (prefer larger on equal score), TLSN-only bonus |
| tools/lib/sources/matcher.ts | edited | Match threshold 30→10 |
| agents/*/persona.yaml | edited | dahr_only attestation, gate thresholds aligned to 10, pioneer offset 0 |
| agents/pioneer/strategy.yaml | edited | Threshold spec sync 12→10 |
| scripts/scheduled-run.sh | created | Cron wrapper with stdin guard, PATH setup, failure alerting |
| scripts/rotate-logs.sh | created | 7-day log retention |
| tools/multi-agent-report.ts | created | Cross-agent dashboard |
| tests/source-selection.test.ts | created | 4 tests for DAHR/TLSN source ranking |
| tests/reasoning-fallback.test.ts | created | 10 contract tests for LLM reasoning fallback |
| ~/.config/demos/credentials | edited | Added LLM_CLI_COMMAND="claude --print" |

## Learnings

- V2 loop stores substage results in substage objects but `getGateResult()` reads from `state.phases.act.result.gate` — these are different locations. Must bridge explicitly.
- Source match scoring was calibrated on HN text data (titles/snippets). Financial numeric data (price tickers) scores poorly because "claims" are analytical words, not numbers.
- `scan.topicIndex` is a Record (not array) — must normalize before iterating
- codex-cli fails in cron (needs stdin). `claude --print` works via pipe with OAuth.
- Pioneer's niche topics (mxn, lit, compliance) consistently have no matching sources — source-aware filtering is essential

## Open Items

- [ ] Sprint 5: Run multi-agent-report after 24h of cron data, validate <10% failure rate
- [ ] LLM provider architecture refactor — caller-configured not auto-detected (saved to memory)
- [ ] Broader architecture discussion — modular/composable refactor (Marius flagged)
- [ ] TLSN: revert to tlsn_preferred when KyneSys fixes server
- [ ] Pioneer/crawler calibration offsets: need 3+ post-reset sessions to recalibrate

## Context for Next Session

All 3 agents publishing in V2 autonomous mode. Cron scheduled every 6h UTC via `scripts/scheduled-run.sh`. LLM uses `claude --print` (OAuth). Multi-agent report at `tools/multi-agent-report.ts --pretty`. Sprint 5 is monitoring — check report after 24h of cron runs. Marius wants an extended architecture discussion about making the project more modular/composable (saved to project memory).
