# AGENTS.md

Operational guide for coding agents working in this repository.

This file is the workflow companion to `CLAUDE.md`.

- `CLAUDE.md` is the baseline source for architecture, principles, and repo-wide rules.
- `AGENTS.md` is the baseline source for day-to-day execution, branch, PR, and beads workflow.

## Read Order

Before starting work:

1. read `CLAUDE.md`
2. read `AGENTS.md`
3. read the relevant package docs for the area you are changing
4. check `bd ready`

There is currently no repo `MEMORY.md`.

## Current Operating Model

This repo now uses:

- `main` as the protected integration branch
- `bd` / beads as the live task tracker
- separate worktrees for parallel agent execution
- one small task per branch and PR
- PRs as the normal merge vehicle, even when no manual human review is expected

Do not treat old stacked Codex branches as the default source of truth unless the user explicitly tells you to resume from one.

## Beads Workflow

Use `bd` as the task authority.

Important commands:

- `bd ready --json` to see unblocked work
- `bd show <id>` to inspect one task
- `bd update <id> --claim` to claim a task
- `bd note <id> "..."` to leave execution notes
- `bd close <id> --reason "..."` when work is complete

Rules:

- always inspect `bd ready` before choosing work
- claim a task before starting implementation
- if you discover new work, create or note a follow-up bead instead of hiding it in chat
- if a task is blocked, record the blocker in beads
- do not silently work on a task someone else has already claimed

## Branch / PR Discipline

For every task:

1. sync from `main`
2. create one task branch
3. make one coherent change
4. run the smallest meaningful validation
5. push and open one PR against `main`

Pattern:

```bash
git fetch origin
git switch main
git pull --ff-only
git switch -c codex/<short-task-name>
```

Rules:

- one bead = one branch = one PR
- do not mix unrelated fixes
- if a task grows, split follow-up work into new beads and new PRs
- do not force-reset or discard user work
- do not push directly to `main` unless the user explicitly instructs an emergency exception

## PR-First Merge Model

PRs here are not primarily for manual line-by-line review. They are the merge unit, audit trail, and badge-producing artifact.

Default expectation:

1. agent makes a scoped change
2. agent runs relevant checks
3. agent opens a PR
4. CI passes
5. PR auto-merges or is merged without manual code review

Preferred repo settings:

- protect `main`
- disable direct pushes to `main`
- require the CI checks you actually trust
- do not require human approval when the goal is zero manual review
- prefer squash merge for small scoped task branches
- enable auto-merge

## Worktree Cooperation

When more than one agent is active:

- use separate git worktrees
- keep code changes isolated per agent
- keep task state shared through beads
- prefer disjoint file ownership when running in parallel

If two tasks would touch the same files heavily, serialize them instead of racing.

## Human Orchestrator Role

The human should act as orchestrator, not as mandatory reviewer for every diff.

Typical split:

- human picks priorities, redirects strategy, and resolves ambiguous product calls
- agents claim beads, implement changes, run checks, and open PRs
- merge happens through green CI and repo policy, not through ad hoc direct pushes
- human intervention is mainly for failed CI, merge conflicts, or deliberate exceptions

## Validation Ladder

Use the smallest relevant check first, then the broader package check when justified.

For `packages/omniweb-toolkit`, important commands include:

- `npm run check:evals`
- `npm run check:package`
- `npm run check:release`
- `npm run check:live`
- `npm run check:live:detailed`
- `npm run run:trajectories -- --trace ./evals/examples/<scenario>.trace.json --scenario <scenario>`

For trajectory work:

- `evals/trajectories.yaml` is the maintained scenario source of truth
- packaged examples must stay aligned with it
- do not weaken coverage or naming enforcement just to pass checks

## Documentation Discipline

- keep the package as the primary authority for its public surface
- do not duplicate official platform facts when the package should layer on them
- keep repo-only research separate from shipped package docs
- if you change publish-facing behavior, update docs and checks in the same PR

## Untracked / Local Artifacts

Treat these cautiously if present:

- `codex-full-review.md`
- `codex-pre-publish-review.md`
- `codex-sdk-investigate.md`
- `scripts/auth-refresh.ts`
- `agents/reference/scores.jsonl`
- `scorecard.png`

Default behavior:

- do not commit them casually
- only use the `codex-*.md` files if explicitly executing those review/investigation prompts
- treat `scripts/auth-refresh.ts` as experimental unless deliberately productized
- treat score/image artifacts as local data unless instructed otherwise

## Security And Safety

- this code can affect real DEM tokens on mainnet
- preserve API-first-for-reads / chain-first-for-writes
- do not introduce `as any` on sensitive paths
- prefer explicit failures over silent degraded behavior on auth and write paths

## Default Next Work

If the user does not specify a task, pick from `bd ready`.

Prefer, in order:

1. publish / release integrity issues
2. package validation or CI issues
3. scoped pre-publish findings
4. auth / publish-path readiness tasks
