# demos-agents — Master Index

> **The one document you read to understand the project.**
> Architecture lives in CLAUDE.md. Operational knowledge lives in MEMORY.md. This file tracks the **evolving narrative** — what we're building, what Demos offers, what's working, what's next.

**Last updated:** 2026-04-01 | **SDK:** 2.11.5 | **Tests:** 169 suites, 2200 passing | **Toolkit:** ~85 files | **Agents:** 6 defined, 1 active (sentinel) | **Sources:** 226 catalog | **ADRs:** 14

---

## Project Narrative

demos-agents is an autonomous agent toolkit built ON the Demos Network. Demos is our infrastructure layer — identity, attestation, cross-chain operations, storage, messaging. We don't compete with Demos; we consume it.

**Where we are (April 2026):**
- **V3 loop is LIVE** — SENSE/ACT/CONFIRM replaces 8-phase V1. Session 59 published 1 post with 4 DAHR attestations, verified on-chain.
- V2 available via `--legacy-loop`. V1 retired.
- Colony DB populated: 88 posts, 8 sources cached, cursor at block 1990525
- Strategy engine: 5 rules (publish_to_gaps, engage_verified, reply_to_mentions, reply_with_evidence, tip_valuable)
- DAHR attestation pipeline functional. TLSN disabled — zero ecosystem adoption. All agents `dahr_only`.
- **Full roadmap with tickable checklist:** See `docs/v3-roadmap.md` (14/23 items complete, 9 open)

**Shipped 2026-03-26:**
- **Speed fixes (5 optimizations, ~77s savings):** Removed --wait 15, skip indexer check, faster verify retries [3,5,10]s, harden findings cap at 10 (autonomous log-only), sense cache on V2 resume
- **Colony intelligence foundation:** `src/lib/colony-intelligence.ts` — AgentProfile, RelationshipEdge, ColonySnapshot, analyzeColony(), persistence. Census script ready.
- **Prediction market sources:** Polymarket (gamma-api) + Kalshi specs + 4 catalog entries. Claim types: probability, prediction.
- **Dev workflow conclusion:** Quality review trial settled — run both `/simplify` (codebase-aware) + Fabric `review_code` (correctness/security). Zero finding overlap.

**Shipped 2026-03-27/28:**
- **Toolkit security audit completed:** 28 findings resolved (3 Critical, 6 High, 12 Medium, 7 Low). DNS rebinding pin (createPinnedFetch), atomic spend cap (reservePaySpend with UUID rollback), chain-first tip resolution (RPC + 5s timeout), proto pollution defense (safeParse reviver), 0o600 file perms, getDemos gate, DAHR 30s timeout, 128-bit hash keys.
- **Desloppify grind (3 cycles):** Strict 81→81.7. Extracted shared feed parser (parseFeedPosts), deprecated 6 guard compat exports, typed DemosRpcMethods + D402ClientLike interfaces, removed dead code, fixed provenance responseHash, restructured src/lib/ into 4 subdirectories (auth/, llm/, attestation/, scoring/).
- **102 new tests** (1713→1815), 10 new suites. Boundary tests, connect error paths, domain filtering, feed parser shapes.
- **CLAUDE.md trimmed** 296→69 lines. Detail moved to `.ai/guides/` (cli-reference, gotchas-detail, dev-workflow).

**Where we're going (V3 roadmap, 2026-04-01):**
- **Phases 5.1-5.3 (unblocked, parallel):** hive-query CLI for on-chain inspection, reaction refresh in V3 sense, colony backfill for full chain history
- **Phases 5.4-5.6:** FTS5 full-text search, colony intelligence layer (agent profiles + interactions), sqlite-vec semantic search
- **Phase 6:** Strategy domain refactor (after 5.1-5.3)
- **Phases 7-8:** Strategy Phase 2 rules (event verifier, thread fan-out), advanced (proof ingestion, contradiction detection)
- See **[v3-roadmap.md](v3-roadmap.md)** for the full tickable checklist.

---

## Demos SDK Capability Map

What Demos offers vs what we use. **Updated each session.**

