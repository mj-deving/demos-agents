# V3 Master Plan

> Single-source execution roadmap for the V3 redesign. Each phase links to its detailed spec document.
> Updated: 2026-04-01

## Status Dashboard

| Area | Status | Notes |
|------|--------|-------|
| **Current phase** | 5.1-5.6 (Colony Tooling) | P0-P5 planned |
| **V3 loop** | LIVE | Session 59: 1 post, 4 DAHR attestations |
| **Colony DB** | Populated (88 posts) | Needs backfill for full history |
| **Tests** | 2199 passing, 169 suites | Zero tsc errors |
| **Branch** | main | All work merged |

## Execution Order

| Phase | Name | Status | Spec | Blocked by |
|-------|------|--------|------|------------|
| 1 | TypeScript 6.0 upgrade | DONE | -- | -- |
| 2 | Toolkit extraction (ADR-0002) | DONE | `docs/architecture-plumbing-vs-strategy.md` | Phase 1 |
| 3a | Colony DB schema + scanner | DONE | `docs/design-loop-v3.md` section 5.1 | Phase 2 |
| 3b | Strategy engine (sense/plan/perf) | DONE | `docs/design-loop-v3.md` section 3 | Phase 3a |
| 3c | Claim extraction + faithfulness gate | DONE | `docs/design-loop-v3.md` section 4 | Phase 3b |
| 4a | Architecture enforcement (ADR-0014) | DONE | `docs/decisions/0014-*` | Phase 3 |
| 4b | Standards audit (TS 6.0 strict) | DONE | -- | Phase 4a |
| **5** | **V3 loop swap** | **DONE** | `docs/phase5-v3-loop-swap-plan.md` | Phase 4b |
| 5-db | Colony DB ingestion in V3 loop | DONE | `docs/colony-db-ingestion-plan.md` steps 1a-1c | Phase 5 |
| 5-cache | Source fetch caching | DONE | `docs/design-loop-v3.md` section 5.3 | Phase 5 |
| **5.1** | **hive-query CLI** | PLANNED | `docs/colony-tooling-plan.md` P0 | Nothing |
| **5.2** | **Reaction refresh in V3 sense** | PLANNED | `docs/colony-tooling-plan.md` P1 | Nothing |
| **5.3** | **Backfill colony (full history)** | PLANNED | `docs/colony-tooling-plan.md` P2 + `docs/colony-db-ingestion-plan.md` step 2 | Nothing |
| **5.4** | **FTS5 full-text search** | PLANNED | `docs/colony-tooling-plan.md` P3 | Phase 5.3 |
| **5.5** | **Colony intelligence layer** | PLANNED | `docs/colony-tooling-plan.md` P4 | Phase 5.3 + 5.4 |
| **5.6** | **sqlite-vec semantic search** | PLANNED | `docs/colony-tooling-plan.md` P5 | Phase 5.4 + embedding model decision |
| **6** | **Strategy domain refactor** | QUEUED | `docs/design-loop-v3.md` section 3 | Phase 5.3 (P0-P2 complete) |

## Phase Descriptions

### Phases 1-4b -- Foundation (COMPLETE)

TypeScript 6.0 migration, toolkit/strategy boundary extraction per ADR-0002, colony DB schema with incremental scanner, declarative strategy engine (sense/plan/computePerformance), structured claim extraction with faithfulness gate, architecture boundary enforcement tests, and full codebase standards audit. These phases transformed the 8-phase V1 loop infrastructure into the clean SENSE/ACT/CONFIRM primitive set.

### Phase 5 -- V3 Loop Swap (COMPLETE)

Replaced V2's `runV2Loop()` with `runV3Loop()` as the default loop. Two-executor design: lightweight `action-executor.ts` for ENGAGE/TIP, full-pipeline `publish-executor.ts` for PUBLISH/REPLY with attestation. Colony DB ingestion wired into the sense phase (SDK fetch, timestamp conversion, FK-off bulk insert). Source response cache enables zero-HTTP evidence computation in SENSE. V3 is default; V2 available via `--legacy-loop`. Validated live: Session 59 published 1 post with 4 DAHR attestations.
**Spec:** `docs/phase5-v3-loop-swap-plan.md`, `docs/colony-db-ingestion-plan.md`

### Phase 5.1 -- hive-query CLI (PLANNED)

Unified on-chain query tool for ad-hoc inspection: posts by author, performance trends, reply tracking, engagement analysis, attestation verification, colony overview. Verb-noun CLI with `--pretty` and `--json` output modes. Read-only, composes existing SDK bridge methods.
**Spec:** `docs/colony-tooling-plan.md` P0

### Phase 5.2 -- Reaction Refresh (PLANNED)

Wire `getHiveReactions()` into the V3 sense phase after colony DB post ingestion. Populates the currently-empty `reaction_cache` table. Unblocks `tip_valuable`, `engage_verified`, and `reply_to_mentions` strategy rules. Approximately 3 lines of code plus 1 chain call.
**Spec:** `docs/colony-tooling-plan.md` P1

### Phase 5.3 -- Colony Backfill (PLANNED)

`cli/backfill-colony.ts` fetches full hive history with cursor-based pagination and resume support. Batch inserts (1000/tx), dead-letter routing for malformed posts, FK constraints off during bulk load. Grows the colony DB from 88 posts to full chain history.
**Spec:** `docs/colony-tooling-plan.md` P2, `docs/colony-db-ingestion-plan.md` step 2

