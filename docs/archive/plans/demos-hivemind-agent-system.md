# Plan: Demos Hivemind Agent System

## Context

Marius runs "isidore" — a self-improving AI agent on SuperColony.ai (Demos Network). The current v4 loop (AUDIT→SCAN→ENGAGE→GATE→PUBLISH→VERIFY→REVIEW) works but is tightly coupled to isidore, mostly manual, and not portable. This plan addresses 7 interconnected goals:

1. **Generalize** the loop into reusable skill workflows
2. **Optimize** model usage (Sonnet where sufficient, Opus where critical)
3. **Design** a subagent for SuperColony operations
4. **Transfer** the loop to OpenClaw and other runtimes
5. **Spec** a standardized "Agent Definition" format
6. **Create** the "Demos SuperColony Hivemind Agent"
7. **Publish** a public repo for all Demos ecosystem agent-models and skills

---

## Conceptual Clarity: Skills vs Agents vs Personas

### The Three Concepts

```
SKILL = What an agent CAN DO (capability)
  └── "Post to SuperColony", "Attest via TLSN", "Read feed"
  └── Portable across agents and tools — same skill works in Claude Code, OpenClaw, Cursor, Codex, etc.

AGENT = WHO it is (identity + skills + strategy + constraints)
  └── "Hivemind uses supercolony skill + self-improving-loop strategy + never-post-without-attestation rules"
  └── An agent WITHOUT skills is just a persona. An agent WITH skills can act.

PERSONA = HOW it communicates (voice, tone, style)
  └── "Isidore speaks in precise, evidence-driven, measured tone"
  └── A persona is a SUBSET of an agent definition — the identity layer
```

**The correct composition: Agent = Persona + Skills + Strategy + Constraints**

### Canonical Standards (What Actually Exists)

#### 1. Agent Skills Open Standard (agentskills.io) — THE canonical skill format

Developed by Anthropic, adopted by **30+ tools**: Claude Code, Cursor, VS Code, GitHub Copilot, Gemini CLI, OpenAI Codex, OpenClaw/pi, Goose, Junie, Roo Code, Mistral Vibe, Databricks, and many more.

**Spec:**
```yaml
---
name: skill-name           # Required. Lowercase, hyphens, max 64 chars. Must match directory name.
description: What + when   # Required. Max 1024 chars. Include keywords for discovery.
license: Apache-2.0        # Optional
compatibility: Requires... # Optional. Max 500 chars. Environment requirements.
metadata:                   # Optional. Arbitrary key-value pairs.
  author: example-org
  version: "1.0"
allowed-tools: Read Grep   # Optional. Experimental. Pre-approved tools.
---

Markdown instructions for the agent...
```

**Directory structure:**
```
skill-name/
├── SKILL.md          # Required — instructions
├── scripts/          # Optional — executable code
├── references/       # Optional — detailed docs (loaded on-demand)
└── assets/           # Optional — templates, schemas, data files
```

**Progressive disclosure (3 tiers):**
1. Metadata (~100 tokens) — name + description loaded at startup for ALL skills
2. Instructions (<5000 tokens) — full SKILL.md loaded when skill activates
3. Resources (as needed) — scripts/, references/, assets/ loaded on demand

**Key rules:**
- SKILL.md under 500 lines. Move detail to references/
- File references one level deep from SKILL.md
- `skills-ref validate ./my-skill` for validation

**Source:** https://agentskills.io/specification

#### 2. Claude Code Agent Format — Canonical for Claude Code

```yaml
---
name: AgentName
description: What the agent does
model: opus|sonnet|haiku
context: fork              # Optional — run in subagent
allowed-tools: Read, Grep  # Optional — tool restrictions
---
Markdown persona + instructions body
```

Located at `~/.claude/agents/*.md`. PAI extends this with voice, color, persona fields.

#### 3. OpenClaw Agent Format — Canonical for OpenClaw

Agents defined via **workspace bootstrap files** (not a single spec file):

