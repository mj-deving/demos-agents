# Claude Codex Coop

Lightweight coordination layer for Claude Code and Codex.

## Purpose

Keep both agents synchronized across sessions with minimal overhead:

- what changed
- why it changed
- where it changed
- what remains

## Protocol

1. Before starting work, read:
   - `claude-codex-coop/STATUS.md`
   - last entry in `claude-codex-coop/logs/SESSION-HANDOFFS.md`
2. Claim your lane before editing files (prevents silent overlap conflicts).
3. During work, update only if scope changes materially.
4. At end of session, append one structured handoff entry (prefer `--auto-files`).
5. Release claim when done.

## Parallel-First Process

Goal: both agents can work at the same time on the same objective without conflicting edits.

1. Shared objective in `STATUS.md`:
   - one owner drives integration
   - both agents can still have separate lanes in claims
2. Lane claims in `CLAIMS.json`:
   - each agent claims concrete file scope + task
   - overlapping scopes fail unless both sides mark `--shared true`
3. Push/CI enforcement:
   - `check-coop` verifies changed files are covered by:
     - latest handoff Changed files list
     - active owner claim scope
   - detects conflicts with other active claims

## Commands

Show only current coop context (status + latest handoff):

```bash
npm run coop:latest
```

JSON output:

```bash
npm run coop:latest -- --json
```

Record read acknowledgment (optional, recommended):

```bash
npm run coop:ack -- --agent codex
```

Combined takeover helper (read latest + ack in one step):

```bash
npm run coop:takeover -- --agent codex
```

Takeover now also records a drift snapshot for sensitive files by default.
Optional flags:
- `--skip-drift true` to skip snapshotting
- `--drift-file /tmp/custom.state` to write the snapshot somewhere else

Append handoff entry:

```bash
npm run coop:handoff -- --agent codex --summary "implemented plugin scaffold" --files "plugins/demos-supercolony,tools/validate-plugin.mjs" --next "review and commit"
```

Append handoff with auto-detected file list (recommended):

```bash
npm run coop:handoff -- --agent codex --summary "implemented X" --auto-files true --worktree true --next "review and commit"
```

Update current status snapshot:

```bash
npm run coop:status -- --owner codex --focus "plugin + scoring" --next "tune score rubric"
```

Claim a lane:

```bash
npm run coop:claim -- --agent codex --lane attestation --task "harden 401/403/429 guards" --files "tools/publish.ts,tools/lib/publish-pipeline.ts"
```

Release claim:

```bash
npm run coop:release -- --agent codex --lane attestation
```

## Enforcement Modes

### CI mode (PR + direct main push)

- Workflow runs `node tools/check-coop.mjs --mode ci`.
- If substantive files change, CI requires:
  - `claude-codex-coop/STATUS.md` updated
  - `claude-codex-coop/logs/SESSION-HANDOFFS.md` updated with a new `## ...` entry
  - latest handoff `Changed files` list covers all changed substantive files
  - active claim for `STATUS.md` owner covers all changed substantive files
  - no non-shared overlap with another active claim

### Solo mode (local pre-push)

Install hooks once per clone:

```bash
npm run hooks:install
```

Manual check:

```bash
npm run check:coop
```

Manual check with soft read-ack warning:

```bash
npm run check:coop:soft-ack
```

Read-ack soft guard:
- non-blocking warning only; never fails push/CI
- warns when `STATUS.md` owner has no ack, or latest ack is older than 24h
- tune with `--soft-ack-hours N` or env `COOP_SOFT_ACK_HOURS=N`

Strict worktree check (includes uncommitted/untracked files):

```bash
npm run check:coop:worktree
```

Temporary bypass (not recommended):

```bash
SKIP_COOP_CHECK=1 git push
```

## Drift Guard

Use drift guard around long autonomous runs to detect unexpected rewrites of
high-risk files during the command window.

Watched files:
- `tools/verify.ts`
- `tools/publish.ts`
- `tools/lib/publish-pipeline.ts`
- `tools/session-runner.ts`

Manual usage:

```bash
bash tools/check-drift.sh snapshot
bash tools/check-drift.sh check
bash tools/check-drift.sh run -- npx tsx tools/session-runner.ts --agent sentinel --pretty
```

Guarded run wrappers:

```bash
npm run session:guarded -- --agent sentinel --pretty
npm run run-loop:guarded -- --schedule sentinel:1 --dry-run
npm run publish:guarded -- --agent sentinel --topic "ETH" --dry-run
```

Notes:
- `run -- ...` uses an ephemeral snapshot by default and cleans it up automatically
- `snapshot`/`check` are for manual before/after comparisons across a longer window
- drift guard complements Git; it answers "did this command mutate sensitive files?"
