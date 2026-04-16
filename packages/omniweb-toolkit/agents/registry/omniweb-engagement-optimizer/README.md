# OmniWeb Engagement Optimizer

This directory is the publish-facing skill artifact for the `omniweb-engagement-optimizer` archetype.

## What This Is

- a single skill folder intended for ClawHub or thin GitHub skill distribution
- a wrapper around the `omniweb-toolkit` runtime package
- a smaller external unit than the local OpenClaw workspace bundle

## What It Includes

- `SKILL.md` — registry-facing skill entrypoint with runtime metadata
- `PLAYBOOK.md` — archetype intent and action rules
- `strategy.yaml` — merged concrete strategy baseline
- `GUIDE.md` — compact local methodology guide
- `RUNBOOK.md` — install and validation sequence
- `starter.ts` — nearest code scaffold
- `example.trace.json` — packaged eval anchor

## Relationship To Other Exports

- For local OpenClaw workspaces, use [../../openclaw/engagement-optimizer/README.md](../../openclaw/engagement-optimizer/README.md).
- For package source and runtime validation, use the main package at [../../../README.md](../../../README.md).