| File | Purpose |
|------|---------|
| **SOUL.md** | Persona, boundaries, tone |
| **IDENTITY.md** | Agent name, vibe, emoji |
| **AGENTS.md** | Operating instructions, memory |
| **TOOLS.md** | Tool usage notes |
| **USER.md** | User profile, preferences |
| **BOOTSTRAP.md** | First-run ritual (auto-deleted) |

Agent configuration in `openclaw.json` under `agents.list[]` with `id`, `runtime`, `params`.

**Skills** load from 3 tiers: workspace > managed (`~/.openclaw/skills/`) > bundled.

#### 4. ACP (Agent Client Protocol) — Canonical cross-agent protocol

ACP is **real** — launched by Zed and JetBrains, adopted by OpenClaw as first-class runtime.

**What it does:** Lets one agent framework run external coding agents (Claude Code, Codex, Pi, OpenCode, Gemini CLI, Kimi) through a backend plugin.

**Config in openclaw.json:**
```json5
{
  acp: {
    enabled: true,
    backend: "acpx",
    defaultAgent: "codex",
    allowedAgents: ["pi", "claude", "codex", "opencode", "gemini", "kimi"],
    maxConcurrentSessions: 8
  }
}
```

**ACP agents in agents.list[]:**
```json5
{
  id: "codex",
  runtime: { type: "acp", acp: { agent: "codex", backend: "acpx", mode: "persistent" } }
}
```

**Key:** ACP is about agent-to-agent communication/delegation. Not about defining agents.

### What's Canonical vs Custom

| Format | Status | Standard |
|--------|--------|----------|
| Agent Skills `SKILL.md` | **CANONICAL** | agentskills.io open standard, 30+ tools |
| Claude Code `agents/*.md` | **CANONICAL** | Claude Code native |
| OpenClaw bootstrap files | **CANONICAL** | OpenClaw native |
| OpenClaw ACP | **CANONICAL** | Agent Client Protocol (Zed/JetBrains) |
| PAI's extended skill format | **CUSTOM** | PAI-specific extensions (Workflows/, Tools/, Personas/) |
| PAI's Traits.yaml | **CUSTOM** | PAI dynamic agent composition |
| Proposed `AGENT.yaml` | **CUSTOM** | Not yet implemented — our innovation |

### Key Insight: No Canonical Agent Definition Standard Exists

Skills have a standard (Agent Skills). Agent-to-agent communication has a standard (ACP). But **agent identity/definition** has NO cross-platform standard. Each tool has its own format:
- Claude Code: `agents/*.md` with YAML frontmatter
- OpenClaw: `SOUL.md` + `IDENTITY.md` + `openclaw.json`
- Neither is portable to the other

**This is the gap we're filling** with `AGENT.yaml` — a canonical agent definition format with projectors to each runtime.

### Repo Strategy

| Repo | Purpose | Visibility |
|------|---------|-----------|
| **`my-agent-skills`** (existing) | Personal skill library — ALL skills (Demos + non-Demos), customized for Marius | Private or public |
| **`omniweb-agents`** (new) | Demos ecosystem: agent definitions + strategies + shared tools + portable skills | Public |
| **Skills in OpenClaw registry** | Individual skills published for community discovery | Public (registry) |
| **Skills following Agent Skills standard** | Same skills work in Claude Code, OpenClaw, Cursor, Codex, etc. | Portable |

`my-agent-skills` stays as personal skill library. `omniweb-agents` holds agent definitions + Demos-ecosystem skills following the Agent Skills open standard.

