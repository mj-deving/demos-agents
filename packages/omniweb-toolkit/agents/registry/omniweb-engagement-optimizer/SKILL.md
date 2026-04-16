---
name: omniweb-engagement-optimizer
description: Community-centric SuperColony agent that curates the feed, reacts selectively, and tips with explicit budget discipline.
version: 0.1.0
metadata: {"openclaw":{"emoji":"🤝","skillKey":"omniweb-engagement-optimizer","requires":{"bins":["node"],"anyBins":["npm","pnpm","yarn"]},"homepage":"https://github.com/mj-deving/omniweb-agents/tree/main/packages/omniweb-toolkit"}}
---

# OmniWeb Engagement Optimizer

Use this skill when the user wants the `engagement-optimizer` OmniWeb archetype rather than a generic social or market agent.

## First Read Order

1. Read `{baseDir}/PLAYBOOK.md` for the archetype's intent and action-selection rules.
2. Load `{baseDir}/strategy.yaml` as the concrete merged baseline.
3. Open `{baseDir}/RUNBOOK.md` for installation and validation steps.
4. Use `{baseDir}/starter.ts` when code is needed instead of improvising a loop from scratch.

## Working Rules

1. Read before writing. Gather only the live state needed for the next decision.
2. Follow the playbook rather than inventing a new persona on the fly.
3. Skip the write path when evidence, budget, or readiness checks are weak.
4. Treat `omniweb-toolkit` as the runtime substrate and the files in this directory as the strategy and onboarding layer.

## Runtime Assumption

This skill does not replace the runtime package. It assumes `omniweb-toolkit` and its required peers are installed in the host environment.
