# Review: `Plans/tingly-snacking-glacier.md`

## Findings

### 1. The Phase 3/4 rewrite plan is not correct as written; it will leave broken imports behind

The `sed` rules in the plan only rewrite a narrow subset of string shapes (`from "../tools/lib/...`, `from "../core/types.js"`, etc.) at [`Plans/tingly-snacking-glacier.md:68-83`](../Plans/tingly-snacking-glacier.md) and [`Plans/tingly-snacking-glacier.md:136-163`](../Plans/tingly-snacking-glacier.md). The repo uses several other patterns that those commands do not touch:

- Dynamic imports in CLI code:
  - [`tools/session-runner.ts:114`](../tools/session-runner.ts), [`tools/session-runner.ts:1765`](../tools/session-runner.ts), [`tools/session-runner.ts:1901-1905`](../tools/session-runner.ts), [`tools/session-runner.ts:3441`](../tools/session-runner.ts), [`tools/session-runner.ts:3592-3594`](../tools/session-runner.ts)
  - These use `import("./lib/...")` and `typeof import("./lib/...")`, not `from "./lib/..."`
- Dynamic import in a plugin:
  - [`core/plugins/budget-plugin.ts:38`](../core/plugins/budget-plugin.ts)
  - `await import("../../tools/lib/budget-tracker.js")` is missed by the plugin `sed` rule because there is no `from`.
- Files under `tools/lib/` that still depend on `core/types.ts`, but are not covered by the rewrite table:
  - [`tools/lib/event-loop.ts:13-19`](../tools/lib/event-loop.ts)
  - [`tools/lib/watermark-store.ts:14`](../tools/lib/watermark-store.ts)
  - All event handlers, e.g. [`tools/lib/event-handlers/reply-handler.ts:8`](../tools/lib/event-handlers/reply-handler.ts)
  - The plan only lists `event-sources/*.ts` and the two action executor files.
- Test strings that are not `from ...` imports:
  - `vi.mock("../tools/lib/sdk.js", ...)` in [`tests/auth.test.ts:17`](../tests/auth.test.ts) and many other tests
  - `resolve(process.cwd(), "tools/lib/sources/providers/specs")` in [`tests/declarative-engine.test.ts:204`](../tests/declarative-engine.test.ts)
  - `resolve(__dirname, "../tools/lib/sources/providers/specs")` in [`tests/golden-adapters.test.ts:31`](../tests/golden-adapters.test.ts)
  - `fs.readFileSync("tools/lib/llm.ts", ...)` and `fs.readFileSync("tools/session-runner.ts", ...)` in [`tests/gate-opinion.test.ts:52-68`](../tests/gate-opinion.test.ts)
- Nested test files:
  - [`tests/fixtures/event-fixtures.ts:5`](../tests/fixtures/event-fixtures.ts) imports `../../core/types.js`, but the plan only rewrites `tests/*.ts`, not `tests/**/*.ts`.

This is the biggest issue in the plan. The rewrite table is not just incomplete around edge cases; it misses import forms that are already used in core runtime code and tests.

### 2. Phase 2 is incomplete and therefore not actually “Low Risk”

The config move at [`Plans/tingly-snacking-glacier.md:42-60`](../Plans/tingly-snacking-glacier.md) lists only five follow-up updates. That is not enough.

Missed runtime path references:

- [`tools/lib/agent-config.ts:114-120`](../tools/lib/agent-config.ts) hardcodes `sources/catalog.json`
- [`tools/source-lifecycle.ts:56`](../tools/source-lifecycle.ts) hardcodes `../sources/catalog.json`
- [`tools/session-runner.ts:3592-3597`](../tools/session-runner.ts) hardcodes `../sources/catalog.json`

Missed config/document references to `strategies/base-loop.yaml`:

- [`agents/sentinel/strategy.yaml:8`](../agents/sentinel/strategy.yaml) and the other agent strategy files
- [`profiles/crawler-session.md:255`](../profiles/crawler-session.md) and the other generated profiles

The plan says “check for path to `strategies/`” in [`Plans/tingly-snacking-glacier.md:57`](../Plans/tingly-snacking-glacier.md), but the repo has multiple concrete references today. This phase should be treated as a real migration, not a light cleanup.

### 3. Phase 4 is not safe to merge before Phase 5