| Demos Capability | SDK Module | Our Status | Notes |
|-----------------|------------|------------|-------|
| **Wallet + Transactions** | `websdk` | ✅ Active | PQC (Falcon/ML-DSA) added 2026-03-20 |
| **SuperColony API** | `websdk` + fetch | ✅ Active | Feed, publish, react, tip — all working |
| **DAHR Attestation** | `websdk` (proxy) | ✅ Active | Primary attestation method |
| **TLSN Attestation** | `tlsnotary` | ❌ Disabled | MPC-TLS proof hangs 300s. Zero ecosystem adoption (0/145 feed posts). All agents `dahr_only` since 2026-03-25. |
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

| Document | Status | Purpose |
|----------|--------|---------|
| [project-structure.md](project-structure.md) | `current` | Codebase tree with colony/, strategy/, V3 CLI modules |
| [architecture-plumbing-vs-strategy.md](architecture-plumbing-vs-strategy.md) | `current` | Toolkit vs strategy boundary (ADR-0002 foundation) |
| [agent-workspace.md](agent-workspace.md) | `current` | YAML agent config format spec |
| [agent-auth-demos-cci-analysis.md](agent-auth-demos-cci-analysis.md) | `current` | Agent Auth Protocol + Demos CCI analysis |
| [attestation-reference.md](attestation-reference.md) | `current` | DAHR + TLSN design constraints and pipeline |
| [claim-driven-attestation-spec.md](claim-driven-attestation-spec.md) | `current` | Claim-driven attestation Phases 1-4 (implemented) |
| [design-intent-driven-scanning.md](design-intent-driven-scanning.md) | `complete` | Intent-driven source scanning Phases 1-5 (implemented) |
| [design-session-transcript.md](design-session-transcript.md) | `complete` | Session transcript — JSONL event logger (implemented) |

### Roadmap & Planning

| Document | Status | Purpose |
|----------|--------|---------|
| **[v3-roadmap.md](v3-roadmap.md)** | **`active`** | **Authoritative roadmap.** Tickable checklist (14/23 done). Phases 1-8. |
| [colony-tooling-plan.md](colony-tooling-plan.md) | `active` | Detail specs for Phases 5.1-5.6 |
| [colony-db-ingestion-plan.md](colony-db-ingestion-plan.md) | `active` | Colony DB ingestion + backfill spec |

### Archive (46 files)

| Directory | Contents |
|-----------|----------|
| `archive/` | 14 completed/superseded docs (V3 design, Phase 5 plan, V1/V2 loop docs, toolkit audit, TLSN report) |
| `archive/reference/` | 5 research docs (ElizaOS comparison, framework research, SDK exploration, Skill Dojo) |
| `archive/plans/` | 27 Claude Code session plan artifacts (declarative-adapters, source-registry-v2, chain-first-migration, etc.) |
| `decisions/` | 14 ADRs (architecture decision records, all with Status: accepted) |

**Project evolution narrative:** `~/.claude/diagrams/demos-agents-evolution.html`

---

## Session Changelog

Most recent first. Each entry captures what changed, what was learned, what's next.

### 2026-03-27 — Toolkit Shipped + Zod Validation

**Theme:** Framework-agnostic toolkit completion. Zod input validation across all 10 tools. SSRF security gap fixed.

**Delivered:**
- **Toolkit core complete:** 10 tools + 6 guards + SDK bridge + SSRF validator + state store in `src/toolkit/`. 168 toolkit tests, all with strong assertions.
- **Zod input validation:** `src/toolkit/schemas.ts` — 11 schemas (9 tool inputs + 2 policies), `validateInput()` helper, bidirectional compile-time type sync assertions. Design-reviewed (Fabric review_design + ask_secure_by_design_questions + Codex plan review). 8 findings addressed (4 critical, 4 medium).
- **SSRF security fix:** `publish.attestUrl` was passing directly to `bridge.attestDahr()` without SSRF validation. Now uses `validateUrl()` matching attest.ts and pay.ts pattern.
- **Chain-level wiring:** publish, tip, verify tools wired to SDK bridge chain primitives (publishHivePost, transferDem, attestDahr).
- **42 weak tests rewritten:** Toolkit test suite hardened — eliminated tautological/bypass tests, every test has strong assertions.

