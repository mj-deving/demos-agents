# Codex Review: Hook Wiring + PubMed Esummary Fix (Design Review)

## Context

Two P1 bugs in the declarative adapter engine:

1. **Hook wiring**: YAML specs declare `hooks:` at operation level (4-space indent), but `ParseSpec.hooks` expects it under `parse:`. Hooks never execute for arxiv/kraken.

2. **PubMed esummary**: `object-entries` mode ignores `items.jsonPath`. Need to apply it before iterating, and filter non-object values (uids array).

## Design

### Fix 1: YAML Hook Indentation
Move `hooks:` under `parse:` in 4 locations:
- arxiv.yaml search operation
- kraken.yaml ticker, assets, ohlc operations

### Fix 2: Kraken Redundant jsonPath
Remove `items.jsonPath: "$.result"` from kraken specs (3 operations) since `envelope.jsonPath: "$.result"` already navigates there.

### Fix 3: Engine object-entries jsonPath Support
In `extractItems()`, for `object-entries` mode, apply `items.jsonPath` via `jsonPathGet` before iterating.

### Fix 4: Non-Object Value Filtering
In `object-entries` mode, skip entries where the value is not an object (filters pubmed `uids` array key).

## Test Contracts

### declarative-engine.test.ts additions
- object-entries with jsonPath navigates to nested object before iterating
- object-entries skips non-object values (arrays, strings)

### golden-adapters.test.ts additions
- pubmed esummary produces per-UID entries (not single "result" entry)
- arxiv hooks execute: canonical URLs use https (async loader test)

## Questions for Review

Q1: Should the object-entries jsonPath application happen before or after envelope unwrap?

Q2: Is removing kraken's items.jsonPath safe given the envelope already handles navigation?

Q3: Should non-object filtering also exclude null/undefined values?

## Files to Read
```bash
cat tools/lib/sources/providers/declarative-engine.ts
cat tools/lib/sources/providers/specs/arxiv.yaml
cat tools/lib/sources/providers/specs/kraken.yaml
cat tools/lib/sources/providers/specs/pubmed.yaml
cat tools/lib/sources/providers/hooks/arxiv.ts
cat tools/lib/sources/providers/hooks/kraken.ts
```

## Output Format
Write findings to `claude-codex-coop/REVIEW-hook-wiring-esummary.md`.
