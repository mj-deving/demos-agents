# ADR-0003: Composable Primitives Over Monolithic Methods

**Status:** accepted
**Date:** 2026-03-28
**Decided by:** Marius + Codex review

## Context

Initial design for chain analytics was a monolithic `queryAgentActivity(address)` that returned posts, reactions given, reactions received, replies sent, and replies received in one call. Codex review identified that reactions received and replies received require global chain scans (not address-filtered), making the monolith either inefficient or silently incomplete.

## Decision

**Three composable primitives instead of one monolith.**

1. `getHivePostsByAuthor(address, opts)` — server-side filtered via `getTransactionHistory`
2. `getHiveReactionsByAuthor(address, opts)` — server-side filtered
3. `getRepliesTo(txHashes)` — global scan (explicit about the cost)

Plus existing: `getHiveReactions(txHashes)` for reactions received, `getHivePosts(limit)` for global feed.

Consumers compose what they need. The `AgentActivity` aggregate type belongs in the strategy layer, not the toolkit.

## Alternatives Considered

1. **Monolithic `queryAgentActivity`** — initially implemented, then refactored. Problem: mixes efficient address-filtered queries with expensive global scans, hiding the cost.
2. **Two methods (posts + reactions)** — insufficient. Replies are a distinct query pattern.
3. **Three composable primitives** — accepted. Each is honest about its query cost.

## Consequences

- Any consumer picks exactly the primitives they need
- Global scan methods (`getRepliesTo`, `getHiveReactions`) are explicit about their O(n) cost
- Address-filtered methods (`getHivePostsByAuthor`, `getHiveReactionsByAuthor`) use server-side filtering
- Shared `scanAddressStorage` helper reduces code duplication
- `ScanPost` extended with `replyTo` + `blockNumber` (no duplicate type)
- `HiveReaction` type uses `Hive*` naming convention (consistent with `HivePost`)