### Sources
- [Agent Skills Open Standard](https://agentskills.io)
- [Agent Skills Specification](https://agentskills.io/specification)
- [Claude Code Skills Docs](https://code.claude.com/docs/en/skills)
- [OpenClaw ACP Agents](https://docs.openclaw.ai/tools/acp-agents)
- [OpenClaw Agent Runtime](https://docs.openclaw.ai/concepts/agent)
- [Awesome OpenClaw Skills](https://github.com/VoltAgent/awesome-openclaw-skills)
- [Anthropic Skills Repo](https://github.com/anthropics/skills)

---

## Research Findings

### A. Current Loop Automation State

| Phase | Automation | Model Need | Generalizable? |
|-------|-----------|------------|----------------|
| **AUDIT** (fetch scores, compare predictions) | Full | Sonnet | YES — any agent with session log |
| **SCAN** (feed + room temp) | Partial (feed auto, assessment manual) | Sonnet | Partial — feed generic, questions platform-specific |
| **ENGAGE** (react + reply) | Semi (react-to-posts.ts --max N) | Sonnet | YES — parameterizable heuristics |
| **GATE** (6-item checklist) | Manual (items 1,5,6 automatable) | Sonnet | Partial — structure generic, items strategy-specific |
| **PUBLISH** (attest + post) | Semi (pipeline auto, content manual) | **Opus** | NO — content needs persona + strategy. Pipeline is generic |
| **VERIFY** (feed check + log) | Full | Sonnet | YES |
| **REVIEW** (4 questions + improvements) | Manual | Sonnet | YES — structure generic |

**Key insight:** Only PUBLISH content generation truly needs Opus. 6/7 phases run fine on Sonnet → ~74% cost reduction.

### B. Three Agent Definition Surfaces That Need Unification

1. **PAI agents** (`~/.claude/agents/*.md`) — YAML frontmatter + persona markdown, Claude Code-specific
2. **OpenClaw agents** (`openclaw.json` + workspace files) — config-driven tool policies + workspace injection
3. **SuperColony agent-config** (`agent-config.json`) — minimal: name, persona, wallet, scripts

### C. Existing Portable Assets

- `~/projects/my-agent-skills/supercolony/` — packaged skill (SKILL.md + scripts + references)
- `~/projects/DEMOS-Work/src/` — 10+ operational scripts (publish, react, score, tlsn, etc.)
- `~/.claude/skills/DEMOS/SuperColony/` — installed skill with workflows (PAI-extended format)
- `~/projects/openclaw-bot/` — personal runbook for configuring OpenClaw bots (NOT architecture)

### D. Automation Opportunities (New Scripts)

| Script | Purpose | Effort |
|--------|---------|--------|
| `room-temp.ts` | Auto room temperature (count posts/6h, cluster topics, find gaps) | Medium |
| `session-review.ts` | Auto review template from session log stats | Medium |
| `improvements.ts` | CRUD on Pending Improvements (--list, --propose, --approve, --verify) | Medium |
| `react-to-posts.ts --strategy` | Intelligent targeting (bayesian-first, disagree-inclusion) | Low |
| Gate items 1,5,6 | Add to room-temp.ts output | Low |

---

## Architecture

### The Agent Definition Spec: `AGENT.yaml`

A single canonical YAML file per agent. Projected into runtime-specific formats via projectors.

```yaml
apiVersion: omniweb-agents/v1
kind: AgentDefinition

metadata:
  name: hivemind
  displayName: "Demos SuperColony Hivemind Agent"
  version: "1.0.0"
  tags: [supercolony, demos, hivemind, self-improving]

identity:
  role: "Verification node in SuperColony's shared nervous system"
  tone: "Precise, curious, measured"
  strengths: [pattern-recognition, quantitative-grounding, signal-contribution]
  avoids: [hype, platitudes, self-referential-content]

capabilities:
  skills: [supercolony]
  tools:
    required: [node-18+, npx-tsx, playwright]
    optional: [bird-cli]

strategy:
  ref: "strategies/self-improving-loop.yaml"    # Separate file

constraints:
  hardRules:
    - "Never publish without attestation"
    - "Never exceed 3 posts per session"
    - "Max 8 reactions per session"
    - "Never modify strategy without human approval"
  oversightGate:
    scope: [strategies/*, skills/*/SKILL.md, personas/*]
    evidenceThreshold: 5
    autoApprove: [scripts/*, session-log]

selfImprovement:
  predictionTracking: true
  calibrationOffset: 6
  improvementLifecycle: [proposed, approved, applied, verified]
  logRotation: { maxEntries: 50 }

runtime:                               # Per-runtime projections
  pai: { defaultTier: premium, agentFile: "Personas/{name}.md" }
  openclaw: { defaultTier: standard, toolProfile: full }
  standalone: { defaultTier: standard, entrypoint: "tools/session-runner.ts" }
  # Model mapping is runtime config, NOT agent definition:
  # modelMapping: { fast: "haiku", standard: "sonnet", premium: "opus" }
```

### Strategy Architecture: Base Loop + Specialization

**Base loop is minimal** — only 4 abstract phases. Everything else is specialization.

```yaml
# strategies/base-loop.yaml — shared skeleton, ALL agents inherit
phases:
  - OBSERVE    # Gather data (HOW is specialization-specific)
  - ACT        # Publish, react, attest (WHAT is specialization-specific)
  - VERIFY     # Confirm result (universal)
  - LEARN      # Audit predictions, calibrate, propose improvements (universal)

mandatory:
  sessionLog: true           # Append-only JSONL, rotate at 50
  predictionTracking: true   # Every action has a hypothesis + predicted outcome
  calibration: true          # Rolling offset from predicted vs actual
  pendingImprovements: true  # Evidence-based change proposals (n>=5)
  oversightGate: true        # Strategy changes require human approval
```

**Each agent owns a customized, self-improvable strategy:**

```yaml
# strategies/sentinel-loop.yaml — Sentinel's specialization
extends: base-loop.yaml

phases:
  - id: scan-gaps          # OBSERVE: heavy feed scanning, gap detection
    modelTier: standard
  - id: attest-evidence    # ACT: TLSN attestation of missing data
    modelTier: standard
  - id: publish-findings   # ACT: post with attested gap analysis
    modelTier: premium
  - id: engage-threads     # ACT: react + reply to related posts
    modelTier: standard
  - id: verify-indexing    # VERIFY: confirm post in feed
    modelTier: fast
  - id: review-session     # LEARN: audit, calibrate, improve
    modelTier: standard
```

```yaml
# strategies/meridian-loop.yaml — Meridian's specialization (future)
extends: base-loop.yaml

phases:
  - id: audit-predictions  # OBSERVE: check past predictions vs outcomes
    modelTier: fast
  - id: scan-prices        # OBSERVE: fetch market data
    modelTier: fast
  - id: publish-prediction # ACT: attested prediction with deadline + confidence
    modelTier: premium
  - id: verify-indexing    # VERIFY
    modelTier: fast
  - id: calibrate          # LEARN: update prediction model
    modelTier: standard
```

**The current 7-phase isidore loop (AUDIT→SCAN→ENGAGE→GATE→PUBLISH→VERIFY→REVIEW) is alpha** — it was designed for one agent exploring. It becomes the basis for Sentinel's specialization but is NOT the universal base.

**Self-improvement is the universal constant.** Every agent, regardless of strategy, must:
1. Log every action with a hypothesis and predicted outcome
2. Audit predictions vs actuals
3. Maintain a calibration offset
4. Propose evidence-based improvements (n>=5 threshold)
5. Get human approval for strategy file changes

### Projector Architecture

```
AGENT.yaml (canonical)
    ├── projectors/pai.ts       → ~/.claude/agents/Hivemind.md
    ├── projectors/openclaw.ts  → workspace/SOUL.md + AGENTS.md + skill
    └── projectors/standalone.ts → self-contained Node.js runner
```

---

## Public Repo Structure

**Repo:** `mj-deving/omniweb-agents` (public, Apache-2.0)

```
omniweb-agents/
├── README.md
├── spec/
│   ├── AGENT-SPEC.md                 # Agent definition format (OUR spec — no standard exists)
│   ├── STRATEGY-SPEC.md              # Strategy/loop format
│   └── schemas/
│       ├── agent.schema.json
│       └── strategy.schema.json
├── agents/
│   ├── hivemind/                      # BASE template (all agents inherit)
│   │   ├── AGENT.yaml
│   │   ├── personas/hivemind.md      # Generalized persona
│   │   └── README.md
│   ├── sentinel/                      # First specialized agent (verification/gap detection)
│   │   ├── AGENT.yaml                # Extends hivemind
│   │   └── personas/sentinel.md
│   ├── arbiter/                       # Future: evidence judge
│   ├── cortex/                        # Future: pattern recognition
│   └── meridian/                      # Future: prediction specialist
├── skills/                            # Agent Skills open standard (agentskills.io)
│   └── supercolony/                   # Shared by ALL agents
│       ├── SKILL.md                  # Canonical frontmatter (lowercase name, description)
│       ├── scripts/                  # Executable tools
│       │   ├── supercolony.ts        # Multi-command CLI (feed, post, react, auth, etc.)
│       │   ├── publish.ts            # Generalized attested publish pipeline
│       │   └── react-to-posts.ts     # Engagement automation
│       ├── references/              # On-demand docs
│       │   ├── api-reference.md
│       │   ├── operational-playbook.md
│       │   ├── publish-procedure.md  # Was "Workflows/Publish.md" — now a reference doc
│       │   ├── audit-procedure.md    # Was "Workflows/Audit.md"
│       │   └── engage-procedure.md   # Was "Workflows/Engage.md"
│       └── assets/                  # Templates, schemas
├── strategies/
│   ├── base-loop.yaml                # Minimal skeleton: OBSERVE→ACT→VERIFY→LEARN + self-improvement
│   ├── sentinel-loop.yaml            # Sentinel: scan-gaps → attest → publish → engage → verify → learn
│   ├── arbiter-loop.yaml             # Future: Arbiter specialization
│   ├── cortex-loop.yaml              # Future: Cortex specialization
│   └── meridian-loop.yaml            # Future: Meridian specialization
├── tools/                             # Shared tooling (future phases)
│   ├── session-runner.ts
│   ├── room-temp.ts
│   └── improvements.ts
├── projectors/                        # Runtime projectors (future phases)
│   ├── pai.ts                        # AGENT.yaml → Claude Code agents/*.md
│   ├── openclaw.ts                   # AGENT.yaml → SOUL.md + IDENTITY.md
│   └── validate.ts
└── docs/
    ├── ARCHITECTURE.md
    └── SELF-IMPROVEMENT.md
```

**Key decisions:**
- Skills follow **Agent Skills open standard** (agentskills.io) — portable across 30+ tools
- PAI's "Workflows/" become `references/` procedure docs (Agent Skills has no Workflows concept)
- Agent definitions use **our custom AGENT.yaml format** (no standard exists for agent identity)
- All agents share supercolony skill + self-improving loop + human oversight gate
- Each specialized agent adds its own strategy + tools + persona

**Relationship to existing repos:**
- `my-agent-skills` → **STAYS** as personal skill library. SuperColony skill lives in BOTH (my-agent-skills for personal use, omniweb-agents for public sharing)
- `DEMOS-Work` → stays private (session logs, wallet, strategies-in-progress)
- `openclaw-bot` → references `omniweb-agents` agent definitions + skills
- OpenClaw skills registry → individual skills can be published there too for community discovery

---

## Model Tier Allocation (Provider-Agnostic)

Three tiers, mapped to any provider:

| Tier | Purpose | Anthropic | OpenAI | Google | OpenRouter |
|------|---------|-----------|--------|--------|-----------|
| **fast** | Simple, mechanical tasks | haiku | gpt-4o-mini | gemini-flash | any fast model |
| **standard** | Balanced quality/cost | sonnet | gpt-4o | gemini-pro | any standard model |
| **premium** | Quality-critical creative work | opus | o3/gpt-4-turbo | gemini-ultra | any premium model |

**Per-phase allocation in AGENT.yaml:**

| Phase | Tier | Why |
|-------|------|-----|
| AUDIT | **fast** | Data fetch + arithmetic comparison, fully scripted |
| SCAN | **standard** | Feed reading + room assessment needs some judgment |
| ENGAGE | **standard** | Reaction targeting follows rules but needs context |
| GATE | **fast** | Binary checklist items, mostly automatable |
| **PUBLISH** | **premium** | Content quality directly impacts engagement. Contrarian framing, synthesis |
| VERIFY | **fast** | Feed check is mechanical |
| REVIEW | **standard** | Pattern matching on structured questions |

**In AGENT.yaml, model tiers are abstract:**
```yaml
strategy:
  phases:
    - id: audit
      modelTier: fast       # Runtime resolves to provider-specific model
    - id: publish
      modelTier: premium    # Only phase that truly needs expensive model
```

**Runtime resolution** happens in the projector or runner:
```yaml
# In runtime config (not in AGENT.yaml):
modelMapping:
  fast: "claude-haiku-4-5"        # Or "gpt-4o-mini" or "gemini-flash"
  standard: "claude-sonnet-4-6"   # Or "gpt-4o" or "gemini-pro"
  premium: "claude-opus-4-6"      # Or "o3" or "gemini-ultra"
```

**Cost estimate (Anthropic example):** All-premium ~$0.53/session → mixed tiers ~$0.12/session = **~77% savings**

**Quality gate:** After n>=10 standard-tier posts, compare engagement rates vs premium-tier posts.

---

## Subagent Guardrails

```yaml
guardrails:
  financial: { maxDEMPerSession: 50, maxTips: 5, tipRange: [1, 5] }
  content: { maxPosts: 3, maxReactions: 8, requireAttestation: true }
  quality: { gateThreshold: 5/6, minConfidence: 60 }
  safety:
    humanApprovalRequired: [strategyChanges, personaChanges]
    selfApproved: [scriptParams, calibration, sessionLog]
    cooldownMinutes: 15
    maxSessionsPerDay: 4
```

**Autonomy progression:** Supervised (sessions 1-5) → Semi-autonomous (6-15, prediction error <5) → Autonomous (16+, 80% posts score 90+)

---

## Implementation Phases

### Phase 1: Foundation (this session + next)
1. Create `omniweb-agents` public repo with directory structure
2. Write `spec/AGENT-SPEC.md` — full format documentation
3. Write `spec/STRATEGY-SPEC.md` — strategy format docs
4. Create `agents/hivemind/AGENT.yaml` — canonical definition
5. Create `agents/isidore/AGENT.yaml` — isidore as hivemind instance
6. Move `supercolony/` skill from `my-agent-skills` to `omniweb-agents/skills/`
7. Extract `strategies/self-improving-loop.yaml` from v4 strategy doc

### Phase 2: Tooling (2 sessions)
8. Build `tools/room-temp.ts` — automated room assessment
9. Build `tools/session-review.ts` — review automation
10. Build `tools/improvements.ts` — Pending Improvements CRUD
11. Enhance `tools/react-to-posts.ts` — add --strategy flag
12. Build `projectors/validate.ts` — AGENT.yaml schema validation
13. Create JSON schemas (`spec/schemas/`)

### Phase 3: Projectors (1-2 sessions)
14. Build `projectors/pai.ts` — generates PAI agent file
15. Build `projectors/openclaw.ts` — generates OpenClaw workspace
16. Build `projectors/standalone.ts` — generates standalone runner
17. Test: install projected PAI agent, run one session
18. Test: deploy OpenClaw projection to Gregor

### Phase 4: Automation (1-2 sessions)
19. Build `tools/session-runner.ts` — standalone loop executor
20. Add gate automation (items 1,5,6) to room-temp.ts
21. Test semi-autonomous mode end-to-end

### Phase 5: Docs & Release (1 session)
22. Write all docs/ files
23. Write CONTRIBUTING.md
24. Final README.md with quickstart
25. Push public, update `my-agent-skills` redirect

---

## Verification

- [ ] `AGENT.yaml` validates against JSON Schema
- [ ] PAI projection produces working agent file (run 1 session)
- [ ] OpenClaw projection loads on Gregor (skill accessible)
- [ ] Standalone runner executes AUDIT phase successfully
- [ ] room-temp.ts produces structured JSON output
- [ ] improvements.ts CRUD works (propose, list, approve, verify)
- [ ] Sonnet handles AUDIT/SCAN/ENGAGE/VERIFY/REVIEW phases adequately
- [ ] Public repo has no private data (wallet, session logs, .env)

---

## Key Design Decisions

1. **YAML over JSON** for agent definitions — human-readable, supports comments
2. **Projectors over adapters** — project canonical spec into each runtime's native format, not a universal abstraction layer
3. **Strategy separate from agent** — same agent can run different strategies (self-improving vs basic-publish)
4. **Node.js scripts as execution layer** — skills are teaching docs, scripts are the engine, works across all runtimes
5. **Public repo separate from working directory** — framework is public, session data stays private

---

## Confirmed Scope: Lean Foundation

**Per Codex review: prove one agent before abstracting.** No formal AGENT.yaml spec, no projectors, no multi-agent architecture yet. Build a working repo with one agent + one skill.

### This Session Deliverables

1. **Save research** — 3 files in `DEMOS-Work/`:
   - `Research-Loop-Analysis.md` — v4 loop breakdown, automation state, generalization opportunities
   - `Research-Agent-Ecosystem.md` — ACP, canonical standards, OpenClaw/PAI/SuperColony patterns
   - `Research-Skill-Patterns.md` — Agent Skills open standard, format comparison

2. **Create `omniweb-agents` repo** — `~/projects/omniweb-agents/` with lean structure

3. **Create Sentinel** — first and only agent:
   - `agents/sentinel/AGENT.yaml` — lightweight definition (identity, capabilities, constraints)
   - `agents/sentinel/personas/sentinel.md` — generalized verification agent persona
   - `agents/sentinel/strategy.yaml` — Sentinel's loop (adapted from isidore v4, not a formal spec)

4. **Port supercolony skill** — Agent Skills open standard format:
   - Source of truth: `~/.claude/skills/DEMOS/SuperColony/` (installed, most current)
   - SKILL.md with canonical frontmatter (lowercase `name`, `description` with keywords)
   - `scripts/` — supercolony.ts CLI tool + generalized publish/react scripts
   - `references/` — operational playbook, API reference, procedure docs
   - Run `skills-ref validate` if available

5. **README.md** — what this repo is, how to use the skill, what Sentinel does

### What We're NOT Doing (Codex-driven scope cuts)
- ~~AGENT-SPEC.md / STRATEGY-SPEC.md~~ — premature formal specs. AGENT.yaml is informal.
- ~~JSON Schema validation~~ — no schema until format stabilizes through use
- ~~Projectors (PAI, OpenClaw, standalone)~~ — defer until AGENT.yaml proves useful
- ~~Multiple agents (Arbiter, Cortex, Meridian)~~ — defer until Sentinel is production-proven
- ~~Autonomy progression thresholds~~ — arbitrary, defer
- ~~Model tier mapping in AGENT.yaml~~ — contradicts "runtime config" principle. Remove.

### Source of Truth Hierarchy
1. **`~/projects/DEMOS-Work/src/`** — Active scripts (isidore-publish.ts, react-to-posts.ts, etc.)
2. **`~/.claude/skills/DEMOS/SuperColony/`** — Most up-to-date docs + workflows
3. **`~/projects/my-agent-skills/supercolony/`** — OUTDATED (missing corrected scoring, v4 loop)

### Sentinel Persona
Generalized from isidore, role-specific:

**sentinel.md contains:**
- Role: verification node in SuperColony's shared nervous system
- Mission: detect gaps, verify claims, attest evidence others haven't
- Tone: precise, curious, measured, evidence-driven
- Anti-patterns: no hype, no platitudes, no self-referential content, no unattested claims
- Post guidelines: per-category templates
- Tagging conventions, text length rules

**NOT in sentinel.md (isidore-specific, stays local):**
- Wallet address, registration date
- Calibration offset (emerges from Sentinel's own data)
- Engagement stats (per-instance runtime data)

### Future Sessions (deferred)
- Harden Sentinel through real sessions → collect data on what works
- AGENT.yaml spec emerges from proven patterns (not upfront design)
- Add agents only when distinct strategy is proven needed
- Projectors when portability is actually needed (not before)
- Formal specs when format stabilizes

### Critical Files to Read During Implementation
- `~/.claude/skills/DEMOS/SuperColony/` — source of truth for skill content
- `~/.claude/skills/DEMOS/SuperColony/Personas/isidore.md` — base for persona generalization
- `~/.claude/skills/DEMOS/SuperColony/OperationalPlaybook.md` — latest operational docs (455 lines)
- `/home/mj/projects/DEMOS-Work/Isidore-Strategy-v4.md` — source for strategy extraction
- Agent Skills spec: https://agentskills.io/specification — canonical skill format
