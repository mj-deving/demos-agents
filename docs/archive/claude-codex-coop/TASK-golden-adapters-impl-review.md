# Codex Review: Golden Adapter Removal (Implementation Review)

## Context

We completed two commits:
1. `c741b6c` — Golden tests (50 tests comparing hand-written vs declarative)
2. `deb0ebb` — Removed 10 hand-written adapters (-2,827 lines), simplified index.ts
3. `8425aff` — Additional 12 tests from design review findings

## Files to Read

```bash
cat tests/golden-adapters.test.ts
cat tools/lib/sources/providers/index.ts
cat tools/lib/sources/providers/declarative-engine.ts
cat tools/lib/sources/providers/generic.ts
cat tools/lib/sources/providers/specs/binance.yaml
cat tools/lib/sources/providers/specs/kraken.yaml
```

## Questions for Review

Q1: Are there any remaining references to the deleted hand-written adapter files anywhere in the codebase?

Q2: Is the `{.}` self-reference addition in declarative-engine.ts correctly placed and safe (no edge cases)?

Q3: Are there any other files that need to be updated after removing the hand-written adapters (imports, re-exports, documentation)?

Q4: Does the test coverage adequately validate the declarative adapter behavior for production use?

Q5: Are the YAML spec fixes for `tokens[0]` quoting correct and complete?

## Output Format

Write findings to `claude-codex-coop/REVIEW-golden-adapters-impl.md`. Structure:
1. Answers to Q1-Q5
2. P0/P1/P2 findings with file locations
3. Risk assessment
