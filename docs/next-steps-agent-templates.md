---
summary: "Forward plan: agent templates, OpenClaw skills, fresh use cases. Living doc — update each session."
read_when: ["next steps", "agent templates", "openclaw", "use cases", "what's next", "fresh agent", "template"]
---

# Next Steps: Agent Templates & Fresh Use Cases

> Living doc. Updated each session. Tracks the path from toolkit primitives to reusable agent templates.

## Vision

Agent templates are built **bottom-up from `supercolony-agent-starter`** (official 130-line minimal agent), NOT top-down from our v3-loop. The v3-loop is sentinel's production harness — one specific, advanced instantiation. New agents start simple.

### Three-Layer Stack

```
supercolony-agent-starter (~80 lines)     ← Official baseline pattern (connect, loop, publish)
  + createToolkit() (15 domains)          ← Our typed primitives (API-first, chain fallback, auth)
  + strategy YAML (per template)          ← What to observe, when to act, thresholds
  = Production agent in ~200 lines
```

### Why not v3-loop as base?

The v3-loop has 521 lines of sentinel-specific ceremony — session numbering, extension hooks, audit calibration, quality scoring, subprocess management, proof ingestion, spending policy. A developer building a "Security Alert Agent" needs none of that. They need: connect, read, think, publish, repeat.

The agent-starter provides exactly that loop. Our `createToolkit()` replaces its raw `fetch()` calls with typed, authenticated, fallback-aware methods. Strategy YAML adds the decision layer. Result: a production agent in ~200 lines that's more capable than anything on SuperColony today.

### ColonyPublisher alignment

The `ColonyPublisher` class shown in supercolony.ai/docs is **docs-only** — not published as code anywhere. No npm package, no GitHub repo. The official agent-starter uses raw `@kynesyslabs/demosdk`. Our `createToolkit()` IS the reference implementation of what `ColonyPublisher` was supposed to be. Every documented method maps 1:1 to our toolkit primitives, plus 20+ more.

### What v3-loop becomes

Sentinel's advanced production harness. Keeps its complexity for agents that need session persistence, multi-phase SENSE/ACT/CONFIRM, extension hooks, and proof ingestion. Templates MAY graduate to this level, but they start simple.

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

Each template = a self-contained repo a developer clones. Under 300 lines total.

```
templates/base/                           ← Fork of agent-starter + createToolkit()
  ├── agent.ts                            # ~80 lines: connect, init toolkit, run loop
  ├── strategy.yaml                       # Empty/minimal — use-case template fills this
  ├── .env.example                        # DEMOS_MNEMONIC, COLONY_URL, interval
  ├── package.json                        # deps: @kynesyslabs/demosdk + our toolkit
  └── README.md

templates/market-intelligence/            ← Extends base
  ├── agent.ts                            # Imports base loop, adds market-specific observe()
  ├── strategy.yaml                       # Oracle checks, price divergence, prediction thresholds
  ├── sources.yaml                        # CoinGecko, Binance, DeFiLlama
  └── README.md

templates/security-sentinel/              ← Extends base
  ├── agent.ts                            # CVE monitoring, threat pattern observe()
  ├── strategy.yaml                       # Alert thresholds, severity rules
  ├── sources.yaml                        # NVD, GitHub advisories, HN security
  └── README.md
```

**The base template is the key deliverable.** It wires `createToolkit()` into the agent-starter loop pattern. Each use-case template then only adds its `observe()` function and strategy YAML.

## OpenClaw Skill Definitions (research needed)

- [ ] Research OpenClaw skill format and constraints
- [ ] Map each agent template to an OpenClaw skill definition
- [ ] Determine if OpenClaw supports the YAML strategy + harness config pattern
- [ ] Prototype one skill (Market Intelligence) and validate

## ColonyPublisher Alignment — RESOLVED

**Finding:** `ColonyPublisher` is docs-only. Not published anywhere (no npm, no GitHub). The official `supercolony-agent-starter` uses raw `@kynesyslabs/demosdk`. MCP server and Eliza plugin each reimplement everything independently.

**Decision:** Our `createToolkit()` IS the reference implementation. Future: create a `ColonyPublisher` compat shim wrapping our toolkit for developers who expect the documented API.

- [x] Investigate: docs-only, confirmed 2026-04-06
- [x] Decision: our toolkit is the real implementation
- [ ] Optional: ColonyPublisher compat shim (thin wrapper around createToolkit)

## Framework Integration Opportunities

SuperColony has official packages for:
- **MCP Server** — `npx -y supercolony-mcp` (11 tools)
- **Eliza Plugin** — `npm install eliza-plugin-supercolony` (8 actions)
- **LangChain/LangGraph** — `pip install langchain-supercolony` (8 tools)

Our toolkit could serve as the backbone for any of these — or as a standalone alternative that's more powerful (15 domains vs their 8-11 tools).

## Execution Order

### Phase 10a: Base Template
1. Fork `supercolony-agent-starter` pattern into `templates/base/`
2. Wire `createToolkit()` into the agent loop (replace raw fetch with typed primitives)
3. Add strategy YAML loading (minimal: observe interval, categories, confidence threshold)
4. Validate: `npm start` runs a working agent that reads feed + publishes via toolkit

### Phase 10b: Market Intelligence Template
1. Extend base with market-specific `observe()` — oracle, prices, divergence detection
2. Write strategy YAML: price thresholds, divergence rules, prediction confidence
3. Add source config: CoinGecko, Binance (DAHR-attested), DeFiLlama
4. Run independently — verify it publishes ANALYSIS + PREDICTION posts

### Phase 10c: Second Template (Security or Research)
1. Build from base, different observe() + strategy
2. Validate the template pattern works for a completely different use case
3. Identify what's truly reusable vs what needs per-template customization

### Phase 10d: OpenClaw Skills
1. Research OpenClaw format
2. Package each template as an OpenClaw skill
3. Test installation and execution via OpenClaw

### Phase 10e: Documentation & Distribution
1. Agent creation guide (how to clone + customize a template)
2. Strategy authoring guide (how to write YAML rules)
3. Publish toolkit as npm package
4. Optional: ColonyPublisher compat shim

---

## Status

- [x] Toolkit primitives complete (Phase 9, 2026-04-06)
- [x] SuperColony agent taxonomy documented (6 use cases from docs)
- [x] ColonyPublisher investigated — docs-only, our toolkit is the real implementation
- [x] Architectural direction decided — bottom-up from agent-starter, not top-down from v3-loop
- [ ] Base template (agent-starter + createToolkit())
- [ ] Market Intelligence template
- [ ] Second template (Security or Research)
- [ ] OpenClaw research + skill packaging
- [ ] Documentation + distribution
