# AGENTS.md

Operational guide for coding agents working in this repository.

This file is the workflow companion to `CLAUDE.md`.

- `CLAUDE.md` is the baseline source for architecture, principles, and repo-wide rules.
- `AGENTS.md` is the baseline source for execution workflow, branch discipline, PR discipline, and beads usage.

## Nearest-File Rule

Use the closest `AGENTS.md` to the files you are changing as the local instruction layer.

- Root `AGENTS.md` defines repo-wide workflow and coordination rules.
- Nested `AGENTS.md` files may add subproject-specific rules and commands.
- User instructions still override repo files.

## Mandatory Read Order

Before starting work:

1. read `CLAUDE.md`
2. read `AGENTS.md`
3. if a nearer nested `AGENTS.md` exists for the area you are changing, read it next
4. read the relevant package docs for the area being changed
5. inspect `bd ready`
6. inspect open GitHub PRs if recent work may overlap

There is currently no repo `MEMORY.md`. Local agent memory files outside the repo are not authoritative current state.

## Coordination Model

This repository should not depend on manual Codex-to-Claude handoffs.

Shared state should come from:

- `main` for merged truth
- open GitHub PRs for in-flight work
- beads for live task selection and blockers
- `CLAUDE.md` and `AGENTS.md` for operating rules

If an agent needs context, it should reconstruct it from those sources rather than waiting for a human relay.

## Current Operating Model

This repo now uses:

- `main` as the integration branch
- `bd` / beads as the live task tracker
- separate worktrees for parallel agent execution
- durable Beads memories for repo facts that should survive chat/session loss
- one repo merge slot for serialized conflict-heavy landing work
- one small task per branch and PR
- PRs as the normal merge vehicle

Do not treat old stacked Codex branches as the default source of truth unless the user explicitly tells you to resume one.

## Beads Workflow

Use `bd` as the task authority.

Important commands:

- `bd ready --json` to see unblocked work
- `bd show <id>` to inspect one task
- `bd update <id> --claim` to claim a task
- `bd note <id> "..."` to leave execution notes
- `bd dep <blocker> --blocks <blocked>` to encode real execution order
- `bd close <id> --reason "..."` when work is complete
- `bd remember "..." --key <name>` to store durable repo facts
- `bd memories` / `bd recall <key>` to retrieve stored repo facts
- `scripts/create-worktree.sh <name> [branch]` to create a parallel worktree outside the repo root with shared Beads state
- `bd merge-slot acquire` / `bd merge-slot release` for serialized hot-file landing work
- `bd gate list` / `bd gate check` to inspect async waits
- `bd history <id>` / `bd diff <from-ref> <to-ref>` when task state changes unexpectedly
- `./scripts/beads-maintenance.sh` for periodic stale/orphan/duplicate hygiene

Rules:

- always inspect `bd ready` before choosing work
- claim a task before starting implementation
- if new work is discovered, create or note a follow-up bead
- if a multi-bead effort has real sequencing, encode it with `bd dep` instead of leaving it implicit in notes
- if a task is blocked, record the blocker in beads
- do not silently work on a task someone else has already claimed
- use `bd remember` for stable repo facts that future agents will need; do not leave them only in chat
- use `bd gate` when a task is effectively waiting on CI, PR merge, another bead, or a human decision
- use `bd history <id>` or `bd diff <from-ref> <to-ref>` before assuming a bead changed “mysteriously”
- beads content should be treated as public workflow metadata
- never put secrets, credentials, tokens, or private operational notes into beads

## Advanced Beads Defaults

- Prefer `scripts/create-worktree.sh <name> [branch]` for parallel agent work so worktrees live outside the repo root. Existing `.claude/worktrees/*` entries in this repo currently do not share the live Beads database by default.
- Use the repo merge slot before rebasing, resolving, or landing work that touches shared hot files such as `packages/omniweb-toolkit/src/hive.ts`, `packages/omniweb-toolkit/src/index.ts`, `src/toolkit/supercolony/api-client.ts`, or the live validation scripts.
- Use Beads memories for durable repo constraints and deployment facts that need to survive session compaction.
- Use gates for async waits instead of informal notes when the blocker is “wait for CI”, “wait for PR merge”, “wait for another bead”, or “wait for human answer”.
- For epics or multi-step hardening tracks, add dependency edges early so `bd ready` reflects actual order rather than just named backlog.
- Use `bd swarm` when an epic is clearly parallelizable and child beads can be worked independently.
- Run `./scripts/beads-maintenance.sh` at natural boundaries: before `/clear`, after a merged work cluster, or when the queue starts to feel noisy.

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
- do not push directly to `main` unless the user explicitly instructs an emergency exception
- do not force-reset or discard user work

