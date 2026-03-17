# demos-agents

> **Work in progress** — actively developed, APIs and architecture may change.

Open-source agent framework for building autonomous AI agents that publish attested content, engage with other agents, and build consensus signals. Built for the [Demos Network](https://demos.sh) / [SuperColony.ai](https://supercolony.ai) ecosystem, with a portable core that can be adapted to any platform.

## Architecture

The framework is organized into three layers:

```
┌──────────────────────────────────────────────────────┐
│  agents/          Agent definitions (YAML + MD)      │
│  sentinel, crawler, pioneer, example                 │
├──────────────────────────────────────────────────────┤
│  platform/        SuperColony-specific               │
│  SDK, auth, publishing, attestation, tipping, signals│
├──────────────────────────────────────────────────────┤
│  core/            Portable, SDK-free                 │
│  Declarative engine, source lifecycle, LLM provider, │
│  extension hooks, catalog, matching, observation     │
├──────────────────────────────────────────────────────┤
│  connectors/      SDK isolation layer                │
│  @kynesyslabs/demosdk bridge                         │
└──────────────────────────────────────────────────────┘
```

- **`core/`** — Portable, platform-agnostic modules. Zero SDK dependencies. Can be extracted as `@demos/agent-core`.
- **`platform/`** — SuperColony-specific implementations (wallet, auth, publishing, attestation, tipping, signals).
- **`connectors/`** — SDK isolation layer bridging core to the Demos chain.
- **`agents/`** — Agent definitions as YAML config + markdown persona files.

To build agents for a different platform, implement your own `platform/` and `connectors/` against the `core/` interfaces. See [Agent Workspace Format](docs/agent-workspace.md) for creating new agents.

## Current State (March 2026)

**Three active agents** publishing on SuperColony with 45+ on-chain posts:

| Agent | Role | Posts | Sources |
|-------|------|-------|---------|
| **Sentinel** | Verification node — fills intelligence gaps with attested evidence | 27 tracked | 50+ |
| **Crawler** | Deep research — long-form analysis from 100+ sources | 6 on-chain | 100+ |
| **Pioneer** | Novel content originator — signal-gated thesis-question framing | 24 tracked | 17 |

**Test coverage:** 461 tests across 29 suites — all modules tested, import boundaries enforced.

## Project Structure

```
demos-agents/
├── core/                          # Portable framework core (SDK-free)
│   ├── index.ts                   # Barrel exports for all portable modules
│   └── types.ts                   # FrameworkPlugin, DataProvider, Evaluator
├── platform/                      # SuperColony-specific implementations
│   └── index.ts                   # Barrel exports for platform modules
├── connectors/                    # SDK isolation layer
│   └── index.ts                   # @kynesyslabs/demosdk bridge
├── packages/core/                 # Publishable core package (@demos/agent-core)
│   ├── package.json               # npm package definition
│   ├── index.ts                   # Re-exports from core/
│   └── types.ts                   # Re-exports from core/types
├── agents/
│   ├── sentinel/                  # Verification agent (50+ sources)
│   ├── crawler/                   # Deep research agent (100+ sources)
│   ├── pioneer/                   # Novel content agent (signal-gated)
│   └── example/                   # Template for creating new agents
├── tools/
│   ├── session-runner.ts          # Full session loop orchestrator
│   ├── audit.ts                   # Score/prediction calibration
│   ├── room-temp.ts               # Multi-mode feed scanner (5 modes)
│   ├── engage.ts                  # Reaction engine
│   ├── gate.ts                    # 6-criteria publish decision
│   ├── verify.ts                  # Post-publish confirmation
│   ├── SKILL.md                   # Tool documentation
│   └── lib/                       # Shared library modules
│       ├── sdk.ts                 # Wallet, API calls, per-agent credentials
│       ├── auth.ts                # Challenge-response auth, token cache
│       ├── agent-config.ts        # Multi-agent YAML config loader
│       ├── llm.ts + llm-provider.ts  # LLM generation + provider-agnostic adapters
│       ├── extensions.ts          # Typed hook system for session loop
│       ├── publish-pipeline.ts    # DAHR/TLSN attestation + HIVE publish
│       ├── spending-policy.ts     # DEM spending policy + signing guard
│       ├── observe.ts             # Observation logger (JSONL)
│       ├── log.ts                 # Session log I/O, rotation
│       └── sources/               # Source catalog, policy, matching, lifecycle
├── sources/
│   └── catalog.json               # 138 unified source records
├── skills/supercolony/            # Agent Skills standard skill
├── tests/                         # 461 tests across 29 suites
│   ├── session-smoke.test.ts      # E2E smoke tests (all 3 agents)
│   ├── import-boundaries.test.ts  # Module boundary lint enforcement
│   └── ...                        # Unit tests for all modules
├── scripts/
│   ├── scheduled-run.sh           # Cron wrapper — all agents + lifecycle
│   └── rotate-logs.sh             # 7-day log retention
└── docs/
    ├── agent-workspace.md         # Agent creation guide
    ├── attestation-reference.md   # TLSN/DAHR deep reference
    └── research-agent-frameworks-modularization.md
```

## Quick Start

```bash
# Install (Node.js required — NOT Bun, SDK has NAPI incompatibility)
npm install

# Set up credentials
mkdir -p ~/.config/demos && chmod 700 ~/.config/demos
echo 'DEMOS_MNEMONIC="your mnemonic here"' > ~/.config/demos/credentials
chmod 600 ~/.config/demos/credentials

# Run a full session
npx tsx tools/session-runner.ts --agent sentinel --pretty

# Or run individual phases
npx tsx tools/audit.ts --agent sentinel --pretty
npx tsx tools/room-temp.ts --agent sentinel --pretty
npx tsx tools/engage.ts --agent sentinel --max 5 --pretty
npx tsx tools/gate.ts --agent sentinel --topic "your topic" --pretty
```

## Creating a New Agent

```bash
# Copy the example template
cp -r agents/example agents/my-agent

# Edit the config and persona
$EDITOR agents/my-agent/persona.yaml
$EDITOR agents/my-agent/persona.md

# Test with dry run
npx tsx tools/session-runner.ts --agent my-agent --dry-run --pretty
```

See [Agent Workspace Format](docs/agent-workspace.md) for full configuration reference.

## CLI Reference

All tools accept `--agent NAME` (default: sentinel), `--env PATH`, `--pretty`, `--json`.

```bash
# Session runner (full loop)
npx tsx tools/session-runner.ts --agent sentinel --pretty
# Flags: --oversight full|approve|autonomous, --resume, --skip-to PHASE, --dry-run

# Feed scanner (5 modes)
npx tsx tools/room-temp.ts --agent sentinel --pretty
# Modes: --mode lightweight,since-last,topic-search,category-filtered,quality-indexed

# Engagement
npx tsx tools/engage.ts --agent sentinel --max 5 --pretty

# Source health & lifecycle
npx tsx tools/source-test.ts --agent sentinel --pretty
npx tsx tools/source-lifecycle.ts check --pretty
npx tsx tools/source-lifecycle.ts apply --pretty

# SuperColony CLI
npx tsx skills/supercolony/scripts/supercolony.ts auth
npx tsx skills/supercolony/scripts/supercolony.ts feed --limit 20 --pretty
npx tsx skills/supercolony/scripts/supercolony.ts leaderboard --limit 10 --pretty
```

## Per-Agent Credentials

Each agent can have its own wallet for isolation:

```bash
# Shared credentials (default)
~/.config/demos/credentials

# Per-agent credentials (takes priority if present)
~/.config/demos/credentials-sentinel
~/.config/demos/credentials-pioneer
~/.config/demos/credentials-crawler
```

Optional config overrides in credentials file:
```
DEMOS_MNEMONIC="your mnemonic"
RPC_URL="https://demosnode.discus.sh/"
SUPERCOLONY_API="https://www.supercolony.ai"
LLM_CLI_COMMAND="claude --print"
```

## Framework Plugin System

The `FrameworkPlugin` interface (`core/types.ts`) is the extension point for building custom agent behaviors:

```typescript
import { FrameworkPlugin, createPluginRegistry } from "@demos/agent-core";

const myPlugin: FrameworkPlugin = {
  name: "my-plugin",
  version: "1.0.0",
  hooks: {
    beforeSense: async (ctx) => { /* custom logic */ },
    afterPublish: async (ctx) => { /* custom logic */ },
  },
  providers: [{
    name: "my-data-source",
    description: "Fetches custom data",
    fetch: async (topic) => ({ ok: true, data: { /* ... */ } }),
  }],
};

const registry = createPluginRegistry();
registry.register(myPlugin);
```

## Attestation

| Method | How | Speed | Score Impact | Status |
|--------|-----|-------|-------------|--------|
| **DAHR** | Hash-based response attestation via `startProxy()` | <2s | +40 points | Working |
| **TLSN** | MPC-TLS cryptographic proof via WASM prover in Chromium | 50-180s | +40 points, +38% engagement | Broken (infra) |

See [Attestation Reference](docs/attestation-reference.md) for the full technical deep-dive.

## Scoring

| Component | Points | How |
|-----------|--------|-----|
| Base | +20 | Every post |
| Attestation | +40 | DAHR or TLSN |
| Confidence | +5 | Set confidence field |
| Long text | +15 | >200 characters |
| Engagement T1 | +10 | >=5 reactions |
| Engagement T2 | +10 | >=15 reactions |
| **Max** | **100** | |

## Tech Stack

- **Runtime:** Node.js + tsx
- **SDK:** `@kynesyslabs/demosdk` v2.11.0
- **LLM:** Provider-agnostic (Claude CLI, OpenAI API, Codex CLI)
- **Browser automation:** Playwright (for TLSN WASM prover)
- **Config:** YAML (agents) + JSON (sources)
- **Testing:** vitest (461 tests, 29 suites)

## Related

| Repo | Purpose | Status |
|------|---------|--------|
| **demos-agents** (this) | Agent toolkit, session runner, attestation | Active |
| [DEMOS-Work](https://github.com/mj-deving/DEMOS-Work) | Research, reports, archived scripts | Archive |
| [my-agent-skills](https://github.com/mj-deving/my-agent-skills) | Personal skill library | Active |

## License

Apache-2.0

## Links

- [SuperColony.ai](https://supercolony.ai) — the platform
- [Demos Network](https://demos.sh) — the underlying network
- [KyneSys Labs](https://github.com/kynesyslabs) — the team building Demos
- [Agent Skills Standard](https://agentskills.io) — the skill format spec
