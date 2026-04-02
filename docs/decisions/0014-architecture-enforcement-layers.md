---
summary: "Three enforcement layers: boundary.test.ts (automated), code placement rule (manual), ADR auto-discovery in /simplify"
read_when: ["enforcement", "boundary test", "architecture", "import restriction", "simplify", "ADR check"]
---

# ADR-0014: Architecture Enforcement Layers

**Status:** accepted
**Date:** 2026-03-30
**Decided by:** Marius

## Context

The project has 13 ADRs and a well-defined toolkit-vs-strategy boundary (ADR-0002), but nothing automated prevents architectural drift. The boundary between `src/toolkit/` (reusable primitives) and `src/lib/` (sentinel strategy) is currently clean, but only because of discipline — no CI gate enforces it. As H1 work (matcher hardening, colony census) adds new code, the risk of accidental boundary violations increases.

## Decision

**Three enforcement layers, from automated to advisory:**

### Layer 1: Automated Boundary Test
`tests/architecture/boundary.test.ts` runs on every `npm test`:
- Fails if any `src/toolkit/` file has **runtime** imports (static or dynamic `import()`) from `src/lib/`, `src/plugins/`, `src/actions/`, or `cli/`
- Tracks type-only cross-boundary imports (allowed but capped — threshold alerts if count grows)
- Validates deprecated re-export shims only forward to toolkit paths and contain no logic (checks for non-export statements, not line-counting)
- Known exceptions are documented inline with references to the plan that resolves them

**Relationship to existing boundary tests:**
- `tests/import-boundaries.test.ts` — checks `src/` vs `platform/` vs `agents/` boundaries (different scope, complementary)
- `tests/toolkit/chain/re-export-shims.test.ts` — validates specific toolkit re-export behavior
- `tests/architecture/boundary.test.ts` (this ADR) — focuses specifically on the toolkit-vs-strategy boundary from ADR-0002

These tests are complementary, not overlapping. If boundary testing grows further, consider consolidating into `tests/architecture/`.

### Layer 2: Code Placement Rule
CLAUDE.md contains a decision tree for where new code goes:
- Mechanism (how something works) → `src/toolkit/`
- Policy (what to do, with what weights) → `src/lib/`
- CLI entry point → `cli/`
- Lifecycle hook → `src/plugins/`
- Agent definition → `agents/{name}/`

### Layer 3: ADR Auto-Discovery in /simplify
When `/simplify` reviews code, it scans `docs/decisions/*.md` for all ADRs with `Status: accepted` and checks the diff against their rules. Convention-based: new ADRs automatically join the review scope. No hardcoded ADR references.

**ADR format convention for auto-discovery:**
- Line 3 must be `**Status:** accepted` (or `superseded`, `deprecated`)
- Only `accepted` ADRs are enforced
- The Decision section contains the rules to check against

## Alternatives Considered

1. **Hardcoded ADR references in /simplify config** — Rejected: breaks when new ADRs are added. Manual maintenance burden.
2. **ESLint import boundary plugin** — Rejected: adds a dependency, ESLint not currently in the project, vitest test achieves the same result with zero new deps.
3. **Pre-commit hook** — Rejected: hooks can be bypassed with `--no-verify`. Vitest test runs as part of CI and can't be skipped.
4. **TypeScript project references** — Rejected: requires separate tsconfig per boundary, adds config complexity for one boundary check.

## Consequences

- Architecture drift caught at test time, not review time
- New ADRs are automatically enforced by /simplify via convention
- Known exceptions are documented and tracked, not hidden
- Type-only imports are distinguished from runtime imports — stricter where it matters, pragmatic where it doesn't
