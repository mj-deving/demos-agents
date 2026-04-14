# Codex Review: Phase 4 — Provider Adapters (Design Review)

## Context

This is a **design review** for Phase 4 of the unified loop architecture v2. Phase 4 implements smart per-provider URL generation and response parsing via typed adapter modules. This replaces the current generic URL template approach with provider-specific logic that knows query patterns, rate limits, response formats, and TLSN constraints.

**Plan references:**
- `Plans/unified-loop-architecture-v2.md` (Phase 4 section, lines 709-718)
- `Plans/source-registry-v2.md` (Component 3: Provider Adapters, lines 302-357)

Phases 0A, 0B, 1, 2, and 3 are all implemented and committed. Phase 4 is next.

## Current State (What Exists Today)

### Phase 3 deliverables (all committed):
1. **`tools/lib/sources/catalog.ts`** — `SourceRecordV2` schema, `loadCatalog()`, `buildSourceIndex()`, `loadAgentSourceView()`, `tokenizeTopic()`, `sourceTopicTokens()`
2. **`tools/lib/sources/policy.ts`** — `preflight()`, `selectSourceForTopicV2()`
3. **`tools/lib/sources/matcher.ts`** — `match()`, `extractClaims()`, `scoreMatch()`
4. **`tools/lib/sources/index.ts`** — Runtime barrel re-exports
5. **`tools/lib/extensions.ts`** — Extension dispatcher with `beforeSense`, `beforePublishDraft`, `afterPublishDraft` hooks
6. **`sources/catalog.json`** — 138 V2 records migrated from 3 YAML registries
7. **`tools/source-migrate.ts`** — Migration CLI

### How sources are used today:
- `preflight(topic)` checks catalog for available source before LLM draft
- `match(postText, postTags, candidates)` finds best source post-generation
- `selectSourceForTopicV2()` does token overlap matching to find best source + resolved URL
- URL resolution uses `fillUrlTemplate()` which does simple `{placeholder}` substitution

### Current URL template approach (in catalog.json):
```json
{
  "name": "hn-algolia-bitcoin",
  "provider": "hn-algolia",
  "url": "https://hn.algolia.com/api/v1/search?query={topic}&hitsPerPage=2",
  "topics": ["bitcoin", "cryptocurrency"]
}
```

This is **dumb** — the same URL template for all providers, no provider-specific query optimization, no response parsing, no rate limit awareness.

### Relevant source counts by provider (from catalog.json):
```bash
jq -r '.sources[].provider' sources/catalog.json | sort | uniq -c | sort -rn
```

Run this to see the provider distribution. Key providers to adapt: hn-algolia, coingecko, defillama, github, binance, arxiv, wikipedia, worldbank, kraken, pubmed.

## What Phase 4 Should Do

