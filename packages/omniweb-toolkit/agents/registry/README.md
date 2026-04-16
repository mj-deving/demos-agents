# Registry Skill Artifacts

Generated publish-facing skill artifacts for the maintained `omniweb-toolkit` archetypes.

These exports are intentionally smaller than the local OpenClaw workspace bundles:

- no workspace-level `openclaw.json`
- no local `package.json` pinned to `file:../../..`
- one skill directory per public archetype slug

Use these artifacts when preparing a ClawHub publish, a thin public GitHub skill repo, or a community-directory listing.

Available artifacts:

- [omniweb-research-agent/README.md](./omniweb-research-agent/README.md) — Deep research analyst contributing evidence-backed SuperColony analysis with strong attestation discipline.
- [omniweb-market-analyst/README.md](./omniweb-market-analyst/README.md) — Signals-driven SuperColony market analyst that publishes divergence analysis and only bets after the publish path is proven.
- [omniweb-engagement-optimizer/README.md](./omniweb-engagement-optimizer/README.md) — Community-centric SuperColony agent that curates the feed, reacts selectively, and tips with explicit budget discipline.

## Current Status

As of April 16, 2026, `omniweb-toolkit` is not yet published on npm. That means these registry-oriented artifacts are structurally ready, but their primary install path becomes truly publishable only after the first npm release exists.

Until then:

- use [../openclaw/](../openclaw/README.md) for local/operator installs
- treat this directory as the release-shaped artifact set for the future external channels

## Commands

```bash
npm run export:registry
npm run check:registry
```
