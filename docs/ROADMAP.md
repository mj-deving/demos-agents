---
type: roadmap
status: active
updated: 2026-04-08
open_items: 12
completed_phases: 14
tests: 3087
suites: 253
tsc_errors: 0
api_endpoints: 38
strategy_rules: 10
colony_posts: 202000
catalog_sources: 247
summary: "Phases 1-14 complete. Session 93: 2 posts published on-chain (verified). 0-post problem solved via 6 surgical fixes across sessions 89-93. Agent publishes 1-2 posts/session reliably. 33 ASSET_MAP entries. Match threshold 9. Topic angle rotation on self+colony dedup."
read_when: ["roadmap", "phase 7", "phase 8", "open items", "deferred", "tech debt", "next steps", "what's next", "backlog", "future work"]
---

# Roadmap

> Authoritative execution tracker. Every open item is here.
> Completed work lives in `docs/INDEX.md` history. Specs in `docs/archive/`.

## Current Status

- **V3 loop:** LIVE with toolkit primitives replacing raw apiCall enrichment
- **Phase 9:** COMPLETE (DataSource abstraction, 15 domain primitives, v3-loop wiring, API backfill, drift detection)
- **Tests:** 3087 passing, 253 suites, **0 tsc errors**
- **Toolkit:** `createToolkit()` facade with 15 namespaces (feed, intelligence, scores, agents, actions, oracle, prices, verification, predictions, ballot, webhooks, identity, balance, health, stats)
- **API Client:** 38/38 endpoints (35 in client, 3 in dedicated modules). 100% coverage.
- **Strategy Engine:** 10 rules in 3 modules (5 core + 4 enrichment + 1 contradiction). Auto-calibration. Leaderboard meta-rule. FTS5 dedup. VOTE/BET rate limiting + session budget guard. Score-100 tuning: confidence threshold, agent minimum, cross-domain bonus.
- **Colony DB:** 188K posts. Schema v8. 605MB. Semantic search wired. Pruning available.
- **ADRs:** 18 (ADR-0018 supersedes ADR-0001 for reads — API-first, chain fallback)
- **Phase 11:** COMPLETE — 7 legacy session-runner patterns adopted as toolkit primitives (76 new tests)
- **Phase 12:** COMPLETE — boundary moves (matcher/policy/lifecycle to toolkit), SENSE health filtering + rate limiting + lifecycle, 3 new macro sources, getSourceHealthSummary primitive
- **Phase 13:** COMPLETE — all 8 tasks. Evidence matching, richness normalization, asset sources, dead config cleanup, E2E test, coverage matrix, strategy audit.
- **Phase 14:** COMPLETE — topic angle rotation, 15 more asset sources, enrichment bridge, endurance sessions 89-93 (2 posts in session 93).
- **Session fixes (89-93):** asset alias case, publish cap, colony dedup rotation, match threshold 9.
- **Next:** See Future items below. npm publish supercolony-toolkit ready.

---

## Open Items

### Phase 5.6: Semantic Search — COMPLETE

- [x] 5.6a -- Colony DB migration v7: sqlite-vec vec0 table (384-dim float32) + post_embeddings tracking
- [x] 5.6b -- Embedding pipeline: `embeddings.ts` with bge-small-en-v1.5 (q8, lazy-loaded, ~33ms/embed)
- [x] 5.6c -- Hybrid search: FTS5 BM25 + vec0 cosine KNN → Reciprocal Rank Fusion (k=60, weights configurable)
- [x] 5.6d -- backfillEmbeddings() for processing existing 188K posts
- [x] 5.6e -- vendor shim: loadExtension() + enableLoadExtension() + allowExtension option

**Spec:** `docs/archive/colony-tooling-plan.md` P5 + `.ai/guides/colony-db-research.md`
**Completed:** 2026-04-04. Model: Xenova/bge-small-en-v1.5 (384-dim, q8 quantized). 9 new tests.

---

### Phase 7: Strategy Phase 2 Rules — COMPLETE

- [x] 7a -- Event verifier for non-numeric claims (3-tier: field match, keyword, LLM semantic)
- [x] 7b -- Strategy Phase 2 rules (9 rules: 5 core + 4 enrichment-aware, all from design-loop-v3.md §6)
- [x] 7c -- Contamination check in faithfulness gate (unattested factual claims detected)
- [x] 7d -- Thread fan-out: `planThreadFanOut()` in `src/toolkit/publish/thread-fan-out.ts`
- [x] 6-defer-d -- adapt_to_leaderboard meta-rule: `applyLeaderboardAdjustment()` with YAML config
- [x] 6-disc-c -- Pluggable rule registry (YAML-based via `config-loader.ts`)
- [x] 6-disc-d -- Colony report consumption: `briefingContext` in DecisionContext, priority boost
- [x] 6-disc-e -- Identity lookup enrichment: `socialHandles` in agent profiles, `identityLookup` param
- [x] 6-disc-j -- ENGAGE txHash resolution: `targetType` discriminant + `resolveAgentToRecentPost()`

**Spec:** `docs/archive/design-loop-v3.md` sections 4-6 + `docs/archive/phase7-design.md`
**Completed:** 2026-04-03

---

### Phase 8: Advanced — COMPLETE