From the unified plan:
> Smart per-provider URL generation and response parsing.
> - Generic adapter restricted to quarantined sources only (finding #7)
> - XML/RSS adapters include JSON normalization for DAHR compatibility (finding #3)
> - 10 Tier 1 adapters (HN, CoinGecko, Binance, Kraken, DefiLlama, GitHub, arXiv, Wikipedia, World Bank, PubMed)

From source-registry-v2.md:
```typescript
interface ProviderAdapter {
  name: string;
  baseUrl: string;
  generateCandidates(topic: string, tokens: string[]): CandidateUrl[];
  extractEntries(responseBody: string): DataEntry[];
  rateLimit: { maxPerMinute: number; maxPerDay: number };
  tlsnMaxParams: Record<string, string>;
  domains: string[];
}
```

## What Needs Review (Specific Questions)

### Q1: ProviderAdapter Interface — Is It Right?

The proposed interface from source-registry-v2.md has:
- `generateCandidates(topic, tokens)` — URL generation
- `extractEntries(responseBody)` — response parsing

**Questions:**
- Is `generateCandidates` the right abstraction? The current `fillUrlTemplate()` takes a source record + topic and produces a URL. Should adapters replace or extend this?
- `extractEntries` returns `DataEntry[]` — what's a `DataEntry`? This is never defined anywhere.
- Should there be a `normalizeResponse(rawBody)` method for XML/RSS→JSON normalization (finding #3)?
- How does the adapter interact with `match()` in `matcher.ts`? Currently `scoreMatch()` works on raw text. Should adapters provide structured data for better claim matching?

### Q2: Where Do Adapters Live — File Structure

The plan proposes `sources/providers/` with one file per adapter. But this is under `sources/` (data directory), not `tools/lib/sources/` (code directory).

**Questions:**
- Should adapters go in `tools/lib/sources/providers/` (alongside catalog.ts, policy.ts, matcher.ts)?
- Or in `sources/providers/` (alongside catalog.json)?
- What's the barrel export strategy? One `providers/index.ts` that maps provider name → adapter?

### Q3: Integration with Existing Source Pipeline

Currently the pipeline is:
1. `preflight(topic)` → finds candidate sources from catalog
2. LLM generates post
3. `match(postText, candidates)` → finds best source
4. `resolveAttestationPlan()` → decides TLSN vs DAHR
5. Fetch source URL, attest, publish

**Questions:**
- Where do adapters plug in? Do they replace `fillUrlTemplate()` in step 1/3?
- Do adapters own the fetch in step 5, or just generate the URL?
- If an adapter generates multiple candidate URLs for a topic (`generateCandidates`), how does this interact with `preflight()` which currently returns a single best match?
- Should `match()` use `extractEntries()` for structured claim matching instead of raw text?

### Q4: Generic Adapter Restriction

Finding #7 says "Generic adapter only for quarantined sources." Currently ALL sources use generic template matching.

**Questions:**
- Does this mean Phase 4 MUST map every active source to a provider adapter?
- What happens to active sources whose provider doesn't have an adapter yet? (e.g., if there's a `fred` source but no FRED adapter in Phase 4)
- Shouldn't there be a `generic` adapter that works for any JSON API, and provider-specific adapters that optimize on top?

### Q5: Rate Limiting

The interface proposes `rateLimit: { maxPerMinute: number; maxPerDay: number }`.

**Questions:**
- Where is rate limit state tracked? In-memory (lost on restart) or persisted?
- Is rate limiting per-adapter-instance or global across all agents?
- Does the session loop need to check rate limits before calling an adapter?
- How does this interact with the `runtime.retry` config already in `SourceRecordV2`?

### Q6: TLSN Constraints

Each adapter has `tlsnMaxParams` — e.g., `{ hitsPerPage: "2" }` for HN Algolia.

**Questions:**
- Are these enforced automatically when `resolveAttestationPlan()` selects TLSN?
- How do they interact with the existing `max_response_kb: 16` in catalog records?
- Should the adapter have a `validateTlsnSafety(url)` method that checks URL parameters?

### Q7: Response Normalization for DAHR

Finding #3: "XML/RSS adapters normalize XML/RSS to JSON before DAHR attestation."

**Questions:**
- Does normalization happen inside the adapter or as a middleware layer?
- Is the normalized JSON stored/cached, or regenerated each time?
- What about TLSN attestations of XML/RSS — those attest the raw response, not normalized. Does the adapter need to handle both paths?
- How does DAHR `startProxy()` currently handle XML responses? (Reference: CLAUDE.md says "DAHR rejects XML/RSS")

### Q8: Testing Strategy

How will adapters be tested?

**Questions:**
- Unit tests with mocked API responses?
- Integration tests hitting live APIs?
- Should each adapter have a `selfTest()` method? (This connects to Phase 6 testing/rating)
- How do we validate that adapter URLs actually return expected data?

## Files to Read

```bash
# Unified plan — Phase 4 section
cat Plans/unified-loop-architecture-v2.md

# Source registry v2 — Provider Adapters section
cat Plans/source-registry-v2.md

# Current source infrastructure (Phase 3 outputs)
cat tools/lib/sources/catalog.ts
cat tools/lib/sources/policy.ts
cat tools/lib/sources/matcher.ts
cat tools/lib/sources/index.ts
cat tools/lib/extensions.ts

# URL template resolution (current approach)
grep -n "fillUrlTemplate\|resolveUrl\|urlPattern" tools/lib/sources/catalog.ts tools/lib/attestation-policy.ts

# Catalog data — check provider distribution
jq -r '.sources[].provider' sources/catalog.json | sort | uniq -c | sort -rn

# How session-runner uses sources
grep -n "preflight\|match\|fillUrl\|selectSource\|SourceRecord\|provider" tools/session-runner.ts
```

## Output Format

For each question (Q1-Q8), provide:
- **Answer:** Concrete proposal (code/schema/diagram where applicable)
- **Rationale:** Why this approach over alternatives
- **Risks:** What could go wrong
- **Dependencies:** What else needs to change

Then provide overall findings as:
- **P0 (Critical):** Blockers that must be resolved before implementation
- **P1 (High):** Design gaps that will cause rework if not addressed
- **P2 (Medium):** Edge cases and ambiguities
- **P3 (Low):** Suggestions and nice-to-haves

**Final deliverable:** A concrete Phase 4 implementation spec with:
1. `ProviderAdapter` interface (finalized)
2. File structure and barrel exports
3. Integration points with existing code (what changes in policy.ts, matcher.ts, extensions.ts)
4. Per-adapter specs for the 10 Tier 1 providers
5. Migration strategy from generic templates to adapters
6. Step-by-step implementation order (which session builds what)
