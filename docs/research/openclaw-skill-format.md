---
summary: "OpenClaw skill format research — current workspace/config shape, supporting-file rules, and omniweb-toolkit export fit"
read_when: ["openclaw", "skill format", "skill packaging", "agent distribution"]
---

# OpenClaw Skill Format Research

Research into OpenClaw's skill packaging format, distribution channels, and feasibility for packaging our agent templates as distributable skills.

## Schema

OpenClaw skills are **directories** containing a `SKILL.md` file. The file uses YAML frontmatter for metadata and a markdown body for behavioral instructions.

### Frontmatter structure

```yaml
---
name: my-skill
description: What this skill does
metadata: {"openclaw":{"emoji":"🔍","requires":{"bins":["node"]},"primaryEnv":"MAIN_ENV_VAR"}}
---
```

Key fields:

- **name / description** — Identity and discoverability.
- **metadata.openclaw.requires** — Declares binary, env, or config dependencies. The runtime checks these before execution.
- **metadata.openclaw.primaryEnv** — The main environment variable the skill needs (typically an API key).
- **metadata.openclaw.install** — Installation steps for dependencies, supporting multiple package managers.
- **skillKey / homepage / emoji / os** — Optional runtime metadata surfaced by the loader and UI.

Runtime nuance:

- The embedded OpenClaw skill loader prefers **single-line frontmatter keys**, with `metadata` written as a single-line JSON object.
- ClawHub publish accepts normal skill folders with **supporting text-based files** alongside `SKILL.md`.

### Skill body

The markdown body **IS** the skill logic. There is no code file — behavioral instructions are written in natural language prose. The AI agent reads and follows these instructions at runtime. This is a fundamentally different paradigm from traditional code packages.

## Distribution

Five distribution channels exist:

| Channel | Description | Scale |
|---------|-------------|-------|
| **ClawHub** | Official marketplace | 13,729+ community skills |
| **Community repos** | GitHub repositories (e.g., VoltAgent/awesome-openclaw-skills) | Curated collections |
| **Direct URLs** | Install from any URL | Ad hoc sharing |
| **Local directories** | `~/.openclaw/skills`, `~/.agents/skills`, `<workspace>/.agents/skills`, `<workspace>/skills` | Development / private use |
| **Bundled** | Ships with OpenClaw install | Core skills |

ClawHub is the primary discovery mechanism. Skills are searchable and installable via `openclaw skills install <skill-slug>`.

Current precedence is:

`<workspace>/skills` → `<workspace>/.agents/skills` → `~/.agents/skills` → `~/.openclaw/skills` → bundled → `skills.load.extraDirs`

Skill visibility is controlled separately through `agents.defaults.skills` and `agents.list[].skills` in `openclaw.json`.

## Template Mapping

How our agent template components map to OpenClaw's skill model:

| Our component | OpenClaw equivalent | Fit |
|---------------|-------------------|-----|
| Base template (v3-loop orchestration) | Skill plus supporting files inside one folder | Workable |
| Strategy YAML (10 rules, scoring weights, source configs) | Companion `strategy.yaml` next to `SKILL.md` | Workable |
| Market Intelligence agent | Skill with market `observe()` instructions in body | Workable with companion files |
| Security Sentinel agent | Skill with security `observe()` instructions in body | Workable with companion files |
| Toolkit (createToolkit, 15 domains) | Would need to be a dependency, not part of the skill | External dependency |

### Proposed packaging (if pursued)

Each agent template can become a skill directory:

```
market-intelligence/
├── SKILL.md           # Frontmatter + loop orchestration instructions
├── strategy.yaml      # Companion file — concrete structured strategy
├── starter.ts         # Optional code scaffold
└── RUNBOOK.md         # Optional validation / operational notes
```

The SKILL.md body would instruct the agent to:
1. Load `strategy.yaml` as structured data
2. Run the sense-plan-act loop per the strategy rules
3. Use the omniweb-agents toolkit (declared as a dependency)

## Feasibility Assessment

### What works

- **Directory-based packaging** aligns with our template structure (a template is already a directory of files).
- **Dependency declarations** (`requires.bins`, `requires.env`) can express our Node.js + SDK requirements.
- **Local directory loading** enables development without publishing to ClawHub.

### What still does not fit cleanly

- **Toolkit dependency.** `omniweb-toolkit` remains the real runtime. The skill folder teaches the agent how to use it, but the dependency still has to be installed and configured.
- **Runtime assumptions.** OpenClaw is prompt-driven and interactive; our playbooks are closer to deliberate autonomous loops. The skill can teach that loop, but OpenClaw does not enforce it structurally.
- **Pre-publish distribution story.** Until `omniweb-toolkit` is published, the cleanest OpenClaw setup is a local workspace bundle pointing at the checked-out package or repo tarball.

### Verdict

**Viable as local workspace bundles today.** Current OpenClaw and ClawHub docs explicitly support skill folders with supporting text files, which means exported archetypes can carry a real `strategy.yaml`, starter asset, and runbook next to `SKILL.md`.

The remaining constraint is operational, not format-level: the bundle still needs a working `omniweb-toolkit` installation and peer dependencies.

## Recommendation

**Export local OpenClaw workspace bundles now, keep public registry publish later.**

Rationale:

1. The current format is already enough for local OpenClaw workspaces.
2. Supporting files remove the biggest earlier blocker: structured strategy can ship next to the skill.
3. The unresolved part is package distribution, not skill schema.
4. A local generated bundle gives a real interoperability test without forcing an early ClawHub publish.

**Current recommendation:** ship generated local bundles for the maintained archetypes, validate them deterministically, and revisit ClawHub publication after the package's npm distribution path is stable.

## Sources

- [Skills - OpenClaw](https://docs.openclaw.ai/tools/skills) — Official documentation on skill format, installation, and distribution.
- [OpenClaw Custom Skill Creation Guide](https://zenvanriel.com) — Community guide with detailed schema examples.
- [VoltAgent/awesome-openclaw-skills](https://github.com/VoltAgent/awesome-openclaw-skills) — Community skill collection and ClawHub statistics.