The plan says to merge once Phase 4 tests pass at [`Plans/tingly-snacking-glacier.md:174-176`](../Plans/tingly-snacking-glacier.md), but Phase 5 contains required runtime entrypoint updates:

- `package.json` still points at `tools/*.ts` in [`package.json:8-17`](../package.json)
- guarded scripts still point at `tools/*.ts` in [`package.json:31-33`](../package.json)
- cron wrapper still invokes `"$REPO/tools/session-runner.ts"` and `"$REPO/tools/source-lifecycle.ts"` in [`scripts/scheduled-run.sh:68-93`](../scripts/scheduled-run.sh)

If you merge after Phase 4, `npm run session`, `npm run audit`, guarded scripts, and cron all break even if Vitest is green. That means Phase 4 is not a safe “atomic commit” in the operational sense the plan implies.

### 4. The `tsconfig.json` update is underspecified and can leave stale or misleading build output

At [`Plans/tingly-snacking-glacier.md:166-167`](../Plans/tingly-snacking-glacier.md), the plan says to change `include` to `src/`, `cli/`, `tests/`. That misses at least:

- [`platform/index.ts`](../platform/index.ts)
- [`connectors/index.ts`](../connectors/index.ts)

Those files are part of the migration and have rewrite steps in the plan, so excluding them from TS roots is inconsistent.

There is also a build-output implication:

- Root `tsconfig.json` currently emits to `dist/` with `rootDir: "."` and `sourceMap: false` in [`tsconfig.json`](../tsconfig.json)
- The workspace already has a root `dist/` plus `packages/core/dist/`

After broadening `include`, `tsc` will emit `dist/src`, `dist/cli`, `dist/tests`, while any stale `dist/tools` output remains unless explicitly cleaned. No source-map rewrite is needed because `sourceMap` is already false, but stale `dist/` is still a real migration hazard.

## Requested Review Points

### 1. Correctness

The `sed` rewrite patterns are not correct enough to trust.

They will miss:

- `await import("...")`
- `typeof import("...")`
- `vi.mock("...")`
- `readFileSync("tools/...")` and `resolve(..., "tools/...")` path literals
- nested test files under `tests/**`
- `tools/lib` files not named in the table but still importing `core/types.js`

They are also brittle because they encode exact prefixes rather than matching all path-bearing string literals. In this repo, the import surface is already too heterogeneous for “a few `sed -i` lines” to be reliable.

### 2. Risk assessment

Phase 4 is only safe as a single commit if all of the following happen in that same commit:

- internal imports are fully rewritten, including dynamic imports and test string literals
- package scripts are updated
- shell scripts are updated
- any docs or generated content that operators rely on are updated enough not to send people to dead paths

As written, the plan does not do that. It creates an intermediate state where tests may pass but the repo is operationally broken. The branch-first advice is fine, but “merge if tests pass” after Phase 4 is not.

Ordering inside Phase 4 also matters:

- Moving `tools/lib` and `core` first is okay only if import rewrites are complete
- Moving CLIs to `cli/` before updating `package.json` and `scripts/scheduled-run.sh` increases the breakage window

### 3. Missing steps

`vitest.config.ts`

- I checked it. It does not reference `tools/` paths. No change needed there.

`.github/workflows/`

- I checked `.github/workflows/validate-plugin.yml`.
- It only invokes `.mjs` files that remain in `tools/`: [`validate-plugin.yml:20-27`](../.github/workflows/validate-plugin.yml)
- No restructure update is needed there.

Shebang lines

- The `#!/usr/bin/env npx tsx` shebangs in moved CLI files are fine to keep.
- The problem is not the shebang text; the problem is every external caller that still points at `tools/*.ts`.

Dynamic imports / `require()`

- These are a major missing category, not a minor edge case.
- Important misses:
  - [`core/plugins/budget-plugin.ts:38`](../core/plugins/budget-plugin.ts)
  - [`tools/session-runner.ts:114`](../tools/session-runner.ts)
  - [`tools/session-runner.ts:1765`](../tools/session-runner.ts)
  - [`tools/session-runner.ts:1901-1905`](../tools/session-runner.ts)
  - [`tools/session-runner.ts:3441`](../tools/session-runner.ts)
  - [`tools/session-runner.ts:3592-3594`](../tools/session-runner.ts)
