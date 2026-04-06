---
summary: "API-first for reads, chain-first for writes. Both routes always implemented. Supersedes ADR-0001 chain-only stance."
read_when: ["API first", "chain first", "data source", "API vs chain", "SuperColony API", "SDK", "fallback", "dual route"]
---

# ADR-0018: API-First for Reads, Chain-First for Writes

**Status:** accepted
**Date:** 2026-04-06
**Supersedes:** ADR-0001 (chain-first, zero API dependency) — partially. ADR-0001 remains correct for writes. This ADR inverts the read strategy.
**Decided by:** Marius

## Context

ADR-0001 was a reactive decision made when supercolony.ai went NXDOMAIN (2026-03-26). The stance was "everything on-chain, API only as lazy fallback." This was correct at the time — the API was unreliable.

Five weeks later, the situation has changed:

1. **SuperColony API is stable** — `/api/feed` returns 200 with public access (no auth for reads). Occasional 502s are transient.
2. **API is dramatically faster for reads** — 100 posts/request with offset pagination vs SDK's ~155 posts via 5 RPC calls (only covers ~2 hour window).
3. **API provides data that doesn't exist on-chain** — scores, reactions, reputation, signals, reply counts. These are platform-layer features, not protocol features.
4. **SDK pagination is limited** — no `sinceBlock` param, `getTransactions` returns raw txs (most non-HIVE), max ~500 raw txs = ~155 HIVE posts.
5. **Colony DB has a sync gap** — 188K posts from backfill (Apr 1-4) but missing posts between backfill end and current sliding window. API could fill this in minutes.
6. **Reactions are API-only** — our on-chain `publishHiveReaction` was our own invention. The platform tracks reactions via `POST /api/feed/{txHash}/react`. Nobody reads on-chain reactions.

### Empirical comparison (2026-04-06)

| Factor | Chain SDK | SuperColony API |
|--------|-----------|-----------------|
| Read speed | ~155 posts per 5 RPC calls | 100 posts per 1 HTTP call |
| Coverage | Latest ~2 hour window | 80K+ posts via offset, 204K indexed |
| Data richness | Raw (text, author, timestamp) | Enriched (+ scores, reactions, reputation) |
| Auth for reads | Wallet required | None (public) |
| Pagination | By tx ID, backward only | Offset-based, full range |
| Reliability | Chain always up | Occasional 502 (graceful degradation exists) |

## Decision

**Invert the read strategy: API-first, chain as fallback. Both routes always implemented and maintained.**

### Routing rules

| Operation | Primary | Fallback | Rationale |
|-----------|---------|----------|-----------|
| **Read feed** | API (`/api/feed`) | Chain (`SDK.getTransactions`) | API is 10x faster, enriched, paginated |
| **Read by author** | API (`/api/feed?author=X`) | Chain (`SDK.getTransactionHistory`) | API has server-side filtering |
| **Backfill/sync** | API offset pagination | Chain scan | API is only practical option at scale |
| **Reactions** | API (`POST /api/feed/{tx}/react`) | None | Reactions are API-only by platform design |
| **Enrichment** | API (scores, signals, oracle) | Local scoring formula | No chain equivalent exists |
| **Publish post** | Chain TX (always) | N/A | Writes are on-chain by definition |
| **Transfer DEM** | Chain TX (always) | N/A | Same |
| **Verify proof** | Chain RPC (`getTxByHash`) | N/A | Must be on-chain for trust |
| **DAHR attestation** | Chain TX (always) | N/A | Same |

### Architectural requirement: DataSource abstraction

Both API and chain read paths must implement a shared `DataSource` interface so the consumer (v3-loop, colony ingestion, strategy engine) doesn't know or care which is active. Switching between them is a configuration flag, not a code change.

```typescript
interface DataSource {
  getHivePosts(limit: number, opts?: { offset?: number; since?: string }): Promise<ScanPost[]>;
  getPostsByAuthor(address: string, opts?: { limit?: number }): Promise<ScanPost[]>;
  getPostByHash?(txHash: string): Promise<ScanPost | null>;
}
```

### Dual-route maintenance rule

When adding a new read operation:
1. Implement the API route first (primary)
2. Implement the chain route as fallback
3. Both must return the same `ScanPost` shape
4. Test both routes
5. Wire fallback: if API call fails, automatically retry via chain

### Drift detection

Demos is iterating fast. API endpoints and SDK methods can change between releases. A drift detection tool must verify:
- All documented API endpoints still respond with expected shapes
- SDK method signatures match our chain-reader wrappers
- Colony DB schema accommodates both data sources

## Alternatives Considered

1. **Keep chain-first (ADR-0001 as-is)** — rejected. The data proves API is objectively better for reads. Sticking to chain-first means permanently limited feed coverage (~155 posts vs 204K) and no access to platform-layer data.
2. **API-only, drop chain reads** — rejected. Chain must remain as fallback for when API is down (the original ADR-0001 scenario). Both routes must exist.
3. **API-first with no chain fallback** — rejected. We know the API went NXDOMAIN for 6 days once. Fallback is essential.

## Consequences

- ADR-0001 is superseded for **read operations**. Its principle still holds for **write operations** (publish, transfer, attest).
- New `DataSource` interface needed in `src/toolkit/` — both `ApiDataSource` and `ChainDataSource` implement it.
- Colony DB backfill gap (~16K missing posts) can be filled via API pagination.
- Reactions are officially API-only — remove `publishHiveReaction` dead code if it still exists.
- Drift detection tool becomes a maintenance requirement, not a nice-to-have.
- All existing chain-read code continues to work as fallback — no immediate breaking changes.
