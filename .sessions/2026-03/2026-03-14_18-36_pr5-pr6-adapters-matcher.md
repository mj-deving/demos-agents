# Session: PR5 Adapter Removal + PR6 Matcher Hardening

**Date:** 2026-03-14 18:36
**Duration:** ~2.5 hours
**Mode:** full
**Working Directory:** ~/projects/demos-agents

## Summary

Major cleanup and feature session: validated declarative adapter equivalence via golden tests, removed 10 hand-written TypeScript adapters (-2,827 lines), fixed two P1 bugs exposed by the removal, and shipped PR6 with LLM-assisted claim extraction and cross-source diversity scoring for the matcher.

## Work Done

- PR5: wrote 62 golden-response tests comparing hand-written vs declarative adapters across all 10 providers
- PR5: deleted 10 hand-written adapter .ts files, simplified index.ts to declarative-only
- Fixed YAML `tokens[0]` quoting bug in binance.yaml and kraken.yaml
- Added `{.}` self-reference in declarative engine for primitive item templates (pubmed esearch)
- Fixed hook wiring: moved `hooks:` under `parse:` in arxiv.yaml and kraken.yaml (4 locations)
- Fixed object-entries mode to apply `items.jsonPath` + filter non-object values (pubmed esummary)
- Removed redundant `items.jsonPath` from kraken specs (envelope handles it)
- PR6: implemented `extractClaimsLLM()` with LLM-assisted structured claim extraction
- PR6: implemented `extractClaimsAsync()` — LLM first, regex fallback, merged deduped
- PR6: implemented `calculateDiversityBonus()` — cross-source claim corroboration scoring
- PR6: added 10s Promise.race timeout, 1500-char text truncation, prompt injection fix
- PR6 Codex review fix: diversity dedupes per-source, bonus only to contributing candidates

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Move hooks under parse in YAML (not change engine) | Matches existing ParseSpec TypeScript type | Support both operation-level and parse-level hooks |
| Keep regex always running alongside LLM | Union of both strategies maximizes claim coverage | LLM-only when successful (loses regex-caught numerics) |
| Diversity bonus +5/claim capped at +15 | Conservative cap prevents false threshold crossings | +10 cap (Codex recommended), +20 (too aggressive) |
| Apply bonus only to contributing candidates | Prevents non-corroborating sources from free-riding | Apply to all (original, simpler but unfair) |
| Build prompt via template literal not .replace() | Prevents placeholder collision from postText containing `{TAGS}` | Escape placeholders (complex) |

## Key Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| tests/golden-adapters.test.ts | created | 62+ declarative adapter correctness tests |
| tools/lib/sources/providers/index.ts | edited | Declarative-only registry (removed 10 imports) |
| tools/lib/sources/providers/declarative-engine.ts | edited | {.} self-reference, object-entries jsonPath, docs |
| tools/lib/sources/providers/specs/arxiv.yaml | edited | Hook indentation fix |
| tools/lib/sources/providers/specs/kraken.yaml | edited | Hook indentation + removed redundant jsonPath |
| tools/lib/sources/providers/specs/binance.yaml | edited | tokens[0] quoting |
| tools/lib/sources/matcher.ts | edited | LLM claims, diversity scoring, timeout, truncation |
| tests/matcher.test.ts | edited | 12 new tests for LLM extraction + diversity |
| 10 adapter .ts files | deleted | hn-algolia, coingecko, github, defillama, arxiv, wikipedia, worldbank, pubmed, binance, kraken |

## Learnings

- YAML `tokens[0]` inside flow sequences `[...]` is invalid — the `[0]` starts a nested sequence. Must quote as `"tokens[0]"`
- Hand-written adapters were masking two engine bugs (hook wiring, object-entries jsonPath) — golden tests exposed them
- Codex design review must complete BEFORE implementation starts — parallelizing defeats the purpose
- Sequential `.replace()` for prompt construction is vulnerable to placeholder collision from user content
- Single source can self-corroborate if matchedClaims has duplicates — must dedupe per-source

## Open Items

- [ ] Wire LLM provider into session-runner → MatchInput.llm (PR6 feature is implemented but not connected to production)
- [ ] PR7: Source testing CLI
- [ ] PR8: Discovery + lifecycle
- [ ] Pioneer calibration tuning (avg error -9.6)
- [ ] Score dilution from regex merge (Codex P2 — monitor, may need LLM-only mode option)

## Context for Next Session

PR5 (adapter removal) and PR6 (matcher hardening) are complete and pushed. 128 tests across 9 suites. The LLM claim extraction is implemented but not wired into the session-runner yet — needs `resolveProvider()` call and pass to `match()`. Next PR on the roadmap is PR7 (source testing CLI).