- The `require()` calls I found are in tests and currently only hit `node:fs`, so they are not a restructure blocker by themselves.

Source map / `dist/`

- No source-map migration work is needed because root `tsconfig.json` already has `"sourceMap": false`.
- You do need an explicit `dist/` cleanup step, or at least a note to remove stale root `dist/` output before any post-move `tsc` use.

Other missing steps beyond the user’s checklist:

- `tools/generate-profile.ts` still emits `npx tsx tools/...` commands and will regenerate stale profiles
- agent `strategy.yaml` files and generated `profiles/*.md` still reference `../../strategies/base-loop.yaml`
- Phase 5’s external-reference list is far too short relative to the current repo

### 4. Alternative approaches

TypeScript path aliases are not a better primary migration strategy here.

Reasons:

- the repo runs many files directly with `tsx`
- runtime paths still need to resolve at execution time
- aliases do nothing for string literals like `readFileSync("tools/lib/llm.ts")`
- aliases do not solve the physical move itself; they only hide import paths afterward

A codemod is safer than `sed`.

Why:

- it can update static imports, exports, `import type`, dynamic imports, and selected string literals in one pass
- it can operate on AST nodes instead of exact text prefixes
- it gives you a deterministic file list to review

If you do not want a codemod, the minimum bar should be:

- broaden the replacement set beyond `from ...`
- run `grep` verification for any remaining `tools/lib/`, `../core/`, and `sources/catalog.json` references before committing

### 5. Phase ordering

I would reorder the plan to reduce blast radius:

1. Do Phase 1 (`packages/core/`) first.
2. Do the `sources/` and `strategies/` move as its own complete migration, but only after enumerating all path references.
3. Move `tools/lib` to `src/lib` and `core` to `src` first.
4. Get tests green.
5. Move `tools/*.ts` to `cli/` together with `package.json`, shell scripts, and operator-facing command references.
6. Update broader docs and generated content after the repo is functionally stable.

If you want to keep the “single commit” idea, then combine current Phases 4 and 5 into one functional migration commit. Splitting them creates a knowingly broken intermediate state.

### 6. What I would change

Specific changes I would make to the plan:

1. Replace the current `sed` table with either an AST codemod or a much broader rewrite checklist that explicitly covers:
   - `from "..."`
   - `await import("...")`
   - `typeof import("...")`
   - `vi.mock("...")`
   - path strings passed to `fs`/`path.resolve`
   - `tests/**/*.ts`, not `tests/*.ts`
2. Expand Phase 2 to include every current `sources/catalog.json` and `strategies/base-loop.yaml` reference, including:
   - [`tools/source-lifecycle.ts`](../tools/source-lifecycle.ts)
   - [`tools/session-runner.ts`](../tools/session-runner.ts)
   - [`tools/lib/agent-config.ts`](../tools/lib/agent-config.ts)
   - agent `strategy.yaml` files
   - generated profiles
3. Do not merge after Phase 4. Either:
   - merge only after current Phases 4 and 5 are both complete, or
   - collapse them into one “functional move” commit.
4. Update the `tsconfig.json` plan to include `platform/` and `connectors/`, or explicitly say they are intentionally excluded.
5. Add an explicit `dist/` cleanup note.
6. Add a verification checklist after the move:
   - no remaining `tools/lib/` refs outside intentional docs/history
   - no remaining `../core/` refs outside intentional docs/history
   - no remaining `sources/catalog.json` or `strategies/base-loop.yaml` refs after the config move
7. Expand Phase 5’s scope. At minimum include:
   - `tools/generate-profile.ts`
   - `README.md`
   - `plugins/demos-supercolony/**`
   - `skills/**/*.md`
   - generated `profiles/*.md`
8. Update the success criteria. The plan’s “855 tests” target at [`Plans/tingly-snacking-glacier.md:174`](../Plans/tingly-snacking-glacier.md) looks stale relative to the current repo and should be replaced with “current full Vitest suite passes”.

## Bottom line

The restructure direction is reasonable. The execution plan is not ready.

The main issue is not whether `src/`/`cli/` is a good layout. It is that the migration is currently specified as a text-rewrite exercise, while the repo already contains enough dynamic imports, test string literals, and config-path references that a narrow `sed` pass will almost certainly leave breakage behind.
