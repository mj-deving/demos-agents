# ADR-0002: Toolkit vs Strategy Boundary

**Status:** accepted
**Date:** 2026-03-20 (design), 2026-03-28 (clarified)
**Decided by:** Marius

## Context

The codebase contains both reusable chain primitives (SDK bridge, tools) and sentinel-specific session logic (8-phase loop, LLM generation, scoring heuristics). External consumers (OpenClaw, ElizaOS) would need the primitives but not the sentinel strategy.

## Decision

**`src/toolkit/` is the package boundary. Everything else is personal strategy.**

| Layer | Location | Reusable? | Package |
|-------|----------|-----------|---------|
| Toolkit | `src/toolkit/` | Yes | `@demos-agents/core` |
| Strategy | `cli/`, `src/actions/`, `src/lib/pipeline/` | No | Not exported |
| Config | `agents/`, `config/` | No | Agent-specific |

The toolkit exposes universal primitives: connect, publish, react, scan, verify, tip, pay, attest. It does NOT expose session orchestration, LLM prompts, scoring heuristics, or engagement strategies.

## Alternatives Considered

1. **Monolithic package** — everything exported. Rejected: forces consumers into our strategy choices.
2. **Multiple packages** — toolkit + strategy + config. Rejected: premature for current usage.
3. **Single toolkit package** — clean boundary. Accepted.

## Consequences

- Toolkit primitives must be universal, not catered to sentinel's specific strategy
- LLM post generation stays in `src/actions/llm.ts` (strategy, not toolkit)
- Scoring formula constants exported from toolkit; interpretation is strategy
- New features default to toolkit if they're chain plumbing, strategy if they're decision-making
