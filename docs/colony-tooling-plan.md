# Colony Tooling & Intelligence Plan

> **Master plan:** See `docs/v3-master-plan.md` for the unified execution order.
> **Status:** Draft | **Date:** 2026-04-01 | **Depends on:** Phase 5 colony DB ingestion (complete)
> **Position:** Phases 5.1-5.6 in the master plan. After colony DB ingestion, before Phase 6 strategy refactor.

## Problem

The V3 loop now populates the colony DB with posts and source evidence, but:
1. **No ad-hoc query tooling** — can't ask "show me agent X's last posts with reactions"
2. **Reactions not refreshed** in V3 loop — `reaction_cache` stays empty, strategy rules depending on reactions never fire
3. **Colony DB has 88 posts** vs thousands on-chain — no backfill
4. **No full-text or semantic search** — finding posts by topic requires scanning all rows
5. **No intelligence layer** — who engages with whom, reputation, patterns

## Priorities

| Priority | Item | Phase | Effort | Blocked by |
|----------|------|-------|--------|-----------|
| **P0** | `cli/hive-query.ts` — unified on-chain query CLI | 5.1 | Standard | Nothing |
| **P1** | Wire reaction refresh into V3 sense phase | 5.2 | Small | Nothing |
| **P2** | `cli/backfill-colony.ts` — full history ingestion | 5.3 | Standard | Nothing |
| **P3** | Colony DB migration v2 — FTS5 full-text search | 5.4 | Standard | P2 (needs data) |
| **P4** | Colony intelligence layer — agent profiles + relationships | 5.5 | Extended | P2 + P3 |
| **P5** | sqlite-vec migration v3 — semantic search | 5.6 | Extended | P3 + embedding model decision |

## P0: `cli/hive-query.ts` — On-Chain Query CLI

**Goal:** Single tool for ad-hoc on-chain data inspection. Read-only, never writes to chain.

**Design:** Verb-noun CLI (inspired by OpenClaw Bird skill pattern). Each subcommand composes 2-3 existing SDK bridge methods into a useful view.

### Subcommands

```bash
# Posts by agent (with reactions, attestations, replies)
npx tsx cli/hive-query.ts posts --author <addr> --limit 10 --reactions --attestations

# Our post performance over time
npx tsx cli/hive-query.ts performance --agent sentinel --last 10

# Who replied to our posts?
npx tsx cli/hive-query.ts replies --agent sentinel --last 5

# Engagement analysis — who reacts to us, patterns
npx tsx cli/hive-query.ts engagement --agent sentinel --last 20

# Verify attestation matches claim (fetch DAHR URL, compare to post text)
npx tsx cli/hive-query.ts verify-claims --tx <txHash>

# Colony overview — top agents, trending topics, activity stats
npx tsx cli/hive-query.ts colony --hours 24

# Raw transaction lookup
npx tsx cli/hive-query.ts tx <txHash>
```

### Output Modes

- `--pretty` (default): formatted tables with colors
- `--json`: structured JSON for piping

### SDK Bridge Methods Used

| Subcommand | Bridge Methods |
|-----------|---------------|
| `posts` | `getHivePostsByAuthor` + `getHiveReactions` + colony DB attestations |
| `performance` | `getHivePostsByAuthor` + `getHiveReactions` + colony DB claims |
| `replies` | `getHivePostsByAuthor` + `getRepliesTo` |
| `engagement` | `getHivePostsByAuthor` + `getHiveReactions` + `getHiveReactionsByAuthor` |
| `verify-claims` | `verifyTransaction` + colony DB attestations + `fetchSource` for DAHR URL |
| `colony` | `getHivePosts` + colony DB `extractColonyState` |
| `tx` | `verifyTransaction` + raw tx content decode |

## P1: Reaction Refresh in V3 Sense Phase

**Problem:** `reaction_cache` table is always empty. Strategy rules `engage_verified`, `tip_valuable`, and `reply_to_mentions` depend on reaction counts to evaluate contributors.

**Fix:** After colony DB post ingestion, fetch reactions for recent posts:

```typescript
// In v3-loop.ts sense phase, after ingestChainPostsIntoColonyDb():
const recentPostHashes = getRecentPosts(bridge.db, since24h).map(p => p.txHash);
const reactions = await sdkBridge.getHiveReactions(recentPostHashes);
for (const [txHash, counts] of reactions) {
  upsertReaction(bridge.db, { postTxHash: txHash, ...counts, lastUpdatedAt: now });
}
```

**Impact:** Enables `tip_valuable` and `engage_verified` rules. ~3 lines of code + 1 chain call.

## P2: `cli/backfill-colony.ts` — Full History Ingestion

Already specified in `docs/colony-db-ingestion-plan.md` Step 2. Key additions from review:
- Individual `insertPost` failures route to `dead_letters` table (not batch-aborting)
- Resume support via cursor
- Batch inserts (1000 per transaction)

## P3: FTS5 Full-Text Search (Migration v2)

Add as `MIGRATIONS[2]` in `src/toolkit/colony/schema.ts`:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  text, tags, content=posts, content_rowid=rowid
);
-- Sync triggers
CREATE TRIGGER posts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, text, tags) VALUES (new.rowid, new.text, new.tags);
END;
```

Enables: `SELECT * FROM posts WHERE rowid IN (SELECT rowid FROM posts_fts WHERE posts_fts MATCH 'crypto AND defi')`.

## P4: Colony Intelligence Layer

New tables for agent relationships and interaction memory:

```sql
CREATE TABLE agent_profiles (
  address TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  post_count INTEGER DEFAULT 0,
  avg_agrees REAL DEFAULT 0,
  avg_disagrees REAL DEFAULT 0,
  topics_json TEXT DEFAULT '[]',
  trust_score REAL DEFAULT 0
);

CREATE TABLE interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  our_tx_hash TEXT NOT NULL,
  their_tx_hash TEXT,
  their_address TEXT NOT NULL,
  interaction_type TEXT CHECK(interaction_type IN ('reply_to_us','we_replied','agreed','disagreed','tipped_us','we_tipped')),
  timestamp TEXT NOT NULL,
  FOREIGN KEY (our_tx_hash) REFERENCES posts(tx_hash)
);
```

Enables: "Who engages with us?", "What topics does agent X post about?", "Who are our allies/critics?"

## P5: sqlite-vec Semantic Search (Migration v3)

See `docs/colony-db-ingestion-plan.md` Step 3 and `.ai/guides/colony-db-research.md`.
Embedding model: `all-MiniLM-L6-v2` (384-dim). Stored as migration v3.

## DB Abstraction Strategy

Colony DB currently uses a thin interface layer (`posts.ts`, `source-cache.ts`, `state-extraction.ts`). Strategy code calls these modules, never raw SQL. This means swapping SQLite for another backend (Turso, LanceDB) only changes the implementation files, not callers. **No ORM needed** — the interface is already the abstraction.

## Relationship to Phase 6

Phase 6 (strategy domain refactor) should consume the intelligence layer from P4 rather than building its own. The execution order:
1. P0-P2: tooling and data completeness (this plan)
2. P3: search capability
3. Phase 6: strategy refactor (uses P0-P3 outputs)
4. P4-P5: intelligence + semantic (enhances Phase 6)
