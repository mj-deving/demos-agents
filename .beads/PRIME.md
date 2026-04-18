# Beads Workflow Context

> Run `bd prime` after compaction or on a fresh session to reload this repo's workflow defaults.

## Start Here

- Read `CLAUDE.md`, then `AGENTS.md`, then the relevant package docs.
- Run `bd ready --json` before choosing work.
- Review open GitHub PRs if recent work may overlap.

## Core Repo Rules

- One bead = one branch = one PR.
- If multiple agents need the same shared additions, land those first in one small PR and branch the parallel follow-up work from the merged base.
- Claim the bead before implementation: `bd update <id> --claim`.
- Prefer `scripts/create-worktree.sh <name> [branch]` for parallel agent work so shared worktrees land in `../demos-agents-worktrees/` instead of cluttering the repo root. Existing `.claude/worktrees/*` in this repo do not share the live Beads database by default.
- Use `bd remember` for durable repo facts. Do not rely on chat memory for constraints future agents will need.
- Use `bd gate` for real async waits such as CI, PR merge, another bead, or a human decision.
- Use `bd history <id>` and `bd diff <from-ref> <to-ref>` before assuming task state changed unexpectedly.

## Merge Slot

- Repo merge slot: `omniweb-agents-merge-slot`
- Acquire it before rebasing, reconciling, or landing conflict-heavy work in shared hot files:
  - `packages/omniweb-toolkit/src/hive.ts`
  - `packages/omniweb-toolkit/src/index.ts`
  - `src/toolkit/supercolony/api-client.ts`
  - live validation scripts
- Release it promptly after the risky step is done.

## Durable Memories

- Search: `bd memories`
- Recall one: `bd recall <key>`
- Current high-value memories include temporary `scdev` naming, ballot endpoint removal, merge-slot hot files, and the shared-Beads worktree rule.

## Session Close

- Leave notes on the bead if needed: `bd note <id> "..."`
- Close completed beads before final handoff: `bd close <id> --reason "..."`
- Keep repo-only research and local artifacts out of commits unless the task explicitly requires them.
