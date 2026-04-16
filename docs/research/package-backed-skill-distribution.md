---
summary: "Research-backed recommendation for distributing omniweb-toolkit as package-backed skills across OpenClaw, ClawHub, GitHub docs, and community directories without splitting source of truth."
read_when: ["skill distribution", "package-backed skill", "clawhub publish", "openclaw bundles", "repo structure", "external docs", "community sites"]
---

# Package-Backed Skill Distribution

Research on the right external distribution model for `omniweb-toolkit` and its archetypes.

This note answers four practical questions:

1. Should the source of truth stay in one repository?
2. Should the public unit be one big skill or multiple archetype-specific skills?
3. How should a skill that depends on a package be distributed?
4. Should public docs live in a wiki or a docs site?

## Current repo reality

Today the repository already has the right raw ingredients:

- the runtime package lives in `packages/omniweb-toolkit`
- the public skill router lives in `packages/omniweb-toolkit/SKILL.md`
- three maintained archetypes exist as playbooks and starter assets
- generated OpenClaw workspace bundles already ship under `packages/omniweb-toolkit/agents/openclaw`
- the bundle export is deterministic and validated by `check:openclaw`

The missing piece is not format support. The missing piece is the outward-facing distribution story.

## Official constraints

### OpenClaw / ClawHub

OpenClaw and ClawHub both support a skill as a **folder** with:

- required `SKILL.md`
- optional supporting text files
- runtime metadata in frontmatter under `metadata.openclaw`
- declared dependency requirements such as env vars, binaries, config files, and install specs

ClawHub also validates that declared requirements match what the skill actually uses. That means published skills should have accurate metadata and should not hide runtime assumptions.

Important consequences for us:

- a package-backed skill is valid
- a skill can ship a `SKILL.md` plus `GUIDE.md`, `RUNBOOK.md`, `strategy.yaml`, and example traces
- if the skill expects `node`, `tsx`, or published npm packages, that should be declared in metadata rather than buried in prose
- a registry-facing skill should be a small, understandable unit rather than a monolithic bundle with many unrelated behaviors

### GitHub docs surface

GitHub's own guidance makes the docs decision straightforward:

- wikis are for additional long-form repository documentation
- search engines only index public wikis under stricter conditions
- GitHub explicitly recommends Pages when search indexing or a larger docs surface matters

So a public launch surface should use a docs site, with repo-authored source content, not a wiki-first model.

## Public repo patterns worth copying

### Pattern A: minimal standalone skill repo

Example: `zscole/model-hierarchy-skill`

Observed shape:

- a very small repository
- `SKILL.md` is the product
- little or no runtime code

What it is good at:

- one concept
- one install unit
- easy discoverability
- easy registry fit

What it does not solve:

- complex runtime dependencies
- stronger validation
- package-backed execution

Implication for us:

- good model for a single archetype slug
- bad model for the entire OmniWeb surface because our runtime lives in a real package

### Pattern B: standalone skill repo with support files and scripts

Example: `ythx-101/x-tweet-fetcher`

Observed shape:

- `SKILL.md` plus `README.md`
- real supporting scripts under `scripts/`
- clear dependency story
- OpenClaw-specific install notes without hiding the broader runtime reality

What it is good at:

- one clear capability
- real executable substrate
- skill as packaging + instructions around tools, not just prompt text

Implication for us:

- this is the closest public analogue to what we need
- an OmniWeb archetype can be published as a skill package with supporting files and declared runtime dependencies
- the skill artifact should explain what it wraps rather than pretending the markdown alone is the runtime

### Pattern C: directory or curation layer, not source of truth

Example: `VoltAgent/awesome-openclaw-skills`

Observed shape:

- discovery and categorization layer
- points users to ClawHub or GitHub
- explicitly warns that curation is not the same as security audit

Implication for us:

- community sites and awesome-lists are distribution amplifiers
- they are not where canonical docs or runtime truth should live
- we should optimize for clean registry/repo artifacts that directories can point at

## Recommended model for omniweb-toolkit

### 1. Keep one source-of-truth repository

Do **not** split the runtime package into a separate source repo just to satisfy skill distribution.

Keep these in this repository:

- runtime package source
- playbooks
- starter assets
- generated OpenClaw exports
- validation scripts
- public docs source

Reason:

- the package, playbooks, proofs, and docs need to evolve together
- splitting early creates version skew between package behavior and skill instructions
- our exported bundles are already generated artifacts, which is the correct seam for external publishing

### 2. Publish multiple archetype-facing skills, not one omnibus skill

External distribution should be **per archetype**, not one giant `omniweb-toolkit` skill for every use case.

Recommended public units:

- `omniweb-research-agent`
- `omniweb-market-analyst`
- `omniweb-engagement-optimizer`

Reason:

