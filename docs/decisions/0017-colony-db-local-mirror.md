---
summary: "Colony DB is a disposable local cache — no ORM, numbered migrations, thin interface layer IS the abstraction"
read_when: ["colony", "database", "cache", "migration", "ORM", "colony DB", "sqlite", "disposable"]
---

# ADR-0017: Colony DB — Local Mirror Architecture

**Status:** accepted
**Date:** 2026-04-01
**Decided by:** Marius

## Context

The colony DB (`~/.{agent}/colony/cache.db`) grew from a Phase 3 experiment into load-bearing infrastructure: 6 tables, a backfill tool, reaction refresh pipeline, and the entire V3 strategy engine reads colony state from it. Three design decisions were embedded in code but never formally documented, creating risk of well-intentioned contributors violating them.

Relevant prior decisions: ADR-0015 mentions colony cache briefly (section 6), ADR-0016 covers the SQLite vendoring. This ADR covers the architecture above the storage layer.

## Decision

### 1. Local mirror, not source of truth

The colony DB is a **disposable local cache** of on-chain data. It can be deleted and rebuilt from chain at any time (`cli/backfill-colony.ts`). The blockchain is always the source of truth.

**Implications:**
- No replication, backup, or consistency guarantees needed
- No distributed locking or multi-process coordination
- Schema migrations can be destructive (drop + rebuild is valid)
- Data loss = run backfill again, not an incident

### 2. No ORM — thin interface layer IS the abstraction

Colony DB uses direct `better-sqlite3` prepared statements wrapped in typed module functions (`posts.ts`, `reactions.ts`, `source-cache.ts`, `dead-letters.ts`, `backfill.ts`). These modules form a thin interface layer that IS the abstraction.

**Why no ORM:**
- 6 tables with simple schemas don't justify Drizzle/Prisma/Knex overhead
- ORMs add a dependency, a build step, and a migration system when we already have `MIGRATIONS[]`
- The interface modules are already swappable — changing the backing store (Turso, LanceDB) only requires reimplementing the module functions, not changing callers
- Performance: synchronous `DatabaseSync` calls in a loop are idiomatic for better-sqlite3; ORMs add async overhead

**The interface layer:**
| Module | Tables | Responsibility |
|--------|--------|---------------|
| `posts.ts` | `posts` | Insert, query by author/hash/time, count |
| `reactions.ts` | `reaction_cache` | Upsert, query by post/time, join with posts |
| `source-cache.ts` | `source_response_cache` | Upsert, TTL-based expiry |
| `dead-letters.ts` | `dead_letters` | Insert failures, retry queue |
| `backfill.ts` | `posts`, `dead_letters`, `_meta` | Chain pagination + batch ingest |
| `claims.ts` | `claim_ledger` | Typed claim records with attestation links |
| `state-extraction.ts` | (reads all) | Colony state aggregation for strategy |
| `available-evidence.ts` | `source_response_cache` | Evidence computation for strategy |
| `performance.ts` | `posts`, `reaction_cache` | Performance score computation |
| `schema.ts` | (all) | DDL, migrations, init |

### 3. Schema evolution via numbered migrations

Schema changes use the `MIGRATIONS` record in `src/toolkit/colony/schema.ts`:

```typescript
const MIGRATIONS: Record<number, Migration> = {
  1: (db) => { db.exec(BASE_SCHEMA_SQL); ... },
  // 2: FTS5 (planned, Phase 5.4)
  // 3: sqlite-vec (planned, Phase 5.6)
};
```

**Rules:**
- Migrations run sequentially on first open after version bump
- `CURRENT_SCHEMA_VERSION` must match the highest migration key
- `BASE_SCHEMA_SQL` uses `CREATE TABLE IF NOT EXISTS` — safe to re-run
- Migrations may ALTER existing tables but must not conflict with `BASE_SCHEMA_SQL`
- Version tracked in `_meta` table (`schema_version` key)

### 4. Dual cursor semantics

Two cursor keys in `_meta` with different semantics:

| Key | Direction | Used by | Purpose |
|-----|-----------|---------|---------|
| `cursor` | Forward (increasing block numbers) | V3 loop (future) | Incremental ingestion from last-seen block |
| `backfill_cursor` | Backward (decreasing block numbers) | `backfill-colony.ts` | Resume point for historical chain scan |

The forward `cursor` is currently dead code — the SDK's `getHivePosts(limit)` has no `sinceBlock` parameter, so incremental ingestion isn't possible yet. The key is reserved for when SDK pagination is added.

## Alternatives Considered

1. **ORMs (Drizzle, Prisma, Knex)** — rejected. Adds dep + build step + migration system for 6 tables. The thin interface layer already provides swappability.
2. **Raw SQL in callers** — rejected. Scattered SQL strings are unmaintainable and untestable. The module layer centralizes all SQL.
3. **Source-of-truth DB with sync** — rejected. The chain is authoritative. Duplicating that authority adds consistency concerns for zero benefit.
4. **In-memory only (no persistence)** — rejected. Cold-start on every session would require re-fetching 500+ posts. Persistence enables incremental enrichment.

## Consequences

- Contributors must use the interface modules, never raw SQL in `cli/` or `src/lib/`
- New tables require a new migration in `MIGRATIONS[]` with version bump
- Colony DB can be deleted without data loss (run backfill to rebuild)
- No ORM will be added unless table count exceeds ~15 or complex relationships emerge
- The `backfill_cursor` and `cursor` keys must never be confused — they track opposite directions
- Colony DB path is per-agent: `~/.{agentName}/colony/cache.db` (not hardcoded to sentinel)
