# Colony DB Research — SQLite Vector Search Ecosystem

> Research date: 2026-03-31 | Context: V3 loop needs smart colony DB for strategy engine

## Recommendation: sqlite-vec + FTS5 hybrid

Single `.db` file with posts, metadata, FTS5 index, AND vector embeddings.

## Top Options Compared

| Tool | Type | Stars | TS/Node | Embedded | Scale | Production | Best For |
|---|---|---|---|---|---|---|---|
| **sqlite-vec** | SQLite ext | 7.3k | npm pkg | Same DB | 1k-100k | Yes | **Our use case** |
| **LanceDB** | Standalone | 9.7k | Native SDK | File | 1k-1B | Yes | Separate vector store |
| **Turso/libSQL** | SQLite fork | 14k+ | npm pkg | Yes | 1k-1M | Yes | If swapping SQLite |
| **Orama** | In-memory | 10.3k | Native TS | RAM | 1k-50k | Yes | Runtime search layer |
| **FTS5** | Built-in | N/A | Any SQLite | Same DB | Any | Absolute | Keyword baseline |

## Why sqlite-vec + FTS5

1. Lives inside existing SQLite DB — one file, no server, no network
2. FTS5 handles keyword search, author filtering, BM25 ranking (already built in)
3. sqlite-vec adds semantic search via `vec0` virtual tables
4. At 10k posts with 384-dim embeddings, KNN completes in single-digit ms
5. `npm install sqlite-vec` — loads into better-sqlite3/node:sqlite
6. Hybrid search via Reciprocal Rank Fusion (documented by Alex Garcia)

## Architecture Sketch

```
posts table (tx_hash, author, text, timestamp, block_number, ...)
    |
    +-- posts_fts (FTS5 virtual table on text)
    |
    +-- posts_vec (vec0 virtual table, 384-dim float32 embeddings)
    |
    +-- topics table (id, label, embedding) — topic taxonomy
```

## Key Capabilities This Enables

- **Topic similarity:** embed query topic, KNN against posts_vec
- **Gap analysis:** embed target topics, find LOW similarity = gaps
- **Trend detection:** partition by time window, compare embedding centroids
- **Author analysis:** FTS5 + JOIN on author
- **Semantic dedup:** find near-duplicate posts via cosine similarity threshold

## Notable Finds

- **sqliteai/sqlite-memory** (15 stars) — hybrid semantic search for AI agent memory
- **sqliteai/sqlite-agent** — auto-generates embeddings on INSERT
- **vlasky/sqlite-vec** fork — adds distance constraints + pagination for feeds
- **Turso/libSQL** — drop-in better-sqlite3 replacement with native F32_BLOB vectors

## Upgrade Path

sqlite-vec → Turso/libSQL (drop-in) → LanceDB sidecar (if >100k vectors)

## Sources

- [sqlite-vec GitHub](https://github.com/asg017/sqlite-vec)
- [FTS5 + sqlite-vec hybrid search](https://alexgarcia.xyz/blog/2024/sqlite-vec-hybrid-search/index.html)
- [sqlite-vec Node.js docs](https://alexgarcia.xyz/sqlite-vec/js.html)
- [LanceDB GitHub](https://github.com/lancedb/lancedb)
- [Turso native vector search](https://turso.tech/blog/turso-brings-native-vector-search-to-sqlite)
- [sqliteai/sqlite-memory](https://github.com/sqliteai/sqlite-memory)