**Key decisions:**
- Zod validates shape/type only. Guards handle stateful rules (rate limits, spend caps, dedup). SSRF validator handles URL safety. No overlap.
- `types.ts` remains source of truth for interfaces. Schemas validate against them, not replace them.
- `.trim().min(1)` on all required strings — rejects whitespace-only inputs (Codex review finding).
- Policy schemas use `.strict()` — typos in spending limits are dangerous.

**Tests:** 112 suites, 1684 passing (up from 111/1605, +79 tests)

---

### 2026-03-25 — Agent Overhaul + Toolkit Architecture Vision

**Theme:** Speed, engagement, strategic direction. TLSN disabled, reply-first, tipping enabled, toolkit vision established.

**Delivered:**
- **Hook recursion fix:** `claude -p` was spawning recursive hooks (14+ per call). Fix: `--setting-sources ''` in CLIProvider. Root cause: UserPromptSubmit hooks spawned nested `claude` processes.
- **TLSN disabled:** Feed scan (145 posts) confirmed 0 TLSN attestations in ecosystem. `sourceAttestations` schema has no type field — TLSN invisible on-chain. All agents switched to `dahr_only`.
- **Reply-first strategy:** Reply targets moved from Bucket 3 to Bucket 1 in topic selection. `replyMinParentReactions` lowered to 3 (from 6-8). 0/82 posts were replies before this change.
- **Tipping enabled:** All agents, `minSessionsBeforeLive: 0`, `requireAttestation: false`.
- **Session speed:** 180s hard timeout, phase budgets slashed (30s each, publish 120s). Hardened plan v2 reviewed by First Principles + Architect agents — 2 items removed (audit skip, LLM parallelism), 5 items added (--wait 15, scan cache, hook latency, subprocess overhead, async harden).
- **minDisagreePerSession enforced:** Second-pass disagree scanner in engage.ts.
- **Quality data txHash:** Moved logging post-publish, backfill script for matching actuals.
- **A/B review trial logging:** CLI for tracking Fabric vs /simplify findings.
- **Session loop docs:** Comprehensive `session-loop-explained.md` + HTML visual.
- **Toolkit architecture vision:** demos-agents evolving from harness → framework-agnostic toolkit. Three-layer architecture (adapter → core → SDK). OpenClaw + ElizaOS as dual first-class targets. Design doc created (`design-toolkit-architecture.md`) with 6 open questions, decision log, iteration path.
- **4 sessions run:** sentinel-44 (1 post, 12.8min), crawler-14 (2 posts, 71.8min → TLSN timeouts), pioneer-38 (1 post, 66.4min → TLSN timeouts). All verified.

**Key findings:**
- TLSN is dead in ecosystem — zero adoption, schema doesn't distinguish it from DAHR
- `claude -p` recursive hook spawning was the root cause of LLM generation failures
- Indexer health check (30s) + verify --wait 15 (15s) = 45s pure waste per post
- Extension hooks run serially with up to 285s combined timeout — potential hidden bottleneck
- 85% of generic abstraction work already exists in codebase (src/types.ts, plugins, sources)

**Tests:** 92 suites, 1418 passing (up from 89/1383, +35 tests)
**Commits:** 9 pushed to main

---

### 2026-03-24/25 — Correlation Analysis, TLSN Reactivation, Test Quality Enforcement

**Theme:** Data-driven tuning — run sessions, collect data, let evidence drive decisions. Anti-vibe-testing enforcement.

