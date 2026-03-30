# Testing Strategy for Toolkit Migration

## Scope

This document defines the validation strategy for the plumbing-vs-strategy migration in [architecture-plumbing-vs-strategy.md](/home/mj/projects/demos-agents/docs/architecture-plumbing-vs-strategy.md). The goal is to keep each phase shippable with a narrow, explicit test surface.

## Test Principles

- Use Vitest for all migration tests.
- Prefer smoke tests at package boundaries before deeper behavior tests.
- Add tests before implementation changes for every phase.
- Keep new test files in kebab-case.
- Validate both `src/toolkit/*` source barrels and `@demos-agents/core` package exports when Phase 1 or Phase 2 changes public surface.

## Phase 1: Smoke Tests

Purpose: validate zero-risk export additions without changing behavior.

Coverage:

- Toolkit barrel re-exports `LLMProvider` as a type-only public contract.
- Toolkit exposes SuperColony scoring constants under `src/toolkit/supercolony/scoring.ts`.
- `@demos-agents/core` exposes the same scoring surface from `@demos-agents/core/supercolony/scoring`.

Test shape:

- One smoke suite for public exports only.
- Type assertion for `LLMProvider` using `expectTypeOf`.
- Runtime assertions for scoring constants and `calculateExpectedScore()`.

Non-goals:

- Do not retest the scoring formula exhaustively here; existing scoring tests remain the source of detailed formula coverage.
- Do not test provider resolution or any LLM runtime adapter behavior in Phase 1.

## Phase 2: Contract Tests and Re-export Shim Tests

Purpose: preserve import compatibility while files move into toolkit namespaces.

Coverage:

- Contract tests for moved modules against their public API behavior.
- Shim tests proving old import paths still resolve and re-export the same symbols.
- Import-boundary tests verifying no new toolkit module reaches back into strategy-only modules.

Recommended suites:

- `tests/toolkit/providers-contract.test.ts`
- `tests/toolkit/sources-contract.test.ts`
- `tests/toolkit/re-export-shims.test.ts`

Key assertions:

- Old and new import paths expose referentially equivalent functions where practical.
- Package subpath exports resolve through `packages/core` export map.
- Dynamic-import callers still work through shim paths until deprecation removal.

## Phase 3: TDD for `ChainTxPipeline` and `EventLoop` Generics

Purpose: cover the highest-risk redesign work with behavior-first tests.

### `ChainTxPipeline`

Write tests first for:

- enforced `sign -> confirm -> broadcast` ordering
- refusal to broadcast when signing or confirmation fails
- idempotent error handling across all call sites that migrate to the pipeline
- security regressions for the prior silent-non-broadcast bug class

Recommended style:

- Table-driven tests for success and failure paths
- Spies/fakes capturing exact call order
- One integration-style suite proving at least one migrated tool uses the pipeline end-to-end

### `EventLoop<TAction>`

Write tests first for:

- generic action payload propagation without `OmniwebActionType`
- compile-time compatibility for at least two distinct action unions
- existing poll-diff-dispatch behavior preserved after generic extraction

Recommended style:

- Runtime behavior tests for polling and dispatch
- `expectTypeOf` coverage for generic action typing
- Regression tests copied from current event-loop behavior before moving files

## Phase 4: CI Lint Rules

Purpose: stop regression after the migration lands.

Coverage:

- lint-style test or CI script blocking new imports from deprecated shim paths
- import-boundary rule ensuring toolkit code does not import strategy-only files
- optional package-surface check that `packages/core/package.json` exports match committed subpaths

Recommended enforcement:

- Keep boundary checks executable in CI, not only in documentation.
- Fail builds on new deprecated imports while allowing existing shims to remain until the planned removal window.

## Validation Gates

Run after each migration phase:

- `npm test`
- `npx tsc --noEmit`

If Phase 2 or later introduces package export map changes, include at least one package-path smoke import in Vitest so CI exercises the real public surface.
