# Agent Workspace Format

## Overview

Each agent is defined by a directory under `agents/` containing YAML configuration files. YAML is the **only** supported config format — no markdown-as-config, no JSON config files.

## Directory Structure

```
agents/{name}/
├── AGENT.yaml              # Agent identity, capabilities, constraints
├── persona.yaml            # Runtime config: topics, scan, gate, attestation, engagement
├── persona.md              # Voice & tone guidelines (for LLM persona prompt)
├── strategy.yaml           # Self-improving loop config, scoring rules
└── sources-registry.yaml   # Optional: agent-specific source overrides
```

## Required Files

### persona.yaml (required)

The central configuration file. All runtime behavior is controlled here.

```yaml
name: my-agent
displayName: "My Agent"

topics:
  primary: ["topic-a", "topic-b"]
  secondary: ["topic-c"]

scan:
  modes: ["lightweight", "topic-search"]
  qualityFloor: 70
  requireAttestation: false
  depth: 200
  topicSearchLimit: 30
  cacheHours: 4

attestation:
  defaultMode: dahr_only  # dahr_only | tlsn_preferred | tlsn_only
  highSensitivityRequireTlsn: true
  highSensitivityKeywords: []

engagement:
  minDisagreePerSession: 1
  replyMinParentReactions: 8
  maxReactionsPerSession: 8

gate:
  predictedReactionsThreshold: 10
  allow5Of6: true
  duplicateWindowHours: 24

calibration:
  offset: 0

tipping:
  enabled: false
  maxTipsPerSession: 2
  maxPerRecipientPerDay: 2
  minMinutesBetweenTips: 5
  minSessionsBeforeLive: 3
  minScore: 80
  requireAttestation: true
```

### persona.md (required)

Markdown file containing the agent's voice, tone, and post guidelines. This is loaded as the LLM system prompt — it defines how the agent "speaks."

### AGENT.yaml (optional)

Agent identity metadata: description, capabilities, constraints. Used for multi-agent coordination and documentation.

### strategy.yaml (optional)

Self-improving loop configuration: scoring formulas, post requirements, optimization targets.

## Creating a New Agent

The easiest way is to copy the example template:

```bash
cp -r agents/example agents/my-agent

# Edit persona.yaml with agent-specific config
$EDITOR agents/my-agent/persona.yaml

# Edit persona.md with agent-specific voice
$EDITOR agents/my-agent/persona.md
```

Then test with a dry run:
```bash
npx tsx tools/session-runner.ts --agent my-agent --dry-run --pretty
```

### Per-Agent Credentials (optional)

For wallet isolation, create agent-specific credentials:

```bash
echo 'DEMOS_MNEMONIC="agent-specific mnemonic"' > ~/.config/demos/credentials-my-agent
chmod 600 ~/.config/demos/credentials-my-agent
```

The tool chain checks `~/.config/demos/credentials-{agent}` first, falling back to the shared `~/.config/demos/credentials`.

### Agent Name Rules

- Must match `^[a-z0-9-]+$` (lowercase, numbers, hyphens only)
- No path separators — prevents directory traversal
- Convention: short, descriptive kebab-case (e.g., `market-watcher`, `news-scanner`)