- [x] 8a -- Proof ingestion: `resolveAttestation()` + `ingestProofs()` + schema v5 (chain_verified)
- [x] 8b -- Contradiction detection: `contradiction-scanner.ts`, metric windows, self-exclusion, `disagree_contradiction` rule
- [x] 8c -- Verified engagement: `VerificationGate` enum, ENGAGE allows verified+unresolved, TIP requires verified
- [x] 8d -- Colony intelligence: `buildColonyIntelligence()`, claim freshness, evidence quality, colony health
- [x] 6-disc-a -- VOTE action type: `vote-bet-codec.ts` (Zod-validated HIVE_BET, 0.1-5 DEM, 7-day expiry)
- [x] 6-disc-b -- Binary market bets: HIVE_BINARY codec, publish-executor handler, heavy path routing
- [x] 6-disc-f -- XMCore cross-chain reads: `napi-guard.ts` with child_process.fork() SIGSEGV isolation
- [x] 6-disc-g -- SSE/webhook consumption: `sse-sense-adapter.ts`, time-bounded, wired into v3-loop SENSE

**Spec:** `docs/archive/design-loop-v3.md` sections 5+6b + `Plans/phase8-all-features-design-reviewed.md`
**Completed:** 2026-04-03. Triple-reviewed (Fabric design + threat model + Codex). 15 new files, +2300 lines, +82 tests.

---

### Refactor: engine.ts split — COMPLETE

- [x] Split `src/toolkit/strategy/engine.ts` (603 lines) into focused modules
  - Core rules + rate limiting + candidate selection → `engine.ts` (331 lines)
  - Shared helpers + applyLeaderboardAdjustment → `engine-helpers.ts` (168 lines)
  - Enrichment-aware rules → `engine-enrichment.ts` (141 lines)
  - Contradiction rule → `engine-contradiction.ts` (49 lines)
- [x] Wire `checkSessionBudget()` into VOTE/BET executor with `spending: { policy, ledger }` deps
- [x] Persist ledger to disk after successful bet via `saveSpendingLedger()`
- [x] Hard-reject VOTE/BET when spending deps missing or amount invalid (defense-in-depth)

**Completed:** 2026-04-04. Re-export from `engine.ts` for backward compat. 6 new tests (+2548 total). Triple-reviewed (simplify + Codex). 5 review findings fixed, 3 deferred with assessment.

---

### Phase 9: API-First Toolkit Primitives (ADR-0018)

> The toolkit's value proposition: agent builders call one typed method, we handle API/chain routing, fallback, auth, caching, error handling. All 38 API endpoints + SDK methods wrapped as clean primitives.

**9.1 — Foundation** — COMPLETE
- [x] 9a -- DataSource abstraction: `ApiDataSource` + `ChainDataSource` + `AutoDataSource` in `src/toolkit/data-source.ts`
- [x] 9b -- API-based colony backfill: `src/toolkit/colony/api-backfill.ts` with cursor pagination
- [x] 9c -- API drift detection tool: `cli/api-health-check.ts` — validates 13 endpoints, reports MATCH/DRIFT/GONE/ERROR
- [x] 9d -- Wire toolkit primitives into v3-loop SENSE phase: `createToolkit()` replaces raw `apiCall()` enrichment
- [x] 9e -- Remove dead `publishHiveReaction` on-chain code (already removed from src/)

**9.2 — P0 Toolkit Primitives (core SENSE + strategy)** — COMPLETE
- [x] 9f -- `toolkit.feed.getRecent()` — delegates to `apiClient.getFeed()`, full FeedResponse
- [x] 9g -- `toolkit.feed.search()` — wraps `apiClient.searchFeed()`
- [x] 9h -- `toolkit.feed.getPost()` — delegates to `dataSource.getPostByHash()` (API-first, chain fallback)
- [x] 9i -- `toolkit.feed.getThread()` — delegates to `dataSource.getThread()` (API-first, chain fallback)
- [x] 9j -- `toolkit.intelligence.getSignals()` — wraps `apiClient.getSignals()`
- [x] 9k -- `toolkit.intelligence.getReport()` — wraps `apiClient.getReport()`

**9.3 — P1 Toolkit Primitives (engagement + context)** — COMPLETE
- [x] 9l -- `toolkit.scores.getLeaderboard()` — wraps `apiClient.getAgentLeaderboard()`
- [x] 9m -- `toolkit.agents.list()` / `.getProfile()` — wraps `apiClient.listAgents()`, `.getAgentProfile()`
- [x] 9n -- `toolkit.actions.tip()` — 2-phase: API validation (`initiateTip`) + chain transfer (`transferDem`)
- [x] 9o -- `toolkit.oracle.get()` / `toolkit.prices.get()` — wraps `apiClient.getOracle()`, `.getPrices()`
- [x] 9p -- `toolkit.agents.getIdentities()` — wraps `apiClient.getAgentIdentities()`

**9.4 — P2 Toolkit Primitives (verification + predictions)** — COMPLETE
- [x] 9q -- `toolkit.verification.verifyDahr()` / `.verifyTlsn()` — wraps `apiClient.verifyDahr()`, `.verifyTlsn()`
- [x] 9r -- `toolkit.predictions.*` — query, resolve, markets via apiClient
- [x] 9s -- `toolkit.ballot.*` — state, accuracy, leaderboard, performance via apiClient

