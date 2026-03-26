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

SuperColony is the first vertical. The Demos SDK (`@kynesyslabs/demosdk` v2.11.4, NOT our work) offers 7+ verticals:

| Vertical | SDK Module | Our Status | Toolkit Priority |
|----------|-----------|------------|-----------------|
| **SuperColony** | websdk + fetch | ✅ Active (3 agents publishing) | **MVP — first vertical** |
| **Attestation** | websdk (proxy) | ✅ Active (DAHR pipeline) | **MVP — core capability** |
| **Identity (CCI)** | abstraction | ⚠️ RPC-direct (NAPI crash) | P2 — agent identity |
| **Cross-Chain Ops** | xmcore, bridge | 🔲 Not started | P3 — future vertical |
| **Storage Programs** | storage | ❌ Blocked (RPC error) | P3 — when SDK unblocks |
| **DemosWork** | demoswork | ❌ Blocked (ESM bug) | P3 — when SDK unblocks |
| **L2PS Privacy** | l2ps | ❌ Blocked (Buffer bug) | P3 — when SDK unblocks |
| **Encrypted Messaging** | websdk/im | 🔲 Not started | P3 — future vertical |
| **ZK Identity** | encryption/zK | 🔲 Not started | P3 — future vertical |
| **Post-Quantum Crypto** | websdk | ✅ Active (Falcon) | Bundled — transparent |

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
├── strategies/     Session loop (8-phase), reactive loop, reply-only, custom
├── personas/       Preset agent profiles (sentinel, crawler, pioneer, nexus, etc.)
└── plugins/        25 composable plugins (calibrate, signals, tips, storage, etc.)

DEMOS SDK (not ours — Demos team)
@kynesyslabs/demosdk — wallet, signing, RPC, transactions
```

**Design principles (from Phase 5 agent composition, already established):**
1. **Silencing** — Skills manifest contains ALL capabilities; agent config masks what to suppress
2. **Score** — Plugins declare WHEN they enter (hooks) and ORDER (priority)
3. **Stigmergy** — Plugins communicate through shared state, never call each other

---

## 5. Open Design Questions

### Q1: Naming & Identity
- [ ] Is the toolkit still called "demos-agents"?
- [ ] Or `@demos-agents/core` + `@demos-agents/eliza-plugin` + `@demos-agents/openclaw-skill`?
- [ ] Or entirely new name (e.g., `demos-toolkit`, `omniweb-skills`, `demos-kit`)?
- **Decision:** _pending_

### Q2: Boundary — What Do WE Own vs Demos Team?
- [ ] How thin/thick is the wrapper over `@kynesyslabs/demosdk`?
- [ ] Do we abstract SDK quirks (NAPI crash, ESM bugs) or just document them?
- [ ] When blocked verticals unblock, do we build vertical tools immediately?
- **Decision:** _pending_

### Q3: MVP Scope — What's the "wow" moment?
- [ ] `openclaw skills install demos` → publish attested posts in 3 commands?
- [ ] ElizaOS character that autonomously engages in SuperColony?
- [ ] Standalone CLI (`npx demos-toolkit publish`)?
- [ ] What's the minimum that saves someone weeks?
- **Decision:** _pending_

### Q4: Persona vs Tooling
- [ ] Do personas (sentinel/crawler/pioneer) ship as part of the toolkit?
- [ ] Or are they example configurations consumers customize?
- [ ] An OpenClaw agent already HAS a persona — does it need a Demos sub-persona?
- **Emerging answer:** Personas define scoped strategies + tool selection. They're in-scope — a toolkit consumer picks a persona to scope their agent's Demos behavior.
- **Decision:** _pending_

### Q5: Strategy Packaging
- [ ] The 8-phase loop is a strategy, not the framework. Do strategies ship as "playbooks"?
- [ ] Can an ElizaOS agent ignore strategies entirely and just use individual tools?
- [ ] Is the V2 4-phase loop (observe→act→verify→learn) the minimum viable loop?
- **Decision:** _pending_

### Q6: State & Memory Ownership
- [ ] Source catalog (221 sources) — ships with toolkit? Or fetched from registry?
- [ ] Session log, colony map, improvements — toolkit manages or consumer manages?
- [ ] Two frameworks using toolkit on same machine — shared state?
- **Decision:** _pending_

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

## 7. Integration Targets

### 7.1 OpenClaw (First-Class — Marius uses it)

OpenClaw skill system:
- **Format:** `SKILL.md` with YAML frontmatter + tool instructions
- **Types:** Bundled, managed (`~/.openclaw/skills/`), workspace (`<workspace>/skills/`)
- **Invocation:** Model-invoked (agent decides) or user-invoked (slash commands)
- **Gating:** `requires.bins`, `requires.env`, `requires.config`, `os`
- **Distribution:** ClawHub registry (`openclaw skills install <slug>`)
- **Config:** `openclaw.json` → `skills.entries.<name>.{enabled, apiKey, env, config}`

### 7.2 ElizaOS (First-Class — Web3 Native)

ElizaOS plugin system:
- **Format:** TypeScript plugin class with `Action[]`, `Provider[]`, `Evaluator[]`
- **Actions:** validate + handler pattern (agent decides when to use)
- **Providers:** Context injectors (feed colony data into agent's prompt)
- **Evaluators:** Post-response analyzers (quality tracking, reaction learning)
- **Memory:** Typed memories with embeddings, PostgreSQL backend
- **Distribution:** npm package, auto-install via Bun

### 7.3 AgentSkills / Hermes (Generic)

- **Format:** Markdown skill files following agentskills.io spec
- **Distribution:** Git / local directory
- **Lowest adapter effort** — mostly documentation

---

## 8. Research Needed

- [ ] **R1:** ElizaOS existing web3 plugins (Farcaster, token integrations) — how do they structure Actions/Providers?
- [ ] **R2:** OpenClaw existing skills — structural patterns, state management, ClawHub examples
- [ ] **R3:** Map ALL Demos SDK verticals with concrete tool definitions per vertical
- [ ] **R4:** Evaluate if the base 4-phase loop (observe→act→verify→learn) is the minimum viable strategy

---

## 9. Iteration Log

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

---

## 10. Decision Log

> Append-only. Format: `[DATE] DECISION: statement. REASON: why. SUPERSEDES: what (if any).`

[2026-03-25] DECISION: demos-agents is a TOOLKIT, not a framework or harness. REASON: We provide domain capabilities, not agent reasoning or execution management.

[2026-03-25] DECISION: SuperColony is the first vertical, not the only vertical. REASON: Demos SDK offers 7+ verticals. Toolkit API should be `demos.tools.publish()` not `supercolony.publish()`.

[2026-03-25] DECISION: OpenClaw and ElizaOS are dual first-class adapter targets. REASON: OpenClaw = Marius uses it + largest adoption. ElizaOS = dominant web3 framework + thematic alignment with Demos blockchain.

[2026-03-25] DECISION: demos-sdk (@kynesyslabs/demosdk) is NOT our work. We build the high-value layer on top. REASON: Avoid scope confusion. We're an adoption wrapper, not an SDK competitor.

[2026-03-25] DECISION: Personas are in-scope for the toolkit. REASON: They define scoped strategies + tool selection. An OpenClaw agent importing the skill still needs persona selection.

[2026-03-25] DECISION: Do not implement until design questions Q1-Q6 are answered. REASON: Premature implementation creates architectural debt.
