# Codex Review: Phase 4 — Provider Adapters (Implementation Review)

## Context

This is an **implementation review** for Phase 4 of the unified loop architecture v2. The design review was completed previously (`REVIEW-phase4.md`). This review covers the actual implementation against that design spec.

**Commit:** ae07ec4
**Files changed:** 24 (14 new, 10 modified)

## What Was Implemented

### New Files (14)

**Provider Adapter System:**
- `tools/lib/sources/providers/types.ts` — ProviderAdapter interface, CandidateRequest, EvidenceEntry, ParsedAdapterResponse, BuildCandidatesContext types
- `tools/lib/sources/providers/index.ts` — Provider registry (getProviderAdapter, requireProviderAdapter, listProviderAdapters)

**10 Tier 1 Adapters:**
- `tools/lib/sources/providers/hn-algolia.ts` — HN Algolia (search, search_by_date, front_page)
- `tools/lib/sources/providers/coingecko.ts` — CoinGecko (simple-price, trending, coin-detail, market-chart, categories)
- `tools/lib/sources/providers/defillama.ts` — DefiLlama (tvl, protocol, chains, yields, dexs)
- `tools/lib/sources/providers/github.ts` — GitHub (repo, search-repos, commits, releases)
- `tools/lib/sources/providers/arxiv.ts` — arXiv (search, XML regex parsing, TLSN-only)
- `tools/lib/sources/providers/wikipedia.ts` — Wikipedia (summary, search)
- `tools/lib/sources/providers/worldbank.ts` — World Bank (indicator, country)
- `tools/lib/sources/providers/pubmed.ts` — PubMed (esearch, esummary)
- `tools/lib/sources/providers/binance.ts` — Binance (ticker-price, ticker-24hr, klines)
- `tools/lib/sources/providers/kraken.ts` — Kraken (ticker, assets, ohlc)
- `tools/lib/sources/providers/generic.ts` — Generic (quarantined sources only)

**Shared Plumbing:**
- `tools/lib/sources/fetch.ts` — fetchSource with retry, timeout, rate-limit
- `tools/lib/sources/rate-limit.ts` — In-memory token bucket per provider

### Modified Files (10)

- `tools/lib/sources/catalog.ts` — SourceRecordV2.adapter field, inferProvider PubMed, hasValidAdapter()
- `tools/lib/sources/policy.ts` — adapter.buildCandidates replaces fillUrlTemplate, hasRegisteredAdapter gate
- `tools/lib/sources/matcher.ts` — async match() with parallel fetch via Promise.all, evidence-based scoring
- `tools/lib/sources/index.ts` — Barrel exports for adapters, fetch, types
- `tools/lib/extensions.ts` — await on async match()
- `tools/lib/publish-pipeline.ts` — HN hitsPerPage guardrail removed (moved to adapter)
- `tools/session-runner.ts` — runBeforePublishDraft/runAfterPublishDraft hooks wired into runPublishAutonomous
- `sources/catalog.json` — adapter.operation metadata, PubMed provider fix, 92 generic sources quarantined

## Design Review Findings Addressed

### From REVIEW-phase4.md:

| # | Severity | Finding | How Addressed |
|---|----------|---------|---------------|
| P0.1 | Critical | DAHR normalization not implementable for XML | arXiv adapter returns empty candidates for DAHR, TLSN-only |
| P0.2 | Critical | Generic adapter restriction vs 92 active generics | 92 generic + 2 pypi quarantined; hasRegisteredAdapter gate in policy.ts |
| P0.3 | Critical | Adapter interface not implementable as written | Source-aware, method-aware contract implemented per review spec |
| P1.1 | High | Extension hooks not wired in session-runner | runBeforePublishDraft/runAfterPublishDraft called in runPublishAutonomous |
| P1.2 | High | matcher.ts must become async | Converted to async with parallel fetch via Promise.all |
| P1.3 | High | Catalog/provider inventory mismatch | PubMed fixed from generic, adapter.operation added to all active sources |
| P2.1 | Medium | TLSN guardrails duplicated/misplaced | HN guardrail moved from publish-pipeline.ts to hn-algolia adapter |
| P2.2 | Medium | maxCandidatesPerTopic not used | Now passed through selectSourceForTopicV2 and honored |
| P2.3 | Medium | Catalog inconsistencies | Active sources audited, non-adapted quarantined |

