---
type: roadmap
status: active
updated: 2026-04-04
open_items: 6
completed_phases: 8
tests: 2548
suites: 191
tsc_errors: 0
api_endpoints: 38
strategy_rules: 10
colony_posts: 188000
summary: "Phases 1-8 + engine split + budget wire complete. Open: 3 semantic search items, 3 future items. 27 deferred (16 closed, 4 continuous monitoring). 20 active tech debt, 11 resolved."
read_when: ["roadmap", "phase 7", "phase 8", "open items", "deferred", "tech debt", "next steps", "what's next", "backlog", "future work"]
---

# Roadmap

> Authoritative execution tracker. Every open item is here.
> Completed work lives in `docs/INDEX.md` history. Specs in `docs/archive/`.

## Current Status

- **V3 loop:** LIVE with full data + intelligence pipeline + proof ingestion + SSE feed
- **Phase 8:** COMPLETE (proof ingestion, contradiction detection, verified engagement, colony intelligence, VOTE/BET codec, XMCore napi-guard, SSE adapter)
- **Tests:** 2548 passing, 191 suites, **0 tsc errors**
- **API Client:** 38/38 endpoints (35 in client, 3 in dedicated modules). 100% coverage.
- **Strategy Engine:** 10 rules in 3 modules (5 core + 4 enrichment + 1 contradiction). Auto-calibration. Leaderboard meta-rule. FTS5 dedup. VOTE/BET rate limiting + session budget guard.
- **Colony DB:** 188K posts. Schema v6 (retry_count + composite indexes). 293MB.
- **Next:** Phase 5.6 semantic search (blocked on embedding model)

---

## Open Items

### Phase 5.6: Semantic Search (deferred)

- [ ] 5.6a -- Colony DB migration: sqlite-vec with 384-dim embeddings
- [ ] 5.6b -- Embedding pipeline: generate embeddings on insert
- [ ] 5.6c -- Hybrid search: FTS5 + vec0 via Reciprocal Rank Fusion

**Spec:** `docs/colony-tooling-plan.md` P5 + `.ai/guides/colony-db-research.md`
**Blocked by:** embedding model decision

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

### Future (no phase assigned)

- [ ] 6-disc-h -- Escrow to social identity: tip by Twitter/GitHub handle without wallet
- [ ] 6-disc-i -- ZK identity proofs for privacy-preserving attestation
- [ ] StorageProgram exploration: SDK structured on-chain storage for HIVE data

---

## Dependency Graph

```
Phase 1-4 (DONE) --> Phase 5 (DONE) --> Phase 6 (DONE) --> Phase 7 (DONE) --> Phase 8 (DONE)
                       |
                       +-> 5.6 semantic search (blocked on embedding model decision)
                       |
                       +-> Future (independent, no blockers)
```

---

## Tech Debt

| Item | Target | Metric |
|------|--------|--------|
| Double-fetch in V3 loop (scan-feed + colony ingestion both call getHivePosts) | 2026-04-14 | 14 sessions with >0 actions |
| Cursor not functional (SDK has no sinceBlock param) | When SDK adds pagination | Track SDK releases |
| Add composite index `(author, timestamp)` on posts for `resolveAgentToRecentPost` perf | When engagement volume grows | Query plan analysis |
| TLSN comparison: structural key-value matching instead of substring | Future | Substring injection risk on short values |
| DAHR/TLSN detection: require both url+responseHash for DAHR, serverName+recv for TLSN | Future | Reduce false positives on malformed tx |
| Concurrency guard: prevent double-processing in `ingestProofs` when scans overlap | Future | BEGIN IMMEDIATE or exclusion list |
| Edge case tests: DAHR empty data, TLSN empty recv, boolean snapshot values | Future | Test coverage gap |
| Integration tests for strategy bridge (briefingContext, identityLookup, targetType) | Future | Unit tests exist, integration tests missing |
| Identity API shape: v3-loop `identityLookup` may always produce `platform: "unknown"` | Next session | Verify against live API response shape |
| socialHandles in agent profiles unused by engine rules | Future | Infrastructure ready, no consumer yet |
| claim_ledger.verified based on self-reported snapshot, not chain-verified data (`scanner.ts`) | Future | Reconcile after ingestProofs runs |
| API responses cast to generic T without runtime validation (`api-client.ts`) | Future | Add Zod schemas for critical endpoints |
| LLM prompt injection via briefingContext (`.slice(500)` truncated but unsanitized) | Future | Consider delimiter/system instruction boundary |
| Cache contradiction scan results with TTL (avoid recomputing 188K posts each iteration) | Future | Review finding 2026-04-03 |
| SSE endpoint configuration (URL, auth, reconnect backoff) — endpoint not yet stable | Future | Review finding 2026-04-03 |
| Bet outcome tracking: reserve schema field for settlement status | Future | Review finding 2026-04-03 |
| Colony DB periodic pruning at scale (293MB and growing) | Future | Review finding 2026-04-03 |
| publish-executor.ts at 792 lines (threshold 500) — split VOTE/BET handler | Future | When adding new action types or executor logic |
| v3-loop.ts at 618 lines (threshold 500) — extract ACT phase orchestration | Future | When adding new phase logic or execution modes |

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

---

## Spec Documents

| Document | Purpose | Status |
|----------|---------|--------|
| `docs/archive/design-loop-v3.md` | Architectural vision: first principles, phase contracts, signal-first, claim schema | Archive (reference) |
| `docs/archive/phase5-v3-loop-swap-plan.md` | Phase 5 implementation plan + Codex review findings | Archive (complete) |
| `docs/archive/phase6-strategy-refactor-plan.md` | Phase 6 plan: 5 sub-phases, 72 criteria, design philosophy | Archive (complete) |
| `docs/colony-db-ingestion-plan.md` | Colony DB ingestion fixes + backfill spec (step 2) | Active (step 2 open) |
| `docs/colony-tooling-plan.md` | P0-P5 detail specs: query CLI, reactions, backfill, FTS5, intelligence, semantic | Active (roadmap) |
| `docs/research/supercolony-api-reference.md` | 100% SuperColony API + scoring + consensus + oracle reference | Active (reference) |
| `docs/research/demos-sdk-capabilities.md` | Full SDK module inventory from MCP queries | Active (reference) |
