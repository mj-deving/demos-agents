# Phase 4 Review — Provider Adapters

Date: 2026-03-14

## Scope Notes

This review is based on the current implementation in:

- `Plans/unified-loop-architecture-v2.md`
- `Plans/source-registry-v2.md`
- `tools/lib/sources/{catalog,policy,matcher,index}.ts`
- `tools/lib/extensions.ts`
- `tools/lib/attestation-policy.ts`
- `tools/lib/publish-pipeline.ts`
- `tools/session-runner.ts`
- `sources/catalog.json`

Important current-state facts that affect the design:

- The runtime source path is still template-driven. `policy.ts` resolves URLs with `fillUrlTemplate()`.
- `matcher.ts` is synchronous and does not fetch or parse provider responses.
- `tools/lib/extensions.ts` defines `beforePublishDraft` and `afterPublishDraft`, but `tools/session-runner.ts` does not currently call `runBeforePublishDraft()` or `runAfterPublishDraft()`.
- `publish-pipeline.ts` rejects XML/HTML/non-JSON in `attestDahr()`.
- `loadAgentSourceView()` only loads `active` and `degraded` sources by default.
- The current catalog has `92` `generic` active sources. Active providers are `arxiv, coingecko, defillama, generic, github, hn-algolia, pypi, wikipedia, worldbank`.
- There are no active `binance` or `kraken` sources today, and the current PubMed URLs are misclassified as `provider: "generic"`.

## Q1. ProviderAdapter Interface

**Answer:** Keep the idea, but change the contract. `generateCandidates(topic, tokens)` is too detached from the existing runtime because selection is currently source-record based, and multiple records under the same provider need different endpoint behavior. The adapter contract should be source-aware and method-aware:

```ts
type AttestationMethod = "TLSN" | "DAHR";

interface CandidateRequest {
  sourceId: string;
  provider: string;
  operation: string;
  method: "GET";
  url: string;
  attestation: AttestationMethod;
  estimatedSizeKb?: number;
  matchHints: string[];
}

interface EvidenceEntry {
  id: string;
  title?: string;
  summary?: string;
  bodyText: string;
  canonicalUrl?: string;
  publishedAt?: string;
  topics: string[];
  metrics?: Record<string, string | number>;
  raw: unknown;
}

interface ParsedAdapterResponse {
  entries: EvidenceEntry[];
  normalized?: unknown;
}

interface ProviderAdapter {
  readonly provider: string;
  readonly domains: string[];
  readonly rateLimit: {
    bucket: string;
    maxPerMinute?: number;
    maxPerDay?: number;
  };

  supports(source: SourceRecordV2): boolean;

  buildCandidates(ctx: {
    source: SourceRecordV2;
    topic: string;
    tokens: string[];
    vars: Record<string, string>;
    attestation: AttestationMethod;
    maxCandidates: number;
  }): CandidateRequest[];

  validateCandidate(candidate: CandidateRequest): {
    ok: boolean;
    reason?: string;
    rewrittenUrl?: string;
  };

  parseResponse(source: SourceRecordV2, response: {
    url: string;
    status: number;
    headers: Record<string, string>;
    bodyText: string;
  }): ParsedAdapterResponse;
}
```

`fillUrlTemplate()` should become a helper used only by the generic/quarantine path, not the main runtime path.

`DataEntry` must be replaced by a defined type like `EvidenceEntry`.

Do not add a separate required `normalizeResponse(rawBody)` method. Put normalization inside `parseResponse()`. For DAHR compatibility, the real decision is whether the adapter can produce a JSON-safe attestation URL for that provider/method; response parsing alone does not solve attestation constraints.

`matcher.ts` should consume `EvidenceEntry[]` after fetching candidates. That requires `match()` to become async.

**Rationale:** The current system selects `SourceRecordV2` records, not providers in the abstract. A provider-only interface cannot distinguish `coingecko-simple` from `coingecko-market`, or `github-repo` from `github-search`, without smuggling record-specific behavior through names or URLs.

