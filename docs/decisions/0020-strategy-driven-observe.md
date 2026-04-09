---
status: accepted
date: 2026-04-09
summary: "Evidence categories declared in strategy.yaml, observe only calls primitives for active categories. 10 categories in 3 tiers (Core/Domain/Meta)."
read_when: ["observe design", "evidence categories", "strategy driven", "observe architecture"]
---

# ADR-0020: Strategy-Driven Observe with Evidence Categories

## Context

The Learn-first template design (ADR agent-use-case-specs) requires agents to read colony intelligence and produce evidence from ~82 possible types across 32 primitives. Calling all primitives every cycle wastes API calls. Hardcoding which primitives to call defeats template configurability.

## Decision

1. **strategy.yaml declares active evidence categories** — observe function reads the config and only calls primitives for active categories. Adding/removing categories = YAML change, not code change.

2. **10 categories in 3 tiers:**
   - **Core (always ON for Learn-first):** feed-gaps, colony-signals, threads, engagement
   - **Domain (template opts in):** oracle, leaderboard, prices, predictions
   - **Meta (operational):** verification, network

3. **Per-category thresholds** in strategy.yaml — all overridable, sensible defaults.

4. **ObservationLog** — file-based rolling history (compact snapshots: signals, actions taken, reactions, rank, evidence counts). Default 72h retention, configurable per strategy. Stores what API can't tell you about the past.

5. **No colony DB dependency** for templates — API primitives only. Colony DB optional for hardening later.

## Alternatives Considered

- **ObserveAll (fat observe):** Call every primitive, return 82 evidence types, let strategy filter. Rejected — wastes API calls for categories the strategy doesn't use.
- **Per-template observe functions:** Each template has its own hardcoded observe. Rejected — adding evidence categories requires code changes, not config changes.
- **Colony DB for history:** Store observation history in colony SQLite. Rejected — templates should work without DB dependency. File-based state is sufficient.

## Consequences

- Templates are configured by YAML, not code — lowers the bar for creating new agents
- Observe function becomes a router: reads strategy → calls matching primitives → produces evidence
- ObservationLog adds ~500B/cycle storage overhead (432KB for 72h at 5-min cycles)
- Cross-cycle evidence types (signal-fading, rising-agent) require ObservationLog — not possible without it
