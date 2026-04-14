# Codex Review: Source Lifecycle Management (Design Review)

## Context

We have 93 quarantined and 45 active sources in `sources/catalog.json`. The lifecycle state machine is defined in `catalog.ts` (quarantined →(3 tests pass)→ active, active →(3 fails)→ degraded, etc.) but no automation exists. Sources enter quarantined via import and never leave without manual intervention.

PR7 shipped `tools/lib/sources/health.ts` with `testSource()` — we can now programmatically probe sources. PR8 builds on that to automate lifecycle transitions.

## Design

### New file: `tools/lib/sources/lifecycle.ts`

The lifecycle manager — evaluates sources against the state machine rules and produces transition recommendations.

**Core types:**
```typescript
interface TransitionResult {
  sourceId: string;
  currentStatus: SourceStatus;
  newStatus: SourceStatus | null;  // null = no change
  reason: string;
  testResult?: SourceTestResult;   // from health.ts
}

interface LifecycleReport {
  timestamp: string;
  evaluated: number;
  transitions: TransitionResult[];
  summary: Record<SourceStatus, number>;
}
```

**Transition rules (from catalog.ts comments):**
1. `quarantined → active`: 3 consecutive test passes (successCount ≥ 3, consecutiveFailures = 0)
2. `active → degraded`: rating.overall < 40 OR consecutiveFailures ≥ 3
3. `degraded → stale`: 14 days since lastFailedAt with no recovery
4. `stale → deprecated`: 30 days since stale transition
5. `archived → quarantined`: manual only (not automated)

**Key functions:**
```typescript
// Evaluate a single source and return transition recommendation
function evaluateTransition(source: SourceRecordV2, testResult?: SourceTestResult): TransitionResult;

// Update catalog.json with approved transitions
function applyTransitions(catalogPath: string, transitions: TransitionResult[]): void;

// Run health tests + evaluate transitions for a filtered set of sources
async function runLifecycleCheck(sources: SourceRecordV2[], options?: { dryRun?: boolean }): Promise<LifecycleReport>;
```

### Updated file: `tools/lib/sources/health.ts`

Add `updateRating()` function that updates a source's rating fields after a test:
```typescript
function updateRating(source: SourceRecordV2, testResult: SourceTestResult): SourceRecordV2;
```

This updates:
- `rating.testCount` += 1
- `rating.successCount` += 1 (on OK/EMPTY) or unchanged
- `rating.consecutiveFailures` += 1 (on failure) or reset to 0
- `rating.lastTestedAt` = now
- `lifecycle.lastFailedAt` = now (on failure)

### New file: `tools/source-lifecycle.ts`

CLI tool for lifecycle management.

**Commands:**
```bash
# Check which sources need transitions (dry run — no changes)
npx tsx tools/source-lifecycle.ts check --pretty

# Check and apply transitions
npx tsx tools/source-lifecycle.ts apply --pretty

# Check only quarantined sources for promotion
npx tsx tools/source-lifecycle.ts check --quarantined --pretty

# Check specific provider
npx tsx tools/source-lifecycle.ts check --provider coingecko --pretty

# JSON output for automation
npx tsx tools/source-lifecycle.ts check --json
```

**Output format (pretty):**
```
Source Lifecycle Report (138 sources evaluated)
──────────────────────────────────────────────────
PROMOTE  coingecko-2a7ea372  quarantined → active   3/3 tests passed
PROMOTE  hn-algolia-8f3c     quarantined → active   3/3 tests passed
DEGRADE  github-abc123       active → degraded      3 consecutive failures
STALE    old-api-def456      degraded → stale       14+ days failing
──────────────────────────────────────────────────
Summary: 2 promotions, 1 degradation, 1 stale. 134 unchanged.
```

### Catalog persistence

`applyTransitions()` writes back to `catalog.json`:
- Updates `status` field
- Sets `lifecycle.promotedAt` for quarantined→active
- Sets `lifecycle.deprecatedAt` for stale→deprecated
- Preserves all other fields
- Atomic write (write to .tmp, rename)

## Test Contracts

### lifecycle.test.ts

**evaluateTransition:**
- quarantined source with 3+ successCount and 0 failures → recommends active
- quarantined source with 2 successCount → recommends no change (needs more tests)
- quarantined source with consecutiveFailures > 0 → recommends no change (reset needed)
- active source with rating.overall < 40 → recommends degraded
- active source with consecutiveFailures >= 3 → recommends degraded
- active source with good rating and 0 failures → recommends no change
- degraded source with lastFailedAt > 14 days ago → recommends stale
- degraded source with lastFailedAt < 14 days ago → recommends no change
- stale source with status for > 30 days → recommends deprecated
- archived source → always recommends no change (manual transitions only)

**updateRating:**
- OK test result increments testCount and successCount, resets consecutiveFailures
- EMPTY test result increments testCount and successCount (valid response)
- FETCH_FAILED increments testCount and consecutiveFailures, does NOT increment successCount
- PARSE_FAILED increments testCount and consecutiveFailures
- NO_ADAPTER/NOT_SUPPORTED/NO_CANDIDATES/UNRESOLVED_VARS increment testCount only
- VALIDATION_REJECTED increments testCount only
- lastTestedAt is set to current time on any test
- lastFailedAt is set on failure statuses only

**applyTransitions:**
- writes updated statuses to catalog.json
- sets promotedAt timestamp for quarantined→active
- sets deprecatedAt timestamp for stale→deprecated
- does not modify sources with null newStatus
- preserves all other source fields
- atomic write (temp file + rename)

**runLifecycleCheck:**
- runs testSource for each source and evaluates transitions
- dryRun=true does not modify catalog
- returns correct summary counts

## Questions for Review

Q1: Should `evaluateTransition` accept a fresh `testResult` OR should it purely look at historical rating data? If we run a test and it passes, do we update the rating FIRST then evaluate, or evaluate based on pre-test state?

Q2: For the quarantined→active threshold of "3 tests pass" — should these be 3 consecutive tests in a single run, or 3 cumulative across runs? The latter means you can run the lifecycle check 3 times over 3 days. I lean toward cumulative (uses `successCount` from rating).

Q3: Should `applyTransitions` require explicit confirmation for promotions (quarantined→active) since they add new sources to the active pool? Or is dry-run mode sufficient as a safety gate?

Q4: The degraded→stale transition needs a "14 days since lastFailedAt" check. But if a degraded source starts passing again, should it go back to active directly, or through quarantined? The catalog.ts comment doesn't specify a recovery path from degraded.

Q5: Should we batch the health tests (with delays between sources, like source-test.ts does) or run them serially? Rate limiting is already in fetchSource, but batch testing 93 quarantined sources could take a while.

## Files to Read

```bash
cat tools/lib/sources/catalog.ts | head -120
cat tools/lib/sources/health.ts
cat tools/source-test.ts
cat sources/catalog.json | head -60
```

## Output Format

Write findings to `claude-codex-coop/REVIEW-source-lifecycle.md`. Answer Q1-Q5. Flag any missing test contracts. Do NOT modify source code.