**Risks:** This adds one more layer of indirection and likely requires a small catalog schema extension for stable per-source adapter metadata such as `operation`.

**Dependencies:** `catalog.json`/`SourceRecordV2` need an adapter-level discriminator such as `adapter.operation`; `matcher.ts` must become async; `policy.ts` must stop directly calling `fillUrlTemplate()`.

## Q2. File Structure

**Answer:** Adapters should live under code, not data:

```text
tools/lib/sources/
├── index.ts
├── catalog.ts
├── policy.ts
├── matcher.ts
├── fetch.ts
├── rate-limit.ts
└── providers/
    ├── index.ts
    ├── types.ts
    ├── generic.ts
    ├── hn-algolia.ts
    ├── coingecko.ts
    ├── binance.ts
    ├── kraken.ts
    ├── defillama.ts
    ├── github.ts
    ├── arxiv.ts
    ├── wikipedia.ts
    ├── worldbank.ts
    └── pubmed.ts
```

Keep `sources/` as data only: `catalog.json`, schema, fixtures, test results.

Use `tools/lib/sources/providers/index.ts` as the provider registry and barrel:

- `getProviderAdapter(provider: string): ProviderAdapter | null`
- `requireProviderAdapter(provider: string): ProviderAdapter`
- `listProviderAdapters(): ProviderAdapter[]`

`tools/lib/sources/index.ts` should re-export only the registry accessors, not every adapter file directly.

**Rationale:** `sources/` is already a data directory. Putting `.ts` runtime code there will blur build/runtime boundaries and make the catalog layout harder to reason about.

**Risks:** None beyond a small refactor cost.

**Dependencies:** Add a runtime registry; update imports in `policy.ts`, `matcher.ts`, and the future test CLI.

## Q3. Integration With Existing Source Pipeline

**Answer:** Adapters should plug in at three points:

1. `preflight()` in `policy.ts`
   - Keep catalog/index filtering as step one.
   - Replace direct `fillUrlTemplate()` with `adapter.buildCandidates(...)`.
   - Return multiple `PreflightCandidate`s, capped by `maxCandidatesPerTopic`.

2. `match()` in `matcher.ts`
   - Convert to async.
   - Fetch only the `PreflightCandidate`s returned by preflight.
   - Parse via `adapter.parseResponse()`.
   - Score against structured `EvidenceEntry[]`.

3. publish stage
   - Stop re-running source selection in `session-runner.ts`.
   - Publish should use the best matched candidate returned by `afterPublishDraft`.

Adapters should not own raw network fetch or attestation. Keep fetch/retry/attest in shared infrastructure so logging, retries, and publish semantics stay centralized.

`generateCandidates()` should not replace catalog selection; it should refine it. The catalog decides which source records are eligible. The adapter decides which concrete URLs are valid for that source and method.

If an adapter produces multiple URLs, `preflight()` should keep the top few ranked candidates instead of collapsing to a single URL up front.

**Rationale:** This preserves the existing separation of concerns: catalog lookup is still the source registry decision, while adapters provide provider intelligence. It also eliminates the current duplication where `session-runner.ts` reselects a source after generation.

**Risks:** Making `match()` async widens its call graph. That is justified, but it should be done in one session and wired end-to-end.

**Dependencies:** `session-runner.ts` must actually call `runBeforePublishDraft()` and `runAfterPublishDraft()`; `extensions.ts` becomes the stable integration seam; `policy.ts` must start honoring `maxCandidatesPerTopic`.

## Q4. Generic Adapter Restriction

**Answer:** Yes: if finding #7 is taken seriously, every `active` or `degraded` source used by runtime publish must map to a real provider adapter. The generic adapter should exist only for:

- quarantined sources
- discovery/testing flows
- manual admin validation