**9.5 — P3 Toolkit Primitives (infrastructure)** — COMPLETE
- [x] 9t -- `toolkit.webhooks.*` — list, create, delete via apiClient
- [x] 9u -- `toolkit.identity.lookup()` — unified: platform, search, or chain address routing
- [x] 9v -- `toolkit.balance.get()` — wraps `apiClient.getAgentBalance()` (API-only)
- [x] 9w -- `toolkit.health.check()` + `toolkit.stats.get()` — wraps apiClient public endpoints

**Spec:** ADR-0018, API ref (`docs/research/supercolony-api-reference.md`), SDK ref (`docs/research/demos-sdk-capabilities.md`), coverage matrix (`docs/toolkit-coverage-matrix.md`)
**Design principle:** Every primitive tries API first (faster, richer), falls back to chain/SDK, has Zod-validated responses, handles auth refresh. Agent builder sees one clean typed call.
**Completed:** 2026-04-06. 19 source files, 17 test files, 73 new tests. `createToolkit()` facade at `src/toolkit/primitives/index.ts`.

### API Type Alignment (tracked — next session)

Live API audit (2026-04-06) found 8 TypeScript type mismatches vs real API responses. Oracle already fixed. See `docs/research/supercolony-api-reference.md` section 13b for full details.

| Endpoint | Severity | Issue |
|----------|----------|-------|
| `/api/prices` | Critical | `PriceData { asset, price }` → real is `{ ticker, priceUsd }` in `{ prices[] }` wrapper |
| `/api/signals` | Critical | Bare `SignalData[]` → real is `{ consensusAnalysis[] }` wrapper. `consensus` is boolean. |
| `/api/stats` | Critical | Flat fields → real is nested `{ network, activity, quality, ... }` |
| `/api/predictions` | Medium | Bare array → `{ predictions[], total }` wrapper |
| `/api/predictions/markets` | Medium | `market` → `marketId`, flat outcomes |
| `/api/report` | Medium | `content`/`timestamp` → `summary`/`script`/`createdAt`/`publishedAt` |
| `/api/health` | Low | Missing `uptime`, `memory`; no `version` |
| `/api/bets/pool` bets | Low | `agent`/`price` → `bettor`/`predictedPrice` |

- [x] Fix PriceData type + schema + consumers
- [x] Fix SignalData type + schema + consumers
- [x] Fix NetworkStats type
- [x] Fix Prediction/PredictionMarket wrapper types
- [x] Fix ReportResponse type
- [x] Fix HealthStatus type
- [x] Fix BettingPool bet item fields
- [x] Fix AgentProfile `totalPosts` → `postCount`

### Phase 11: Pattern Adoption — Legacy Session-Runner → Toolkit Primitives

> 7 battle-tested patterns extracted from cli/session-runner.ts (4528 lines, legacy 8-phase loop)
> and implemented as toolkit-layer primitives for auto-flow to agent templates.
> Source: `docs/archive/session-runner-patterns.md` (extracted 2026-04-07).

- [x] 11a -- `src/toolkit/util/subprocess.ts` — SIGTERM→SIGKILL kill escalation (from session-runner.ts:702-710)
- [x] 11b -- `src/toolkit/util/timed-phase.ts` — Budget-aware async wrapper with overage observation (from session-runner.ts:625-635)
- [x] 11c -- `src/toolkit/sources/prefetch-cascade.ts` — Try N source candidates with fallback logging (from session-runner.ts:2229-2290)
- [x] 11d -- `src/toolkit/publish/quality-gate.ts` — Pre-publish validation: text length, reactions, category (from session-runner.ts:2325-2335)
- [x] 11e -- `src/toolkit/util/hook-dispatch.ts` — Isolated hook runner with timeout + isTimeout distinction (from session-runner.ts:3386-3406)
- [x] 11f -- `src/toolkit/strategy/topic-expansion.ts` — Generic→specific topic mapping with source coverage check (from session-runner.ts:1221-1249)
- [x] 11g -- `src/toolkit/colony/agent-index.ts` — Agent quality index + convergence detection (from session-runner.ts:1261-1271)

**Design principle:** All primitives in `src/toolkit/` — no `cli/` dependencies. Templates get them for free via `createToolkit()` / `createAgentRuntime()`.
**Provenance:** Each item traces to specific session-runner.ts line ranges. See archive doc for full analysis (ADOPT/PRESERVE/DEAD classification).

**Deferred patterns (PRESERVE — implement when triggered):**
- Version-gated resume: enforce when V3 resume is added (session-runner.ts:4109-4119)
- Fresh-cache TTL: SENSE result caching for 5 min on restart (session-runner.ts:3410-3427)

### Phase 12: Source Subsystem — ADR-0002 Moves + Activation + Coverage — COMPLETE

> Completed 2026-04-07. Boundary moves, SENSE wiring, macro sources, lifecycle primitive.

**12a — Move mechanism code to toolkit (ADR-0002 boundary):** COMPLETE
- [x] `src/lib/sources/matcher.ts` (826 lines) → `src/toolkit/sources/` — claim extraction + evidence scoring is mechanism
- [x] `src/lib/sources/policy.ts` (314 lines) → `src/toolkit/sources/` — preflight + source selection is mechanism
- [x] `src/lib/sources/lifecycle.ts` (356 lines) → `src/toolkit/sources/` — rating/status transitions is mechanism
- [x] 2-line re-export shims at old paths. URL helpers extracted to `src/toolkit/chain/url-helpers.ts`.
- [x] Boundary test passes: matcher.ts + policy.ts in KNOWN_RUNTIME_EXCEPTIONS (strategy deps: providers, attestation-policy, transcript). Type-only cap raised to 11.

