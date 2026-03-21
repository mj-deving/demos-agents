# demos-agents — Master Index

> **The one document you read to understand the project.**
> Architecture lives in CLAUDE.md. Operational knowledge lives in MEMORY.md. This file tracks the **evolving narrative** — what we're building, what Demos offers, what's working, what's next.

**Last updated:** 2026-03-21 | **SDK:** 2.11.4 | **Tests:** 78 suites, 1139 passing | **Agents:** 6 defined, 3 publishing

---

## Project Narrative

demos-agents is an autonomous agent toolkit built ON the Demos Network. Demos is our infrastructure layer — identity, attestation, cross-chain operations, storage, messaging. We don't compete with Demos; we consume it.

**Where we are (March 2026):**
- Core loop works: 8-phase session (AUDIT→SCAN→ENGAGE→GATE→PUBLISH→VERIFY→REVIEW→HARDEN)
- 3 agents actively publishing to SuperColony (sentinel, crawler, pioneer)
- 20 plugins (9 session loop + 3 SC API + 4 omniweb real + 4 omniweb scaffold→silent-fail)
- Event-driven reactive loop alongside cron
- TLSN + DAHR attestation pipeline functional
- Post-quantum wallet signing available (Falcon via Demos SDK)
- CCI identity queries wired (RPC-direct, bypassing NAPI crash in abstraction barrel)
- Web2 identity linking CLI (proof gen, Twitter/GitHub linking, identity query)
- Feed-mining CLI (extract source URLs from other agents' attestations → add to catalog)
- Claim-driven attestation (Phases 1-4): extract claims from post text → build surgical URLs → attest per-claim → verify values

**Where we're going:**
- Session-runner wiring for claim-driven attestation (insert between match and publish)
- CCI identity as root → Agent Auth Protocol as session auth layer
- Deeper Demos SDK integration: ZK identity, encrypted messaging, L2PS privacy
- Feed-mining for source discovery, dynamic topic expansion

---

## Demos SDK Capability Map

What Demos offers vs what we use. **Updated each session.**

| Demos Capability | SDK Module | Our Status | Notes |
|-----------------|------------|------------|-------|
| **Wallet + Transactions** | `websdk` | ✅ Active | PQC (Falcon/ML-DSA) added 2026-03-20 |
| **SuperColony API** | `websdk` + fetch | ✅ Active | Feed, publish, react, tip — all working |
| **DAHR Attestation** | `websdk` (proxy) | ✅ Active | Primary attestation method |
| **TLSN Attestation** | `tlsnotary` | ✅ Active | MPC-TLS, Playwright bridge. KyneSys proxy intermittent |
| **Cross-Chain Identity** | `abstraction` | ⚠️ RPC-direct | `Identities` class SIGSEGV on import (NAPI crash). RPC calls work. |
| **Web2 Identity Linking** | `abstraction` | ⚠️ Blocked | Same NAPI crash. SDK methods exist for Twitter/GitHub/Discord/Telegram |
| **ZK Identity** | `encryption/zK` | 🔲 Not started | Groth16 ZK-SNARKs for privacy-preserving attestation. Available in SDK. |
| **Post-Quantum Crypto** | `websdk` | ✅ Active | `connectWallet({ algorithm: "falcon", dual_sign: true })` |
| **Storage Programs** | `storage` | ❌ Blocked | RPC returns "Unknown message" / "GCREdit mismatch" (node-side) |
| **DemosWork** | `demoswork` | ❌ Blocked | ESM directory import bug in `baseoperation.js` |
| **L2PS Privacy** | `l2ps` | ❌ Blocked | `encryptTx` Browser Buffer fails in Node ESM |
| **Encrypted Messaging** | `websdk/instant-messaging` | 🔲 Not started | E2E encrypted (ml-kem-aes). Available in SDK. |
| **Cross-Chain Swaps** | `bridge` | 🔲 Not started | Rubic bridge integration available |
| **EVM Contract Calls** | `xmcore/evm` | 🔲 Not started | Smart contract operations via Demos |
| **KeyServer OAuth** | `keyserver` | 🔲 Not started | OAuth flow for Web2 identity (GitHub uses this) |
| **Human Passport** | `abstraction` | ⚠️ Blocked | Available in Identities class but NAPI crash blocks import |
| **Nomis Reputation** | `abstraction` | ⚠️ Blocked | Same NAPI crash |
| **Ethos Reputation** | `abstraction` | ⚠️ Blocked | Same NAPI crash |

**Key blocker:** The `@kynesyslabs/demosdk/abstraction` barrel export causes SIGSEGV in Node.js because it transitively loads FHE/PQC/zK native modules. The `Identities` class itself is pure JS. Workaround: direct RPC calls. Permanent fix: KyneSys needs to split the barrel or lazy-load native modules.

---

## Documentation Index

### Architecture & Design

| Document | Status | Updated | Purpose |
|----------|--------|---------|---------|
| [loop-heuristics.md](loop-heuristics.md) | `current` | 2026-03-20 | **Single source of truth** for SCAN→GATE→PUBLISH pipeline, agent differentiation, 8 constitutional rules |
| [project-structure.md](project-structure.md) | `stale` | 2026-03-17 | Codebase tree + file descriptions. Test counts outdated (78 suites now). Missing claim-attestation files. |
| [omniweb-agent-architecture.md](omniweb-agent-architecture.md) | `stale` | 2026-03-18 | Two-tier agent model. References omniweb-runner.ts which doesn't exist. Aspirational, not current. |
| [agent-workspace.md](agent-workspace.md) | `reference` | 2026-03-17 | YAML agent config format spec. agents/ directory exists but format not fully enforced by loader yet. |

### Research & Analysis

| Document | Status | Updated | Purpose |
|----------|--------|---------|---------|
| [agent-auth-demos-cci-analysis.md](agent-auth-demos-cci-analysis.md) | `current` | 2026-03-20 | Agent Auth Protocol + Demos CCI = complementary layers. Passport + boarding pass model. |
| [architecture-comparison-elizaos.md](architecture-comparison-elizaos.md) | `reference` | 2026-03-18 | ElizaOS, demos-agents, OpenClaw, Claude Code architecture comparison |
| [research-agent-frameworks-modularization.md](research-agent-frameworks-modularization.md) | `reference` | 2026-03-17 | OpenClaw, CrewAI, LangGraph, ElizaOS as modularization inspiration |
| [skill-dojo-integration-research.md](skill-dojo-integration-research.md) | `current` | 2026-03-19 | Contract-tested inventory of 15 Skill Dojo skills. 5 req/hr rate limit. |

### SDK & Integration

| Document | Status | Updated | Purpose |
|----------|--------|---------|---------|
| [attestation-reference.md](attestation-reference.md) | `current` | 2026-03-14 | TLSN + DAHR design constraints, performance drift, pipeline detail |
| [claim-driven-attestation-spec.md](claim-driven-attestation-spec.md) | `current` | 2026-03-21 | Claim-driven attestation design spec (Phases 1-4). Codex-reviewed. |
| [sdk-exploration-results.md](sdk-exploration-results.md) | `current` | 2026-03-18 | StorageProgram / DemosWork / L2PS blocker diagnosis. SDK 2.11.2 (now 2.11.4, blockers likely unchanged) |
| [TLSN-Report-KyneSys-2026-03-14.md](TLSN-Report-KyneSys-2026-03-14.md) | `current` | 2026-03-14 | MPC-TLS proxy relay failure diagnosis — KyneSys infrastructure issue |

### Roadmap & Planning

| Document | Status | Updated | Purpose |
|----------|--------|---------|---------|
| [roadmap-unified.md](roadmap-unified.md) | `stale` | 2026-03-20 | 7-phase plan: Phases 1-5 complete, Phase 6 blocked, Phase 7 systematic SDK integration. Phase 5 status not updated in file. |
| [roadmap-skill-dojo-local.md](roadmap-skill-dojo-local.md) | `current` | 2026-03-20 | Course correction: extract Skill Dojo as local SDK-direct implementations |
| [phase5-agent-composition-plan.md](phase5-agent-composition-plan.md) | `complete` | 2026-03-20 | Skill loader + manifest design. Codex-reviewed. Implemented: Phase 0 (hook internalization) + Phase 5 (loadExtensions). |

---

## Session Changelog

Most recent first. Each entry captures what changed, what was learned, what's next.

### 2026-03-21 — Claim-Driven Attestation Phases 2-4 (afternoon)

**Theme:** Surgical attestation — attest the exact data point a claim needs, not a generic blob.
*(Phase 1 and spec work in morning session below)*

**Delivered:**
- **Phase 2: Surgical URL construction** — `SurgicalCandidate` type, `buildSurgicalUrl` on `ProviderAdapter`. Declarative engine generates from YAML specs with `claimTypes` + `extractionPath` (supports `{var}` interpolation). 3 specs updated (binance, coingecko, etherscan).
- **Phase 3: Attestation planner + executor** — `buildAttestationPlan` (portable, `src/lib/`) with budget limits (maxCostPerPost, maxTlsn/DahrPerPost). `executeAttestationPlan` (platform-bound, `src/actions/`) with rate limiting + TLSN→DAHR fallback. `plannedMethod` field carries planner's budget decision to executor.
- **Phase 4: Value verifier** — `verifyAttestedValues` with tolerance (2% price, 5% metric). Trend/quote always pass. Missing data fails closed.
- **Pipeline wiring** — `preAttested` in `PublishOptions` (not new positional param). Multi-attestation mapping. Primary-only reporting model (no changes to log/audit/review).
- **Entity canonicalization** — `inferAssetAlias` resolves tickers ("BTC"→"bitcoin") for CoinGecko API compatibility.

**Key findings:**
- Planner/executor decoupling gap: planner must record method decisions, not let executor re-derive (Codex #1)
- Fail-open verification is dangerous: missing attestation data should fail, not silently pass (Codex #2)
- CoinGecko API needs canonical asset names, not tickers — `ids=btc` is Bitcoin Cash, not Bitcoin (Codex #3)

**Tests:** 78 suites, 1139 passing (up from 73 suites, 1100)
**Commits:** 5 pushed to main (3 implementation + 1 simplify + 1 Codex fixes)

---

### 2026-03-21 — Claim Spec + Source Curation + Claim Phase 1 (morning)

**Theme:** Design-first — write the spec, get Codex review, curate sources, then build Phase 1.

**Delivered:**
- **Claim-driven attestation spec** written (`docs/claim-driven-attestation-spec.md`), iterated 3 times with Codex review. 4 High + 2 Medium findings addressed in v2.
- **Source curation** — triaged 74 quarantined sources, fixed 2 active arxiv DAHR flags (arxiv is TLSN-only), promoted deribit + polymarket with trimmed URLs.
- **Phase 1: Claim extraction** — `src/lib/claim-extraction.ts` with rules-first extraction (prices, percentages, domain units) + LLM fallback. ASSET_MAP entity recognition. Fix for double-extract on shorthand dollars.

**Tests:** 76 suites, 1100 passing (up from 73/1050)
**Commits:** 8 (3 spec iterations + 2 source curation + 2 claim extraction + 1 fix)

---

### 2026-03-20 — Phase 0 + Phase 5 Complete (evening)

**Theme:** Ship the skill loader — internalize hooks, then replace registerHook with loadExtensions.

**Delivered:**
- **Phase 0: Hook internalization** — moved 9 hook closures from session-runner.ts into their plugin files. Plugins now own their logic instead of being empty shells with closures in the runner.
- **Phase 5: Skill loader** — `loadExtensions()` replaces `registerHook()`. Extension system fully dynamic with immutable registry. "New agent = just YAML" goal achieved.

**Tests:** 74 suites, 1065 passing (up from 73/1050)
**Commits:** 2 (phase0 + phase5)

---

### 2026-03-20 — Identity + Quantum + Agent Auth + Phase 5 Plan (daytime)

**Theme:** Demos-first philosophy — use Demos as baseline plumbing, fail silently, never exclude.

**Delivered:**
- **Phase 5 plan** written and Codex-reviewed (`phase5-agent-composition-plan.md`). Codex found critical gap: plugin files are empty shells, hook logic lives in session-runner.ts closures. Added Phase 0 prerequisite. *(Implemented in evening session above.)*
- **Quantum wallet upgrade** — `sdk.ts` now supports `{ algorithm: "falcon", dualSign: true }`. Config via `DEMOS_ALGORITHM` in credentials.
- **CCI identity plugin** — replaced scaffold blocker with real `getIdentities` RPC query.
- **4 scaffold plugins → silent-fail** — cci-identity, chain-query, address-watch, demoswork no longer throw. All attempt real operations, degrade gracefully.
- **Agent Auth SDK evaluated** — `@auth/agent@0.3.0` loads, keypair gen works, provider discovery works.
- **Agent Auth + CCI analysis** — documented as complementary layers (passport + boarding pass model).
- **Demos doc index** saved as reference memory for regular lookups.
- **SDK upgraded** to 2.11.4 (from 2.11.2).

**Key findings:**
- Demos `abstraction` barrel SIGSEGV is in transitive FHE/PQC/zK native module loading, not in Identities class itself
- Most session-loop plugins have NO real dependencies on each other (Codex disproved 3 assumed dependency edges)
- Demos SDK has 20+ identity methods we're not using (Nomis, Ethos, Human Passport, ZK)
- Agent Auth directory has only 2 services (Gmail, Agent Deploy) — early but protocol is sound

**Tests:** 73 suites, 1050 passing (up from 1046)
**Commits:** 2 pushed to main

**Three design principles for Phase 5 (from first-principles + creative analysis):**
1. **Silencing** (biology/epigenetics) — YAML prunes from full genome, doesn't build up
2. **Score** (music/orchestration) — plugins declare temporal ordering + hook priorities
3. **Stigmergy** (complex systems/ant colonies) — plugins coordinate via state, never call each other

---

## Demos Documentation Reference

Full index at `https://docs.kynesys.xyz/llms.txt`

**Most relevant for our work:**

| Topic | URL |
|-------|-----|
| Cross-Context Identity | `docs.kynesys.xyz/backend/internal-mechanisms/cross-context-identities` |
| ZK Identity | `docs.kynesys.xyz/backend/zk-identity/overview` |
| Cross-chain Identity SDK | `docs.kynesys.xyz/sdk/cross-chain/identities` |
| Web2 Identity Linking | `docs.kynesys.xyz/sdk/web2/identities/` |
| DAHR API | `docs.kynesys.xyz/sdk/web2/dahr-api-reference/overview` |
| TLSN | `docs.kynesys.xyz/sdk/web2/tlsnotary/overview` |
| Storage Programs | `docs.kynesys.xyz/sdk/storage-programs/overview` |
| DemosWork | `docs.kynesys.xyz/sdk/cookbook/demoswork/overview` |
| MCP Server | `docs.kynesys.xyz/backend/mcp-server/available-tools` |
| WebSDK | `docs.kynesys.xyz/sdk/websdk/overview` |
| SDK API Reference | `kynesyslabs.github.io/demosdk-api-ref/index.html` |
| Post-Quantum Crypto | `docs.kynesys.xyz/sdk/post-quantum-cryptography` |
| Encrypted Messaging | `docs.kynesys.xyz/sdk/websdk/instant-messaging/overview` |

---

## External Protocols

| Protocol | Status | Our Integration | Reference |
|----------|--------|----------------|-----------|
| **Agent Auth Protocol** | v1.0-draft | SDK installed, evaluated | `agent-auth-demos-cci-analysis.md` |
| **SuperColony API** | Active | Full integration | `loop-heuristics.md` |
| **Demos SDK** | v2.11.4 | Core dependency | `sdk-exploration-results.md` |
| **Skill Dojo API** | Active (5 req/hr) | Reference only | `skill-dojo-integration-research.md` |

---

## Maintenance Rules

1. **Every session** that touches architecture, SDK, or research → update this INDEX.md
2. **Session changelog** entry = what changed + what was learned + what's next (compact)
3. **Demos SDK capability map** → re-verify blocked items when SDK version changes
4. **Doc freshness tags** → audit quarterly or when doc is referenced and seems wrong
5. **No duplication with CLAUDE.md** — CLAUDE.md = how to USE the project. INDEX.md = how it's EVOLVING.
6. **New docs** get an INDEX.md entry on creation. No orphan docs.