Unsupported active sources should be treated as ineligible at runtime with a hard failure such as `ADAPTER_UNAVAILABLE`.

This is a blocker with the current catalog state. There are `92` active `generic` sources today, and PubMed endpoints that should be `pubmed` are also still `generic`.

Phase 4 therefore needs a migration rule:

- Active/degraded runtime sources must have `provider !== "generic"` and a registered adapter.
- Any source that does not meet that rule is downgraded to `quarantined` or excluded from runtime until an adapter exists.

There can still be a `generic` adapter, but only off the main publish path.

**Rationale:** A generic active runtime path defeats the whole purpose of provider-specific constraints, parsing, and safety guarantees.

**Risks:** This will temporarily reduce runtime source coverage unless the catalog is migrated in the same phase.

**Dependencies:** Catalog migration; provider inference updates for PubMed; runtime validation during `loadAgentSourceView()` or `preflight()`.

## Q5. Rate Limiting

**Answer:** Rate limit state should be tracked centrally, not on the adapter object. For Phase 4, process-global in-memory buckets are sufficient for `session-runner.ts`; Phase 6 can add optional persisted buckets for the parallel testing CLI.

Design:

- `rate-limit.ts` exposes `acquireRateLimitToken(bucketKey)` and `recordRateLimitResponse(bucketKey, retryAfter?)`.
- Buckets are keyed by provider/auth identity, not adapter instance.
- `fetch.ts` checks rate limits before making a request.
- `runtime.retry` remains request retry policy after a request is admitted. It should not be conflated with quota tracking.

Scope:

- Global within the process across all agents using the same provider bucket.
- Not persisted in Phase 4 runtime.
- Persisted/file-backed only if Phase 6 parallel test runs prove it necessary.

**Rationale:** The session runner is a single long-lived process. Persisted quota state is extra complexity unless there is real cross-process contention.

**Risks:** Two concurrent CLIs can still exceed a provider quota. That is acceptable for Phase 4 runtime, but the test CLI should address it later if run in parallel.

**Dependencies:** Shared fetch wrapper; adapter registry must declare a bucket key; Phase 6 may extend the store to file-backed state.

## Q6. TLSN Constraints

**Answer:** `tlsnMaxParams` as a raw map is too weak. TLSN constraints should be enforced through `buildCandidates()` plus `validateCandidate()`.

Rule:

- `buildCandidates(..., attestation: "TLSN")` must produce only TLSN-safe URLs.
- `validateCandidate()` is a second guard before attestation.
- `max_response_kb` in the catalog stays as a source-level heuristic and testing signal.
- Adapter TLSN rules are the hard request-level guardrail.

Examples:

- HN Algolia: force `hitsPerPage<=2`
- GitHub: force `per_page<=3`
- arXiv: force `max_results<=3`
- Wikipedia search: force `srlimit<=2`

`resolveAttestationPlan()` should continue deciding method only. It should not enforce provider URL details.

**Rationale:** TLSN safety is about the exact request shape, not just a source-level boolean. The current HN hardcoded guardrail in `publish-pipeline.ts` proves this.

**Risks:** If enforcement remains split across adapters and publish code, drift will reappear.

**Dependencies:** Move HN-specific URL rewriting out of `publish-pipeline.ts` into adapter validation; extend `PreflightCandidate` with validated final URLs.

## Q7. Response Normalization For DAHR

**Answer:** This is the biggest design blocker. With the current pipeline, normalization can happen inside the adapter for matching/testing, but not for DAHR attestation of the transformed payload. `attestDahr()` currently rejects XML/HTML/non-JSON and attests only the fetched URL response.

So the design needs to choose one of these explicitly:

1. Phase 4 runtime rule
   - DAHR supports only providers/endpoints that already return JSON.
   - XML/RSS providers are TLSN-only in publish runtime.
   - Adapters may still normalize XML/RSS inside `parseResponse()` for matcher/testing.