**Delivered:**
- **7 bugs fixed:** attestation policy bypass (claim path ignored `dahr_only`), `tlsn_only` silent fallback, improvement dedup (exact→fuzzy), EMA bounds (-5→-15), DefiLlama URL (`compound`→`compound-finance`), defi preflight URL mismatch (declarative engine ignored source URL), CLI empty output retry.
- **Correlation analysis (n=68):** `predicted_reactions` has zero correlation with actuals (r=-0.002). TLSN 14.0 vs DAHR 6.1 avg reactions (2.3x). ANALYSIS 8.9 vs QUESTION 5.0 avg (1.8x). Threshold lowered 7→1.
- **TLSN reactivated:** MPC-TLS back online (diagnostic confirmed). All agents switched to `tlsn_preferred`.
- **Test quality enforcement:** Two-layer anti-vibe-testing gate (vitest globalSetup + PostToolUse hook). Validator handles braces in strings/templates/comments. 2 genuinely assertion-free tests fixed.
- **Improvement cleanup:** 115 stale items purged, fuzzy dedup prevents re-accumulation (normalizes numeric values + hex hashes).
- **H3/H1 evaluation:** Implement neither — phases are causally coupled, publish latency is blockchain (52% of session time), not orchestration. Council recommendation stands.
- **Transcripts validated:** H2 JSONL pipeline confirmed working, query CLI operational.
- **12 quality_score data points** collected (6 sentinel, 6 pioneer) — past threshold for future analysis.

**Key findings:**
- The LLM cannot predict social dynamics (6.0rx systematic over-prediction)
- Attestation type is the strongest engagement signal, not content quality
- "Markdown instructions are suggestions; code modules are laws" — structural enforcement beats prompt-based rules
- URL param extraction needs broadcast to ALL operation variable aliases, not just the named variable
- Improvement dedup fails when numbers change between sessions ("over-prediction by 13.0rx" ≠ "10.6rx")

**Tests:** 89 suites, 1383 passing (up from 87/1355, +28 tests)
**Commits:** 10 pushed to main

---

### 2026-03-24 — Session Transcript (H2) Shipped

**Theme:** Observability — append-only JSONL event logger for session replay, correlation, and fine-tuning.

**Delivered:**
- **Council debate (4×3)** on 5 mini-swe-agent hypotheses. Unanimous: H2 first, H4/H5 rejected.
- **Design doc** (`design-session-transcript.md`) with Codex plan review (8 findings addressed).
- **Transcript module** (`src/lib/transcript.ts`): emit/read/prune, schema v1 with versioning.
- **Session-runner integration** — 6 emit points (session-start/complete, phase-start/complete/error).
- **Phase metrics extraction** — per-phase data/metrics with verified result paths.
- **Query CLI** (`cli/transcript-query.ts`) — latency bars, aggregates, --pretty/--json.
- **Retroactive Codex review** of Steps 1+2 (workflow violation caught and corrected).

**Tests:** 87 suites, 1355 passing (up from 86/1341)
**Commits:** 6 (transcript module + wiring + metrics + query CLI + 2 review fixes)

---

### 2026-03-23 — Signal Detection Pipeline Complete + Session Audit

**Theme:** Ship all 5 phases of intent-driven scanning in one session, run + audit live sessions, fix operational issues.

**Delivered:**
- **Phase 2:** Source scanner CLI + intent spec (`cli/source-scan.ts`, `src/lib/source-scanner.ts`)
- **Phase 3:** Anti-signal detection with cross-source confirmation
- **Phase 4:** Session loop integration (runSourceScan + mergeAndDedup in SCAN/GATE phases)
- **Phase 5:** Z-score adaptive thresholds, multi-window baselines, convergence detection
- **5 live sessions** (2 sentinel, 3 pioneer) — all published, all verified
- **Session audit** — 6 findings: pioneer calibration fixed (-10), HARDEN JSON parse fixed
- **Operational hardening** — SourceUsageTracker wired, attestation retry, anti-signal double-fetch
- **Dev workflow corrected** — Fabric review_code for Tier 2+, summarize_git_diff on all commits, fix-all-findings rule
- **mini-swe-agent research** — explored patterns, creative ideation, council debate → H2 plan

**Key findings:**
- Fabric review_code and Codex commit review are complementary (different detection domains)
- Source scan 0 signals on first run is expected (baselines need population)
- Algorithm and dev workflow are unconnected systems (PAI gap documented)

**Tests:** 87 suites, 1341→1355 passing
**Commits:** 18+ (signal phases + audit fixes + workflow + transcript)

---

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
