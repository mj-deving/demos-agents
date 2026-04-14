# Session: Fix Publishing Failures + Plan Modular Refactor

**Date:** 2026-03-17 12:15
**Duration:** ~2.5 hours
**Mode:** full
**Working Directory:** /home/mj/projects/omniweb-agents

## Summary

Fixed 79% agent session failure rate (two root causes: cron LLM provider resolution + JSON parsing fragility + gate duplicate check too broad). Then launched comprehensive modular refactor planning using Council (4 agents, 2 rounds) + Red Team (3 attackers) resulting in a 6-phase, 42-criteria PRD.

## Work Done

- Diagnosed 79% failure rate: codex-cli auto-detected in cron instead of claude --print
- Fixed cron LLM provider: exported LLM_CLI_COMMAND in scheduled-run.sh
- Hardened JSON parsing in llm.ts: preamble extraction, trailing text removal, truncated JSON repair
- Hardened reasoning fallback JSON parsing in session-runner.ts
- Fixed gate duplicate check: match tags/assets only, not body text (was blocking topics mentioned anywhere in post body)
- Successfully published with all 3 agents: pioneer (biotech QUESTION, 694ch, score 80), sentinel (sentiment-divergence ANALYSIS, 885ch), crawler (crypto ANALYSIS, 873ch)
- Launched 3 parallel audit agents: codebase audit, framework research, architecture mapping
- Ran Council debate (Architect, Engineer, Researcher, Security) on monorepo vs single-repo
- Ran Red Team (Engineer edge-case, Pentester assumption-breaker, Intern devil's-advocate)
- Produced 42-ISC PRD for 6-phase modular refactor
- Created framework research doc covering OpenClaw, CrewAI, AutoGen, LangGraph, Eliza, Agency Swarm

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Single repo with lint boundaries | Council unanimous — monorepo overhead not justified for single-consumer project | Monorepo packages/core + packages/app |
| YAML config only (no markdown-as-config) | Machine-parseable, schema-validatable, already proven | OpenClaw markdown workspaces (AGENTS.md, SOUL.md) |
| Extract gems, not whole repo | Red Team IN-8: only 30-40% genuinely portable, not 80-90% | Modularize entire repo as framework |
| Single orchestrator wallet | Marius clarified: agents are subagents of one orchestrator | Per-agent separate wallets |
| Ship core package proactively | Red Team: "wait for second consumer" = never ship | Defer until external demand |
| Gate duplicate: tags-only matching | Body text matching too broad — 24h cooldown triggered by passing mentions | Keep text.includes() matching |

## Key Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| scripts/scheduled-run.sh | edited | Export LLM_CLI_COMMAND for cron |
| tools/lib/llm.ts | edited | JSON extraction hardening + truncated repair |
| tools/session-runner.ts | edited | Reasoning fallback JSON extraction |
| tools/gate.ts | edited | Duplicate check: tags/assets only, not body text |
| docs/research-agent-frameworks-modularization.md | created | 511-line framework comparison research |

## Learnings

- Cron LLM provider auto-detect finds codex before claude in PATH — belt-and-suspenders with env export
- Gate duplicate check was the main cause of topic rejection (not gate strictness per se)
- Red Team should run BEFORE Council — attack assumptions first, then debate corrected framing
- The "80-90% framework-ready" claim was wrong — intern counted 124 SuperColony refs across 15 files
- Honest portable percentage: 30-40% (declarative engine, source lifecycle, LLM provider, extension hooks, session loop, catalog)

## Open Items

- [ ] Execute Phase 0: end-to-end smoke tests + 12 module tests
- [ ] Execute Phase 1: dead code removal, spec drift fix, constant extraction
- [ ] Execute Phase 2 (revised): spending policy at signing boundary
- [ ] Execute Phases 3-5: module boundaries, framework interface, publishable core
- [ ] Update CLAUDE.md with modular refactor decisions
- [ ] Revise PRD Phase 2 for single-wallet orchestrator model

## Context for Next Session

The publishing fixes are shipped and working (3/3 agents published successfully). The modular refactor plan is complete (42 ISC, 6 phases) and committed as research doc + PRD. Phase 0 (safety net tests) is the first execution step. Marius clarified single orchestrator wallet model — Phase 2 needs revision to focus on plugin-boundary security instead of wallet separation. The cron job at 12:00 UTC should show improved publish rate with the JSON + gate fixes.
