# Session: Agent Overhaul + Toolkit Architecture Design

**Date:** 2026-03-26 16:30
**Duration:** ~6 hours
**Mode:** full
**Working Directory:** ~/projects/omniweb-agents

## Summary

Massive session: fixed broken `claude -p` (hook recursion), ran all 3 agents with TLSN (failed → disabled), shipped engagement improvements (reply-first, tipping, minDisagree, quality txHash), created comprehensive session loop documentation, then pivoted to strategic toolkit architecture design — evolving omniweb-agents from harness to framework-agnostic toolkit with OpenClaw + ElizaOS adapters.

## Work Done

- Fixed `claude -p` recursive hook spawning — `--setting-sources ''` injection in CLIProvider
- Ran all 3 agents: sentinel-44 (1 post), crawler-14 (2 posts), pioneer-38 (1 post)
- TLSN ecosystem scan: 0/145 feed posts have TLSN attestations — disabled across all agents
- Implemented minDisagreePerSession enforcement (second-pass scanner in engage.ts)
- Added txHash to quality data, moved logging post-publish, built backfill script (6 matches found)
- Created A/B review trial logging CLI
- Reply-first strategy (Bucket 1 priority), tipping enabled all agents, 180s session timeout
- Sub-1-minute session plan: reviewed by First Principles + Architect agents, hardened (2 items removed, 5 added)
- Created comprehensive `docs/session-loop-explained.md` + HTML visual
- Established toolkit architecture vision: framework-agnostic, three-layer (adapter → core → SDK)
- Answered all 6 design questions (Q1-Q6) with Marius
- Council debate (4/4 convergence): zero loops in toolkit — atomic tools + rate-limit guard
- Researched skill design best practices, OpenClaw skill system, ElizaOS plugin architecture
- Mapped all 11 Demos SDK verticals with concrete tool definitions
- Deconstructed Skill Dojo: 15 parameterized SDK wrappers (zero AI), parity analysis
- Tested TLSN via Skill Dojo: Phase 1 works, Phase 2 fails — confirms infra issue, not our code
- 15+ commits pushed, 89→92 suites, 1383→1418 tests

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| omniweb-agents = TOOLKIT, not framework/harness | We provide domain capabilities, not agent reasoning | Keep as harness, become framework |
| Zero loops in toolkit | 4/4 council convergence + prior art (Stripe, Composio, MCP) | 8-phase loop, 4-phase, Sense+Act |
| Tools over personas | Consumer's agent has its own identity | Ship personas as core, sub-agent model |
| Stateless tools by default | Consumer manages state, rate limits mandatory | Toolkit manages all state |
| Thin wrapper over SDK | Abstract non-trivial complexity, don't obscure | Thick abstraction, raw SDK pass-through |
| Replicate Skill Dojo locally | Our local path is better (no rate limit, claim extraction) | Remote-only, hybrid without local replication |
| TLSN disabled indefinitely | 0 ecosystem adoption + Phase 2 MPC proof fails everywhere | Keep trying, DAHR-only permanent |
| Reply-first strategy | Replies get 2x reactions (13.6 vs 8.2) | Keep top-level priority |
| 180s session hard timeout | 60+ min sessions are waste | No timeout, per-phase budgets only |

## Key Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| `src/lib/llm-provider.ts` | edited | `--setting-sources ''` injection for claude CLI |
| `cli/session-runner.ts` | edited | 180s timeout, phase budgets slashed, reply-first bucket order |
| `agents/*/persona.yaml` | edited | dahr_only, tipping enabled, replyMinParentReactions: 3 |
| `src/lib/engage-heuristics.ts` | created | Extracted selectReaction + enforceDisagreeMinimum |
| `src/lib/quality-score.ts` | edited | Added txHash + actual_reactions fields |
| `scripts/backfill-quality-actuals.ts` | created | Join quality data with session logs by txHash |
| `scripts/log-review-trial.ts` | created | A/B trial logging CLI |
| `docs/session-loop-explained.md` | created | Comprehensive 8-phase loop reference |
| `docs/design-toolkit-architecture.md` | created | 550+ line living design doc, 13 decisions |
| `docs/INDEX.md` | edited | Session changelog, stale content fixes |
| `CLAUDE.md` | edited | TLSN status, timeout, tipping, docs sync convention |

## Learnings

- `claude -p` fires ALL PAI hooks including UserPromptSubmit — hooks spawn nested `claude` processes creating a recursive fork bomb. Fix: `--setting-sources ''` keeps OAuth while disabling hooks.
- TLSN is dead in the ecosystem — 0/145 feed posts, schema doesn't even distinguish TLSN from DAHR. The 2.3x multiplier from n=68 data was measuring something else.
- Skill Dojo "skills" are just parameterized SDK calls, not AI agents. Zero LLM, zero reasoning.
- TLSN Phase 1 (token) works everywhere. Phase 2 (MPC-TLS WASM proof) fails everywhere — notary handshake issue, confirmed by testing Skill Dojo's own TLSN skill.
- 85% of omniweb-agents generic abstractions already exist (types.ts, plugins, sources). Toolkit evolution is extraction, not greenfield.
- Agent framework taxonomy: Framework (brain) vs Harness (body) vs Toolkit (hands). We're hands.
- Indexer health check (30s) + verify `--wait 15` (15s) = 45s waste per post.
- Extension hooks run serially with up to 285s combined timeout — hidden bottleneck.

## Open Items

- [ ] Speed fixes: 5 surgical changes (remove --wait 15, skip indexer, reduce retries, cap harden, scan cache)
- [ ] Colony intelligence: map feed, track agents, verify reply-first + tipping actually fires
- [ ] Toolkit MVP spec with ISC criteria
- [ ] Toolkit implementation (git mv + re-export after all improvements done)
- [ ] Add Polymarket/Kalshi to source catalog
- [ ] Quality correlation: 17 entries, need 20+ with actuals

## Context for Next Session

Speed fixes are 30min surgical (5 changes, mostly 1-liners). Do those first, then run agents to test reply-first + tipping. Colony intelligence is the high-priority capability to build — it becomes `core/intel/colonyMap.ts` in the toolkit. Toolkit MVP spec uses the complete design doc at `docs/design-toolkit-architecture.md` (550+ lines, 13 decisions, all questions answered). All improvements survive the toolkit refactor — it's reorganization not rewrite.
