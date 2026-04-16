---
status: accepted
date: 2026-04-16
summary: "Keep one canonical repo and runtime package, but distribute OmniWeb externally as generated per-archetype skill artifacts plus a public docs site."
read_when: ["skill distribution", "package-backed skill", "repo structure", "clawhub", "openclaw", "external docs", "publishing model"]
---

# ADR-0022: Package-Backed Skill Distribution

## Context

`omniweb-toolkit` now has three layers that matter externally:

- the runtime package itself
- maintained archetype playbooks and starters
- generated OpenClaw workspace bundles under `packages/omniweb-toolkit/agents/openclaw/`

The repo needed an explicit decision on how to present and distribute those layers outside the monorepo:

- one repo or multiple source repos
- one giant public skill or several smaller skills
- workspace bundles only or registry-facing skill artifacts too
- docs site or GitHub wiki as the public docs surface

Official channel docs and public examples point in the same direction:

- OpenClaw and ClawHub support a skill as a folder with `SKILL.md` plus supporting text files and declared runtime metadata.
- Public skill repos that work well are usually small, capability-focused units.
- GitHub recommends Pages rather than wikis when search indexing or a larger public docs surface matters.

See `docs/research/package-backed-skill-distribution.md` for the supporting research.

## Decision

Adopt the following external distribution model:

1. **Keep this repository as the canonical source of truth.**
   The runtime package, playbooks, starters, generated exports, checks, and public docs source remain in this repo.

2. **Keep `omniweb-toolkit` as the executable runtime package.**
   Skills wrap and instruct around the package; they do not replace or duplicate it.

3. **Distribute public skills per archetype, not as one omnibus skill.**
   The external skill units are the maintained archetypes:
   - `omniweb-research-agent`
   - `omniweb-market-analyst`
   - `omniweb-engagement-optimizer`

4. **Treat local workspace bundles and registry-facing skills as separate products.**
   - `agents/openclaw/` is the local-operator and proving surface.
   - a future registry-oriented export target will emit smaller per-archetype skill artifacts for ClawHub and similar channels.

5. **Generate outward-facing artifacts from this repo.**
   If separate per-skill repos or registry bundles are created later, they are generated release outputs, not hand-maintained sources.

6. **Use a public docs site as the primary external docs surface.**
   Canonical docs stay versioned in-repo and publish outward to a docs site. A GitHub wiki is not the primary public surface.

## Alternatives Considered

1. **Split the runtime package and skills into separate source repositories**  
   Rejected because it creates version skew between package behavior, playbook guidance, and exported skill artifacts too early.

2. **Publish one giant `omniweb-toolkit` skill that covers every archetype**  
   Rejected because registry and community channels are skill-centric, discoverability suffers, and the prompt surface becomes too broad.

3. **Use local workspace bundles as the only external form forever**  
   Rejected because local bundles are good for proving and operator installs, but they are too heavy for registry and community discovery channels.

4. **Use a GitHub wiki as the main public docs surface**  
   Rejected because indexing and public-docs ergonomics are weaker than a Pages or static docs site workflow.

5. **Create multiple hand-maintained public skill repos immediately**  
   Rejected because it duplicates source-of-truth responsibilities and invites drift.

## Consequences

- External users get smaller, clearer skill units that match actual archetypes.
- The package remains the single runtime substrate, which keeps behavior and validation centralized.
- The repo must support at least two export surfaces:
  - local OpenClaw workspace bundles
  - future registry/community skill artifacts
- The docs site becomes the canonical outward-facing explanation layer for all external artifacts.
- The next implementation step is to design the executable publish pipeline that turns this decision into generated artifacts and release rules.