- registries and community sites are skill-centric, not monorepo-centric
- each archetype has a distinct promise, audience, and runbook
- smaller skills are easier to understand, install, review, and trust
- separate slugs improve discoverability and reduce prompt bloat

Keep `omniweb-toolkit` itself as the runtime package and internal router, not as the only public skill artifact.

### 3. Treat the package as runtime, and the skill as a generated wrapper artifact

Best practice for a package-backed skill is:

- the package provides executable behavior
- the skill provides agent-facing instructions, supporting files, install metadata, and onboarding

That means the public skill should not try to duplicate the package. It should declare and wrap it.

For us, each exported skill artifact should contain:

- `SKILL.md`
- `GUIDE.md` or a compact local guide
- `PLAYBOOK.md`
- `strategy.yaml`
- `RUNBOOK.md`
- example trace or score template
- accurate `metadata.openclaw.requires` and `metadata.openclaw.install`

When npm publish is stable, registry-facing skills should install the published package rather than requiring a checked-out monorepo.

### 4. Keep local workspace bundles and registry skills as different products

We should support two external shapes:

### Local workspace bundle

Use for:

- serious operators
- local testing
- docs quickstarts
- end-to-end proof runs

Shape:

- full OpenClaw workspace bundle
- `openclaw.json`
- local `package.json`
- skill folder and support files

This already exists and should stay.

### Registry/community skill artifact

Use for:

- ClawHub publish
- community lists
- GitHub skill repos

Shape:

- one archetype skill folder or thin repo
- published package dependency, not `file:../../..`
- small and legible metadata surface
- docs URL pointing back to the canonical docs site

Do not force registries to absorb the full workspace bundle when they only need the skill unit.

### 5. Use generated outward artifacts, not hand-maintained mirror repos

If we later decide to publish each archetype as its own GitHub repo, those repos should be **thin generated mirrors**, not hand-authored sources.

Preferred order:

1. maintain truth here
2. generate publishable archetype artifacts
3. publish those artifacts to ClawHub and community channels
4. only create separate public repos if a channel strongly benefits from one-repo-per-skill

If separate repos are created, they should be treated as release outputs with automated sync, not places where people edit the skill first.

## Repo structure recommendation

Keep the current monorepo and strengthen the export boundary rather than reorganizing the entire repo around external channels.

Recommended shape:

```text
packages/omniweb-toolkit/
  SKILL.md
  GUIDE.md
  playbooks/
  assets/
  scripts/
  agents/
    openclaw/                 # local workspace bundles
    registry/                 # future publish-ready per-skill artifacts
docs/
  site/                       # future public docs source
  research/
```

Notes:

- `agents/openclaw/` remains the operator/local-workspace export
- a future `agents/registry/` or equivalent export can strip the workspace wrapper and emit skill-first artifacts for ClawHub/community distribution
- public docs should point outward from one docs site, not be duplicated across every channel

## Release model

The clean release sequence is:

1. prove primitives and journeys live
2. publish the package to npm
3. switch registry-facing skill exports to published package install metadata
4. publish per-archetype skills to ClawHub or thin skill repos
5. list those skills in community directories
6. point every public artifact back to the same docs site

Until step 2 is done, local workspace bundles are the honest primary distribution format.

## Concrete decision

The best current architecture is:

- **one repository** as canonical source
- **one runtime package** as the executable substrate
- **multiple generated archetype skill artifacts** as public distribution units
- **one public docs site** as external documentation surface
- **optional thin mirror repos later**, only as generated release channels

This avoids the two bad extremes:

- one huge monolithic skill that tries to represent the whole package
- many hand-maintained repos that drift from the runtime and from each other

## Next implementation steps

1. Keep `packages/omniweb-toolkit/agents/openclaw/` as the local proving/export path.
2. Add a second export target for registry-facing per-archetype skill artifacts after the package publish path is real.
3. Make each archetype export declare accurate `metadata.openclaw.requires` and `metadata.openclaw.install`.
4. Stand up the docs site and use it as `homepage` for every external skill artifact.
5. Publish the skills per archetype, not as one omnibus listing.

## Sources

- [OpenClaw: Creating Skills](https://docs.openclaw.ai/tools/creating-skills)
- [ClawHub skill format](https://github.com/openclaw/clawhub/blob/main/docs/skill-format.md)
- [GitHub Docs: About wikis](https://docs.github.com/en/communities/documenting-your-project-with-wikis/about-wikis)
- [GitHub Docs: What is GitHub Pages?](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [VoltAgent/awesome-openclaw-skills](https://github.com/VoltAgent/awesome-openclaw-skills)
- [ythx-101/x-tweet-fetcher](https://github.com/ythx-101/x-tweet-fetcher)
- [zscole/model-hierarchy-skill](https://github.com/zscole/model-hierarchy-skill)
