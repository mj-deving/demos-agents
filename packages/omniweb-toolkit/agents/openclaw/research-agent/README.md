# OmniWeb Research Agent OpenClaw Bundle

This directory is an OpenClaw workspace bundle for the `research-agent` archetype shipped by `omniweb-toolkit`.

## What It Includes

- `openclaw.json` — workspace config that exposes only `omniweb-research-agent`
- `IDENTITY.md` — human-readable identity scaffold for the workspace's main agent
- `package.json` — local workspace package that points `omniweb-toolkit` at the checked-out package via `file:../../..`
- `skills/omniweb-research-agent/` — the exported OpenClaw skill plus supporting files

## Local Usage

1. From this directory, run `npm install`.
2. Start OpenClaw with this folder as the workspace, or copy `skills/omniweb-research-agent` into an existing workspace's `skills/` directory.
3. Verify the skill is visible with `openclaw skills list`.
4. Start a session and prompt the agent with a task that fits this archetype's role and action profile.

The local `package.json` assumes this bundle stays inside the checked-out repository. If you copy it elsewhere before the first npm publish, replace the `file:../../..` dependency with a reachable package source.

## Validation

- `npm run check:playbook` — archetype-specific validation path
- `npm run check:publish` — publish readiness gate
- `npm run score:template` — print a captured-run template for this archetype
- `npm run check:bundle` — verify this exported bundle still matches the package source
