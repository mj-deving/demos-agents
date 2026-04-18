# Codex Session Handoff: OmniWeb Toolkit Green Path

Date: 2026-04-15  
Workspace: `/home/mj/projects/demos-agents`  
Current stack tip: `codex/enforce-packaged-example-filenames`  
Primary scope: `packages/omniweb-toolkit`

## What Changed Since The Earlier SuperColony Handoff

The previous handoff captured the large skill/package refactor that split the old mixed SuperColony material into a cleaner `omniweb-toolkit` package with routed references, validation scripts, packaged assets, and a more disciplined consumer surface.

This session moved the project from "refactored and mostly consistent" to a much greener, more enforceable release path:

- the package gained live response-envelope verification
- the package gained trajectory-trace scoring instead of only static trajectory spec material
- packaged example traces were added for every maintained trajectory scenario
- the example checker now enforces packaged coverage against the maintained trajectory spec
- the example checker now enforces one-scenario-per-file naming discipline
- all of that work was farmed as stacked GitHub PRs instead of direct pushes

The important new reality for Claude is that this is no longer primarily a docs-cleanup effort. It is now a package hardening and release-integrity effort with a working validation ladder.

## Current Branch / PR Reality

Do not keep working on `codex/supercolony-skill-progressive-disclosure`. That branch is just the older stack base now.

Current stacked draft PR chain:

- PR #2: `codex/trajectory-trace-runner` -> `codex/supercolony-skill-progressive-disclosure`
- PR #3: `codex/trajectory-trace-example` -> `codex/trajectory-trace-runner`
- PR #4: `codex/check-trajectory-examples` -> `codex/trajectory-trace-example`
- PR #5: `codex/strict-trajectory-coverage` -> `codex/check-trajectory-examples`
- PR #6: `codex/trajectory-trace-input-validation` -> `codex/strict-trajectory-coverage`
- PR #7: `codex/tip-flow-trace-example` -> `codex/trajectory-trace-input-validation`
- PR #8: `codex/edge-empty-data-trace-example` -> `codex/tip-flow-trace-example`
- PR #9: `codex/edge-budget-exhaustion-trace-example` -> `codex/edge-empty-data-trace-example`
- PR #10: `codex/redteam-injection-trace-example` -> `codex/edge-budget-exhaustion-trace-example`
- PR #11: `codex/stateful-guardrails-trace-example` -> `codex/redteam-injection-trace-example`
- PR #12: `codex/enforce-packaged-trajectory-coverage` -> `codex/stateful-guardrails-trace-example`
- PR #13: `codex/enforce-packaged-example-filenames` -> `codex/enforce-packaged-trajectory-coverage`

Current stack tip for any new work:

```bash
git fetch origin
git switch codex/enforce-packaged-example-filenames
git pull --ff-only
git switch -c codex/<next-small-task>
```

Rules Claude should follow:

- one small task = one branch = one PR
- do not add commits to `codex/supercolony-skill-progressive-disclosure`
- do not batch unrelated changes together
- preserve the stacked base chain unless explicitly asked to restack or squash

## Where We Came From

The project started this arc with a messy combination of:

- stale SuperColony terminology and routing
- overgrown skill docs that mixed activation, reference, strategy, and research
- package metadata and shipped-file drift
- compatibility-doc duplication
- weak guarantees around what was actually shipped versus what was merely documented
- trajectory material that existed as a maintained spec but not as packaged, enforceable trace fixtures

That older state has now been pushed much closer to a reliable consumer package:

- `supercolony-toolkit` was renamed and normalized as `omniweb-toolkit`
- `SKILL.md`, `GUIDE.md`, `README.md`, `TOOLKIT.md`, `references/`, `docs/`, `agents/`, `assets/`, and `playbooks/` were refactored into a cleaner progressive-disclosure package
- release checks, self-audit checks, live drift checks, and package checks were added and tightened
- runtime dependency expectations for shipped TypeScript scripts were made explicit
- subpath exports and tarball expectations were validated
- live response-shape verification was added
- trajectory trace scoring was added and then hardened

## What Is Green Right Now

The package has a much stronger "green path" than before:

- `npm run check:package` passes in the current stack
- `npm run check:evals` passes in the current stack
- `npm run check:release` had already been brought into a working state earlier in the stack
- `npm run check:live:detailed` had already been added and validated earlier in the stack
- `evals/run-trajectories.ts` now rejects malformed trace JSON and malformed trace structure as input errors
- trajectory passes now require complete required step/action/assertion coverage, not just decent metric booleans
- packaged examples now exist for all maintained scenarios:
  - `publish-flow`
  - `tip-flow`
  - `edge-empty-data`
  - `edge-budget-exhaustion`
  - `redteam-injection`
  - `stateful-guardrails`
- `check-trajectory-examples.ts` now enforces:
  - every maintained scenario has packaged example coverage
  - no unexpected scenario ids are present
  - no scenario is duplicated across packaged examples
  - each packaged trace contains exactly one scenario id
  - each packaged trace filename matches `<scenario-id>.trace.json`

## High-Level Trajectory From Here

The project should now move from "create missing fixtures and guardrails" into "close the remaining release-integrity and consumer-confidence gaps".

The most sensible direction is:

1. strengthen release verification around the packaged tarball and shipped eval assets
2. make coverage and release status easier for CI and maintainers to consume
3. improve the consumer-facing package metadata and publish readiness
4. deepen end-to-end validation around auth, live reads, and eventually controlled write-path checks

In other words: keep moving from internal cleanup toward externally credible package release readiness.

## Untracked Files: What They Are And What To Do

These files are currently untracked in the repo root or nearby paths:

- `agents/reference/scores.jsonl`
- `codex-full-review.md`
- `codex-pre-publish-review.md`
- `codex-sdk-investigate.md`
- `scorecard.png`
- `scripts/auth-refresh.ts`

Recommended treatment:

- `codex-full-review.md`
  - This is a Codex-generated deep-review prompt/instruction file.
  - Keep it only if you want Claude or another agent to run that review.
  - Otherwise delete it; it is not a product file and should not be committed casually.

- `codex-pre-publish-review.md`
  - This is a Codex-generated pre-publish review prompt for `packages/omniweb-toolkit`.
  - Same recommendation: keep if you want Claude to execute that review, otherwise delete.

- `codex-sdk-investigate.md`
  - This is a Codex-generated investigation brief for auth / SDK crash / publish-path work.
  - Keep if you want Claude to pursue end-to-end auth and publish verification.
  - Otherwise delete.

- `scripts/auth-refresh.ts`
  - This is an experimental utility for refreshing SuperColony auth outside the normal SDK path.
  - It should not be committed as-is unless you deliberately decide it belongs in the repo as supported maintainer tooling.
  - If it is useful, move it into a clearly non-product research or maintainer-tools area and document it.
  - If not needed, delete it.

- `agents/reference/scores.jsonl`
  - This looks like older local score telemetry or run history from April 11-12, not this packaging session.
  - Do not commit it unless the repo deliberately wants benchmark/run-history artifacts versioned.
  - Better options are: archive it outside the repo, add it to `.gitignore`, or move it to a non-committed local data path.

- `scorecard.png`
  - This is also an older artifact and does not look like part of the package release path.
  - Same recommendation as `scores.jsonl`: archive outside the repo or ignore it.

Practical recommendation:

- keep the three `codex-*.md` files temporarily if you want Claude to execute them
- decide explicitly whether `scripts/auth-refresh.ts` is worth productizing
- delete or ignore `agents/reference/scores.jsonl` and `scorecard.png` unless you have a specific reporting workflow for them

## Concrete Claude Task Backlog

These are good follow-on tasks for Claude while Codex is rate limited. Each should be handled as a separate small PR from `codex/enforce-packaged-example-filenames`.

### Highest-value next tasks

- Add a release check that asserts every packaged example trace is actually present in the `npm pack --dry-run` tarball.
- Add a release check that asserts the packaged example file list matches the maintained scenario ids from `evals/trajectories.yaml`.
- Add a machine-readable coverage artifact command for trajectory examples, so CI can consume coverage status without scraping logs.
- Add a `--json` or summary-mode contract to whichever check currently has the most maintainers-facing value, then document it for CI.