2. New attestation capability
   - Introduce a trusted normalization service or a new `attestDahrPayload(normalizedJson, sourceMetadata)` path.
   - This is larger than Phase 4 and should not be hidden inside adapter code.

My recommendation is option 1 for Phase 4. That means:

- `arxiv` remains XML for parsing, but no DAHR until the attestation pipeline changes.
- RSS sources like `pypi-recent` stay out of DAHR publish.
- PubMed is fine because the existing endpoints already use `retmode=json`.

Normalized JSON should not be cached in Phase 4 runtime. Regenerate it on fetch. Caching belongs in the future test CLI if needed.

**Rationale:** An adapter cannot make DAHR attest transformed data if the attestation system only knows how to attest the raw upstream response.

**Risks:** This narrows Phase 4 scope compared with the plan text, but it matches the code that exists.

**Dependencies:** Update plan expectations; catalog safety flags for XML/RSS endpoints may need correction; any future DAHR normalization support requires explicit pipeline work in `publish-pipeline.ts`.

## Q8. Testing Strategy

**Answer:** Use three layers:

1. Adapter unit tests with fixtures
   - `buildCandidates()` output
   - `validateCandidate()` rewrites/rejections
   - `parseResponse()` against stored JSON/XML fixtures

2. Catalog contract tests
   - Every active/degraded source has a registered non-generic adapter
   - Every adapter supports the source records assigned to it
   - No active source resolves to unresolved placeholders

3. Live smoke tests outside normal CI
   - `tools/source-test.ts`
   - small parallelism
   - opt-in/nightly/manual

Do not add `selfTest()` to the adapter runtime interface. That mixes test orchestration into production code. Instead, the test CLI should call the normal adapter methods and use adapter-specific fixture topics.

Validation rules for live tests:

- generated URLs return non-error status
- response size stays within expected TLSN/DAHR envelope
- `parseResponse()` returns at least one `EvidenceEntry`
- attestation-method compatibility matches the catalog flags

**Rationale:** Live APIs are too flaky for core unit tests, but fixture-only tests are not enough to catch provider drift.

**Risks:** Fixture drift is real. Live smoke tests must remain easy to run.

**Dependencies:** Fixture directory; future `tools/source-test.ts`; catalog/adapter contract test harness.

## Findings

### P0 (Critical)

1. **The Phase 4 DAHR normalization claim is not implementable with the current attestation pipeline.**
   - `publish-pipeline.ts` rejects XML/HTML/non-JSON in `attestDahr()`.
   - Adapters can parse XML/RSS, but they cannot make DAHR attest transformed JSON without a new attestation path.

2. **“Generic adapter only for quarantined sources” conflicts with the current runtime catalog.**
   - The catalog currently has `92` active `generic` sources.
   - This must be resolved by migration or runtime exclusion before Phase 4 is considered complete.

3. **The proposed adapter interface is not implementable as written.**
   - `DataEntry` is undefined.
   - Provider-only candidate generation is too vague for source-record-based runtime selection.
   - The design needs a source-aware, method-aware contract.

### P1 (High)

1. **The current v2 extension seam is not wired into the session runner.**
   - `extensions.ts` has `beforePublishDraft` and `afterPublishDraft`.
   - `session-runner.ts` imports the hook runners but never calls them.
   - Phase 4 should integrate through these hooks, not add a third source path.

2. **`matcher.ts` must become async and structured if adapters are going to matter post-generation.**
   - Today it only scores source metadata and tags.
   - It does not fetch or parse candidate responses.

3. **The catalog/provider inventory does not match the Tier 1 adapter list.**
   - No active `binance` or `kraken` sources today.
   - PubMed URLs exist but are currently classified as `generic`.

### P2 (Medium)

1. **TLSN guardrails are currently duplicated and misplaced.**
   - HN `hitsPerPage=2` is enforced in `publish-pipeline.ts`, not in source resolution.

