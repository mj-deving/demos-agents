# Codex Review: Golden Adapter Tests (Design Review)

## Context

The declarative adapter engine (PR4) shipped 11 YAML specs that replicate all 10 hand-written TypeScript provider adapters. The registry in `index.ts` loads hand-written adapters first, then overlays declarative adapters. Declarative adapters are already serving production traffic.

**Goal:** Write golden-response tests that feed identical inputs to both hand-written and declarative adapters, comparing output for functional equivalence. Once tests pass, we'll remove the hand-written adapters.

The 10 providers: hn-algolia, coingecko, defillama, github, arxiv, wikipedia, worldbank, pubmed, binance, kraken.

## Design

### Test Architecture

One test file: `tests/golden-adapters.test.ts`

For each provider, test the 3 adapter methods:
1. **buildCandidates** — feed same `BuildCandidatesContext`, compare URLs and candidate structure
2. **validateCandidate** — feed same `CandidateRequest`, compare ok/rewrite behavior
3. **parseResponse** — feed same fixture response, compare entry count, IDs, key field presence

### Loading Both Adapters

```typescript
// Hand-written: import directly
import { adapter as hwHnAlgolia } from '../tools/lib/sources/providers/hn-algolia.js';
// etc for all 10

// Declarative: load from YAML specs
import { loadDeclarativeProviderAdaptersSync } from '../tools/lib/sources/providers/declarative-engine.js';
const declAdapters = loadDeclarativeProviderAdaptersSync({
  specDir: resolve(__dirname, '../tools/lib/sources/providers/specs'),
  strictValidation: true,
});
```

### Comparison Strategy

Output won't be identical (template formatting differs). Compare **structural equivalence**:

- **buildCandidates**: URL base+path matches, key query params present, same attestation method, same operation name
- **validateCandidate**: same ok status, same rewrite behavior (if one rewrites, other should too)
- **parseResponse**: same entry count, same entry IDs, key metrics keys present, topics overlap

### Mock Source Records

Create minimal `SourceRecordV2` for each provider/operation combination. Example:
```typescript
const hnSource: SourceRecordV2 = {
  id: 'hn-search',
  name: 'HN Search',
  url: 'https://hn.algolia.com/api/v1/search',
  provider: 'hn-algolia',
  status: 'active',
  attestation: { methods: ['TLSN', 'DAHR'] },
  adapter: { operation: 'search' },
};
```

### Fixture Responses

Inline JSON fixtures for each provider's response format. Keep minimal — 1-2 entries per fixture.

## Test Contracts

### hn-algolia
- buildCandidates produces URL containing `hn.algolia.com/api/v1/search` for both adapters
- buildCandidates includes `query` param in URL for both adapters
- buildCandidates TLSN candidate has hitsPerPage=2 for both
- validateCandidate rewrites hitsPerPage>2 to 2 for TLSN in both
- parseResponse extracts same number of entries from hits array
- parseResponse entry IDs match (objectID field)
- parseResponse entries have points metric in both

### coingecko
- buildCandidates simple-price URL contains `/simple/price` for both
- buildCandidates simple-price includes `ids` query param for both
- buildCandidates coin-detail returns empty for TLSN in both (too large)
- buildCandidates trending URL contains `/search/trending` for both
- validateCandidate market-chart rewrites days>1 for TLSN in both
- parseResponse simple-price extracts object-entries by coin ID
- parseResponse simple-price entries have price_usd metric
- parseResponse trending extracts from coins[*].item path

### github
- buildCandidates search-repos URL contains `/search/repositories` for both
- buildCandidates search-repos includes `per_page` param for both
- buildCandidates TLSN per_page=3 for both
- validateCandidate rewrites per_page>3 to 3 for TLSN in both
- parseResponse search-repos extracts items array
- parseResponse repo extracts single entry with stars metric
- parseResponse commits extracts sha-based IDs

### defillama
- buildCandidates tvl URL contains `/tvl/` for both
- buildCandidates protocol returns empty for TLSN in both
- buildCandidates chains returns empty for TLSN in both
- parseResponse tvl extracts single entry with tvl metric
- parseResponse protocol extracts single entry

