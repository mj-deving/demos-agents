---
summary: "OpenClaw skill format research — schema, distribution, feasibility assessment for agent templates"
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
metadata:
  openclaw:
    emoji: "🔍"
    requires:
      bins: ["required-binaries"]
      env: ["REQUIRED_ENV_VARS"]
    primaryEnv: "MAIN_ENV_VAR"
    install:
      - id: brew
        kind: brew
        formula: package-name
os: [darwin, linux, win32]
---
```

Key fields:

- **name / description** — Identity and discoverability.
- **metadata.openclaw.requires** — Declares binary and environment variable dependencies. The runtime checks these before execution.
- **metadata.openclaw.primaryEnv** — The main environment variable the skill needs (typically an API key).
- **metadata.openclaw.install** — Installation steps for dependencies, supporting multiple package managers.
- **os** — Platform compatibility list.

### Skill body

The markdown body **IS** the skill logic. There is no code file — behavioral instructions are written in natural language prose. The AI agent reads and follows these instructions at runtime. This is a fundamentally different paradigm from traditional code packages.

## Distribution

Five distribution channels exist:

| Channel | Description | Scale |
|---------|-------------|-------|
| **ClawHub** | Official marketplace | 13,729+ community skills |
| **Community repos** | GitHub repositories (e.g., VoltAgent/awesome-openclaw-skills) | Curated collections |
| **Direct URLs** | Install from any URL | Ad hoc sharing |
| **Local directories** | `~/.openclaw/skills`, `.agents/skills`, `workspace/skills` | Development / private use |
| **Bundled** | Ships with OpenClaw install | Core skills |

ClawHub is the primary discovery mechanism. Skills are searchable and installable via `openclaw install skill-name`.

## Template Mapping

How our agent template components map to OpenClaw's skill model:

| Our component | OpenClaw equivalent | Fit |
|---------------|-------------------|-----|
| Base template (v3-loop orchestration) | Meta-skill that loads strategy YAML and runs the loop | Indirect — requires adapter |
| Strategy YAML (10 rules, scoring weights, source configs) | **No equivalent** — strategy lives in markdown prose | Paradigm mismatch |
| Market Intelligence agent | Skill with market `observe()` instructions in body | Workable with companion files |
| Security Sentinel agent | Skill with security `observe()` instructions in body | Workable with companion files |
| Toolkit (createToolkit, 15 domains) | Would need to be a dependency, not part of the skill | External dependency |

### Proposed packaging (if pursued)

Each agent template would become a skill directory:

```
market-intelligence/
├── SKILL.md           # Frontmatter + loop orchestration instructions
├── strategy.yaml      # Companion file — our structured strategy rules
└── sources.yaml       # Optional — source configuration
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

### What does not work

- **Strategy-as-data vs strategy-as-prose.** Our core value proposition is structured, tunable strategy YAML — scoring weights, thresholds, rule priorities. OpenClaw's model bakes strategy into unstructured markdown. A skill consumer cannot easily tune `min_confidence: 0.7` when it is buried in prose.
- **No native companion file support.** OpenClaw skills are SKILL.md-centric. Companion files (strategy.yaml, sources.yaml) would work in local directories but may not survive ClawHub distribution cleanly.
- **Runtime assumptions.** OpenClaw skills assume a conversational AI context. Our v3-loop is a headless autonomous pipeline (sense → plan → act). The execution model differs.
- **Toolkit dependency.** Our 15-domain toolkit with 38 API endpoints, chain SDK integration, and colony DB is a substantial runtime dependency that does not fit the "self-contained skill" model.

### Verdict

**Possible but requires an adapter pattern.** The paradigm mismatch (strategy-as-data vs strategy-as-prose) means OpenClaw packaging would be a lossy translation of our template model. The structured strategy YAML — our key differentiator — would need to be either:

1. Flattened into prose (losing tunability), or
2. Kept as a companion file with custom loading logic in the SKILL.md body (fragile, non-standard).

Neither option is clean.

## Recommendation

**Defer OpenClaw packaging until templates are validated in production.**

Rationale:

1. Templates do not yet exist — designing for a distribution format before the thing being distributed is premature.
2. The adapter cost is non-trivial and adds complexity without immediate user value.
3. Local directory loading means we can always package later without changing the template format.
4. Production validation will reveal which parts of templates are stable enough to package.

**Revisit after:** Two agent templates (Market Intelligence + one more) are running successfully in production with the v3-loop.

## Sources

- [Skills - OpenClaw](https://docs.openclaw.ai/tools/skills) — Official documentation on skill format, installation, and distribution.
- [OpenClaw Custom Skill Creation Guide](https://zenvanriel.com) — Community guide with detailed schema examples.
- [VoltAgent/awesome-openclaw-skills](https://github.com/VoltAgent/awesome-openclaw-skills) — Community skill collection and ClawHub statistics.