### From REVIEW-phase3-steps34.md (deferred):

| # | Finding | How Addressed |
|---|---------|---------------|
| 1 | Extension hooks bypassed in session-runner (P1) | Hooks now wired — runBeforePublishDraft/runAfterPublishDraft called |
| 6 | attestation-policy.ts retains v1 API (P2) | v1 API still present but no longer called by session-runner publish path |

## What To Review

### Q1: ProviderAdapter Contract Correctness

Does the implemented interface match the design spec from REVIEW-phase4.md? Check:
- `buildCandidates()` — source-aware, method-aware
- `validateCandidate()` — TLSN parameter enforcement
- `parseResponse()` — EvidenceEntry output
- `supports()` — correct dispatch

### Q2: Adapter Implementation Quality

For each of the 10 Tier 1 adapters, verify:
- Operation inference from `source.adapter?.operation` with URL fallback
- TLSN constraints enforced in both buildCandidates AND validateCandidate
- parseResponse handles malformed/empty responses without throwing
- Correct API endpoints and query parameter patterns

### Q3: Integration Correctness

- **policy.ts**: Does hasRegisteredAdapter correctly gate generic sources? Does adapter.buildCandidates produce valid candidates?
- **matcher.ts**: Does parallel fetch via Promise.all respect rate limits? Does evidence-based scoring produce reasonable scores?
- **session-runner.ts**: Does the hook-based flow preserve all failure modes (preflight skip, match fallback, TLSN→DAHR fallback)?
- **extensions.ts**: Is the async await change sufficient for the hook dispatcher?

### Q4: Catalog Migration Correctness

- Are all 46 active sources correctly mapped to adapters?
- Is adapter.operation correctly inferred for each provider?
- Are quarantined sources still loadable via generic adapter for testing?

### Q5: Edge Cases

- What happens when preflight passes but match() fails (all fetches timeout)?
- What happens when an adapter's buildCandidates returns empty (e.g., arXiv for DAHR)?
- Does the legacy fallback in session-runner actually work if both hooks return void?
- Rate limit bucket key collisions between providers?

## Files to Read

```bash
# New adapter system
cat tools/lib/sources/providers/types.ts
cat tools/lib/sources/providers/index.ts
cat tools/lib/sources/fetch.ts
cat tools/lib/sources/rate-limit.ts

# All 11 adapters
for f in tools/lib/sources/providers/{hn-algolia,coingecko,defillama,github,arxiv,wikipedia,worldbank,pubmed,binance,kraken,generic}.ts; do echo "=== $f ==="; cat "$f"; done

# Integration changes
git diff HEAD~1 -- tools/lib/sources/policy.ts
git diff HEAD~1 -- tools/lib/sources/matcher.ts
git diff HEAD~1 -- tools/session-runner.ts
git diff HEAD~1 -- tools/lib/extensions.ts
git diff HEAD~1 -- tools/lib/publish-pipeline.ts
git diff HEAD~1 -- tools/lib/sources/catalog.ts
git diff HEAD~1 -- tools/lib/sources/index.ts

# Catalog migration
jq -r '.sources[] | select(.status=="active") | "\(.provider) \(.adapter.operation // "NO-OP") \(.name)"' sources/catalog.json
jq -r '.sources[].status' sources/catalog.json | sort | uniq -c

# Design review for reference
cat claude-codex-coop/REVIEW-phase4.md
```

## Output Format

For each question (Q1-Q5), provide:
- **Findings:** Issues found (with file:line references)
- **Severity:** P0 (blocker), P1 (high), P2 (medium), P3 (low)

Then provide overall assessment:
- Does the implementation match the design spec?
- Any security concerns (URL injection, response parsing)?
- Any breaking changes to autonomous sessions?
- Confidence level for deploying this in a live session
