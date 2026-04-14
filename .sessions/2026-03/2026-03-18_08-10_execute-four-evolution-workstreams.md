# Session: Execute Four Evolution Workstreams

**Date:** 2026-03-18 08:10
**Duration:** ~3 hours
**Mode:** full
**Working Directory:** ~/projects/omniweb-agents

## Summary

Planned and executed 3 of 4 evolution workstreams for omniweb-agents. Added Action and EventPlugin interfaces to core/types.ts, fixed the improvement loop (dedup, EMA calibration, age-out), and built the complete SuperColony reactive event loop with 4 social sources, 4 handlers, and a long-lived event-runner process. All code reviewed by parallel review agents with critical bugs caught and fixed.

## Work Done

- Planned all 4 workstreams using Red Team + Council + First Principles (48 ISC criteria)
- WS1: Extracted improvement-utils.ts with dedup, EMA calibration, age-out, stale management
- WS1: Added dedup to both CLI (improvements.ts) and programmatic (improve.ts) paths
- WS2: Added Action, ActionInput, ActionResult interfaces to core/types.ts
- WS2: Added EventPlugin, EventSource, EventHandler, AgentEvent, EventAction, WatermarkStore to core/types.ts
- WS2: Genericized EvaluatorInput from topic/category to context: Record<string, unknown>
- WS2: Extended PluginRegistry with registerEvent(), getActions(), getEventSources(), getEventHandlers()
- WS4: Built WatermarkStore (file-based + in-memory for tests)
- WS4: Built EventLoop with adaptive polling, warm-up on restart, error isolation
- WS4: Built 4 social EventSources (replies, mentions, tips, disagrees)
- WS4: Built 4 pure EventHandlers (reply, mention, tip-thanks, disagree)
- WS4: Built event-runner.ts (long-lived process entry point with budget-gated executor)
- Ran /simplify reviews after WS1 and WS2
- Ran 3 parallel review agents on commits — caught 3 high-severity bugs
- Ran review agent on WS4 completion — caught 2 more high-severity bugs
- All bugs fixed in dedicated fix commits
- 88 new tests written (527 → 615 total, 36 suites)

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Build order WS1→WS2→WS4→WS3 | Council unanimous: WS4 before WS3 because SC reactive uses existing infra | WS1→WS2→WS3→WS4 |
| Auto-tune calibration offset ONLY | Only param with clean numeric feedback signal | Also tune reply/disagree/match thresholds |
| Separate EventPlugin interface | Session hooks and event hooks have incompatible context types | Extend FrameworkPlugin with event hooks |
| EvaluatorInput genericization | topic/category were SC-specific concepts leaking into core | Keep topic/category, add adapter layer |
| Warm-up poll on restart | Prevents re-firing all events after process restart | Save full snapshot in watermark store |
| Pure event handlers | Testable, dry-runnable, rate-limit checks in executor | Side-effecting handlers |
| Defer WS3 to next session | Substantial scope (Skill-Dojo agents, tx queue, response validation) | Push through in one session |

## Key Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| core/types.ts | edited | Added Action, EventPlugin, event types, genericized EvaluatorInput |
| tools/lib/improvement-utils.ts | created | Dedup, EMA calibration, age-out, stale management |
| tools/improvements.ts | edited | Dedup check, cleanup command, stale status |
| tools/improve.ts | edited | Dedup check in proposeImprovement, import shared types |
| tools/lib/watermark-store.ts | created | File-based + in-memory WatermarkStore |
| tools/lib/event-loop.ts | created | Poll-diff-dispatch orchestrator with adaptive polling |
| tools/lib/event-sources/*.ts | created | 4 social event sources |
| tools/lib/event-handlers/*.ts | created | 4 pure event handlers |
| tools/event-runner.ts | created | Long-lived process entry point |
| tests/*.test.ts | created | 5 new test files, 88 new tests |

## Learnings

- Review agents catch bugs that tests miss: dedup bypass in improve.ts, memory leak in timer array, watermark not seeded on restart — all would have been production issues
- Warm-up poll pattern is essential for event loops with persistence: poll once to establish baseline, then start diffing
- EvaluatorInput genericization was safe because no downstream consumers existed yet — timing matters for breaking changes
- Worktree agents are excellent for parallel test writing while main agent builds implementation

## Open Items

- [ ] WS3: Skill-Dojo agents (DeFi/Markets + Infra/Ops clusters)
- [ ] WS3: Response validation layer for SD-1 fake data
- [ ] WS3: Transaction queue for shared wallet nonce management
- [ ] WS2 (deferred): Eliza OS adapter package
- [ ] WS2 (deferred): OpenClaw adapter package
- [ ] event-runner.ts: Populate ownTxHashes from session log (reply source is dead without this)
- [ ] event-runner.ts: Implement tip/disagree fetch stubs
- [ ] event-runner.ts: Auth token refresh mechanism
- [ ] Codex review when rate limit resets

## Context for Next Session

Three workstreams shipped (WS1, WS2, WS4) with 615 tests all green. WS3 (Skill-Dojo agents) is the remaining workstream — needs response validation, DeFi/Markets + Infra/Ops agent clusters, and transaction queue. The event-runner.ts has TODO stubs for ownTxHashes population, tip/disagree fetching, and SDK action execution. The four evolution workstream plan is at `memory/project_four_workstreams_plan.md`, full architecture doc at `MEMORY/WORK/20260317-183000_event-driven-architecture-decomposition/event-driven-architecture.md`.