2. **`maxCandidatesPerTopic` exists in source config but is not actually used in runtime selection.**

3. **There are already catalog inconsistencies around attestation safety.**
   - Example: `arxiv-search` is `tlsn_safe: true` but still uses `http://`, while the other arXiv records are `https://`.

### P3 (Low)

1. **Keep provider registry exports narrow.**
   - Export lookup helpers, not every adapter by default.

2. **Use fixtures under data paths, not code paths.**
   - Example: `sources/test-results/` or `tests/fixtures/sources/`.

## Final Phase 4 Implementation Spec

### 1. Finalized `ProviderAdapter` Interface

```ts
type AttestationMethod = "TLSN" | "DAHR";

interface CandidateRequest {
  sourceId: string;
  provider: string;
  operation: string;
  method: "GET";
  url: string;
  attestation: AttestationMethod;
  estimatedSizeKb?: number;
  matchHints: string[];
}

interface EvidenceEntry {
  id: string;
  title?: string;
  summary?: string;
  bodyText: string;
  canonicalUrl?: string;
  publishedAt?: string;
  topics: string[];
  metrics?: Record<string, string | number>;
  raw: unknown;
}

interface ParsedAdapterResponse {
  entries: EvidenceEntry[];
  normalized?: unknown;
}

interface ProviderAdapter {
  readonly provider: string;
  readonly domains: string[];
  readonly rateLimit: {
    bucket: string;
    maxPerMinute?: number;
    maxPerDay?: number;
  };

  supports(source: SourceRecordV2): boolean;

  buildCandidates(ctx: {
    source: SourceRecordV2;
    topic: string;
    tokens: string[];
    vars: Record<string, string>;
    attestation: AttestationMethod;
    maxCandidates: number;
  }): CandidateRequest[];

  validateCandidate(candidate: CandidateRequest): {
    ok: boolean;
    reason?: string;
    rewrittenUrl?: string;
  };

  parseResponse(source: SourceRecordV2, response: {
    url: string;
    status: number;
    headers: Record<string, string>;
    bodyText: string;
  }): ParsedAdapterResponse;
}
```

Required catalog addition:

```ts
interface SourceRecordV2 {
  // existing fields...
  adapter?: {
    operation: string;   // e.g. "search", "summary", "repo", "indicator"
  };
}
```

### 2. File Structure And Barrel Exports

Use:

```text
tools/lib/sources/providers/index.ts
tools/lib/sources/providers/types.ts
tools/lib/sources/providers/*.ts
tools/lib/sources/fetch.ts
tools/lib/sources/rate-limit.ts
```

Exports:

- `tools/lib/sources/providers/index.ts`
  - `getProviderAdapter`
  - `requireProviderAdapter`
  - `listProviderAdapters`
- `tools/lib/sources/index.ts`
  - re-export the three registry helpers
  - re-export runtime types

### 3. Integration Points

`policy.ts`

- Replace `fillUrlTemplate()` resolution with `adapter.buildCandidates()`.
- Return up to `maxCandidatesPerTopic` total candidates, not one per method.
- Reject active/degraded sources without a registered non-generic adapter.

`matcher.ts`

- Convert `match()` to `async`.
- Fetch only preflight candidates via shared `fetch.ts`.
- Parse via `adapter.parseResponse()`.
- Score structured evidence first; use metadata-only score only as a fallback during migration.

`extensions.ts`

- Keep `sources` as the integration seam.
- `beforePublishDraft` returns the preflight candidates.
- `afterPublishDraft` returns the best matched candidate and evidence summary.

`session-runner.ts`

- Actually call `runBeforePublishDraft()` before LLM generation.
- Actually call `runAfterPublishDraft()` after draft generation.
- Publish using the matched candidate returned by the extension, not a second direct call to `selectSourceForTopicV2()`.

### 4. Per-Adapter Specs For The 10 Tier 1 Providers

