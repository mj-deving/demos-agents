# Codex Review: Source Testing CLI (Implementation Review)

## Context

PR7: Standalone source health testing. Library module `tools/lib/sources/health.ts` + CLI `tools/source-test.ts`. Uses full adapter pipeline (buildCandidates → validateCandidate → fetch → parse). 18 new tests.

## Changes Made

1. `tools/lib/sources/health.ts`: Core `testSource()`, `resolveTestUrl()`, `filterSources()`, `DEFAULT_TEST_VARS`. Statuses: OK, EMPTY, FETCH_FAILED, PARSE_FAILED, NO_ADAPTER, UNRESOLVED_VARS.
2. `tools/source-test.ts`: CLI with `--source`, `--agent`, `--provider`, `--quarantined`, `--pretty`, `--json`, `--delay`, `--vars` flags. Loads raw catalog.
3. `tests/source-health.test.ts`: 18 tests across 3 describe blocks (testSource, resolveTestUrl, filterSources).

## Questions for Review

Q1: Does the adapter pipeline usage match the design review finding? (buildCandidates → validateCandidate → fetch, NOT direct URL substitution)

Q2: Is the fallback from buildCandidates to direct URL resolution correct? When buildCandidates returns empty or throws.

Q3: Are the 6 status types correctly mapped to the right conditions (OK, EMPTY, FETCH_FAILED, PARSE_FAILED, NO_ADAPTER, UNRESOLVED_VARS)?

Q4: Does the CLI correctly load the raw catalog instead of loadAgentSourceView for quarantined access?

Q5: Any missing test coverage for edge cases?

## Files to Read

```bash
cat tools/lib/sources/health.ts
cat tools/source-test.ts
cat tests/source-health.test.ts
```

## Output Format

Write findings to `claude-codex-coop/REVIEW-source-test-cli-impl.md`. Answer Q1-Q5. Do NOT modify source code.
