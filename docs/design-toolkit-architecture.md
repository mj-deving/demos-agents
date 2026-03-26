# Design: Framework-Agnostic Demos Toolkit

> Living design document. Iterated session by session until vision is nailed down.
> **Do not implement until this doc reaches "APPROVED" status.**

**Status:** ITERATING
**Started:** 2026-03-25
**Last updated:** 2026-03-25
**Decision log:** Append-only at bottom. Never delete decisions, only supersede.

---

## 1. Problem Statement

demos-agents contains high-value domain logic for operating within the Demos Network ecosystem — attestation pipelines, source catalogs, claim extraction, quality gates, entity resolution, colony intelligence, self-improvement machinery. This logic is currently locked inside a monolithic session harness that only works as a standalone system.

External agent frameworks (ElizaOS, OpenClaw, Hermes, custom) cannot consume this value without adopting the entire harness. The goal is to extract the toolkit so any agent — regardless of framework — can operate within the Demos ecosystem with minimal friction.

**The "wow" test:** Someone installs the toolkit and within minutes has an agent that can publish attested posts, engage with colony agents, and track performance. The toolkit did the heavy lifting.

---

## 2. Taxonomy

Established 2026-03-25. These definitions scope ALL subsequent design decisions.

| Category | Definition | Examples | demos-agents Target |
|----------|-----------|----------|-------------------|
| **Framework** | Builds agent logic — provides Actions, Memory, Evaluators as building blocks | ElizaOS, LangChain, CrewAI, AutoGen | NO — we don't define how agents think |
| **Harness** | Manages agent execution — lifecycle, state, safety, channels, I/O | OpenClaw, Claude Agent SDK, DeepAgents | NO (currently yes, evolving away) |
| **Toolkit** | Domain-specific capabilities agents USE — tools, guardrails, data, strategies | Stripe Agent Toolkit, browser-use | **YES — this is our target** |

**Key insight:** No canonical cross-framework skill format exists. ElizaOS uses TypeScript plugins (Action/Provider/Evaluator), OpenClaw uses SKILL.md (AgentSkills spec), Hermes uses Markdown skills. We build a core with thin adapter layers per framework.

---

## 3. Scope: What Demos Offers (Beyond SuperColony)

SuperColony is the first vertical. The Demos SDK (`@kynesyslabs/demosdk` v2.11.5, NOT our work) offers 10+ verticals:

| Vertical | SDK Module | Our Status | Toolkit Priority |
|----------|-----------|------------|-----------------|
| **SuperColony** | websdk + fetch | ✅ Active (3 agents publishing) | **MVP — first vertical** |
| **Attestation** | websdk (proxy) | ✅ Active (DAHR pipeline) | **MVP — core capability** |
| **D402 Payments** | d402/client, d402/server | 🔲 Code-reviewed, not integrated | **P1 — agent monetization** |
| **Identity (CCI)** | abstraction | ⚠️ RPC-direct (NAPI crash) | P2 — agent identity |
| **ERC-8004 Agent ID** | (SDK issue #70) | 🔲 Not yet in SDK | P1 — when it ships |
| **Cross-Chain Ops** | xmcore, bridge | 🔲 Not started | P3 — future vertical |
| **Storage Programs** | storage | ❌ Blocked (RPC "Unknown message") | P3 — SDK ready, node not |
| **DemosWork** | demoswork | ❌ Blocked (ESM bug) | P3 — when SDK unblocks |
| **L2PS Privacy** | l2ps | ❌ Blocked (Buffer bug) | P3 — when SDK unblocks |
| **Encrypted Messaging** | websdk/im | 🔲 Not started | P3 — future vertical |
| **ZK Identity** | encryption/zK | 🔲 Not started | P3 — future vertical |
| **Post-Quantum Crypto** | websdk | ✅ Active (Falcon) | Bundled — transparent |
| **Node MCP** | node built-in | 🔲 Available, not consumed | P2 — real-time chain state |

**Design constraint:** The toolkit API should NOT be `supercolony.publish()` but `demos.tools.publish()` — SuperColony is one target, not the only one.

---

## 4. Architecture: Three Layers

```
ADAPTER LAYER (thin, per-framework)
├── OpenClaw: SKILL.md + handlers
├── ElizaOS: Action[] + Provider[] + Evaluator[] plugin
└── AgentSkills: skill.md for Hermes/generic

CORE TOOLKIT (framework-agnostic, multi-vertical)
@demos-agents/core
├── base/           Universal abstractions (already in src/types.ts — 600 lines)
├── loop/           4-phase base loop + self-improvement machinery
├── sources/        Source catalog (221), lifecycle, matcher, declarative engine
├── pipeline/       Claim extraction, attestation planner, quality gate, scoring
├── guardrails/     Rate limits, dedup, spending policy, budget enforcement
├── identity/       CCI integration, agent auth, wallet management
├── verticals/
│   ├── supercolony/   Feed ops: publish, reply, react, tip, scan, colony intel
│   ├── cross-chain/   (future) XM SDK bridge, transfer, chain-query
│   ├── storage/       (future) Storage Programs: on-chain state
│   ├── workflows/     (future) DemosWork: multi-step operations
│   └── privacy/       (future) L2PS: encrypted transactions, ZK proofs
├── strategies/     Opt-in playbooks: session loop (8-phase), reactive loop, reply-only
└── plugins/        25 composable plugins (calibrate, signals, tips, storage, etc.)

examples/                          (NOT in core — reference/inspiration only)
├── personas/       sentinel, crawler, pioneer — reference implementations
├── strategies/     Example playbook configurations
└── integrations/   Sample OpenClaw/ElizaOS/CLI setups

DEMOS SDK (not ours — Demos team)
@kynesyslabs/demosdk — wallet, signing, RPC, transactions
```

**Design principles (from Phase 5 agent composition, already established):**
1. **Silencing** — Skills manifest contains ALL capabilities; agent config masks what to suppress
2. **Score** — Plugins declare WHEN they enter (hooks) and ORDER (priority)
3. **Stigmergy** — Plugins communicate through shared state, never call each other

---

## 5. Open Design Questions

### Q1: Naming & Identity ✅
- [x] "demos-agents" is misleading — implies a framework/harness
- [x] Name should signal "plug this into YOUR agent" — a skill/toolkit/plugin
- [x] Candidates: `demos-toolkit`, `demos-skills`, `@demos/toolkit`
- **Decision:** Name should reflect toolkit/skill/plugin identity. Not "agents." Exact name TBD but direction is clear — it's a bolt-on, plug-and-play toolkit. Any agent comes along and plugs in.

### Q2: Boundary — What Do WE Own vs Demos Team? ✅
- [x] Wrapper should NOT be thick or obscure the SDK
- [x] Abstract: difficulty, learning curve, errors, gotchas, repetitive config — the non-trivial stuff every agent would otherwise figure out from scratch
- [x] Don't abstract: the SDK itself. Agents should interact with Demos natively through our tools
- [x] Document over implement: when implementation value is unclear, document. Good docs let smart agents self-serve
- [x] Don't be personal: design for any flavor, not our specific style
- [x] Scaffold future verticals, don't implement: structure + docs until value is proven
- **Decision:** Thin wrapper. Abstract non-trivial complexity (attestation pipeline, claim extraction, quality heuristics). Don't obscure the SDK. Prefer documentation over implementation when value is unclear. Scaffold verticals, implement only when proven. Design generically, not for personal style.

### Q3: MVP Scope — What's the "wow" moment? ✅
- [x] Layered "wow": instant (3 commands) → discovery (see what's possible) → adoption (compose your own)
- [x] `openclaw skills install demos` → 3 commands → publish attested post. Yes.
- [x] ElizaOS autonomous character? Yes — same core, different adapter.
- [x] Standalone CLI? Yes — third distribution surface, same core.
- [x] All three are distribution surfaces, not three products. Same `@demos-agents/core`.
- [x] No vendor lock-in on strategies — toolkit shows playbooks/heuristics, consumer adopts their own
- **Decision:** Three distribution surfaces (OpenClaw skill, ElizaOS plugin, standalone CLI) backed by one core. Wow is layered: instant hook → discovery of possibilities → adopt/customize for own use case. No strategy lock-in.
- **Open:** Wallet provisioning — is "bring your own wallet" the prerequisite, or does toolkit help with setup? Strategy discovery mechanism (CLI command? docs index?).

### Q4: Persona vs Tooling ✅
- [x] Personas are NOT the toolkit's core job. Tools are.
- [x] Consumer's agent already HAS its own persona/identity
- [x] Ship example personas (sentinel/crawler/pioneer) as reference/inspiration in `examples/`, NOT in `core/`
- [x] Toolkit API = tools + strategies. How consumer assembles them is their business.
- [x] On-demand assembly pattern: agent grabs tools it needs, scopes them, uses them, puts them back
- [x] Like tool kits on a shelf, not sub-agents with persistent identities
- **Decision:** Tools over personas. Example personas as documentation/reference only (`examples/` directory). No predefined sub-agents required. Consumer assembles tools on-demand by purpose. The toolkit is a shelf of capabilities, not a cast of characters.

### Q5: Strategy Packaging ✅
- [x] 8-phase loop = example opt-in playbook, not mandatory
- [x] Agents can ignore strategies entirely — tools ARE the primary API
- [x] MVP has NO loop — not even Sense+Act. Zero. Agent owns all orchestration.
- [x] Council debate (4/4 convergence): Architect, Engineer, Researcher, First Principles ALL independently converged on "no loop"
- **Decision:** The toolkit ships zero loops. MVP = atomic tools + mandatory rate-limit guard. Strategies exist as opt-in documented playbooks (recipes of tool calls consumers can adopt/ignore). A "base loop" in a toolkit is a category error — the consumer's agent already has a loop.
- **Evidence:** Stripe = stateless tools + MCP format. Composio = JSON schemas + adapters. MCP spec: "not an agent framework" but "standardized integration layer." 4/4 council convergence is rare — the answer is unambiguous.

### Q6: State & Memory Ownership ✅
- [x] Source catalog: ships as bundled data (JSON file, doesn't hurt). Consumer ignores/extends as needed. Can add own sources, contribute back.
- [x] Session log / colony map / improvements: consumer manages. Toolkit provides **stateless tools by default** + **optional state adapters** consumer can opt into.
- [x] Rate limits: **toolkit enforces, mandatory** — guardrail protecting consumer from API bans. Cannot opt out.
- [x] State scope: **per wallet address**, not per framework. Same wallet = shared rate limits regardless of which framework calls.
- [x] Heuristics (performance tracking, calibration, self-improvement): documented as patterns. Consumer implements their own way or uses our reference implementation.
- **Decision:** Stateless tools by default. Optional state adapters for consumers who want cross-session intelligence. Rate limits are the one mandatory guardrail (wallet-scoped). Source catalog ships as bundled data. Heuristics documented, not forced.

---

## 6. Existing Work to Build On

**Already generic (from codebase exploration 2026-03-25):**
- `src/types.ts` — FrameworkPlugin, Action, DataProvider, Evaluator, EventPlugin (600 lines, universal)
- `src/plugins/` — 25 plugins, 19 generic, 6 SC-specific
- `src/lib/sources/` — Catalog, lifecycle, matcher, declarative engine
- `src/lib/event-loop.ts` — Poll-diff-dispatch (generic pattern)
- `config/strategies/base-loop.yaml` — 4-phase universal base loop
- `connectors/` — SDK isolation layer (core never imports SDK directly)

**SC-specific (becomes `verticals/supercolony/`):**
- `src/actions/publish-pipeline.ts` — DAHR attestation → HIVE post
- `src/lib/write-rate-limit.ts`, `tips.ts`, `mentions.ts`, `signals.ts`, `predictions.ts`
- `cli/session-runner.ts` — 8-phase orchestrator

**WS2 (from four workstreams plan) already outlined:**
- Action interface for cross-framework adapters
- Generic EvaluatorInput (topic/category → context)
- `packages/adapters/eliza/`, `packages/adapters/openclaw/`

---

## 7. Skill Design Principles (from research)

Source: [mgechev/skills-best-practices](https://github.com/mgechev/skills-best-practices), OpenClaw docs, ElizaOS core

### Universal Skill Design Rules

1. **Progressive Disclosure** — Keep main manifest minimal. Load details JIT through explicit instructions. Don't bloat the token window.
2. **Deterministic Over Generative** — Delegate fragile operations to tested scripts. Don't ask the LLM to generate parsing logic each time.
3. **Instructions for Agents, Not Humans** — Skills target machine execution. Step-by-step numbering = strict sequence.
4. **Template-Driven Output** — Provide concrete JSON/config templates. Agents pattern-match exceptionally well.
5. **Descriptive Error Messages** — Scripts must return human-readable errors so the agent can self-correct without user intervention.
6. **Flat Structure** — Files exactly one level deep. No nested subdirectories.

### Directory Pattern

```
skill-name/
├── SKILL.md              (<500 lines, navigation + procedures)
├── scripts/              (executable CLIs — deterministic, tested)
├── references/           (schemas, cheatsheets, domain logic)
└── assets/               (templates, JSON examples, static files)
```

---

## 8. Integration Targets (Researched)

### 8.1 OpenClaw (First-Class — Marius uses it)

**Source:** [docs.openclaw.ai/tools/skills](https://docs.openclaw.ai/tools/skills)

- **Format:** `SKILL.md` with YAML frontmatter (name + description required, single-line keys only)
- **Types:** Bundled (lowest) → managed `~/.openclaw/skills/` → workspace `<workspace>/skills/` (highest)
- **Invocation:** Model-invoked (agent decides) OR user-invoked (slash commands, `user-invocable: true`)
- **Direct dispatch:** `command-dispatch: tool` + `command-tool` bypasses LLM reasoning entirely
- **Gating:** `metadata.openclaw.requires.{bins, anyBins, env, config}`, `os` platform filter
- **Config injection:** `openclaw.json` → `skills.entries.<name>.{enabled, apiKey, env, config}`. Env vars injected only if not already set.
- **Distribution:** ClawHub registry (`openclaw skills install <slug>`)
- **Token impact:** ~24 tokens per skill (195 base + 97 + field lengths per skill)
- **Session model:** Skills snapshotted at session start, reused for duration. Hot-reload via watcher.

**Our adapter surface:** SKILL.md (<500 lines) + scripts/ (CLI wrappers calling core) + references/ (schemas, source catalog excerpt)

### 8.2 ElizaOS (First-Class — Web3 Native)

**Source:** ElizaOS monorepo core types + plugin-starter + plugin-bootstrap + registry

**Core Interfaces:**

```typescript
// Action — things the agent DOES
interface Action {
  name: string;              // e.g. 'PUBLISH_TO_DEMOS'
  similes?: string[];        // aliases for LLM matching
  description: string;       // LLM-visible
  validate: Validator;       // guard: should this run? → boolean
  handler: Handler;          // execution → ActionResult { success, text?, data? }
  examples?: ActionExample[][];  // few-shot for LLM selection
}

// Provider — context the agent KNOWS
interface Provider {
  name: string;
  get: (runtime, message, state) → ProviderResult;
  // ProviderResult { text?, values?, data? }
  // text → injected into LLM prompt
  // values → merged into state.values
  // data → merged into state.data
}

// Evaluator — post-response LEARNING
interface Evaluator {
  name: string;
  alwaysRun?: boolean;      // run after every response?
  validate: Validator;       // same signature as Action
  handler: Handler;          // same signature as Action
}

// Plugin — bundles everything
interface Plugin {
  name: string;
  init?: (config, runtime) → void;  // Zod config validation
  actions?: Action[];
  providers?: Provider[];
  evaluators?: Evaluator[];
  services?: Service[];      // long-lived SDK connections
  events?: PluginEvents;     // reactive event handlers
  dependencies?: string[];   // plugin dependency chains
}
```

**Key patterns to adopt:**
- `ProviderResult { text, values, data }` triple — separates LLM-visible from structured
- `similes` + `examples` on Actions — helps LLM select without custom routing
- Zod config validation at `init()` — clean config gate
- Service class for long-lived SDK connection (wallet, auth)

**Distribution:** GitHub-based registry (`elizaOS/registry`), JSON manifest per plugin, auto-install by name.

**What maps to our architecture:**

| ElizaOS | demos-agents | Adapter Work |
|---------|-------------|-------------|
| Action (validate+handler) | FrameworkPlugin.Action | Shape translation only |
| Provider (context inject) | DataProvider | Add `text` field to output |
| Evaluator (post-response) | Evaluator | Same pattern |
| Service (long-lived) | connectors/ (SDK bridge) | Wrap as Service class |
| Memory (typed+embedded) | Session transcript | Different model — document don't force |
| Plugin.events | EventPlugin | Map event types |

**What we have that ElizaOS doesn't:** Attestation hard gate, source catalog/lifecycle, claim extraction pipeline, scoring/quality system. These are our differentiated value.

### 8.3 AgentSkills / Hermes (Generic)

- **Format:** Markdown skill files following agentskills.io spec
- **Distribution:** Git / local directory
- **Lowest adapter effort** — SKILL.md already covers this format

---

## 8. Research Needed

- [x] **R1:** ElizaOS plugin architecture — full report at `MEMORY/WORK/20260326-elizaos-plugin-architecture-research/research-report.md`. Action/Provider/Evaluator interfaces, plugin-bootstrap (16 providers, 13 actions), web3 plugin patterns, registry model.
- [x] **R2:** OpenClaw skill system — SKILL.md format, ClawHub distribution, config injection, gating. Plus mgechev/skills-best-practices (progressive disclosure, deterministic scripts, flat structure).
- [x] **R3:** All 11 Demos SDK verticals mapped with concrete tool definitions, providers, data assets, blockers, priorities. MVP = SuperColony + Attestation (7 tools). 3 blocked, 3 not started, 1 workaround. Full mapping in Explore agent output (2026-03-26).
- [x] **R4:** Council debate (4/4 convergence): no base loop. Atomic tools only. Prior art (Stripe, Composio, MCP) confirms.

---

## 9. MVP Tool Surface (from R3 Vertical Mapping)

### Active Verticals (MVP)

| Tool | Vertical | Params → Return | Internal Complexity |
|------|----------|----------------|-------------------|
| `connect(credentials)` | Core | wallet path → session handle | Wallet + auth + session |
| `publish(draft)` | SuperColony | text, category, tags → txHash | 6-step: claims→attest→tx→confirm→broadcast |
| `reply(parentTx, text)` | SuperColony | txHash + text → txHash | Same as publish + reply threading |
| `react(txHash, type)` | SuperColony | txHash + agree/disagree → success | API auth + rate check |
| `tip(txHash, amount)` | SuperColony | txHash + DEM amount → txHash | Spending policy + tx |
| `scan(options?)` | SuperColony | filters → Post[] + opportunities | Feed fetch + source catalog + filtering |
| `verify(txHash)` | SuperColony | txHash → confirmed or not | Indexer lookup + retries |
| `attest(url)` | Attestation | URL → responseHash + txHash | DAHR proxy relay |
| `discoverSources(domain?)` | Attestation | domain filter → ranked sources | 229 sources, health, matching |
| `pay(url, amount?)` | D402 Payments | URL → Response (auto-pay on 402) | D402Client.handlePaymentRequired() |

### Mandatory Middleware

| Guard | Scope | Cannot Opt Out |
|-------|-------|----------------|
| Rate limit | 15 posts/day, 5/hour, wallet-scoped | Protects from API ban |

### Data Assets (Bundled)

| Asset | Size | Updates |
|-------|------|---------|
| Source catalog | 229 sources, ~15K lines JSON | Ships with toolkit version |
| Attestation specs | 38 specs, 27 with claimTypes | Ships with toolkit version |
| Entity maps | ASSET_MAP (21 crypto) + MACRO_MAP (15 macro) | Ships with toolkit version |
| Prediction market specs | Polymarket (3 ops) + Kalshi (3 ops) | Ships with toolkit version |
| Quality heuristics | Scoring rules, calibration patterns | Documented, consumer customizes |

### Blocked/Future Verticals (Scaffold Only)

| Vertical | Status | Blocker | When Ready |
|----------|--------|---------|------------|
| CCI Identity | ⚠️ RPC workaround | NAPI crash on barrel import | P2 — partial now |
| Storage Programs | ❌ Blocked | Node lacks RPC handler | P3 — KyneSys infra |
| DemosWork | ❌ Blocked | SDK ESM import bug | P3 — KyneSys fix |
| Cross-Chain | 🔲 Not validated | Needs testnet exploration | P3 |
| L2PS Privacy | ❌ Blocked | SDK Buffer polyfill | P3 — KyneSys fix |
| Encrypted Messaging | 🔲 Not started | None known | P3 |
| ZK Identity | 🔲 Not started | None known | P3 |
| Skill Dojo | ✅ Active | 5 req/hr rate limit | Data provider layer, not vertical |

---

## 10. Skill Dojo Parity Analysis

### What Skill Dojo Actually Is

Skill Dojo is **NOT an AI agent system.** It's 15 parameterized SDK wrappers behind a hosted REST API (`POST /api/execute`). Each "skill" is a deterministic function: receive params → call SDK/external API → optionally DAHR attest → return data + proof. Zero LLM, zero reasoning, zero memory.

**Decision [2026-03-26]:** Replicate Skill Dojo locally as "best of all" implementation. Skill Dojo API remains as optional seamless fallback. Local path has no rate limit + more control. Consumer never knows which path runs.

### Skill-by-Skill Comparison

| # | Skill Dojo Skill | What It Does (Server-Side) | Our Local Implementation | Gap | Diff Notes |
|---|---|---|---|---|---|
| 1 | `defi-agent` (order-book) | Fetches Binance `api/v3/depth` + DAHR attests response | Source catalog has Binance. `declarative-engine.ts` fetches + parses via YAML spec. `publish-pipeline.ts` does DAHR. | **None** | Our path is richer: claim extraction, quality gate, multi-source attestation plan. Skill Dojo returns raw order book; we extract specific claims and attest surgically. **Our local is better.** |
| 2 | `defi-agent` (liquidity) | Queries Uniswap V3 / Raydium pool data | Not in source catalog | **Small** | Add Uniswap V3 subgraph + Raydium API as source specs. Declarative engine handles it. |
| 3 | `defi-agent` (bridge-swap) | Rubic bridge quotes | Not implemented | **Medium** | Rubic API integration. Maps to cross-chain vertical. |
| 4 | `prediction-market-agent` | Polymarket + Kalshi API + DAHR attest | ✅ DONE (2026-03-26) — polymarket.yaml (3 ops) + kalshi.yaml (3 ops) + 4 catalog entries | **None** | Polymarket gamma-api + Kalshi trade-api/v2 specs shipped. Same DAHR flow. **Our local matches Skill Dojo.** |
| 5 | `address-monitoring-agent` | `nodeCall` + chain RPC balance/tx queries | Not implemented | **Medium** | Need `nodeCall` wrapper for Demos chain + chain RPC adapters. XM SDK has the primitives. |
| 6 | `network-monitor-agent` | `nodeCall` health + ethers.js mempool | Not implemented | **Medium** | Need nodeCall health queries + ethers provider for EVM mempool. |
| 7 | `chain-operations-agent` | XM SDK unified balance/sign/transfer (9 chains) | XM SDK available, untested on testnet | **Validation** | SDK is imported. Need to validate each chain works on testnet. Core code exists. |
| 8 | `multi-step-operations-agent` | DemosWork batch/conditional workflows | DemosWork SDK exists, **blocked** (ESM import bug) | **Blocked** | Cannot replicate until KyneSys fixes the `baseoperation.js` barrel import. |
| 9 | `identity-agent` | CCI create/resolve/link via Identities class | Working via RPC-direct workaround | **Small** | Our RPC path works. Skill Dojo calls same SDK. Ours bypasses NAPI crash via direct RPC. **Our local works, theirs may crash too.** |
| 10 | `tlsnotary-attestation-agent` | TLSNotary MPC-TLS proof generation | Playwright bridge (`tlsn-playwright-bridge.ts`) | **Parity but both broken** | Both paths fail — our Playwright bridge times out at 300s, their hosted path likely has same infra issue (same notary node). Need to verify if Skill Dojo TLSN actually works. |
| 11 | `solana-operations-agent` | XM SDK Solana adapter | XM SDK available, untested | **Validation** | Same SDK, just need testnet validation. |
| 12 | `ton-operations-agent` | XM SDK TON adapter | XM SDK available, untested | **Validation** | Same as above. |
| 13 | `near-operations-agent` | XM SDK NEAR adapter | XM SDK available, untested | **Validation** | Same as above. |
| 14 | `bitcoin-operations-agent` | XM SDK Bitcoin adapter | XM SDK available, untested | **Validation** | Same as above. |
| 15 | `cosmos-operations-agent` | XM SDK Cosmos/IBC adapter | XM SDK available, untested | **Validation** | Same as above. |

### Summary

| Status | Count | Skills |
|---|---|---|
| **Our local is BETTER** | 3 | defi-agent (order-book), identity-agent, prediction-market (shipped 2026-03-26) |
| **Easy to add locally** | 1 | defi-agent (liquidity) |
| **Needs new implementation** | 3 | address-monitoring, network-monitor, bridge-swap |
| **Needs testnet validation** | 5 | chain-operations + 4 chain-specific ops |
| **Both Phase 2 broken** | 1 | tlsnotary-attestation — Phase 1 (token) works everywhere, Phase 2 (MPC-TLS WASM proof) fails everywhere. Notary handshake issue, not our code. |
| **Blocked on SDK** | 1 | multi-step-operations (ESM bug) |
| **N/A** | 1 | demos-wallet (browser only) |

### Where Our Local Path Is Better Than Skill Dojo

1. **No 5 req/hr rate limit** — local calls are unlimited
2. **Claim extraction** — we parse API responses into structured claims, Skill Dojo returns raw data
3. **Multi-source attestation planning** — we attest specific claims across multiple sources, Skill Dojo attests one blob
4. **Quality gate** — we score content before publishing, Skill Dojo has no quality layer
5. **Source lifecycle** — we track source health and rotate, Skill Dojo uses hardcoded endpoints
6. **Entity resolution** — we map "BTC" → "bitcoin" for correct API calls, Skill Dojo doesn't

### Where Skill Dojo Is Better

1. **Hosted — zero local setup** — consumer doesn't need Node.js, SDK, or wallet locally
2. **Pre-built chain adapters** — 5 chain-specific ops skills work without XM SDK validation

### Implementation Plan: Local Best-of-All

**Phase 1 (with MVP):** Replicate skills 1, 4, 9 locally (already mostly done)
- defi-agent → existing source catalog + DAHR (DONE)
- prediction-market → add Polymarket/Kalshi source specs (SMALL)
- identity-agent → existing RPC workaround (DONE)

**Phase 2:** Replicate skills 5, 6 locally
- address-monitoring → nodeCall wrapper + chain RPC (MEDIUM)
- network-monitor → nodeCall health + ethers mempool (MEDIUM)

**Phase 3:** Validate chain operations (skills 7, 11-15)
- Run testnet validation for each XM SDK chain adapter
- Compare results with Skill Dojo output for parity

**Phase 4 (when unblocked):** Replicate skill 8
- multi-step-operations → DemosWork SDK (after ESM fix)

### Seamless Fallback Architecture

```typescript
// Consumer calls:
const data = await demos.tools.scan({ domain: "defi", pair: "ETH/USDT" });

// Internally:
async function scan(params) {
  // 1. Try local path first (no rate limit, richer processing)
  try {
    const localResult = await localProviders.fetch(params);
    if (localResult.ok) return localResult;
  } catch (localErr) {
    log.warn("Local fetch failed, trying Skill Dojo fallback", localErr);
  }

  // 2. Fall back to Skill Dojo API (rate limited, simpler)
  if (skillDojoClient.canExecute()) {
    const remoteResult = await skillDojoClient.execute(mapToSkillId(params), params);
    if (remoteResult.ok) return normalizeResult(remoteResult);
  }

  // 3. Both failed
  throw new Error("No data source available");
}
```

The consumer never sees the routing. Local is tried first (faster, no limit). Skill Dojo is transparent fallback. Results are normalized to the same shape regardless of path.

---

## 11. Iteration Log

### 2026-03-25 — Session 1: Vision Established
- Taxonomy defined (framework vs harness vs toolkit)
- Three-layer architecture proposed (adapter → core → SDK)
- 6 open design questions identified
- Deep codebase exploration: 85% of generic work already exists
- SuperColony confirmed as first vertical, not only vertical
- Key clarification: demos-sdk is Demos team's work, not ours
- OpenClaw + ElizaOS confirmed as dual first-class adapter targets
- ElizaOS web3 alignment noted (dominant crypto framework, $25M+ AUM)
- Existing docs: architecture-comparison-elizaos.md, research-agent-frameworks-modularization.md already exist as prior research
- TLSN ecosystem scan: 0/145 posts have TLSN attestations, disabled indefinitely

**Participants:** Marius + Claude (Intern agent for framework research, Explore agent for codebase deep-dive)

### 2026-03-25 — Session 2: Q1-Q6 Answered
- **Q1 (Naming):** Resolved — name must signal toolkit/skill/plugin, not "agents." Exact name TBD.
- **Q2 (Boundary):** Resolved — thin wrapper. Abstract non-trivial complexity, don't obscure SDK. Document over implement when value unclear. Scaffold verticals, don't implement.
- **Q3 (MVP):** Resolved — three distribution surfaces (OpenClaw, ElizaOS, CLI), one core. Layered wow: instant hook → discovery → adopt/customize. No strategy lock-in.
- **Q4 (Personas):** Resolved — tools over personas. Examples in `examples/` for reference. On-demand assembly by purpose, not predefined sub-agents.
- **Q5 (Strategies):** Partially resolved — strategies are opt-in playbooks. PARKED: what is the minimum viable strategy? Needs creative/analytical deep dive.
- **Q6 (State):** Resolved — stateless tools by default, optional state adapters. Rate limits mandatory (wallet-scoped). Source catalog ships as bundled data. Heuristics documented as patterns.

**Status: 5 of 6 questions answered. Q5 parked for deep thinking session.**
**Next:** R1-R4 research, then MVP spec with ISC criteria.

**Participants:** Marius + Claude

### 2026-03-25 — Session 3: Q5 Council Debate + Skill Design Research
- **Q5 resolved via Council debate (4/4 convergence):** Zero loops. MVP = atomic tools + rate-limit guard. "A base loop in a toolkit is a category error."
- Council members: Architect (Serena), Engineer (Marcus), Researcher (Ava), First Principles
- All independently converged on same answer from different angles:
  - Architect: impedance mismatch with consumer's existing loop
  - Engineer: "four functions and a constraint" ships fastest
  - Researcher: Stripe, Composio, MCP all confirm tools-not-loops pattern
  - First Principles: three irreducible primitives (identity, attest, transact)
- **Skill design research completed:**
  - AgentSkills best practices (mgechev): progressive disclosure, deterministic scripts, lean SKILL.md, JIT loading
  - OpenClaw skill system: SKILL.md format, ClawHub distribution, config injection, requires gating
  - ElizaOS plugin system: Action/Provider/Evaluator pattern, npm distribution (research agent)
- **MVP tool surface defined:** connect, publish, scan, verify, react, tip, discoverSources + rate-limit middleware
- **All 6 design questions now answered.** Ready for MVP spec.

**Status: ALL questions answered. Ready for MVP spec with ISC criteria.**
**Next:** Write the MVP spec. The Algorithm can derive ISC from it.

**Participants:** Marius + Claude + Council (4 agents) + ElizaOS researcher

### 2026-03-26 — Session 4: Skill Dojo Deconstruction + Parity Analysis
- **Key discovery:** Skill Dojo is NOT an AI system — it's 15 parameterized SDK wrappers behind a REST API. Zero LLM, zero reasoning, zero memory. Each "skill" = receive params → SDK/API call → optional DAHR attest → return data.
- **Decision: Replicate locally (option B+C).** Local "best of all" implementation + Skill Dojo API as seamless fallback. Consumer never sees routing.
- **Parity analysis complete:** 15 skills mapped. 2 where our local is already better (DeFi order-book, identity). 2 easy to add (prediction markets, liquidity). 3 need new implementation (address monitoring, network monitor, bridge). 5 need testnet validation (chain ops). 1 both broken (TLSN). 1 blocked (DemosWork).
- **Our local advantages over Skill Dojo:** No rate limit, claim extraction, multi-source attestation planning, quality gate, source lifecycle, entity resolution.
- **Skill Dojo advantages:** Zero local setup, pre-built chain adapters, prediction market data ready.
- **Seamless fallback architecture defined:** local-first → Skill Dojo fallback → normalized result shape.
- **4-phase local replication plan:** Phase 1 (MVP, mostly done), Phase 2 (monitoring, medium), Phase 3 (chain validation), Phase 4 (when SDK unblocks).

**Participants:** Marius + Claude

### 2026-03-26 — Session 5: SDK Deep-Dive + D402 + Prediction Markets + MCP
- **SDK upgraded 2.11.4 → 2.11.5** (released same day). L2PS messaging types.
- **D402 Payment Protocol deep-dive:** Complete HTTP 402 micropayment system in SDK. Client auto-pays on 402, server Express middleware gates endpoints. Gasless d402_payment tx type. No docs exist — we're reading source code. Added `pay()` to MVP tool surface.
- **Storage Programs confirmed still blocked:** "Unknown message" on both RPC nodes. SDK is mature (granular JSON ops, binary mode, group ACL, 1MB limit). Our wrappers (`storage-client.ts`, `storage-plugin.ts`) ready. Blocker is KyneSys infrastructure.
- **TLSN diagnosis conclusive:** `tlsn-component` repo is same engine in iframe. All three paths (our Playwright bridge, tlsn-component, SDK TLSNotary) use identical `tlsn-js` WASM. Hang is KyneSys notary server, not our code. Our bridge is correct.
- **Prediction markets shipped:** Polymarket (3 ops) + Kalshi (3 ops) YAML specs + 4 catalog entries. Parity with Skill Dojo achieved.
- **2 MCP servers wired:** `demosdk_references` (get.demos.sh) + `demosdk_docs` (GitBook). Available for SDK doc lookup.
- **KyneSys org fully mapped:** 23 repos, 6 NPM packages, 3 MCP servers. Key strategic items: ERC-8004 agent identity (issue #70), D402, Storage Programs.
- **ERC-8004 Agent Identity identified as most strategic upcoming feature** — on-chain agent identity registry via ERC-721. Open SDK issue, not yet implemented.

**Participants:** Marius + Claude + 3 parallel research agents

---

## 12. Decision Log

> Append-only. Format: `[DATE] DECISION: statement. REASON: why. SUPERSEDES: what (if any).`

[2026-03-25] DECISION: demos-agents is a TOOLKIT, not a framework or harness. REASON: We provide domain capabilities, not agent reasoning or execution management.

[2026-03-25] DECISION: SuperColony is the first vertical, not the only vertical. REASON: Demos SDK offers 7+ verticals. Toolkit API should be `demos.tools.publish()` not `supercolony.publish()`.

[2026-03-25] DECISION: OpenClaw and ElizaOS are dual first-class adapter targets. REASON: OpenClaw = Marius uses it + largest adoption. ElizaOS = dominant web3 framework + thematic alignment with Demos blockchain.

[2026-03-25] DECISION: demos-sdk (@kynesyslabs/demosdk) is NOT our work. We build the high-value layer on top. REASON: Avoid scope confusion. We're an adoption wrapper, not an SDK competitor.

[2026-03-25] DECISION: Personas are in-scope for the toolkit. REASON: They define scoped strategies + tool selection. An OpenClaw agent importing the skill still needs persona selection.

[2026-03-25] DECISION: Do not implement until design questions Q1-Q6 are answered. REASON: Premature implementation creates architectural debt.

[2026-03-25] DECISION: Toolkit wrapper is thin — abstract non-trivial complexity, don't obscure SDK. REASON: Agents are smart. Abstract difficulty/gotchas/config, but let them interact with Demos natively. Prefer documentation over implementation when value is unclear.

[2026-03-25] DECISION: Tools over personas. Example personas in examples/ only. REASON: Consumer's agent already has its own identity. Toolkit is a shelf of capabilities, not a cast of characters. On-demand assembly by purpose.

[2026-03-25] DECISION: Strategies are opt-in playbooks, never mandatory. REASON: No vendor lock-in. 8-phase loop is one example. Agents can use individual tools without any strategy.

[2026-03-25] DECISION: Stateless tools by default, optional state adapters. REASON: Consumer manages their own state. Rate limits are the one mandatory guardrail (wallet-scoped, protects from API bans).

[2026-03-25] DECISION: Three distribution surfaces, one core. REASON: OpenClaw skill, ElizaOS plugin, standalone CLI all call the same @demos-agents/core. Not three products.

[2026-03-25] DECISION: Scaffold future verticals, don't implement. REASON: Structure + docs until value is proven. Don't be too individual for personal use case — design generically so everyone can adopt.

[2026-03-25] DECISION: Zero loops in the toolkit. MVP = atomic tools + rate-limit guard. REASON: Council debate (4/4 convergence). Prior art (Stripe, Composio, MCP) confirms toolkits ship tools not loops. Consumer's agent already has a loop — imposing another creates impedance mismatch.

[2026-03-25] DECISION: MVP tool surface: connect(), publish(), scan(), verify(), react(), tip(), discoverSources() + mandatory rate-limit middleware. REASON: Engineer's "four functions and a constraint" principle. publish() hides 6-step chain internally. Complexity is internal, API is clean.

[2026-03-26] DECISION: Replicate Skill Dojo locally as "best of all" version. Skill Dojo API as seamless fallback. REASON: Skill Dojo is 15 parameterized SDK wrappers, not AI. Our local path is already better for 2/15 skills (no rate limit, claim extraction, quality gate). Local-first eliminates 5 req/hr shared constraint. SUPERSEDES: earlier framing of Skill Dojo as "data provider layer" — it's actually an alternative execution path for the same operations we do locally.

[2026-03-26] DECISION: Seamless routing: local-first → Skill Dojo fallback → normalized result. Consumer never sees which path runs. REASON: Transparency. Same result shape regardless of path. Local is faster + no rate limit. Skill Dojo is zero-setup convenience for consumers who can't run SDK locally.

[2026-03-26] DECISION: Add pay() to MVP tool surface — D402 client auto-pay on HTTP 402. REASON: D402 Payment Protocol is complete in SDK v2.11.5 (gasless d402_payment tx, Express middleware, auto-retry). Enables agents to access paid data sources and monetize services. ~20 lines client integration. SUPERSEDES: D402 was not considered in prior MVP scope (undocumented module, discovered via source code reading).

[2026-03-26] DECISION: Prediction market sources (Polymarket + Kalshi) ship as bundled data assets. REASON: Polymarket gamma-api (3 ops) and Kalshi trade-api/v2 (3 ops) specs complete. No auth required. New claim types: probability, prediction. Enables attested market-consensus predictions — qualitatively different from price feeds.

[2026-03-26] DECISION: Monitor ERC-8004 Agent Identity (SDK issue #70) as highest-priority strategic feature. REASON: On-chain agent identity registry using ERC-721. Agent cards with name, capabilities, endpoints, payment address. When it ships in SDK, integrate immediately — game changer for our CCI architecture.

[2026-03-26] DECISION: Storage Programs deferred from MVP, keep wrappers ready. REASON: SDK is mature (granular JSON ops, binary, group ACL, 1MB limit). Our storage-client.ts and storage-plugin.ts wrap it. But RPC nodes return "Unknown message" — KyneSys hasn't deployed server-side handlers. Confirmed still broken in v2.11.5.

[2026-03-26] DECISION: TLSN remains disabled. tlsn-component offers no alternative path. REASON: All three approaches (our Playwright bridge, tlsn-component iframe, SDK TLSNotary) share identical tlsn-js WASM engine. The hang is in the KyneSys notary server, not our code. Fix requires KyneSys infrastructure work or testing against a reference notary.
