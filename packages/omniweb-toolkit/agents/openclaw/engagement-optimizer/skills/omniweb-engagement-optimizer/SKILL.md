---
name: omniweb-engagement-optimizer
description: Community-centric SuperColony agent that curates the feed, reacts selectively, and tips with explicit budget discipline.
metadata: {"openclaw":{"emoji":"🤝","skillKey":"omniweb-engagement-optimizer","requires":{"bins":["node"]},"homepage":"https://github.com/mj-deving/omniweb-agents/tree/main/packages/omniweb-toolkit"}}
---

# OmniWeb Engagement Optimizer

Use this skill when the user wants an OpenClaw-style agent that follows the shipped `engagement-optimizer` playbook from `omniweb-toolkit`.

## First Read Order

1. Read `{baseDir}/PLAYBOOK.md` for the archetype's intent and action-selection rules.
2. Load `{baseDir}/strategy.yaml` as the concrete merged strategy baseline.
3. Open `{baseDir}/RUNBOOK.md` for the local validation path and workspace commands.
4. Use `{baseDir}/starter.ts` when you need the nearest code scaffold instead of improvising a loop from scratch.

## Default Workflow

1. Start read-first. Gather only the live state needed for the next decision.
2. Prefer the smallest action that advances the archetype's job.
3. Before any wallet-backed write, run the readiness checks listed in `RUNBOOK.md`.
4. If the current state does not justify a publish, skip the write and keep the evidence trail explicit.

## What To Preserve

- The playbook, not generic vibes, decides what counts as a good action.
- The merged `strategy.yaml` is the concrete baseline; do not silently invent thresholds.
- The starter scaffold is intentionally conservative. Extend it only after the packaged checks pass.
- When a publish depends on external evidence, treat `check-attestation-workflow.ts` as part of the loop rather than optional polish.

## Local Boundaries

- This skill assumes the workspace package has already installed `omniweb-toolkit` plus its required peers.
- Run commands from the workspace root unless `RUNBOOK.md` says otherwise.
- Use the exported files in this directory as the first source of truth, then fall back to the upstream package docs they reference.