### arxiv
- buildCandidates returns empty for DAHR in both
- buildCandidates TLSN URL contains max_results=3 for both
- validateCandidate rewrites max_results>3 for TLSN in both
- parseResponse extracts entries from XML <entry> blocks
- parseResponse entry IDs are arXiv paper IDs

### wikipedia
- buildCandidates summary URL contains `/page/summary/` for both
- buildCandidates search URL contains srlimit param for both
- buildCandidates TLSN search has srlimit=2 for both
- validateCandidate rewrites srlimit>2 for TLSN search in both
- parseResponse summary extracts single entry with title
- parseResponse search extracts from query.search array

### worldbank
- buildCandidates indicator URL contains `/indicator/` for both
- buildCandidates includes format=json param for both
- buildCandidates TLSN has per_page=5 for both
- validateCandidate enforces format=json in both
- parseResponse indicator extracts from [meta, data] tuple
- parseResponse indicator entries have value metric

### pubmed
- buildCandidates esearch URL contains `/esearch.fcgi` for both
- buildCandidates TLSN has retmax=3 for both
- validateCandidate enforces retmode=json in both
- validateCandidate TLSN caps retmax to 3 in both
- parseResponse esearch extracts PMIDs from idlist
- parseResponse esummary extracts articles by UID

### binance
- buildCandidates ticker-price URL contains `/ticker/price` for both
- buildCandidates includes symbol param for both
- buildCandidates resolves "bitcoin" to "BTCUSDT" in both
- validateCandidate requires symbol param in both
- validateCandidate TLSN klines caps limit to 5 in both
- parseResponse ticker-price extracts symbol and price
- parseResponse klines extracts candle entries

### kraken
- buildCandidates ticker URL contains `/Ticker` for both
- buildCandidates includes pair param for both
- buildCandidates resolves "bitcoin" to "XXBTZUSD" in both
- validateCandidate TLSN assets returns not-ok in both
- parseResponse ticker extracts from result object-entries
- parseResponse entries have ask/bid/last metrics

## Questions for Review

Q1: Should we test matchHints equivalence? The hand-written adapters include `ctx.tokens.slice(0, N)` while declarative specs use template interpolation — systematically different.

Q2: For parseResponse, should we compare exact bodyText/summary strings or just verify they're non-empty? Templates produce different formatting.

Q3: The defillama hand-written adapter has a `stablecoins` operation. The YAML spec also has it. Should we test all 6 defillama operations or focus on the most distinct ones (tvl, protocol, chains)?

Q4: For the arxiv XML parsing comparison, should we include a full Atom XML fixture or a minimal one with just 1 entry?

Q5: After removal, should index.ts still have a try/catch fallback for when declarative engine fails, or should it throw hard?

## Files to Read

```bash
cat tools/lib/sources/providers/index.ts
cat tools/lib/sources/providers/types.ts
cat tools/lib/sources/providers/declarative-engine.ts
cat tools/lib/sources/providers/hn-algolia.ts
cat tools/lib/sources/providers/coingecko.ts
cat tools/lib/sources/providers/github.ts
cat tools/lib/sources/providers/defillama.ts
cat tools/lib/sources/providers/arxiv.ts
cat tools/lib/sources/providers/wikipedia.ts
cat tools/lib/sources/providers/worldbank.ts
cat tools/lib/sources/providers/pubmed.ts
cat tools/lib/sources/providers/binance.ts
cat tools/lib/sources/providers/kraken.ts
cat tools/lib/sources/providers/specs/hn-algolia.yaml
cat tools/lib/sources/providers/specs/coingecko.yaml
cat tests/declarative-engine.test.ts
```

## Output Format

Write findings to `claude-codex-coop/REVIEW-golden-adapters.md`. Structure:

1. Design feedback (any issues with the comparison strategy)
2. Test contract review (missing behaviors, edge cases to add)
3. Answers to Q1-Q5
4. Additional test cases to add
5. Risk assessment for the adapter removal step