### Consumer/package hardening

- Audit `package.json` metadata for publish readiness: `repository`, `homepage`, `bugs`, keyword quality, license-file presence.
- Add a package-level check that all documented `npm run` commands in the README exist and are runnable.
- Verify `npm pack --dry-run` includes exactly the intended `evals/examples/*.trace.json` files and no repo-only artifacts.
- Add a check that shipped markdown does not reference unshipped local paths.

### Trajectory tooling hardening

- Make `run-trajectories.ts --template` emit a filename hint or metadata tying each generated template cleanly to a scenario id.
- Add stricter checking around step ordering beyond index-based matching if there are realistic out-of-order trace capture risks.
- Add clearer failure reasons in trajectory results when status mismatches versus action mismatches versus assertion mismatches occur.
- Add a negative-test helper or fixture strategy so malformed trace cases are validated more systematically.

### CI / maintainer ergonomics

- Wire the package checks into CI if they are not already wired.
- Add a small maintainer doc explaining the intended validation ladder:
  - `check:evals`
  - `check:package`
  - `check:release`
  - `check:live`
  - `check:live:detailed`
- Add a short doc explaining how to add a new trajectory scenario without breaking packaged coverage.

### Auth / live integration work

- Use `codex-sdk-investigate.md` as the brief for a focused auth/publish-path investigation.
- Verify which auth-gated endpoints now work with a fresh saved token and update the audit tooling accordingly.
- Determine whether `scripts/auth-refresh.ts` is worth keeping, replacing, or deleting.
- Verify that the consumer-facing `connect()` path remains cleanly separated from the crashing root SDK import path.

### Deep review tasks

- Run the full repository review described in `codex-full-review.md` and convert findings into scoped PRs.
- Run the package pre-publish review described in `codex-pre-publish-review.md` and convert any blocking findings into scoped PRs.
- Reconcile any review findings against accepted ADRs and the current six-domain architecture.

### Nice-to-have but lower priority

- Add a short generated index in `evals/examples/` or `README.md` summarizing the six packaged scenarios and why each exists.
- Add a coverage badge or status line to the README once the check output is stable enough to trust.
- Add a maintainer-only script that prints the current stacked trajectory-example/guardrail PR status for handoffs.

## What Claude Should Say Back Before Starting

Claude should confirm:

- it will branch from `codex/enforce-packaged-example-filenames`
- it will open one small PR per task
- it will not commit the untracked review prompt files unless explicitly asked
- it understands that the package is on a green path already and should now be hardened incrementally, not re-refactored wholesale

## Minimal Message To Give Claude

Use this if you want to paste a concise update:

```text
The project moved beyond the older SuperColony doc refactor. Current reality is:

- the package is now `omniweb-toolkit`
- the docs/package/references/assets/playbooks structure was already refactored
- live/package/release checks were already added and brought green
- trajectory trace scoring was added
- packaged example traces now exist for all 6 maintained scenarios
- the checker now enforces full packaged coverage against `evals/trajectories.yaml`
- the checker also enforces one-scenario-per-file naming via `<scenario-id>.trace.json`

Current PR stack tip:
`codex/enforce-packaged-example-filenames`

Branch from there:
`git fetch origin`
`git switch codex/enforce-packaged-example-filenames`
`git pull --ff-only`
`git switch -c codex/<next-small-task>`

One task = one branch = one PR.
Do not commit on `codex/supercolony-skill-progressive-disclosure`.

Untracked files:
- `codex-full-review.md`, `codex-pre-publish-review.md`, `codex-sdk-investigate.md` are prompt docs; keep only if you will execute them
- `scripts/auth-refresh.ts` is experimental and should not be committed casually
- `agents/reference/scores.jsonl` and `scorecard.png` look like local artifacts and should probably stay uncommitted

Best next tasks:
- enforce packaged example traces in the release tarball
- add CI-consumable trajectory coverage summary output
- run the pre-publish review prompt and turn findings into scoped PRs
- investigate auth/publish-path readiness using the sdk/auth brief
```

