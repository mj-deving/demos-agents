# Task: Review Phase 3 Steps 1+2 Implementation

## Context

Phase 3 Steps 1+2 of the unified loop architecture v2 were implemented in commit 7499e4d (plus follow-up 924fc9c for docs). This adds:

1. **Extension dispatcher** (`tools/lib/extensions.ts`) — typed hook system for v2 loop
2. **Source catalog module** (`tools/lib/sources/catalog.ts` + `tools/lib/sources/index.ts`) — unified source registry with V2 records and in-memory index

## Files to Review

- `tools/lib/extensions.ts` — NEW: LoopExtensionHooks, EXTENSION_REGISTRY, registerHook(), 3 dispatcher functions
- `tools/lib/sources/catalog.ts` — NEW: SourceRecordV2, SourceIndex, buildSourceIndex(), loadCatalog/loadYamlRegistry/loadAgentSourceView, normalizeSourceRecord()
- `tools/lib/sources/index.ts` — NEW: barrel re-export
- `tools/session-runner.ts` — MODIFIED: calibrate migrated from inline to dispatcher via registerHook()

## Review Focus

1. **Correctness:** Do the types match the spec in `Plans/unified-loop-architecture-v2.md`?
2. **Safety:** Any edge cases in normalizeSourceRecord(), buildSourceIndex(), or loadAgentSourceView()?
3. **Import hygiene:** Any circular import risks? Does the extension dispatcher avoid the calibrate→session-runner cycle correctly?
4. **Performance:** Is buildSourceIndex() O(n) as expected for ~140 sources?
5. **Migration readiness:** Will these types and loaders work correctly for Steps 3+4 (policy.ts, matcher.ts, session-runner wiring)?

## Validation

```bash
npx tsc --noEmit
```

## Output

Severity-ordered findings: P0 (critical), P1 (high), P2 (medium), P3 (low).
