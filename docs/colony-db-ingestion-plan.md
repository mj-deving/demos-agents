# Colony DB Ingestion Plan

> **Master plan:** See `docs/v3-master-plan.md` for the unified execution order.
> **Status:** Steps 1a-1c COMPLETE (2026-03-31). Step 2 (backfill) PLANNED. | **Depends on:** Phase 5 V3 loop (complete)

## Problem

The V3 loop's strategy engine reads from the colony SQLite DB to determine colony state (activity, gaps, threads, agents). But the colony DB is never populated — `scan-feed.ts` writes a JSON cache with truncated `FilteredPost[]` data, and nobody calls `insertPost()` or `processBatch()`.

**Result:** `extractColonyState()` returns empty state → `plan()` returns 0 actions → V3 sessions produce nothing.

## Architecture Diagram

See: `~/.claude/diagrams/v3-architecture-flow.html`

## Root Causes

1. **Missing bridge:** scan-feed outputs JSON (FilteredPost), strategy reads SQLite (CachedPost). Nobody bridges them.
2. **Type mismatch:** `ScanPost.timestamp` is `number` (unix ms), `CachedPost.timestamp` is `string` (ISO 8601).
3. **FK constraint:** `posts.reply_to REFERENCES posts(tx_hash)` — inserting reply posts before their parents fails.
4. **No backfill:** Colony DB starts empty. Incremental ingestion only sees new posts per session.

## Fix Plan

### Step 1: Immediate — Unblock V3 loop (this session)

**In `cli/v3-loop.ts`, after scan-feed subprocess:**

```typescript
// Fetch full chain posts via SDK (not from scan-feed output)
const sdkBridge = createSdkBridge(demos, undefined, AUTH_PENDING_TOKEN);
const chainPosts = await sdkBridge.getHivePosts(500);

// Convert ScanPost[] → CachedPost[] with correct types
db.pragma("foreign_keys = OFF");
const ingest = db.transaction((posts: ScanPost[]) => {
  for (const p of posts) {
    insertPost(db, {
      txHash: p.txHash,
      author: p.author,
      blockNumber: p.blockNumber ?? 0,
      timestamp: new Date(p.timestamp).toISOString(),  // number → string
      replyTo: p.replyTo ?? null,
      tags: p.tags ?? [],
      text: p.text,
      rawData: { category: p.category, reactions: p.reactions },
    });
  }
});
ingest(chainPosts);
db.pragma("foreign_keys = ON");
```

**Why fetch via SDK instead of using scan-feed output:**
- `FilteredPost` has `textPreview` (truncated), not `text` (full)
- `FilteredPost` has no `blockNumber`, no `replyTo`
- scan-feed is a subprocess — we'd need to add fields to its JSON output
- The SDK bridge is already instantiated (wallet connected at top of loop)

**Double-fetch concern:** Yes, scan-feed also calls `getHivePosts()`. For now this is acceptable:
- Both calls hit the same RPC node
- Chain reads are cheap (no gas, no state mutation)
- The scan-feed subprocess serves a different purpose (activity stats, quality filtering)
- Future optimization: have scan-feed populate the colony DB directly, eliminating the v3-loop fetch

### Step 2: Backfill tool — Full hive history

**New file: `cli/backfill-colony.ts`**

One-time CLI tool that fetches the full hive history and populates the colony DB:

```
npx tsx cli/backfill-colony.ts --agent sentinel --limit 5000
```

Features:
- Cursor-based pagination (uses `getCursor(db)` / `setCursor(db)`)
- Resume support (picks up where it left off if interrupted)
- Batch inserts in transactions (1000 posts per tx)
- FK constraints off during bulk load
- Progress reporting
- Runs the colony scanner's dead-letter retry after backfill
- Individual `insertPost` failures routed to `dead_letters` table (not batch-aborting) — early hive posts may have different encoding or missing fields

### Step 3: Smart colony layer (future)

**Add to colony DB schema:**

```sql
-- FTS5 full-text search on post content
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  text, tags, content=posts, content_rowid=rowid
);

-- Triggers to keep FTS5 in sync
CREATE TRIGGER IF NOT EXISTS posts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, text, tags) VALUES (new.rowid, new.text, new.tags);
END;

-- sqlite-vec embeddings (requires npm install sqlite-vec)
-- Embedding model: all-MiniLM-L6-v2 (384-dim). If switching models, recreate this table.
CREATE VIRTUAL TABLE IF NOT EXISTS posts_vec USING vec0(
  post_rowid INTEGER PRIMARY KEY,
  embedding float[384]
);
```

**Capabilities this enables:**
- **Topic similarity:** `SELECT ... FROM posts_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 10`
- **Gap detection:** embed target topics, find posts with LOW cosine similarity
- **Trend analysis:** partition by time window, compare embedding centroids
- **Hybrid search:** FTS5 keyword results + vec0 semantic results merged via Reciprocal Rank Fusion

**Research reference:** `.ai/guides/colony-db-research.md`

## Implementation Sequence

| Step | Scope | Files | Blocked by |
|------|-------|-------|-----------|
| 1a | Fix timestamp conversion | `cli/v3-loop.ts` | Nothing |
| 1b | Fix FK constraint | `cli/v3-loop.ts` | Nothing |
| 1c | Verify live session works | Run session | 1a + 1b |
| 2 | Backfill tool | `cli/backfill-colony.ts` (new) | 1c |
| 3a | FTS5 schema + triggers (migration v2) | `src/toolkit/colony/schema.ts` MIGRATIONS[2] | 1c |
| 3b | sqlite-vec integration (migration v3) | `src/toolkit/colony/schema.ts` MIGRATIONS[3], `package.json` | Research + 3a |
| 3c | Hybrid search queries | `src/toolkit/colony/` new module | 3a + 3b |

Steps 1a-1c are immediate and **COMPLETE** (2026-03-31). Steps 2-3 are next session work.

**Next plan:** `docs/colony-tooling-plan.md` — on-chain query CLI, reaction refresh, backfill, FTS5, intelligence layer. Sits between this plan and Phase 6.

## Decision: Why not use processBatch()?

`processBatch()` in `src/toolkit/colony/scanner.ts` expects `RawHivePost[]` which has a raw `data` field (the encoded hive payload). The SDK bridge returns `ScanPost[]` which is already decoded. Using `processBatch()` would require re-encoding posts just to decode them again. Direct `insertPost()` is simpler and more efficient.

## Decision: Double-fetch vs single-fetch

Currently, scan-feed and the colony ingestion both call `getHivePosts()`. This is a temporary duplication. The long-term fix is one of:

A. **scan-feed populates colony DB** — requires scan-feed to accept a DB path and import colony modules (crosses the subprocess boundary)
B. **v3-loop replaces scan-feed entirely** — inline the activity stats calculation, eliminate the subprocess
C. **Keep double-fetch** — chain reads are cheap, both serve different purposes

Recommendation: Start with C (what we have), evaluate B after V3 proves stable.

**Tech debt tracking:** Double-fetch is intentional technical debt. Target removal: after 2 weeks of stable V3 sessions (target: 2026-04-14). Metric: 14 consecutive sessions with >0 actions produced. Preferred consolidation path: option B (inline activity stats into v3-loop, eliminate scan-feed subprocess).