**12b — Activate unused source infrastructure in v3-loop:** COMPLETE
- [x] Health filtering — degraded/stale/deprecated/archived sources auto-skipped in SENSE source selection
- [x] Rate limiting — per-source token bucket applied before each fetch in fetchSourcesParallel
- [x] Lifecycle — updateRating + evaluateTransition called after each source fetch; transitions logged via observer
- [x] `getSourceHealthSummary()` toolkit primitive — aggregate health stats for agent templates
- [x] prefetch-cascade — DEFERRED: architecture mismatch (source resolution produces single candidate, not list). Needs source resolution redesign to produce ranked candidate list. See Future Items.

**12c — Source coverage:** COMPLETE
- [x] 3 new macro/market sources added to catalog: crypto-fear-greed (sentiment), coingecko-global-market (dominance/cap), defillama-global-tvl (DeFi TVL). All quarantined pending lifecycle promotion.
- [x] Source freshness: fetchSourcesParallel always fetches fresh (no stale cache served). source_response_cache has TTL but is response cache for colony DB, not substitution for live fetches.
- [x] Coverage gap documentation: yield curve feeds (FRED requires API key), VIX (CBOE requires auth), central bank policy (ECB API has non-JSON format). Tracked in Future Items.

### Phase 13: System Tightening — Fix All Publish Paths

> Goal: Every session publishes 1-2 posts. Currently 0 posts common (sessions 84-88).
> All 7 tasks Codex-delegatable. Spec: `docs/phase13-system-tightening.md`
> Visual lifecycle: `docs/v3-loop-capability-map.md`

**Batch 1 (safe/diagnostic — run in parallel):**
- [x] 13a -- Fix publish_to_gaps evidence matching: phrase-key tokenizer (`findTopicEvidenceMatches`) closes gap between multi-word evidence subjects and gap tokens. Debug logging via `DEMOS_DEBUG_PUBLISH_TO_GAPS=1`.
- [x] 13b -- Add missing asset sources to catalog: ARB, XRP, SOL, OP (new CoinGecko simple/price); LINK, DOT, AVAX set to quarantined. 7 assets now attestable.
- [x] 13c -- publish_prediction rule: enabled, not a code bug. Blocker is data availability — SENSE hardcodes `getPool({ asset: "BTC" })`. Fetch pools for multiple assets to increase firing rate (future improvement).
- [x] 13g -- Strategy config audit: only 2/10 rules reachable (reply_to_mentions, tip_valuable). 8 rules blocked by missing apiEnrichment/evidence bridges in defaultObserve(). Dead config: divergenceThreshold, minBallotAccuracy, disagreesPerCycle, maxPublishPerSession.

**13c future improvement:** publish_prediction is the simplest publish path — just needs bettingPool + prices. Fetch pools for multiple assets (not just BTC) to dramatically increase firing rate.

**13g critical finding — two data pipelines:**
The strategy engine has 10 rules, but the agent-loop path (`defaultObserve()`) returns `evidence: []` and no `apiEnrichment` — only 2/10 rules reachable (reply_to_mentions, tip_valuable). The v3-loop path has its own SENSE phase (`fetchApiEnrichment()`) that populates leaderboard, oracle, prices, bettingPool, signals — so all 10 rules are *wired* in v3-loop, but some are blocked by data quality issues (evidence matching, richness semantics, source coverage).

**Dead config values (loaded but never used):** `enrichment.divergenceThreshold`, `enrichment.minBallotAccuracy`, `rateLimits.disagreesPerCycle`. `limits.maxPublishPerSession` is loaded but v3-loop already injects it separately at `v3-loop.ts:219`.

**Batch 2 (fixes — v3-loop focus, informed by Batch 1 diagnostics):**
- [x] 13d -- Richness normalization: log-scale (bytes → 0-95 score). Math.round (neutral rounding, Codex review fix). MIN_PUBLISH_EVIDENCE_RICHNESS=50. Filter now functional.
- [x] 13e -- Catalog coverage matrix: `docs/catalog-coverage-matrix.md`. 10/50 top assets have multi-provider coverage, 36/50 have 0 sources.
- [x] 13f -- E2E publish path integration test: all 4 publish paths verified in single test (`tests/cli/publish-path-e2e.test.ts`).
- [x] 13h -- Dead config cleanup: removed divergenceThreshold, minBallotAccuracy, disagreesPerCycle from types/loader/yaml/bridge/template.

**Codex review fixes (post-Phase 13):**
- [x] Richness: Math.ceil → Math.round (neutral rounding, no upward bias)
- [x] Evidence matching: single-token overlap → 2+ token overlap (prevents false-positive matches via generic terms)

### Phase 14: Publish Reliability — Topic Rotation + Coverage

> Goal: Sessions 89-92 consistently publish 1-2 posts across multiple paths.
> Builds on Phase 13 fixes (evidence matching, richness normalization, source coverage).

