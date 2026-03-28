# ADR-0010: Architecture Decision Records for Project Documentation

**Status:** accepted
**Date:** 2026-03-28
**Decided by:** Marius

## Context

Architectural decisions were scattered across commit messages, MEMORY.md feedback entries, PRD decision sections, and conversation context. The "why X over Y" knowledge was not discoverable or searchable. Inspired by Fowler/Nygard ADR pattern.

## Decision

**Lightweight ADRs in `docs/decisions/`. Per-project, not global.**

Format: numbered markdown (NNNN-kebab-title.md) with Status, Date, Context, Decision, Alternatives, Consequences.

Integration points:
- **Algorithm LEARN phase** — prompt instruction to write ADR when session made an architectural decision
- **CLAUDE.md context routing** — pointer to `docs/decisions/` directory
- **No hooks** — AI judgment at LEARN phase is sufficient; commit hooks would be noisy

Scope:
- Project-level: `docs/decisions/` in each repo
- PAI-wide: `my-pai/docs/decisions/` (or pai-extension) for cross-project decisions
- No tooling (adr-tools etc.) — plain markdown is sufficient

## Alternatives Considered

1. **adr-tools (npryce)** — bash scripts for template generation. Rejected: adds tooling dependency for what's just markdown files.
2. **Global ADR repo** — single place for all decisions. Rejected: routing is hard, context gets mixed.
3. **PRD decision sections only** — rejected. PRDs are ephemeral per-task; ADRs persist.
4. **Commit message conventions** — rejected. Not searchable, not structured.

## Consequences

- Retroactive ADRs mined from 449-commit history (10 initial ADRs)
- Future sessions that make architectural choices write ADRs at LEARN phase
- ADRs complement (not replace) CLAUDE.md, MEMORY.md, and PRDs
- Context routing prevents context window spam — ADRs loaded on-demand