### Phase 5.4 -- FTS5 Full-Text Search (PLANNED)

Colony DB migration v2: FTS5 virtual table on post text and tags with sync triggers. Enables keyword search across the full colony without scanning all rows. Required foundation for the intelligence layer.
**Spec:** `docs/colony-tooling-plan.md` P3

### Phase 5.5 -- Colony Intelligence Layer (PLANNED)

Agent profiles table (post counts, avg reactions, topics, trust scores) and interactions table (reply/agree/disagree/tip relationships). Enables "who engages with us?" and "who are our allies/critics?" strategy queries.
**Spec:** `docs/colony-tooling-plan.md` P4

### Phase 5.6 -- Semantic Search (PLANNED)

Colony DB migration v3: sqlite-vec with all-MiniLM-L6-v2 embeddings (384-dim). Topic similarity, gap detection via low cosine similarity, hybrid search via Reciprocal Rank Fusion with FTS5 results.
**Spec:** `docs/colony-tooling-plan.md` P5, `.ai/guides/colony-db-research.md`

### Phase 6 -- Strategy Domain Refactor (QUEUED)

Refactor strategy code in `src/lib/` to consume the intelligence layer from Phase 5.5 rather than building its own queries. Depends on P0-P2 being complete for data availability; P4-P5 enhance Phase 6 after it ships.
**Spec:** `docs/design-loop-v3.md` section 3

## Dependency Graph

```
Phases 1-4b (DONE)
  |
  v
Phase 5: V3 loop swap (DONE)
  |
  +-- 5-db: Colony DB ingestion (DONE)
  +-- 5-cache: Source fetch caching (DONE)
  |
  +-- 5.1: hive-query CLI -----> (no deps, start anytime)
  +-- 5.2: Reaction refresh ----> (no deps, start anytime)
  +-- 5.3: Colony backfill -----> (no deps, start anytime)
  |     |
  |     v
  +-- 5.4: FTS5 search
  |     |
  |     +----> 5.5: Intelligence layer
  |     +----> 5.6: Semantic search (also needs embedding model decision)
  |
  +-- Phase 6: Strategy refactor (after 5.1-5.3 complete; enhanced by 5.5-5.6)
```

Phases 5.1, 5.2, and 5.3 can be executed in parallel. Phase 5.4 requires data from 5.3. Phase 6 can begin once 5.1-5.3 are done; 5.5-5.6 enhance it but do not block it.

## Decision Log

| Date | Decision | Rationale | Spec reference |
|------|----------|-----------|---------------|
| 2026-03-30 | SENSE/ACT/CONFIRM replaces 8-phase V1 | 7 irreducible primitives mapped to 3 phases; V1 had 5 ceremonial phases | `design-loop-v3.md` section 2 |
| 2026-03-30 | Signal-first publishing (not topic-first, not data-first) | Topic-first had 78% body_match=0; data-first too constraining; signal-first gives creative freedom with attestation grounding | `design-loop-v3.md` section 4 |
| 2026-03-30 | 1 post = 1 attestable claim, multi-claim = thread | Focused, verifiable posts instead of monolithic walls; each reply gets its own attestation | `design-loop-v3.md` section 4 |
| 2026-03-31 | Two executors (action + publish) not one | ENGAGE is 1 chain call, PUBLISH is 10 steps with error recovery; forcing both through same interface pretends they are equally simple | `phase5-v3-loop-swap-plan.md` Key Decision |
| 2026-03-31 | SDK double-fetch acceptable (temporary) | scan-feed and colony ingestion both call getHivePosts(); chain reads are cheap; consolidation target 2026-04-14 after 14 stable sessions | `colony-db-ingestion-plan.md` Decision: Double-fetch |
| 2026-03-31 | Direct insertPost() over processBatch() | processBatch expects RawHivePost[] (encoded); SDK bridge returns ScanPost[] (decoded); re-encoding to decode again is wasteful | `colony-db-ingestion-plan.md` Decision: Why not processBatch |
| 2026-04-01 | P0-P2 before Phase 6, P4-P5 after | Strategy refactor needs data completeness (backfill) and query tooling, but intelligence layer and semantic search enhance rather than block it | `colony-tooling-plan.md` Relationship to Phase 6 |
| 2026-04-01 | No ORM for colony DB | Thin interface layer (posts.ts, source-cache.ts, state-extraction.ts) is already the abstraction; swapping SQLite backend changes only implementation files | `colony-tooling-plan.md` DB Abstraction Strategy |

## Tech Debt Tracking

| Item | Target date | Metric | Notes |
|------|------------|--------|-------|
| Double-fetch in V3 loop | 2026-04-14 | 14 consecutive sessions with >0 actions | Preferred path: inline activity stats into v3-loop, eliminate scan-feed subprocess |

## Detailed Spec Documents

| Document | Purpose | Keep as |
|----------|---------|---------|
| `docs/design-loop-v3.md` | Architectural vision: first principles, phase contracts, signal-first publishing, colony intelligence, claim schema | Long-term reference |
| `docs/phase5-v3-loop-swap-plan.md` | Phase 5 implementation: module signatures, code placement, testing plan | Historical record (phase complete) |
| `docs/colony-db-ingestion-plan.md` | Colony DB bridge fixes + backfill tool spec | Active spec for step 2 (backfill) |
| `docs/colony-tooling-plan.md` | P0-P5 tooling priorities with schemas and CLI designs | Active roadmap for phases 5.1-5.6 |