**14a — Topic angle rotation (strategy design + implementation):**
Post-dedup rotation in publish-executor.ts. When self-dedup blocks a signal-aligned publish, generate an alternative angle using existing vocabulary (expandTopic, expandTopicToDomains, oracle divergences, temporal framing). No LLM needed for angle generation — only for the draft step which already receives topic as input. Retry once with angled topic.
- [x] 14a-1: Angle generation function in toolkit/strategy/topic-angle.ts (pure, deterministic)
- [x] 14a-2: Post-dedup retry logic in publish-executor.ts (self-dedup → angle → re-check)
- [x] 14a-3: 7 tests for angle generation (divergence, expansion, temporal, edge cases)
- [x] 14a-4: Uses oracle divergence data + temporal/analytical framing (expansion map injectable)

**14b — Expand catalog: 15 more top-50 assets (Codex-delegatable):**
Add CoinGecko simple/price sources for: BNB, ADA, DOGE, TRX, SHIB, TON, SUI, NEAR, APT, HBAR, BCH, ICP, FIL, RENDER, UNI. Same format as existing entries. Status: quarantined. Unblocks divergence publishes for more assets.
- [x] 14b: 15 CoinGecko asset sources added (BNB ADA DOGE TRX SHIB TON SUI NEAR APT HBAR BCH ICP FIL RENDER UNI). 247 total catalog sources.

**14c — Agent-loop enrichment bridge (medium-large):**
Wire apiEnrichment into defaultObserve() using executor injection pattern (ADR-0019). Extract fetchApiEnrichment() to shared toolkit location (ADR-0002 boundary compliance). Templates opt-in to enrichment at startup. Unblocks 8/10 rules for template-based agents.
- [x] 14c-1: Extract fetchApiEnrichment to src/toolkit/api-enrichment.ts (ADR-0002 compliant)
- [x] 14c-2: ObserveResult.context already supports Partial<DecisionContext> — no type change needed
- [x] 14c-3: enrichedObserve() in agent-loop.ts — defaultObserve + apiEnrichment via dynamic import
- [x] 14c-4: 5 tests for extracted module (partial failure, total failure, logging, config)

**14d — Live endurance sessions 89-92 (automated + manual review):**
Run 4 sentinel sessions to validate Phase 13+14 fixes. Monitor: posts/session, which paths fire, evidence quality, richness filtering, dedup behavior. Target: 2/4 sessions publish 1+ post, 2+ different paths fire.
- [x] 14d: Sessions 89-93 run. Session 93: 2 posts published, 2/2 verified in feed. 4 session-diagnosed fixes applied (asset alias, publish cap, colony dedup rotation, match threshold).

### Phase 15: Infrastructure Depth — Omniweb Intelligence + Persistence + Retirement

> Goal: Transform from crypto commenter to omniweb intelligence publisher. Persist source lifecycle. Retire legacy code.
> Spec: `docs/phase15-infrastructure-depth.md`

- [ ] 15a -- Dynamic pool + prediction market discovery: fetch pools for ALL oracle-tracked assets + wire Polymarket prediction markets. No hardcoded asset lists.
- [ ] 15b -- Source activation sweep + macro adapters: (1) audit + batch-promote quarantined sources that already work, (2) build FRED/VIX/ECB adapters, (3) broaden strategy topic weights beyond crypto.
- [ ] 15c -- Source registry as DB: colony DB migration v9, source_lifecycle table, persist ratings/transitions across sessions.
- [ ] 15d -- Prefetch cascade: selectSourceForTopicV2 returns ranked list, fallback on fetch failure.
- [ ] 15e -- Session-runner retirement: audit→port→slim→deprecate. 17 shared imports. Low priority.

**Batch 1** (parallel): 15a-1/2 (pool discovery) + 15b-1 (catalog audit) + 15c-1/2 (DB schema+store)
**Batch 2** (parallel): 15b-2 (batch promote) + 15b-3 (FRED) + 15a-3/4 (prediction markets) + 15c-3/4 (lifecycle wiring)
**Batch 3**: 15b-4/5/6 (VIX + ECB + strategy weights) + 15d (prefetch cascade)
**Batch 4** (large): 15e (session-runner retirement)

### Future (no phase assigned)
- [ ] 6-disc-h -- Escrow to social identity: tip by Twitter/GitHub handle without wallet
- [ ] 6-disc-i -- ZK identity proofs for privacy-preserving attestation
- [ ] StorageProgram exploration: SDK structured on-chain storage for HIVE data
- [ ] ElizaOS adapter: deprecate or remove (0 production consumers)
- [ ] Remove deprecated signals.ts/signals-plugin.ts (delete when session-runner retires)

---

## Dependency Graph

```
Phase 1-4 (DONE) --> Phase 5 (DONE) --> Phase 6 (DONE) --> Phase 7 (DONE) --> Phase 8 (DONE)
                       |                                                          |
                       +-> 5.6 semantic search (DONE)                             +-> Tech debt sweep (DONE)
                       |                                                          |
                       +-> Future (independent, no blockers)                      +-> Phase 9: API-first (ADR-0018)
                                                                                      9a DataSource abstraction
                                                                                      9b API backfill
                                                                                      9c Drift detection
                                                                                      9d Wire into v3-loop
                                                                                      9e Remove dead reaction code
```

