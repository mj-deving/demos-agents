---
summary: "Forward plan: agent templates, OpenClaw skills, fresh use cases. Living doc — update each session."
read_when: ["next steps", "agent templates", "openclaw", "use cases", "what's next", "fresh agent", "template"]
---

# Next Steps: Agent Templates & Fresh Use Cases

> Living doc. Updated each session. Tracks the path from toolkit primitives to reusable agent templates.

## Vision

The toolkit (`createToolkit()` with 15 domain primitives) is template-agnostic plumbing. The next step is building **agent templates** — self-contained packages that any developer can instantiate to create a SuperColony agent for a specific use case.

Architecture:
```
Agent Harness (OpenClaw / CLI)     ← Owns the loop, config, schedule
  └─ Strategy Layer (YAML rules)   ← Per-template, lightweight, swappable
      └─ Toolkit Primitives        ← Universal, shared across all templates
```

## Agent Templates (from supercolony.ai/docs taxonomy)

| # | Template | Primary Categories | Key Primitives | Strategy Focus |
|---|----------|-------------------|----------------|----------------|
| 1 | **Market Intelligence** | ANALYSIS, PREDICTION, VOTE | oracle, prices, predictions, ballot, feed | Price analysis, divergence detection, attestation-grounded signals |
| 2 | **Security Sentinel** | ALERT, OBSERVATION | feed.search, intelligence.getSignals, publish | CVE monitoring, threat pattern detection, API outage alerts |
| 3 | **Research Analyst** | ANALYSIS, OBSERVATION | feed, oracle, DAHR attestation, publish | Paper/dataset synthesis, evidence-grounded analysis |
| 4 | **Code Monitor** | ALERT, ANALYSIS | feed.search, source fetch (GitHub/HN), publish | Dependency issues, bug patterns, regression alerts |
| 5 | **Infra Watchdog** | ALERT, OBSERVATION | health.check, external sources, publish | Uptime monitoring, degraded service detection |
| 6 | **Creative Curator** | OBSERVATION, FEED | feed.getRecent, agents.list, react, tip | Discover high-quality content, curate, engage |

## Template Format (proposed)

Each template = a directory with:
```
templates/market-intelligence/
  ├── template.yaml        # Template metadata (name, description, categories, required primitives)
  ├── strategy.yaml        # Strategy rules (what to observe, when to act, thresholds)
  ├── sources.yaml         # Data sources to watch (APIs, RSS, on-chain)
  ├── harness-config.yaml  # Loop config (schedule, oversight, rate limits, budget)
  └── README.md            # Human-readable guide
```

## OpenClaw Skill Definitions (research needed)

- [ ] Research OpenClaw skill format and constraints
- [ ] Map each agent template to an OpenClaw skill definition
- [ ] Determine if OpenClaw supports the YAML strategy + harness config pattern
- [ ] Prototype one skill (Market Intelligence) and validate

## ColonyPublisher Alignment (research needed)

The official SuperColony docs show a `ColonyPublisher` class (`import { ColonyPublisher } from "supercolony/publisher"`) with methods like `hive.publish()`, `hive.getFeed()`, `hive.react()`, `hive.tip()`, etc. Our toolkit primitives map 1:1 to these methods.

- [ ] Investigate: is `supercolony/publisher` a real published package or docs-only?
- [ ] If real: should our toolkit expose a `ColonyPublisher`-compatible interface?
- [ ] If docs-only: our `createToolkit()` IS the reference implementation

## Framework Integration Opportunities

SuperColony has official packages for:
- **MCP Server** — `npx -y supercolony-mcp` (11 tools)
- **Eliza Plugin** — `npm install eliza-plugin-supercolony` (8 actions)
- **LangChain/LangGraph** — `pip install langchain-supercolony` (8 tools)

Our toolkit could serve as the backbone for any of these — or as a standalone alternative that's more powerful (15 domains vs their 8-11 tools).

## Execution Order

### Phase 10a: Template Infrastructure
1. Design template YAML schema (strategy + harness + sources)
2. Create `templates/` directory structure
3. Extract sentinel's current strategy YAML as the first template (Market Intelligence)
4. Validate: can a fresh agent be created from just the template + toolkit?

### Phase 10b: First Fresh Agent
1. Pick a second template (Security Sentinel or Research Analyst)
2. Write its strategy YAML from scratch
3. Write its source config
4. Run it independently — verify it publishes, reacts, uses signals

### Phase 10c: OpenClaw Skills
1. Research OpenClaw format
2. Package each template as an OpenClaw skill
3. Test installation and execution via OpenClaw

### Phase 10d: Documentation & Distribution
1. Agent creation guide (how to use templates)
2. Strategy authoring guide (how to write rules)
3. Publish toolkit as npm package (if scope warrants)

---

## Status

- [x] Toolkit primitives complete (Phase 9, 2026-04-06)
- [x] SuperColony agent taxonomy documented (6 use cases from docs)
- [ ] Template format designed
- [ ] First template extracted (Market Intelligence from sentinel)
- [ ] OpenClaw research
- [ ] First fresh agent created
