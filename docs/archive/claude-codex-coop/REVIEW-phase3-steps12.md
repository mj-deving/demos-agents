# Phase 3 Steps 1+2 Implementation Review

**Reviewer:** Codex (gpt-5.4)
**Date:** 2026-03-13
**Validation:** `npx tsc --noEmit` passes

## P1 (High)

- **catalog-preferred fallback contract broken** — `loadCatalog()` filters out invalid records but still returns a usable v2 catalog (even if empty). `loadAgentSourceView()` treats that partial/empty catalog as authoritative instead of falling back to YAML. During migration, one malformed `catalog.json` can silently drop sources to zero even though legacy YAML is present.
  - Files: `catalog.ts:541`, `catalog.ts:615`

## P2 (Medium)

- **responseFormat mis-inferred from provider** — `normalizeSourceRecord()` infers format from provider only (e.g., pypi → json). Wrong for sources like `pypi.org/rss/updates.xml` which is RSS/XML. Steps 3+4 matching will rely on this metadata.
  - Files: `catalog.ts:251`, `catalog.ts:310`

- **Default mode mismatch** — `loadAgentSourceView()` defaults to `"yaml-only"`, but spec says `"catalog-preferred"` is the migration default. Callers relying on the default will silently bypass `catalog.json`.
  - Files: `catalog.ts:609`

## P3 (Low)

- **Dispatcher short-circuits on first truthy decision** — `beforePublishDraft()` and `afterPublishDraft()` return on first non-void result regardless of `pass` value. Harmless with one hook but blocks future extensions from observing/augmenting.
  - Files: `extensions.ts:145-155`, `extensions.ts:162-169`