---

## Tech Debt

| Item | Target | Metric |
|------|--------|--------|
| ~~Double-fetch in V3 loop (scan-feed + colony ingestion both call getHivePosts)~~ | ~~2026-04-14~~ | **DONE 2026-04-04** — pre-fetched posts passed to ingestChainPostsIntoColonyDb. scan-feed subprocess still fetches independently (process isolation). |
| Cursor not functional (SDK has no sinceBlock param) | When SDK adds pagination | Track SDK releases |
| ~~Add composite index `(author, timestamp)` on posts for `resolveAgentToRecentPost` perf~~ | ~~When engagement volume grows~~ | **DONE 2026-04-04** — schema v8 migration |
| ~~TLSN comparison: structural key-value matching instead of substring~~ | ~~Future~~ | **DONE 2026-04-04** — structural JSON matching with deep value + substring fallback |
| ~~DAHR/TLSN detection: require both url+responseHash for DAHR, serverName+recv for TLSN~~ | ~~Future~~ | **DONE 2026-04-04** — AND validation in isDahrTransaction + isTlsnProofData |
| ~~Concurrency guard: prevent double-processing in `ingestProofs` when scans overlap~~ | ~~Future~~ | **DONE 2026-04-04** — claimed_at timestamp with 5-min expiry + releaseExpiredClaims |
| ~~Edge case tests: DAHR empty data, TLSN empty recv, boolean snapshot values~~ | ~~Future~~ | **DONE 2026-04-04** — 8 new tests in proof-resolver.test.ts |
| Integration tests for strategy bridge (briefingContext, identityLookup, targetType) | Future | Unit tests exist, integration tests require full LLM+bridge mock |
| Identity API shape: v3-loop `identityLookup` may always produce `platform: "unknown"` | Future | Documented — live API not accessible for verification |
| socialHandles in agent profiles unused by engine rules | Future | Infrastructure ready, awaiting consumer rule |
| ~~claim_ledger.verified based on self-reported snapshot, not chain-verified data (`scanner.ts`)~~ | ~~Future~~ | **DONE 2026-04-04** — reconcileClaimVerification() downgrades on chain_verified=-1 |
| ~~API responses cast to generic T without runtime validation~~ | ~~Future~~ | **DONE 2026-04-04** — Zod schemas for 5 critical enrichment types in api-schemas.ts |
| ~~LLM prompt injection via briefingContext~~ | ~~Future~~ | **DONE 2026-04-04** — sanitized: strip control chars + injection tags, 500 char truncation |
| ~~Cache contradiction scan results with TTL (avoid recomputing 188K posts each iteration)~~ | ~~Future~~ | **DONE 2026-04-04** — in-memory TTL cache with MAX_CACHE_SIZE + invalidation |
| SSE endpoint configuration (URL, auth, reconnect backoff) — endpoint not yet stable | Future | Review finding 2026-04-03 |
| ~~Bet outcome tracking: reserve schema field for settlement status~~ | ~~Future~~ | **DONE 2026-04-04** — bet_tracking table in schema v8 |
| ~~Colony DB periodic pruning at scale (293MB and growing)~~ | ~~Future~~ | **DONE 2026-04-04** — prunePosts() with temp table, transaction, FK preservation |
| Wire AbortSignal through fetchSource for wall-clock budget enforcement | Future | Review finding 2026-04-04 — FetchSourceOptions interface change |
| ~~publish-executor.ts at 792 lines~~ | ~~Future~~ | **DONE 2026-04-04** — split to publish-executor (431) + publish-helpers (323) + publish-types (78) |
| ~~v3-loop.ts at 618 lines~~ | ~~Future~~ | **DONE 2026-04-04** — split to v3-loop (499) + v3-loop-helpers (126) |

### Recently Resolved

| Item | Resolved |
|------|----------|
| Wire `ingestProofs()` into v3-loop | 2026-04-03 — wired in SENSE phase |
| Retry cap on retryable attestation failures | 2026-04-03 — retry_count in schema v6, 5-retry cap |
| Unified daily spending cap | 2026-04-03 — checkSessionBudget() in spending-policy.ts |
| Parallel RPC concurrency unbounded | 2026-04-03 — p-limit(5) in proof-ingestion-rpc-adapter |
| TLSN storage fee uncapped | 2026-04-04 — Math.min(storageFee, 15) cap |
| SSE feed event cast without schema validation | 2026-04-04 — Zod SSEPostSchema with safeParse |
| File paths leaked in error messages | 2026-04-04 — sdk.ts already sanitized, agent-config.ts redacted |
| Raw error .toString() coercion in event-service.ts | 2026-04-04 — err.message pattern |
| External JSON.parse without safeParse | 2026-04-04 — generic.ts/declarative-engine.ts are deprecated shims; source-discovery.ts already in try/catch; sse-feed.ts now uses Zod |
| Runtime guard for unrecognized targetType | 2026-04-04 — already has default case with skip + observe |
| Faithfulness gate has no chain verification dependency | N/A — by design, documented |

### Deferred Evaluation (assessed as acceptable — revisit periodically)

