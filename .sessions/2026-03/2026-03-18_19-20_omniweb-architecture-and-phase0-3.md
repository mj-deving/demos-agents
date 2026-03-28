# Session: Omniweb Architecture + Phases 0-3

**Date:** 2026-03-18 19:20
**Duration:** ~2.5h
**Mode:** full
**Working Directory:** ~/projects/demos-agents

## Summary

Massive session: completed items 1-4 (demo configs, executor extraction, adapter specs), designed the full omniweb agent architecture (3 agents, 13 action types, 6 plugins), validated SDK modules against live testnet (StorageProgram blocked by node infra, DemosWork ESM bug, L2PS Buffer issue), and implemented Phases 1-2 (type extensions, StoragePlugin, BudgetPlugin, CrossChainPlugin, omniweb executor, NEXUS agent). Hit infrastructure wall at Phase 3 — all omniweb agents blocked on KyneSys deploying node-side handlers.

## Work Done

- Cleaned SC references from defi-markets/infra-ops AGENT.yaml + persona.md (framework demos, not SC publishers)
- Created minimal strategy.yaml + sources-registry.yaml + source-config.yaml for both demo agents
- Extracted executeAction from event-runner.ts → tools/lib/action-executor.ts (factory + DI pattern)
- Fixed 2 latent bugs: recordPublish missing agent param, saveWriteRateLedger extra arg
- Extracted toErrorMessage to shared tools/lib/errors.ts (deduplicated from 8 files)
- Created adapter interface specs for Eliza OS and OpenClaw (core/adapter-specs.ts)
- Wrote omniweb-agent-architecture.md (645 lines) — full design for NEXUS, WEAVER, SHADE
- Phase 0: SDK exploration tests for StorageProgram (21 pass), DemosWork (blocked), L2PS (partial)
- Phase 1: Extended EventAction type union (5→13), StoragePlugin, storage-client.ts, StorageWatcher, NEXUS agent configs
- Phase 2: BudgetPlugin, budget-tracker.ts, CrossChainPlugin, BalanceSource, omniweb-action-executor.ts
- Phase 3: nexus-bootstrap.ts — discovered node doesn't support StorageProgram transactions yet

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Two-tier agent model (SC + omniweb) | SC agents are valid narrow scope, omniweb is broader | Single tier (rejected — too much scope creep for sentinel) |
| 3 omniweb archetypes: NEXUS/WEAVER/SHADE | Covers operator/coordinator/privacy triangle | More specialized agents (rejected — "super capable, few agents") |
| Factory composition for omniweb executor | Wraps SC executor, doesn't modify it | Extend in place (rejected — breaks SC agents) |
| StorageProgram for inter-agent coordination | On-chain, searchable, ACL-controlled | Local files (rejected — not visible to other agents) |
| Phase 0 SDK gate | Validate before committing to architecture | Build first, test later (rejected — would waste days on blocked infra) |

## Key Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| core/types.ts | edited | Extended EventAction type: SCActionType + OmniwebActionType + param interfaces |
| tools/lib/action-executor.ts | edited | Extracted from event-runner.ts, added errors.ts import |
| tools/lib/omniweb-action-executor.ts | created | Handles 8 new action types, composes with SC executor |
| tools/lib/storage-client.ts | created | Wraps StorageProgram SDK for agent use |
| tools/lib/budget-tracker.ts | created | Per-category DEM allocation + canAfford/recordSpend |
| tools/lib/errors.ts | created | Shared toErrorMessage (deduplicated from 8 files) |
| tools/lib/event-sources/storage-watcher.ts | created | Polls Storage Programs for field changes |
| tools/lib/event-sources/balance-source.ts | created | Low balance alerts + income detection |
| core/plugins/storage-plugin.ts | created | On-chain state persistence hooks |
| core/plugins/budget-plugin.ts | created | Treasury management hooks |
| core/plugins/cross-chain-plugin.ts | created | Chain balance DataProvider |
| core/adapter-specs.ts | created | Eliza OS + OpenClaw adapter interfaces |
| tools/nexus-bootstrap.ts | created | Live Storage Program creation script |
| agents/nexus/* | created | NEXUS agent: AGENT.yaml, persona, strategy, sources |
| docs/omniweb-agent-architecture.md | created | 645-line design document |
| docs/sdk-exploration-results.md | created/updated | Phase 0+3 findings |

## Learnings

- **Template blindness**: First working agent (sentinel) became assumed template for all — caught by Iterative Depth + Intern
- **Types lie about runtime**: StorageProgram types are perfect, but node returns "Unknown message" for all SP operations
- **SDK ahead of infra**: KyneSys shipped client SDK (v2.11.2) before deploying server-side handlers on testnet
- **ESM packaging matters**: DemosWork barrel export uses `from "."` — valid in CJS, broken in ESM
- **Factory composition > inheritance**: omniweb executor wraps SC executor cleanly via function composition
- **Phase 0 gate saved days**: Would have built full agent only to discover node doesn't support the tx type

## Open Items

- [ ] Report 3 SDK issues to KyneSys (StorageProgram node handlers, DemosWork ESM, L2PS Buffer)
- [ ] Re-test StorageProgram when node deploys SP support
- [ ] Study defi-markets/infra-ops skills to derive real use cases (queued)
- [ ] Fix ownTxHashes unbounded growth (/simplify HIGH severity finding)
- [ ] NEXUS live Storage Program creation (blocked on node)
- [ ] WEAVER + SHADE agents (blocked on DemosWork + L2PS fixes)

## Context for Next Session

Next session targets: (1) study defi-markets/infra-ops plugin skills to derive real use cases and redesign their strategy.yaml from actual capabilities, (2) fix ownTxHashes unbounded growth. Omniweb agents are fully designed + implemented to the infrastructure boundary — code is ready, waiting on KyneSys to deploy StorageProgram support on demosnode.discus.sh. 855 tests pass, 11 commits pushed.