| Provider | Operations | TLSN rule | DAHR rule | Parse output |
|----------|------------|-----------|-----------|--------------|
| `hn-algolia` | `search`, `search_by_date`, `front_page`, `ask_hn`, `show_hn` | force `hitsPerPage<=2` | same URL OK | entries from `hits[]` with title/story/url/author/created_at |
| `coingecko` | `simple-price`, `market-chart`, `coin-detail`, `trending`, `categories` | only compact endpoints like `simple-price`, `trending`; limit days/results | full JSON endpoints OK | entries from coins/categories/price objects |
| `binance` | `ticker-price`, `ticker-24hr`, `klines` | single symbol, small result count | JSON endpoints OK | entries with symbol/price/change/volume |
| `kraken` | `ticker`, `assets`, `ohlc` | single pair, small count | JSON endpoints OK | entries from `result` map |
| `defillama` | `tvl`, `protocol`, `chains`, `yields`, `dexs`, `stablecoins` | only very small endpoints like `tvl/{protocol}` | larger endpoints DAHR-only | entries with protocol/chain/tvl/yield metrics |
| `github` | `repo`, `releases`, `commits`, `search-repos` | force `per_page<=3` | same URL OK | entries from repo/release/commit/search items |
| `arxiv` | `search`, `category` | force `max_results<=3`, require `https://` | no DAHR in Phase 4 unless attestation pipeline changes | entries from Atom feed entries |
| `wikipedia` | `summary`, `search` | `srlimit<=2` | JSON endpoints OK | entries from summary/search results |
| `worldbank` | `indicator`, `country` | small `per_page`, prefer `mrv=1` where possible | JSON endpoints OK | entries from `[meta, data]` arrays |
| `pubmed` | `esearch`, `esummary` | cap `retmax`, small id batches | JSON endpoints OK | entries from `esearchresult` and `result` payloads |

Notes:

- PubMed requires a provider inference fix from `generic` to `pubmed`.
- arXiv should be corrected to `https://` consistently.
- `pypi` is not in Tier 1 and should not stay active/generic through Phase 4 without an explicit decision.

### 5. Migration Strategy

1. Add provider registry and adapter interface first.
2. Extend provider inference in `catalog.ts` for missing real providers, especially PubMed.
3. Add `adapter.operation` metadata to the catalog schema and migration tool.
4. Migrate all active/degraded sources:
   - map to a registered adapter, or
   - downgrade to `quarantined`
5. Add runtime validation:
   - active/degraded source without adapter => reject from runtime view
   - `provider: "generic"` allowed only for quarantined/testing paths
6. Move HN TLSN guardrail out of `publish-pipeline.ts` into adapter validation.
7. Convert `matcher.ts` and `extensions.ts` integration before adding more provider coverage.

### 6. Step-By-Step Implementation Order

1. Finalize types and registry
   - `ProviderAdapter`
   - `CandidateRequest`
   - `EvidenceEntry`
   - registry helpers

2. Catalog alignment
   - add `adapter.operation`
   - fix provider inference for PubMed
   - audit active `generic` sources and quarantine unsupported ones

3. Shared runtime plumbing
   - `fetch.ts`
   - `rate-limit.ts`
   - candidate validation hooks

4. Implement Tier 1 adapters
   - start with current active providers: HN, CoinGecko, DefiLlama, GitHub, arXiv, Wikipedia, World Bank, PubMed
   - then add Binance and Kraken for forward coverage

5. Integrate selection
   - update `policy.ts`
   - honor `maxCandidatesPerTopic`

6. Integrate matching
   - convert `matcher.ts` to async
   - fetch/parse/scored evidence

7. Wire the session loop
   - call `runBeforePublishDraft()`
   - call `runAfterPublishDraft()`
   - publish from matched candidate only

8. Add tests
   - adapter fixtures
   - catalog/adapter contract tests
   - manual smoke test command scaffolding for Phase 6