| Item | Original Assessment | Revisit When |
|------|-------------------|--------------|
| `scoreAttestability` in thread-fan-out parallels `scoreClaim` in signal-first-pipeline | Intentionally different heuristics (attestability vs signal strength) | If scoring logic drifts or a unified scorer is needed |
| Two priority mutation patterns (briefing boost + leaderboard adjustment) | Info — no abstraction needed for 2 sites | If a 3rd priority modifier is added |
| `getRule` vs `findRule` near-duplicate in engine-helpers.ts | `findRule` fabricates default for rejection logging; different return type | If a 3rd lookup pattern is added |
| Stringly-typed targetType ("post"\|"agent") acceptable for 2 values | TypeScript union enforces compile-time | If a 3rd target type is added |
| Swallowed error in `resolveAgentToRecentPost` — no observer access | Standalone helper in action-executor.ts, can't thread observer | If debugging engagement failures |
| N+1 DB queries for agent profiles via `getAgentProfile` (uncached prepare per call) | Pre-existing pattern across colony modules | When profile count exceeds 50 per batch |
| `applyLeaderboardAdjustment` toLowerCase per entry — negligible at <100 entries | O(N) on small N | If leaderboard exceeds 1000 agents |
| Magic number '-48 hours' in `resolveAgentToRecentPost` | Acceptable hardcode for recency window | If window needs tuning per agent/config |
| Test policy objects use wrong property names (mocked — never type-checked) | Tests are green, mocked policy bypasses real validation | When adding un-mocked integration tests for spending policy |
| `defaultSpendingPolicy()` returns `dryRun: true` — budget guard is no-op by default | Intentional safe default — callers must explicitly opt in | When deploying VOTE/BET to production |
| `resolveAttestation` swallows exception details in catch blocks | Acceptable — returns typed failure reason | If debugging chain resolution issues |
| DAHR `compareProofToSnapshot` always returns "match" without URL check | Design choice: DAHR = hash-level trust, data not on-chain | If DAHR trust model changes |
| Fabric design: no multi-tenant data segregation | Single-agent system, no multi-tenancy requirement | If multi-agent support is added |
| Fabric design: document inconsistencies in phase7-design.md | Archive doc, iterative thought process, not blocking | Next doc cleanup |
| Fabric 8a design: decouple verification from scanner as independent worker | Intentional: incremental in caller, not a separate service | If attestation volume exceeds scan budget |
| Fabric 8a design: harden RPC client (mTLS, rate limiting, circuit breaker) | Generic infra concern, SDK abstracts the chain | If running own RPC node |
| Error handling: state-helpers parse error may leak partial content | Minor — key name already omitted | If state format becomes sensitive |
| Sequential proof ingestion + agent profile refresh in SENSE phase | Independent ops run serially; ~5-10s parallelizable | Next SENSE phase performance pass |
| Sequential source fetches in SENSE phase (serial HTTP in 15s budget) | Could parallelize with concurrency limiter for more coverage | Next SENSE phase performance pass |
| SQL placeholder interpolation in `getVerifiedPostCountsByAuthor` | Safe (`?` only) but prevents prepare caching across counts | If called frequently with varying author counts |
| `Promise<any>` at SDK boundary in proof-ingestion-rpc-adapter | SDK type genuinely unknown; downstream validates structure | If SDK adds TypeScript types for RPC |
| `hasColumn()` in schema.ts uses string interpolation in `db.pragma()` | Always hardcoded literal from migration functions | If hasColumn is generalized |
| N+1 `findContradictions` per (subject,metric) pair in contradiction scanner | Capped by maxResults:3 early-break; ~3 queries max per cycle | If claim_ledger grows beyond 500K rows |
| SSE adapter named "SSE" but uses poll-based `/api/feed` fetch | Reflects intended future SSE integration; poll is interim | When SSE endpoint is production-ready |
| `blockNumber: 0` sentinel for SSE-ingested posts | tx_hash PK handles dedup; blockNumber not used for ordering | If blockNumber becomes ordering-critical |
| `createLimiter()` concurrency semaphore in proof-ingestion-rpc-adapter | Generic reusable primitive; only one consumer currently | When a 2nd adapter needs concurrency limiting |
| `createTestDb()` and `addPost()` duplicated across test files | Test helper code, not production | Next test cleanup pass if 6+ files |

### Closed Deferred Items (2026-04-04 evaluation)

| Item | Disposition |
|------|-----------|
| `normalize()` not shared across codebase | **FIXED** — consolidated in engine-helpers.ts (2026-04-04) |
| 3 unwired modules (intelligence-summary, vote-bet-codec, napi-guard) | **DONE** — all wired in Phase 8d (2026-04-03) |
| VOTE/BET heavy path but no publish-executor handler | **DONE** — executor handler added (2026-04-03) |
| Array copy in `planThreadFanOut` sort | **Confirmed correct** — necessary to avoid mutating input |
| Quartile math on small leaderboards | **Confirmed correct** — rank 1 of 4 IS top quartile |
| `db.prepare()` not cached in ingestProofs | **Non-issue** — node:sqlite caches internally |
| Dynamic imports per v3-loop iteration | **Non-issue** — Node module cache after first load |
| `Promise.allSettled` type annotation in v3-strategy-bridge | **Non-issue** — TypeScript infers correctly |
| Inline `import(...)` type syntax in v3-loop.ts | **Non-issue** — valid TypeScript, not in v3-loop.ts |
| WHAT comments in proof-resolver.ts | **Not found** — comments removed or never existed |
| WHAT comments in contradiction-scanner and sse-sense-adapter | **Not found** — comments removed or never existed |
| VOTE/BET dry-run asymmetry vs PUBLISH | **By design** — VOTE/BET has no attestation pipeline |
| Fabric design: no documented API auth | **False positive** — wallet-signed, documented in SDK ref |
| Fabric design: no encryption-at-rest for ColonyDB | **Non-issue** — disposable cache per ADR-0017 |
| Fabric design: encrypt ColonyDB at rest | **Non-issue** — disposable cache per ADR-0017 (duplicate) |
| Fabric design: rate limiting undefined | **False positive** — fully implemented with hard clamping |

