---
type: roadmap
status: active
updated: 2026-04-02
open_items: 12
completed_phases: 7
tests: 2460
suites: 183
tsc_errors: 0
api_endpoints: 38
strategy_rules: 9
colony_posts: 188000
summary: "All open work: 13 items across Phase 5.6, 8, Future. Dependency graph, decision log, tech debt. Phases 1-7 complete."
read_when: ["roadmap", "phase 7", "phase 8", "open items", "deferred", "tech debt", "next steps", "what's next", "backlog", "future work"]
---

# Roadmap

> Authoritative execution tracker. Every open item is here.
> Completed work lives in `docs/INDEX.md` history. Specs in `docs/archive/`.

## Current Status

- **V3 loop:** LIVE with full data + intelligence pipeline
- **Phase 7:** COMPLETE (thread fan-out, ENGAGE txHash fix, leaderboard meta-rule, colony report + identity enrichment)
- **Tests:** 2435 passing, 181 suites, **0 tsc errors**
- **API Client:** 38/38 endpoints (35 in client, 3 in dedicated modules). 100% coverage.
- **Strategy Engine:** 9 rules (4 enrichment-aware). Auto-calibration. Leaderboard meta-rule. FTS5 dedup.
- **Colony DB:** 188K posts. Schema v4 (FTS5 + agent_profiles + interactions). 293MB.
- **Next:** Phase 8 -- proof ingestion, contradiction detection, verified engagement

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

### Phase 8: Advanced

- [x] 8a -- Proof ingestion: `resolveAttestation()` + `ingestProofs()` + schema v5 (chain_verified)
- [ ] 8b -- Contradiction detection in claim ledger
- [ ] 8c -- Verified engagement: agree/tip only after verifying target's attestation
- [ ] 8d -- Colony intelligence algorithm: smart scanning per `design-loop-v3.md` section 5
- [ ] 6-disc-a -- VOTE action type for price predictions (HIVE_BET memo, 5 DEM to pool)
- [ ] 6-disc-b -- Binary market bets (HIVE_BINARY memo, Polymarket integration)
- [ ] 6-disc-f -- XMCore cross-chain reads for on-chain data verification
- [ ] 6-disc-g -- SSE/webhook consumption for real-time reactive events (event-runner exists)

**Spec:** `docs/archive/design-loop-v3.md` sections 5+6b
**Blocked by:** Phase 7 (DONE)

---

### Future (no phase assigned)

- [ ] 6-disc-h -- Escrow to social identity: tip by Twitter/GitHub handle without wallet
- [ ] 6-disc-i -- ZK identity proofs for privacy-preserving attestation
- [ ] StorageProgram exploration: SDK structured on-chain storage for HIVE data

---

## Dependency Graph

```
Phase 1-4 (DONE) --> Phase 5 (DONE) --> Phase 6 (DONE)
                       |                    |
                       +-> 5.6 semantic     +-> Phase 7 (unblocked)
                       |   (blocked on          |
                       |    embedding model)     +-> Phase 8 (after 7)
                       |
                       +-> Future (independent, no blockers)
```

---

## Tech Debt

| Item | Target | Metric |
|------|--------|--------|
| Double-fetch in V3 loop (scan-feed + colony ingestion both call getHivePosts) | 2026-04-14 | 14 sessions with >0 actions |
| Cursor not functional (SDK has no sinceBlock param) | When SDK adds pagination | Track SDK releases |
| Wire `ingestProofs()` into v3-loop after scan completes | Phase 8b | Proof ingestion primitive exists but not called in production |
| Add composite index `(author, timestamp)` on posts for `resolveAgentToRecentPost` perf | When engagement volume grows | Query plan analysis |
| TLSN comparison: structural key-value matching instead of substring | Phase 8c | Substring injection risk on short values |
| Retry cap on retryable attestation failures (currently retries forever) | Phase 8b | Add retry_count column or age-based eviction |
| DAHR/TLSN detection: require both url+responseHash for DAHR, serverName+recv for TLSN | Phase 8c | Reduce false positives on malformed tx |
| Concurrency guard: prevent double-processing in `ingestProofs` when scans overlap | Phase 8b | BEGIN IMMEDIATE or exclusion list |
| Edge case tests: DAHR empty data, TLSN empty recv, boolean snapshot values | Phase 8b | Test coverage gap |
| Integration tests for strategy bridge (briefingContext, identityLookup, targetType) | Phase 8b | Unit tests exist, integration tests missing |
| Identity API shape: v3-loop `identityLookup` may always produce `platform: "unknown"` | Next session | Verify against live API response shape |
| socialHandles in agent profiles unused by engine rules | Phase 8c | Infrastructure ready, no consumer yet |
| TLSN storage fee uncapped — large proof = unbounded DEM cost (`tlsn-playwright-bridge.ts:298`) | Phase 8b | Add Math.min(storageFee, 15) cap |
| claim_ledger.verified based on self-reported snapshot, not chain-verified data (`scanner.ts:191`) | Phase 8b | Reconcile after ingestProofs runs |
| API responses cast to generic T without runtime validation (`api-client.ts:458`) | Phase 8c | Add Zod schemas for critical endpoints |
| External JSON.parse without safeParse in provider files (`generic.ts:93`, `declarative-engine.ts:1215`, `source-discovery.ts:80`, `sse-feed.ts:135`) | Phase 8c | Use safeParse() for external HTTP bodies |
| File paths leaked in error messages (`sdk.ts:83,167`, `agent-config.ts:405`) | Phase 8c | Redact absolute paths |
| No unified daily spending cap across tips + attestations + D402 + gas | Future | Theoretical daily max is unbounded due to TLSN + D402 |
| Runtime guard for unrecognized targetType values in action-executor ENGAGE case | Phase 8b | TypeScript enforces at compile time, no runtime check |
| LLM prompt injection via briefingContext (`.slice(500)` truncated but unsanitized) | Phase 8c | Consider delimiter/system instruction boundary |
| Parallel RPC concurrency unbounded in ingestProofs beyond limit param | Phase 8b | Add p-limit or document safe threshold |
| Raw error `.toString()` coercion in `eliza/event-service.ts:55` | Phase 8c | Use `.message` pattern |
| SSE feed event cast without schema validation (`sse-feed.ts:135`) | Phase 8c | Add Zod schema for SSEPost |
| Faithfulness gate has no chain verification dependency (by design, pre-publish) | N/A | Document that gate output is NOT chain-verified |

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
