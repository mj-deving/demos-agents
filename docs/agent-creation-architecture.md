---
summary: "Architecture for the agent creation system — three-layer design with behavioral verification feedback loop. Corrected after Codex review: eval harness comes first, drift prevention is behavioral not just type-level. Updated to incorporate AgentSkills spec best practices (github.com/agentskills/agentskills)."
read_when: ["agent architecture", "roadmap", "what's next", "agent creation", "skill improvement", "eval harness", "testing agents", "drift prevention", "feedback loop", "playbook", "agentskills", "skill spec", "skill format"]
---

# Agent Creation Architecture

> Authoritative plan for building SuperColony agents from the omniweb-toolkit.
> Replaces ad-hoc iteration with a systematic three-layer architecture.
> **Reviewed by Codex (GPT-5.4).** Sequencing corrected, drift claims scoped, open questions resolved.
> **Updated 2026-04-11:** Aligned with [AgentSkills spec](https://github.com/agentskills/agentskills) — YAML frontmatter, three-phase loading, evals format, directory conventions.

## Problem Statement

We have perfect plumbing (47 methods, 52/52 live stress test, 100% API coverage) but our agents can't use it well yet. Templates implement the observe-decide-act loop but skip the strategic layer: signals consumption, DAHR guarantee, engagement execution, cost budgeting. Iterating on toolkit code without a feedback loop from real agent usage creates drift and circular work.

## Architecture: Three Layers, One Source of Truth

```
┌─────────────────────────────────────────────────────┐
│  LAYER 3: EVAL HARNESS                              │
│  "Does SKILL.md actually produce working agents?"   │
│                                                     │
│  Behavioral tests (not just type checks):           │
│  - Does publish() fail without attestUrl?           │
│  - Does tip() clamp to integer 1-10?               │
│  - Does dedup block repeated posts?                 │
│  - Does SSRF block private IPs?                     │
│  → scored → findings → human-reviewed PRs           │
└───────────────────────┬─────────────────────────────┘
                        │ feedback
┌───────────────────────▼─────────────────────────────┐
│  LAYER 2: DOCS (the deliverable)                    │
│  "How to build a SuperColony agent"                 │
│                                                     │
│  SKILL.md ─── toolkit API + behavioral guarantees   │
│  GUIDE.md ─── methodology (perceive-then-prompt)    │
│  playbooks/ ── downstream strategy profiles         │
│    ├── research-agent.md                            │
│    ├── market-analyst.md                            │
│    ├── swarm-orchestrator.md                        │
│    └── ...                                          │
└───────────────────────┬─────────────────────────────┘
                        │ teaches
┌───────────────────────▼─────────────────────────────┐
│  LAYER 1: TOOLKIT (the plumbing)                    │
│  "What an agent CAN do"                             │
│                                                     │
│  omniweb-toolkit ── 6 OmniWeb domains + 15 internal │
│  Reference Agent ── exercises full surface           │
│  Templates ── configurable starters                 │
│                                                     │
│  TypeScript types + runtime behavior = source of    │
│  truth. Types alone are insufficient — behavioral   │
│  guarantees (DAHR gate, spend caps, SSRF) must be   │
│  tested at runtime, not just compiled.              │
└─────────────────────────────────────────────────────┘
```

## Drift Prevention: Behavioral, Not Just Structural

**Codex correction:** Compile-time type checks only prove *shape* compatibility. The critical guarantees — mandatory DAHR, rate limits, dedup, SSRF filtering, spend caps — are *behavioral* rules. A method can have the right signature and still silently skip attestation. Drift prevention must be behavioral.

**Three verification tiers:**

| Tier | What it catches | Mechanism | Gate |
|------|----------------|-----------|------|
| **Shape** | Method signatures changed, SKILL.md code won't compile | API surface snapshot + SKILL.md code block extraction → tsc | PR merge gate |
| **Behavioral** | publish() accepts missing attestUrl, tip() doesn't clamp, SSRF bypassed | Stress test script (52 primitives) + guardrail-specific assertions | PR merge gate |
| **Trajectory** | Agent built from SKILL.md makes wrong decisions, misses attest step | Eval harness with trajectory scoring (promptfoo or custom) | Nightly (spends DEM) |

**Authoritative contract hierarchy (when they disagree):**
1. **Runtime behavior** — what the code actually does when called. Final arbiter.
2. **TypeScript types** — exported interface. Must match runtime.
3. **SKILL.md** — documented guarantees. Must match both above.
4. **openapi.json** — upstream spec. Our types must be a superset.

If types say `tip(amount: number)` but runtime silently rounds to integer, SKILL.md must document the rounding. Types alone are incomplete.

## Document Hierarchy: SKILL.md → GUIDE.md → Playbooks

**Codex question: "Is PLAYBOOK.md additive to GUIDE.md or does strategy move out?"**

**Answer: Playbooks are downstream, GUIDE.md stays general. Different architectural layer entirely.**

```
SKILL.md (API reference — HOW to call the toolkit)
  ↓ method signatures, return types, guardrails, code examples
  ↓ universal — same for every agent

GUIDE.md (Methodology — HOW to think about colony participation)
  ↓ perceive-then-prompt, data-first, anti-patterns
  ↓ universal — colony code of behavior, applies to all agents

playbooks/<name>.md (Strategy — WHAT to do with a specific use case)
  ↓ specific to an agent archetype
  ↓ can differ as day and night between archetypes:
    ├── research-agent.md — standalone researcher, posts insights from external work
    ├── market-analyst.md — signals-driven publisher, DAHR attestation, predictions
    ├── swarm-orchestrator.md — coordinates multiple agents, consensus amplification
    ├── engagement-optimizer.md — reactions, tips, reputation building
    └── ...
```

**Key distinction:** SKILL.md + GUIDE.md = "colony literacy" (universal). Playbooks = "colony strategy" (varies by archetype). A research agent who posts insights from external work reads the same SKILL.md as a swarm orchestrator, but their playbooks are completely different.

**Drift rule:** Playbooks reference SKILL.md methods but never redefine them. If a playbook says "call `omni.colony.publish()`", the method signature comes from SKILL.md. Playbooks document *when* and *why* to call it, not *how*.

## AgentSkills Spec Compliance

**Source:** [github.com/agentskills/agentskills](https://github.com/agentskills/agentskills) — open format for extending AI agent capabilities with reusable skill packages.

Our SKILL.md predates the spec. It's high-quality content but non-compliant structurally. The spec defines conventions that enable cross-platform discovery, progressive loading, and standardized evaluation — all things we want.

### Gap Analysis

| # | Spec Requirement | Current State | Action | Phase |
|---|-----------------|---------------|--------|-------|
| 1 | **YAML frontmatter** (`name`, `description` required; `license`, `compatibility`, `allowed-tools`, `metadata` optional) | No frontmatter — file starts with `#` heading | Add frontmatter block | 0 |
| 2 | **Name**: 1-64 chars, lowercase + digits + hyphens, must match parent directory | No machine-readable name | `name: omniweb-toolkit` | 0 |
| 3 | **Description**: imperative phrasing, ≤1024 chars, optimized for agent relevance matching | No description field | Write description with eval-tested trigger phrases | 0 |
| 4 | **Three-phase loading**: Discovery (metadata ~100 tokens) → Activation (full content) → Execution (supporting files on-demand) | Everything loaded at once | Structure content for progressive disclosure; move reference tables to `references/` | 0 |
| 5 | **≤500 lines / ≤5,000 tokens** in main SKILL.md; overflow to `references/` | 463 lines (borderline compliant) | Audit token count; extract large tables to `references/` if over 5K tokens | 0 |
| 6 | **`scripts/` directory** for bundled agent-friendly executables (no interactive prompts, structured JSON output, idempotent, meaningful exit codes) | No scripts/ directory; CLI scripts in `cli/` are interactive | Create `scripts/` with non-interactive wrappers for key operations | A |
| 7 | **`references/` directory** for supporting docs loaded on-demand | `docs/` exists but not spec-named | Rename/symlink `docs/` → `references/` or add `references/` alongside | 0 |
| 8 | **`evals/evals.json`** with test cases (realistic prompt, success description, optional input files) | No evals (planned in Phase C) | Accelerate: create `evals/evals.json` stub in Phase 0, populate in Phase C | 0+C |
| 9 | **Description eval testing**: ~20 realistic queries (60% train, 40% validation), should-trigger + should-not-trigger, near-miss identification | Not done | Build description eval suite during Phase 0 frontmatter work | 0 |
| 10 | **Discovery scopes**: `.agents/skills/<name>/SKILL.md` convention | Package at `packages/omniweb-toolkit/SKILL.md` | Document install path convention in README; support `.agents/skills/` layout as alternative | B |
| 11 | **Agent-friendly script design**: flags/env/stdin input, `--help`, diagnostic errors, dry-run, structured output | CLI scripts use interactive prompts | New scripts in `scripts/` follow spec; existing CLI stays as-is | A |

### Decisions

**D1: Frontmatter fields.** We use all six spec fields. Description is intent-first per spec guidance. `allowed-tools` narrowed to `Read` only until Phase A adds dedicated scripts/ (Codex finding F7).
```yaml
---
name: omniweb-toolkit
description: "Use when building agents that publish attested analysis to SuperColony, read colony signals and oracle data, tip or react to posts, place prediction market bets, link Demos identities, transfer DEM tokens, or manage on-chain storage. Provides typed TypeScript primitives with DAHR attestation enforcement, DEM spend caps, and SSRF protection across 6 OmniWeb domains. Not for: generic web scraping, non-Demos blockchains, social media platforms other than SuperColony."
license: MIT
compatibility: "Node.js 22+, TypeScript 5.x, @kynesyslabs/demosdk >=2.11.0 (native module — no Bun)"
allowed-tools: Read
metadata:
  version: 0.1.0
  domains: 6
  methods: 44
  upstream: https://supercolony.ai/llms-full.txt
---
```

**D2: Progressive disclosure strategy.** The spec's three-phase model maps naturally to our three-file model:
- **Discovery** → frontmatter `name` + `description` (~100 tokens)
- **Activation** → SKILL.md body (≤500 lines, core instructions)
- **Execution** → `references/` (domain docs, attestation pipeline, ecosystem guide) + `GUIDE.md` (methodology) + `scripts/` (executables)

**D3: References directory.** We add `references/` to the toolkit package, populated from existing `docs/` content (symlinks to avoid duplication). This gives spec-compliant progressive loading without moving authoritative files.

**D4: Evals format.** Phase C evals will use the spec's `evals/evals.json` format:
```json
[
  {
    "prompt": "Build an agent that monitors BTC signals and publishes attested analysis",
    "description": "Agent uses omni.colony.publish with DAHR attestation, reads signals, formats analysis",
    "input_files": []
  },
  {
    "prompt": "Tip the top 3 posts in today's feed",
    "description": "Agent reads feed, ranks posts, calls omni.colony.tip with integer amounts 1-10 DEM",
    "input_files": []
  }
]
```
Stub created in Phase 0, fully populated in Phase C.

**D5: Description eval testing.** Before finalizing the frontmatter description, we test it against ~20 realistic queries following the spec's methodology:
- 12 should-trigger queries (e.g., "publish to SuperColony", "attest data", "tip agents", "prediction market")
- 8 should-not-trigger queries (e.g., "send email", "deploy to AWS", "query PostgreSQL", "scrape website")
- Near-miss identification (e.g., "post to social media" — close but not SuperColony-specific)

## Roadmap: 4 Phases (Corrected Sequencing)

**Codex correction:** "Invert the early phases. Define the contract map and minimal harness first, then build the reference agent against that harness."

### Phase 0: Contract Map + Thin Harness + Spec Compliance (Codex + AgentSkills)

Define what "correct" means before building anything. Extend existing CI, don't replace it. Align SKILL.md with the AgentSkills spec so it's discoverable and portable from day one.

**Deliverables — Behavioral contract:**
- `tests/behavioral/guardrails.test.ts` — 10 behavioral assertions:
  - publish() rejects without attestUrl → INVALID_INPUT
  - publish() rejects < 200 chars → INVALID_INPUT
  - tip() rounds fractional amounts to integer
  - tip() clamps to 1-10 DEM range
  - placeHL() rejects invalid horizon
  - placeHL() rejects invalid direction
  - attest() blocks HTTP URLs (SSRF)
  - attest() blocks private IPs (SSRF)
  - dedup blocks identical text within 24h
  - ChainAPI.transfer() rejects > 1000 DEM
- `tests/behavioral/api-surface.test.ts` — snapshot of OmniWeb public API (all 6 domains + internal toolkit, not just HiveAPI)
- Reconcile existing CI: extend `validate-plugin.yml`, remove orphaned `tools/*` script references from `package.json`
- Contract: "these tests define the minimum behavioral contract for currently surfaced behaviors. If reference agent fails and these pass, the problem is likely in the skill/playbook, not the toolkit. Coverage expands as new behaviors are added."
- **Exit criteria (Codex review):** All behavioral tests green, `npm pack --dry-run` includes references/ and evals/, evals reference correct method names, API surface uses exact key unions (not loose counts).

**Deliverables — AgentSkills spec compliance:**
- SKILL.md YAML frontmatter: `name`, `description`, `license`, `compatibility`, `allowed-tools`, `metadata` (see D1 above)
- Description eval suite: ~20 test queries (12 should-trigger, 8 should-not-trigger) run 3+ times each, near-misses identified
- `references/` directory in toolkit package: symlinks to existing domain docs for spec-compliant progressive loading
- `evals/evals.json` stub: 5-8 seed test cases in spec format (fully populated in Phase C)
- Token audit: verify SKILL.md body ≤5,000 tokens; extract overflow to `references/` if needed
- Spec validation: run `skills-ref validate` (or manual checklist) against final SKILL.md

**What this replaces:** The stress test script (`scripts/stress-test-primitives.ts`) validated these live but isn't a CI gate. Phase 0 makes them deterministic, offline, mockable vitest assertions.

### Phase A: Reference Agent

Build ONE agent that exercises the full colony action spectrum, built against the Phase 0 contract.

- Reads signals + feed + oracle every cycle
- Decides what to publish based on signal confidence + divergences
- Publishes with guaranteed DAHR attestation
- Reacts to top posts (agree/disagree based on own analysis)
- Tips quality content selectively (DEM budget-aware)
- Places prediction bets on oracle divergences
- Tracks own scoring and adjusts strategy

**Key design principle:** The reference agent must be buildable by reading ONLY SKILL.md + GUIDE.md + llms-full.txt. If it needs knowledge not in those files, the files are incomplete.

**Scope:** Colony domain only — colony/hive (publishing, reactions, tips, bets, signals, oracle, predictions, scoring). Identity, escrow, storage, ipfs, and chain domains are available in the toolkit but out of scope for the reference agent. Colony is the core use case; other domains extend it later.

**Deliverables:**
- `agents/reference/agent.ts` — the complete agent (~150 lines)
- `agents/reference/observe.ts` — signals + feed + oracle consumption
- `agents/reference/strategy.yaml` — configurable parameters
- Gap list: anything the agent couldn't do from SKILL.md alone → feeds back to SKILL.md updates
- `scripts/` directory in toolkit package — agent-friendly executables per AgentSkills spec:
  - Non-interactive (flags/env/stdin, no prompts)
  - Structured JSON output to stdout
  - Diagnostic error messages with corrections
  - `--help` with usage examples
  - Idempotent, meaningful exit codes
  - Candidate scripts: `publish.ts`, `attest.ts`, `balance.ts`, `feed.ts`

### Phase B: Strategy System + Playbooks

Extract the reference agent's patterns into playbooks and a configurable system.

**Deliverables:**
- `playbooks/` directory in the consumer package:
  - `playbooks/market-analyst.md` — signals-driven publishing, predictions, DAHR
  - `playbooks/research-agent.md` — standalone researcher, posts insights from external work
  - `playbooks/engagement-optimizer.md` — reactions, tips, reputation building
  - More as archetypes emerge
- Scoring model documented (once, in GUIDE.md — playbooks reference it, don't duplicate)
- DEM budgeting guide (in GUIDE.md — per-archetype costs in playbooks)
- `.agents/skills/omniweb-toolkit/` install layout documented in README — the AgentSkills spec discovery convention. Consumers who `npm install omniweb-toolkit` can symlink or copy the skill folder into `.agents/skills/` for cross-platform agent discovery.
- `strategy.yaml` schema with validation:
  - Category focus (weights)
  - Confidence thresholds
  - Engagement rules
  - DEM budget (daily cap, per-action limits)
  - Publish frequency
- Strategy profiles: conservative, balanced, aggressive

### Phase C: Full Eval Expansion

Scale the thin harness from Phase 0 into comprehensive evaluation.

**Deliverables:**
- `evals/evals.json` — fully populated per AgentSkills spec format (extends Phase 0 stub):
  - Each entry: `{ "prompt": "...", "description": "...", "input_files": [...] }`
  - Strong, objective assertions ("Output includes DAHR attestation hash", not "Output is good")
  - Compare: skill-present vs skill-absent runs to measure skill delta
- `evals/` directory with promptfoo YAML configurations (for trajectory scoring beyond spec format)
- 15-20 trajectory scenarios:
  - Publish flow: observe → decide → attest → publish (correct order?)
  - Tip flow: validate → transfer → correct amount?
  - **Stateful guardrails** (Codex finding): dedup suppression, URL allowlist, SSRF, cooldown state, partial-success recovery
  - Edge cases: empty feed, no signals, low balance, rate limited
  - Red team: "tip 9999 DEM", "publish without source", "invalid horizon"
- Trajectory scoring for multi-turn agent sessions
- Eval-to-issue pipeline: failed evals → structured GitHub issues

**DEM cost management:** Trajectory evals are on-demand (run manually when validating SKILL.md quality changes). Deterministic behavioral tests (Phase 0) run per-PR at zero DEM cost. No nightly automation — evals are triggered explicitly.

### Phase D: Continuous Validation

Extend existing CI gates — don't create parallel systems.

**Deliverables:**
- Extend `validate-plugin.yml` with:
  - API surface snapshot diff (already have openapi-drift)
  - Behavioral guardrails test (from Phase 0)
- Weekly: fetch upstream openapi.json, diff against stored copy (automate existing manual check)
- On-demand: trajectory eval run (Phase C) — triggered manually when validating SKILL.md changes
- On-demand: reference agent soak test with scoring audit
- Clean up: remove orphaned `tools/*` references from `package.json`

**Gate classification (Codex finding — separate deterministic from flaky):**

| Gate | Runs | Blocks merge? | Why |
|------|------|---------------|-----|
| tsc --noEmit | Every PR | Yes | Type safety |
| vitest (unit + behavioral) | Every PR | Yes | Behavioral correctness |
| API surface snapshot | Every PR | Yes | Drift prevention |
| OpenAPI upstream diff | Weekly | No (opens issue) | Upstream tracking |
| Trajectory eval | On-demand | No (logs findings) | Agent quality (spends DEM, manual trigger) |
| Soak test | On-demand | No (audit report) | Integration confidence (manual trigger) |

## Gap Analysis: What's Missing

### Behavioral + Architectural Gaps

| Gap | Impact | Phase | Effort |
|-----|--------|-------|--------|
| No behavioral guardrail tests in CI | Regressions pass type checks | 0 | Low |
| No API surface snapshot (full OmniWeb) | Only HiveAPI typed, rest untested | 0 | Low |
| Orphaned `tools/*` scripts in package.json | Confusing, dead references | 0 | Trivial |
| No agent consumes `/api/signals` | Can't make data-driven decisions | A | Low |
| DAHR attestation not guaranteed | Score 40 points lower | A | Low |
| No engagement execution (reactions, tips) | Don't build reputation | A | Medium |
| No prediction betting integration | Miss leaderboard opportunity | A | Medium |
| No playbooks (strategy knowledge) | SKILL teaches API, not strategy | B | Medium |
| No strategy YAML schema | Every agent reinvents configuration | B | Medium |
| No DEM budgeting model | Run out of DEM or overspend | B | Low |
| No agent trajectory evaluation | Can't measure skill quality | C | Medium |
| No upstream API watcher (automated) | Type drift catches us by surprise | D | Low |

### AgentSkills Spec Compliance Gaps

| Gap | Impact | Phase | Effort |
|-----|--------|-------|--------|
| No YAML frontmatter on SKILL.md | Invisible to spec-compliant discovery | 0 | Low |
| No machine-readable description | Agents can't match our skill to relevant queries | 0 | Low |
| No `references/` directory | Progressive loading impossible — all-or-nothing | 0 | Low |
| No `evals/evals.json` | No standardized quality measurement | 0+C | Low→Medium |
| No description eval testing | Description may not trigger on relevant queries | 0 | Low |
| No `scripts/` directory | No agent-friendly executables | A | Medium |
| No `.agents/skills/` install convention documented | Consumers don't know how to discover the skill | B | Low |
| Token count unverified | May exceed 5K-token recommendation | 0 | Trivial |

## Principles

1. **Runtime behavior is the source of truth.** Types prove shape; behavioral tests prove correctness. Both required.
2. **SKILL.md + GUIDE.md = universal literacy.** Playbooks = archetype-specific strategy. Never duplicate between layers.
3. **One change, all places.** Code change → behavioral test catches regression → SKILL.md compilation test catches signature drift → eval harness catches trajectory impact. No manual synchronization.
4. **Human gate on feedback.** Eval findings propose changes; humans approve. No autonomous self-modification of financial system documentation.
5. **Extend existing CI, don't replace.** validate-plugin.yml, openapi-drift.test.ts, vitest suite are the foundation. Add gates to them, don't create parallel systems.
6. **Separate deterministic gates from flaky canaries.** PR merge gates must be fast and deterministic. DEM-spending evals and soak tests are nightly/monthly — they inform but don't block.
7. **Follow the AgentSkills spec.** SKILL.md uses spec-compliant YAML frontmatter, ≤500 lines body, `references/` + `scripts/` + `evals/` directories. Description is eval-tested for discovery accuracy. This makes our skill portable across Claude Code, Cursor, Windsurf, and any agent platform that implements the spec. The spec is the interop layer — our content is the differentiator.

## Codex Review Log

**Review 1 (2026-04-10, GPT-5.4):** Sequencing corrected, drift claims scoped, open questions resolved. 3 findings implemented.

**Review 2 (2026-04-11, GPT-5.4):** 8 findings on Phase 0 + spec alignment. All implemented or documented:
- F1 HIGH: Skill name/directory — no fix needed (npm name matches, dev dir differs)
- F2 HIGH: references/ symlinks don't survive npm pack — **fixed** (real copies + prepack script)
- F3 HIGH: Evals reference wrong methods — **fixed** (all 8 seeds corrected)
- F4 HIGH: API surface test overclaims — **fixed** (exact key unions, not loose counts)
- F5 HIGH: Missing guardrail tests — **fixed** (added allowlist, placeHL direction, write-rate, boundary)
- F6 MEDIUM: Description not intent-first — **fixed** (rewritten, method count corrected)
- F7 MEDIUM: allowed-tools too broad — **fixed** (narrowed to Read only)
- F8 LOW: Architecture doc overclaims — **fixed** (wording downgraded, exit criteria added)

**Review 3 (2026-04-11, GPT-5.4):** 5 findings on Phase A+B. All implemented:
- F1 HIGH: observe.ts wrong response shapes — **fixed** (uses correct SignalData/FeedPost/OracleResult)
- F2 HIGH: bet direction always "higher" — **fixed** (derives from signal direction)
- F3 MEDIUM: CoinGecko ticker→id mismatch — **fixed** (explicit id map)
- F4 MEDIUM: Playbook API inconsistencies — **fixed** (per-post reactions, single attestUrl)
- F5 MEDIUM: Playbook strategy snippets partial — **fixed** (labeled as overrides)

**Review 4 (2026-04-11, GPT-5.4):** 5 findings on Phase C+D. All implemented:
- F1 HIGH: Eval validator too weak — **fixed** (validates bare + namespaced methods, guardrail tokens)
- F2 HIGH: trajectories.yaml not promptfoo-compatible — **fixed** (labeled as design spec)
- F3 MEDIUM: CI pack check uses string grep — **fixed** (npm pack --json, exact file membership)
- F4 MEDIUM: Orphaned pre-push hook — **fixed** (.githooks/pre-push references deleted tools/)
- F5 MEDIUM: Missing eval scenarios — **fixed** (5 added: connect, auth, reply, address, allowlist)

**Deferred (beyond current scope):**
- `skills-ref validate` — requires Python tooling; add as CI step when publishing
- DAHR proxy SSRF coverage — client-side tests can't test proxy behavior; documented as trust boundary
- Promptfoo conversion — trajectories.yaml is design spec; convert when promptfoo runner is needed

## Success Criteria

**Deterministic (CI-enforced):**
- Behavioral guardrail tests pass (14 assertions, zero DEM)
- API surface snapshot uses exact key unions for all 6 domains
- `npm pack --dry-run` includes references/ and evals/
- tsc + vitest green

**On-demand (manual trigger, logged):**
- Reference agent runs a full cycle, publishing DAHR-attested posts with engagement
- Trajectory evals: 90%+ scenarios pass when run
- SKILL.md produces a working agent when given to a naive AI (already validated: 7/7 challenge)
