# Task: Fix 4 Skipped /simplify Findings

## Context

During Phase 3 Steps 1+2 implementation, a 3-agent /simplify code review found 11 issues (all fixed) plus 4 that were deferred. Fix these 4 now.

## Finding 1: RunnerFlags Pick for BeforeSenseContext.flags

**File:** `tools/lib/extensions.ts`
**Issue:** `BeforeSenseContext.flags` is an inline object type `{ agent: string; env: string; log: string; dryRun: boolean; pretty: boolean; }`. This duplicates the RunnerFlags shape from session-runner.ts.
**Fix:** Use `Pick<RunnerFlags, 'agent' | 'env' | 'log' | 'dryRun' | 'pretty'>` — BUT check if RunnerFlags is exported from session-runner.ts. If importing it would create a circular dependency (extensions.ts should NOT import session-runner.ts), then extract a shared flags type to a separate file (e.g., `tools/lib/runner-types.ts`) or keep the inline type with a comment explaining why.

## Finding 2: Export inferProvider and normalizeUrlPattern

**File:** `tools/lib/sources/catalog.ts`
**Issue:** `inferProvider()` and `normalizeUrlPattern()` are private functions but will be needed by the migration CLI (`tools/source-migrate.ts`) in Step 4.
**Fix:** Export them. They are pure utility functions with no side effects.

## Finding 3: loadAgentSourceConfig override param

**File:** `tools/lib/sources/catalog.ts`
**Issue:** `loadAgentSourceConfig()` is a private function that returns hardcoded defaults. It should accept an optional config override parameter so agents can customize their source config.
**Fix:** Add an optional `overrides?: Partial<AgentSourceConfig>` parameter. Apply overrides with spread: `return { ...defaults, ...overrides }`. Update `loadAgentSourceView()` to accept and pass through the override.

## Finding 4: Catalog JSON record validation

**File:** `tools/lib/sources/catalog.ts`
**Issue:** `loadCatalog()` only validates `version === 2` and `Array.isArray(sources)`. Individual source records are not validated — a malformed record (missing `id`, `provider`, etc.) will pass through and crash at index build or runtime.
**Fix:** Add a `isValidSourceRecord(record: unknown): record is SourceRecordV2` type guard that checks required fields exist with correct types. Filter records through it in `loadCatalog()`. Log a warning for any rejected records (use `console.error` — this is a data integrity issue that should be visible).

## Validation

```bash
npx tsc --noEmit
```

## Important

- Do NOT change any existing public API signatures
- Do NOT modify session-runner.ts for these changes
- Keep changes minimal and focused on each finding
