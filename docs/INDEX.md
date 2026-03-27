# demos-agents — Master Index

> **The one document you read to understand the project.**
> Architecture lives in CLAUDE.md. Operational knowledge lives in MEMORY.md. This file tracks the **evolving narrative** — what we're building, what Demos offers, what's working, what's next.

**Last updated:** 2026-03-28 | **SDK:** 2.11.5 | **Tests:** 125 suites, 1815 passing | **Agents:** 6 defined, 3 publishing | **Sources:** 229 catalog, 38 specs

---

## Project Narrative

demos-agents is an autonomous agent toolkit built ON the Demos Network. Demos is our infrastructure layer — identity, attestation, cross-chain operations, storage, messaging. We don't compete with Demos; we consume it.

**Where we are (March 2026):**
- Core loop works: 8-phase session (AUDIT→SCAN→ENGAGE→GATE→PUBLISH→VERIFY→REVIEW→HARDEN)
- 3 agents actively publishing to SuperColony (sentinel, crawler, pioneer)
- 20 plugins (9 session loop + 3 SC API + 4 omniweb real + 4 omniweb scaffold→silent-fail)
- Event-driven reactive loop alongside cron
- DAHR attestation pipeline functional. TLSN disabled 2026-03-25 — zero ecosystem adoption (0/145 feed posts), proof generation hangs 300s. All agents on `dahr_only`.
- Post-quantum wallet signing available (Falcon via Demos SDK)
- CCI identity queries wired (RPC-direct, bypassing NAPI crash in abstraction barrel)
- Claim-driven attestation (Phases 1-4): extract claims → surgical URLs → attest per-claim → verify values
- **Intent-driven signal detection pipeline (Phases 1-5 COMPLETE):** threshold/change/z-score detection, anti-signals with cross-source confirmation, source scanning CLI, session loop integration, convergence detection
- **Session transcript (H2 SHIPPED):** append-only JSONL event logger, phase metrics, query CLI
- **Operational hardening:** SourceUsageTracker, attestation retry with backoff, anti-signal double-fetch verification
- **Correlation analysis (n=68):** `predicted_reactions` gate disabled (r=-0.002, no predictive value). Quality gate threshold 7→1.
- **Attestation policy enforcement:** Executor respects `dahr_only`/`tlsn_preferred`/`tlsn_only`; claim-driven path no longer bypasses policy.
- **Test quality enforcement (anti-vibe-testing):** Two-layer gate prevents assertion-free tests — vitest globalSetup (hard gate) + PostToolUse hook (write-time warning).
- **Improvement dedup:** Fuzzy normalization strips numeric values and hex hashes, preventing 60+ duplicate improvements per agent.
- **Source URL resolution:** `buildCandidates` extracts URL params from static source URLs, broadcasts to operation variable aliases.

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

**Where we're going:**
- **Colony intelligence redesign:** Colony Mind 3-layer architecture. Blocked on colony census (supercolony.ai DNS down).
- **Toolkit evolution:** 5-PR migration `src/toolkit/` → `packages/core/` for npm packaging. Adapter packages for OpenClaw + ElizaOS. Audit cleanup complete — PR2-5 unblocked.
- **Desloppify target 85+:** 37 remaining review items. Need trusted review scores (--external-start path). Continue src/lib/ restructuring (33 flat files remain).
- Continue collecting quality_score data (17 entries, need 20+ with actuals for meaningful correlation)
- CCI identity as root → Agent Auth Protocol as session auth layer
- Deeper Demos SDK integration: ZK identity, encrypted messaging, L2PS privacy (when SDK unblocks)

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

| Document | Status | Updated | Purpose |
|----------|--------|---------|---------|
| [design-toolkit-architecture.md](design-toolkit-architecture.md) | `APPROVED` | 2026-03-27 | **Framework-agnostic toolkit design.** Taxonomy, three-layer architecture, decision log. Toolkit shipped: 10 tools, 6 guards, Zod validation, SSRF protection. |
| [session-loop-explained.md](session-loop-explained.md) | `current` | 2026-03-25 | Comprehensive session loop reference — 8-phase V1, V2 architecture, hooks, timing, bottlenecks |
| [loop-heuristics.md](loop-heuristics.md) | `current` | 2026-03-20 | **Single source of truth** for SCAN→GATE→PUBLISH pipeline, agent differentiation, 8 constitutional rules |
| [project-structure.md](project-structure.md) | `stale` | 2026-03-17 | Codebase tree + file descriptions. Test counts outdated (89 suites now). Missing signal-detection, transcript, source-scanner, test-quality-validator files. |
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
| [design-intent-driven-scanning.md](design-intent-driven-scanning.md) | `complete` | 2026-03-24 | Intent-driven source scanning (Phases 1-5). Council-reviewed. All phases implemented. |
| [design-session-transcript.md](design-session-transcript.md) | `complete` | 2026-03-24 | Session transcript H2. Council-validated (4×3 rounds) + Codex plan review (8 findings). Implemented. |
| [sdk-exploration-results.md](sdk-exploration-results.md) | `current` | 2026-03-18 | StorageProgram / DemosWork / L2PS blocker diagnosis. SDK 2.11.2 (now 2.11.4, blockers likely unchanged) |
| [TLSN-Report-KyneSys-2026-03-14.md](TLSN-Report-KyneSys-2026-03-14.md) | `current` | 2026-03-14 | MPC-TLS proxy relay failure diagnosis — KyneSys infrastructure issue |

### Roadmap & Planning

| Document | Status | Updated | Purpose |
|----------|--------|---------|---------|
| [roadmap-unified.md](roadmap-unified.md) | `stale` | 2026-03-20 | 7-phase plan: Phases 1-5 complete, Phase 6 blocked, Phase 7 systematic SDK integration. Superseded by signal detection + transcript work. |
| [roadmap-skill-dojo-local.md](roadmap-skill-dojo-local.md) | `current` | 2026-03-20 | Course correction: extract Skill Dojo as local SDK-direct implementations |
| [phase5-agent-composition-plan.md](phase5-agent-composition-plan.md) | `complete` | 2026-03-20 | Skill loader + manifest design. Codex-reviewed. Implemented: Phase 0 (hook internalization) + Phase 5 (loadExtensions). |

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
