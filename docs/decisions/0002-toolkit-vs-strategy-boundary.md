---
summary: "Toolkit = mechanism (how), strategy = policy (what/weights). Mixed modules must split. Boundary enforced by test."
read_when: ["toolkit", "strategy", "boundary", "code placement", "where does code go", "ADR-0002", "module split"]
---

# ADR-0002: Toolkit vs Strategy Boundary

**Status:** accepted (expanded 2026-03-30)
**Date:** 2026-03-20 (design), 2026-03-28 (clarified), 2026-03-30 (expanded per first-principles analysis)
**Decided by:** Marius

## Context

The codebase contains both reusable chain primitives (SDK bridge, tools) and sentinel-specific session logic (8-phase loop, LLM generation, scoring heuristics). External consumers (OpenClaw, ElizaOS) would need the primitives but not the sentinel strategy.

A first-principles analysis (2026-03-29) using 3-agent codebase mapping + FirstPrinciples decomposition + Red Team + Council debate identified 15+ modules in a "gray zone" mixing plumbing and strategy. The original boundary (`src/toolkit/` = package) was too narrow — reusable primitives were trapped in `src/lib/`. See [architecture-plumbing-vs-strategy.md](../architecture-plumbing-vs-strategy.md) for the full analysis.

## Decision

**`src/toolkit/` is the package boundary. It is expanded to include infrastructure primitives beyond the original 10 tools + 6 guards.**

### Core (main barrel `@demos-agents/core`)

| Layer | Location | Reusable? | Package |
|-------|----------|-----------|---------|
| Tools (10) | `src/toolkit/tools/` | Yes | `@demos-agents/core` |
| Guards (6 + state-helpers) | `src/toolkit/guards/` | Yes | `@demos-agents/core` |
| Session + bridge | `src/toolkit/` (flat) | Yes | `@demos-agents/core` |
| Types + LLMProvider interface | `src/toolkit/types.ts` | Yes | `@demos-agents/core` |

### Sub-path exports (lean barrel, opt-in)

| Layer | Location | Sub-path | Status |
|-------|----------|----------|--------|
| Reactive | `src/toolkit/reactive/` | `@demos-agents/core/reactive` | Pending (EventLoop needs generic TAction) |
| Providers | `src/toolkit/providers/` | `@demos-agents/core/providers` | Pending (DeclarativeEngine needs dep extraction) |
| Sources | `src/toolkit/sources/` | `@demos-agents/core/sources` | Pending |
| SC scoring | `src/toolkit/supercolony/` | `@demos-agents/core/supercolony/scoring` | **Shipped** (Phase 1) |
| Chain helpers | `src/toolkit/chain/` | — | Pending (ChainTxPipeline, asset-helpers) |
| Math | `src/toolkit/math/` | `@demos-agents/core/math` | Pending (BaselineMath) |

### Strategy (NOT exported)

| Layer | Location | Reusable? |
|-------|----------|-----------|
| CLI runners | `cli/` | No |
| Event sources/handlers | `src/reactive/event-{sources,handlers}/` | No |
| Plugins (22) | `src/plugins/` | No |
| Agent config, predictions, tips, mentions | `src/lib/` | No |
| Quality scoring, engage heuristics | `src/lib/scoring/`, `src/lib/pipeline/` | No |
| Config | `config/` | No |

### Gray Zone (documented, deferred — see ADR-0013)

| Module | Extraction trigger |
|--------|--------------------|
| `matcher.ts` | First non-sentinel consumer needs claim matching |
| `policy.ts` | First non-sentinel consumer needs source selection |
| `action-executor.ts` | First non-sentinel consumer needs event dispatch |
| `budget-tracker.ts` | Second consumer proves budget model generalizes |

### Classification rule

A module belongs in toolkit if it is a **mechanism** (how something works). It belongs in strategy if it is a **policy** (what to do, with what weights, at what thresholds). When mixed, split the mechanism into toolkit and parameterize the policy.

### Composable primitives principle (merged from ADR-0003)

Toolkit methods must be composable primitives, not monoliths that hide cost. Each method should be honest about its query cost (address-filtered vs global scan). Consumers compose what they need. Aggregate types (e.g., `AgentActivity`) belong in the strategy layer, not the toolkit. Example: `getHivePostsByAuthor` (cheap, filtered) + `getHiveReactions` (expensive, global scan) instead of a monolithic `queryAgentActivity` that hides the cost difference.

### Security principle

The toolkit boundary is a **security boundary**. Every public function is a backward-compatibility promise. Every parameter is a trust surface. Every configurable threshold is a potential fund-loss vector. When in doubt, keep it opinionated. See [ADR-0007](0007-security-first-real-money.md).

## Alternatives Considered

1. **Monolithic package** — everything exported. Rejected: forces consumers into our strategy choices.
2. **Multiple packages** — toolkit + strategy + config. Rejected: premature for current usage.
3. **Single toolkit package, narrow boundary** — original 10 tools + 6 guards only. Rejected (2026-03-30): traps reusable infrastructure primitives (EventLoop, DeclarativeEngine, catalog, auth) in strategy code.
4. **Single toolkit package, expanded boundary** — core barrel + sub-path exports. Accepted: keeps main barrel lean, exposes infrastructure via opt-in sub-paths.

## Consequences

- Toolkit primitives must be universal, not catered to sentinel's specific strategy
- LLM post generation stays in `src/actions/llm.ts` (strategy, not toolkit)
- `LLMProvider` **interface** exported from toolkit; resolution logic stays in strategy
- Scoring formula constants exported under `supercolony/scoring` namespace (SC-specific)
- New features default to toolkit if they're chain plumbing, strategy if they're decision-making
- Sub-path exports keep main barrel lean — minimal consumer imports only what they need
- Gray-zone modules documented with explicit extraction triggers (see ADR-0013)
- Reactive infrastructure primitives (EventLoop) are toolkit material per [design-toolkit-architecture.md 2026-03-30 clarification](../design-toolkit-architecture.md) — distinct from agent orchestration loops which remain prohibited