### Shared Additions First

When multiple agents are likely to add the same new files or touch the same shared scaffolding, do not let each agent branch independently from the same old base and recreate the same additions.

Use this pattern instead:

1. land the shared additions first in one small PR
2. merge that PR to `main`
3. branch the parallel follow-up work from the new merged base

Examples of "shared additions":

- new package reference files
- `SKILL.md` or `TOOLKIT.md` link additions
- catalog entries or provider specs needed by multiple follow-up tasks
- new scripts or test helpers that several agents will extend

This is upstream of the merge slot:

- use `shared additions first` to prevent PR contamination at branch-creation time
- use the merge slot later when remaining hot files still need serialized landing

## PR-First Merge Model

PRs here are not primarily requests for manual line-by-line human review. They are the merge unit, audit trail, and task boundary.

Default expectation:

1. agent makes a scoped change
2. agent runs relevant checks
3. agent opens a PR
4. agent inspects Codex review output and addresses findings before merge
5. CI passes
6. the PR is merged or auto-merged to `main`

Before merging a PR:

- inspect PR comments and review threads, not just CI
- explicitly check for comments from `chatgpt-codex-connector[bot]`
- if Codex review is still pending, wait for it or trigger it with `@codex review`
- do not merge while unresolved Codex findings remain unless the user explicitly accepts them
- preferred CLI check: `gh pr view <num> --comments`

Preferred repo settings:

- protect `main`
- disable direct pushes to `main`
- require the CI checks you actually trust
- if Codex auto-review is enabled, make sure the merge flow waits for it before enabling auto-merge
- do not require human approval if the goal is zero manual review
- prefer squash merge for small scoped branches
- enable auto-merge

Merge responsibility:

- the agent that opened a PR may merge it once checks are green, Codex review has been inspected, and conflicts are clear
- any agent may merge a green PR when acting as the current maintainer, but it must still inspect Codex review output first
- the human should only need to intervene for ambiguous product decisions, broken CI, or merge conflicts

## Worktree Cooperation

When more than one agent is active:

- use separate git worktrees
- prefer `scripts/create-worktree.sh <name> [branch]` so the worktree shares the live Beads state without cluttering the repo root
- keep code changes isolated per agent
- keep task state shared through beads and GitHub
- prefer disjoint file ownership when running in parallel

If two tasks would touch the same files heavily, serialize them instead of racing.

## Model Routing

Use the stronger reasoning model by default for product, architecture, prompt, and strategy work.

Use a fast-lane model only for bounded, low-ambiguity work with a clear verification path.

Fast-lane equivalents:

- Codex agents: `gpt-5.3-codex-spark`
- Claude agents: Claude Sonnet

Good fast-lane tasks:

- first-pass PR scans
- CI/log triage
- changed-file skims
- search-heavy codebase exploration
- narrow deterministic fixes
- summarizing review threads or unresolved comments

Keep stronger models for:

- architecture or repo-wide design
- prompt or agent-strategy changes
- ambiguous bugs or regressions
- research-quality judgment
- final merge decisions when findings are subtle

Recommended pattern:

1. use the fast-lane model for initial triage or a bounded mechanical patch
2. escalate to the stronger model for ambiguous cases, integration, and final judgment

Do not let a fast-lane model make the final call on product behavior, publish quality, or architectural tradeoffs without review by the stronger model.

## Validation Ladder

Use the smallest relevant check first, then broader checks when justified.

For `packages/omniweb-toolkit`, important commands currently include:

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
- if publish-facing behavior changes, update docs and checks in the same PR when possible
- keep cross-agent operational rules in `AGENTS.md`, not in agent-specific overlay files

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
- `scripts/apply-main-protection.sh` is the maintained helper for reapplying the repo's `main` branch protection via `gh api`

## Beads Storage Note

Current beads setup:

- local embedded beads database remains the live working database
- remote durability is provided by DoltHub backup
- there are currently no federation peers configured
- do not run `bd init --server` or reinitialize beads unless the user explicitly requests a backend migration

`--server` only matters if the repo intentionally moves from embedded local beads to a shared external Dolt SQL server as the primary live backend.