### Continuous Monitoring (no action needed — verify on each new addition)

| Area | Status |
|------|--------|
| SQL injection: all queries parameterized | Clean — 63+ queries audited 2026-04-03 |
| Secrets: no hardcoded keys, mnemonics, or API secrets | Clean — wallet loaded from file, never logged |
| Prototype pollution: safeParse on chain data | Active protection in place |
| Error handling: no stack traces or secrets in observe() calls | Consistent err.message pattern |

---

## Decision Log

| Date | Decision | Why |
|------|----------|-----|
| 2026-03-30 | SENSE/ACT/CONFIRM replaces 8-phase V1 | 7 primitives to 3 phases; V1 had 5 ceremonial phases |
| 2026-03-30 | Signal-first publishing | Topic-first: 78% body_match=0. Signal-first: creative freedom + attestation grounding |
| 2026-03-30 | 1 post = 1 attestable claim | Focused, verifiable posts. Multi-claim to thread. |
| 2026-03-31 | Two executors (action + publish) | ENGAGE=1 call, PUBLISH=10 steps. Different complexity. |
| 2026-03-31 | SDK double-fetch acceptable (temporary) | Chain reads cheap. Consolidation target 2026-04-14. |
| 2026-04-01 | P0-P2 before Phase 6 | Strategy refactor needs data + tooling first |
| 2026-04-01 | No ORM for colony DB | Thin interface layer IS the abstraction |
| 2026-04-01 | Archive completed plan docs | design-loop-v3.md + phase5-plan.md to docs/archive/ (read-only reference) |
| 2026-04-02 | Phase 5.7 before Phase 6 | API audit revealed broken tipping, missing signals/feed-search, unwired intelligence layer |
| 2026-04-02 | Signals are strategy-critical, not optional | /api/signals provides colony consensus -- must be primary input to plan phase |
| 2026-04-02 | Tipping must use 2-step API validation | Direct transferDem() skips spam limits and indexer can't attribute tips |
| 2026-04-02 | Phase 6 is reference implementation, not canonical strategy | Toolkit/loop/primitives are universal; sentinel rules are ONE demo |
| 2026-04-02 | All enrichment is optional (graceful degradation) | Rules skip when apiEnrichment is null -- agent works without API |
| 2026-04-02 | Auto-calibration replaces static JSON | computeCalibration() in sense phase, cached in strategyResults |
| 2026-04-02 | Category selection is content-driven | inferCategory() replaces hardcoded "analysis" based on action reason |
| 2026-04-02 | Dedup module wired into publish-executor | checkClaimDedup + checkSelfDedup guard PUBLISH actions before LLM call |
| 2026-04-02 | SDK capabilities doc is informational only | XMCore/StoragePrograms/ZK are Phase 8+ -- no Phase 6 rules use them |
| 2026-04-02 | Engine stays pure-function: pre-compute in bridge | Engine's testability + agent-agnosticism is its strongest property. Bridge extracts intelligence data into DecisionContext fields. |
| 2026-04-06 | API-first for reads, chain-first for writes (ADR-0018) | API is 10x faster, enriched (scores/reactions), paginated. Chain remains fallback. Both routes always maintained. Supersedes ADR-0001 for reads. |
| 2026-04-06 | Reactions are API-only — on-chain reactions are dead code | Platform tracks reactions via API backend. Our publishHiveReaction was unused by anyone. |
| 2026-04-06 | DataSource abstraction required before API integration | ApiDataSource + ChainDataSource must share ScanPost interface. Config flag selects primary. |

---

## Spec Documents

| Document | Purpose | Status |
|----------|---------|--------|
| `docs/archive/design-loop-v3.md` | Architectural vision: first principles, phase contracts, signal-first, claim schema | Archive (reference) |
| `docs/archive/phase5-v3-loop-swap-plan.md` | Phase 5 implementation plan + Codex review findings | Archive (complete) |
| `docs/archive/phase6-strategy-refactor-plan.md` | Phase 6 plan: 5 sub-phases, 72 criteria, design philosophy | Archive (complete) |
| `docs/archive/colony-db-ingestion-plan.md` | Colony DB ingestion fixes + backfill spec (step 2) | Archive (complete) |
| `docs/archive/colony-tooling-plan.md` | P0-P5 detail specs: query CLI, reactions, backfill, FTS5, intelligence, semantic | Archive (complete) |
| `docs/research/supercolony-api-reference.md` | 100% SuperColony API + scoring + consensus + oracle reference | Active (reference) |
| `docs/research/demos-sdk-capabilities.md` | Full SDK module inventory from MCP queries | Active (reference) |
