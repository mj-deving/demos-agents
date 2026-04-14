# Declarative Provider Adapter Engine Plan

## Goal

Replace most hand-written provider adapters with declarative specs so adding a new provider is usually:

1. add a `yaml` spec
2. add or update catalog records
3. optionally add a tiny hook for edge logic

Target outcome: reduce a typical provider from ~250 lines of TypeScript to ~50-100 lines of YAML, while preserving the current `ProviderAdapter` contract used by `policy.ts` and `matcher.ts`.

## Decision

Use **YAML as the authoring format** and **JSON Schema as the validator**.

Why YAML:

- better for hand-editing 50+ provider specs
- supports comments and readable multi-line templates/regex
- already present in the repo via `yaml`
- JSON remains supported because JSON is valid YAML and is useful for generated fixtures

Recommendation:

- Author specs in `*.yaml`
- Validate them against `provider-spec.schema.json`
- Load both `.yaml` and `.json`

## Design Summary

The engine should introduce one new runtime module:

- `tools/lib/sources/providers/declarative-engine.ts`

It will:

- load spec files from a directory
- validate schema and semantic constraints
- create `ProviderAdapter` instances from specs
- apply URL templating, auth injection, and TLSN/DAHR constraints
- parse responses using declared JSON selectors or regex-based XML/RSS extraction
- return empty entries instead of throwing on parse failures

This keeps the public contract unchanged:

- `policy.ts` still calls `buildCandidates()` and `validateCandidate()`
- `matcher.ts` still calls `parseResponse()`
- `index.ts` still exports `getProviderAdapter()`, `requireProviderAdapter()`, `listProviderAdapters()`

## Declarative Spec Schema

### Authoring shape

```yaml
schemaVersion: 1

provider:
  name: string
  displayName: string
  matches:
    providers: [string]          # matches SourceRecordV2.provider
    hosts: [string]              # optional host match fallback
    urlPatterns: [string]        # optional regex strings
  domains: [string]
  rateLimit:
    bucket: string
    maxPerMinute: 60             # optional
    maxPerDay: 10000             # optional
    byOperation:                 # optional override
      operation-name:
        bucket: string           # optional; defaults to provider bucket
        maxPerMinute: 10
        maxPerDay: 1000
  auth:
    mode: none | query-param-env | header-env
    envVar: string               # required unless mode=none
    queryParam: string           # required for query-param-env
    headerName: string           # required for header-env
    headerValueTemplate: string  # e.g. "Bearer ${ENV}"
  defaults:
    responseFormat: json | xml | rss | html
    parseFailureMode: empty-entries | single-raw-entry
    normalizeJson: true

operations:
  operation-name:
    when:
      sourceAdapterOperation: [string]   # exact match against source.adapter.operation
      urlPatterns: [string]              # regex strings against source.url
      default: false
    request:
      method: GET
      urlTemplate: string                # full URL with {vars}
      query:                             # optional; merged after urlTemplate
        key: string | number | boolean
      headers:                           # optional
        Header-Name: string
      estimatedSizeKb:
        TLSN: 8
        DAHR: 14
      matchHints:
        - "{vars.query}"
        - "{tokens[0]}"
    variables:
      variableName:
        sources:
          - vars.asset
          - vars.symbol
          - topic
          - tokens[0]
          - literal: "BTC"
        required: true
        default: "BTC"
        transforms:
          - trim
          - lowercase
          - uppercase
          - slug
          - wiki-title
          - regex-replace:
              pattern: "\\s+"
              replacement: "-"
          - map:
              btc: bitcoin
              xbt: bitcoin
        enum: ["1m", "5m", "1h", "1d"]
        pattern: "^[A-Z0-9_-]+$"
    compatibility:
      responseFormats: [json, xml]       # must include source.responseFormat
      tlsn:
        allowed: true
        requireHttps: true
        maxResponseKb: 16
        rewriteQuery:
          hitsPerPage:
            default: 2
            max: 2
          per_page:
            max: 3
        requireQuery:
          retmode: json
      dahr:
        allowed: true
        requireNormalizedJson: true
        blockedReason: null
    parse:
      format: json | xml | rss
      envelope:
        jsonPath: "$"                    # optional; unwrap nested payload before items
      items:
        mode: json-path | regex-blocks | single-object | array-tuples | object-entries
        jsonPath: "$.hits[*]"
        blockPattern: "<entry>([\\s\\S]*?)</entry>"
        tupleFields: [time, open, high, low, close, volume]
      fields:
        id:
          jsonPath: "$.objectID"
          regex: "<id>([^<]+)</id>"
          required: true
        title:
          jsonPath: "$.title"
        summary:
          jsonPath: "$.description"
          transforms:
            - truncate: 500
        bodyText:
          template: "{story_text|title|(no content)}"
        canonicalUrl:
          jsonPath: "$.url"
        publishedAt:
          jsonPath: "$.created_at"
        topics:
          jsonPath: "$._tags[*]"
          default: []
        metrics:
          points:
            jsonPath: "$.points"
            default: 0
          num_comments:
            jsonPath: "$.num_comments"
            default: 0
        raw:
          mode: item                      # item | matched-block | parsed-root
    hooks:
      module: null                        # optional relative module path
      resolveVariables: null
      validateCandidate: null
      postParse: null
```

### Semantics and limits

To keep the engine tractable, the selector language should be deliberately small:

- JSON selectors: a minimal JSONPath subset only
  - `$`
  - `$.field`
  - `$.field.nested`
  - `$.array[*]`
  - `$[1]`
  - `$[1][*]`
- XML/RSS selectors: regex only, with first capture group as the extracted value
- templates: string interpolation plus fallback chain, e.g. `{story_text|title|(no content)}`
- `object-entries` mode iterates object values and exposes the object key as `{key}`
- topic templates that return comma-separated strings are split into topic arrays

### Validation rules

Every spec should be validated at two levels.

Schema validation:

- required top-level keys exist
- auth mode fields are internally consistent
- operation names are unique
- `request.method` is `GET`
- parse modes and selector fields are structurally valid

Semantic validation:

- provider name is unique across all specs and TS adapters
- every operation has a resolvable `when` rule or `default: true`
- all template variables referenced in `urlTemplate`, `query`, `headers`, `matchHints`, and `parse.fields` exist
- `compatibility.responseFormats` is compatible with catalog `source.responseFormat`
- `dahr.allowed: true` requires `parse.format: json` and `normalizeJson: true`
- `tlsn.maxResponseKb` cannot exceed 16 unless explicitly waived for future pipeline work
- `rewriteQuery` keys must be query parameters, not path fragments
- `header-env` and `query-param-env` may reference env vars only; secrets are never embedded in YAML

### DAHR compatibility flags

Keep DAHR decisions explicit per operation:

```yaml
compatibility:
  dahr:
    allowed: true | false
    requireNormalizedJson: true | false
    blockedReason: "Atom XML response; DAHR pipeline is JSON-only"
```

This is important because compatibility is often operation-specific, not provider-wide.

## Example Specs

### 1. HN Algolia

```yaml
schemaVersion: 1

provider:
  name: hn-algolia
  displayName: Hacker News Algolia
  matches:
    providers: [hn-algolia]
    hosts: [hn.algolia.com]
  domains: [tech, startup, ai, programming]
  rateLimit:
    bucket: hn-algolia
    maxPerDay: 10000
  auth:
    mode: none
  defaults:
    responseFormat: json
    parseFailureMode: empty-entries
    normalizeJson: true

operations:
  search:
    when:
      sourceAdapterOperation: [search]
      default: true
    request:
      method: GET
      urlTemplate: "https://hn.algolia.com/api/v1/search"
      query:
        query: "{query}"
        hitsPerPage: "{hitsPerPage}"
      estimatedSizeKb:
        TLSN: 8
        DAHR: 14
      matchHints:
        - "{query}"
        - "{tokens[0]}"
    variables:
      query:
        sources: [vars.query, topic]
        required: true
      hitsPerPage:
        sources:
          - literal: "5"
        default: "5"
    compatibility:
      responseFormats: [json]
      tlsn:
        allowed: true
        requireHttps: true
        maxResponseKb: 16
        rewriteQuery:
          hitsPerPage:
            default: 2
            max: 2
      dahr:
        allowed: true
        requireNormalizedJson: true
    parse:
      format: json
      items:
        mode: json-path
        jsonPath: "$.hits[*]"
      fields:
        id:
          jsonPath: "$.objectID"
          required: true
        title:
          jsonPath: "$.title"
        bodyText:
          template: "{story_text|title|(no content)}"
        canonicalUrl:
          jsonPath: "$.url"
        publishedAt:
          jsonPath: "$.created_at"
        topics:
          jsonPath: "$._tags[*]"
          default: []
        metrics:
          points:
            jsonPath: "$.points"
            default: 0
          num_comments:
            jsonPath: "$.num_comments"
            default: 0
          author:
            jsonPath: "$.author"
        raw:
          mode: item

  search_by_date:
    when:
      sourceAdapterOperation: [search_by_date]
      urlPatterns: ["/search_by_date"]
    request:
      method: GET
      urlTemplate: "https://hn.algolia.com/api/v1/search_by_date"
      query:
        query: "{query}"
        hitsPerPage: "{hitsPerPage}"
      estimatedSizeKb:
        TLSN: 8
        DAHR: 14
      matchHints:
        - "{query}"
    variables:
      query:
        sources: [vars.query, topic]
      hitsPerPage:
        sources:
          - literal: "5"
    compatibility:
      responseFormats: [json]
      tlsn:
        allowed: true
        rewriteQuery:
          hitsPerPage:
            default: 2
            max: 2
      dahr:
        allowed: true
        requireNormalizedJson: true
    parse:
      format: json
      items:
        mode: json-path
        jsonPath: "$.hits[*]"
      fields:
        id: { jsonPath: "$.objectID", required: true }
        title: { jsonPath: "$.title" }
        bodyText: { template: "{story_text|title|(no content)}" }
        canonicalUrl: { jsonPath: "$.url" }
        publishedAt: { jsonPath: "$.created_at" }
        topics: { jsonPath: "$._tags[*]", default: [] }
        raw: { mode: item }
```

### 2. CoinGecko

```yaml
schemaVersion: 1

provider:
  name: coingecko
  displayName: CoinGecko
  matches:
    providers: [coingecko]
    hosts: [api.coingecko.com]
  domains: [crypto, defi, markets, prices]
  rateLimit:
    bucket: coingecko
    maxPerMinute: 30
    maxPerDay: 500
  auth:
    mode: none
  defaults:
    responseFormat: json
    parseFailureMode: empty-entries
    normalizeJson: true

operations:
  simple-price:
    when:
      sourceAdapterOperation: [simple-price]
      urlPatterns: ["/simple/price"]
      default: true
    request:
      method: GET
      urlTemplate: "https://api.coingecko.com/api/v3/simple/price"
      query:
        ids: "{assetId}"
        vs_currencies: usd
        include_market_cap: "true"
        include_24hr_vol: "true"
      estimatedSizeKb:
        TLSN: 1
        DAHR: 1
      matchHints:
        - "{assetId}"
    variables:
      assetId:
        sources: [vars.asset, topic]
        transforms:
          - trim
          - lowercase
          - slug
    compatibility:
      responseFormats: [json]
      tlsn:
        allowed: true
        maxResponseKb: 16
      dahr:
        allowed: true
        requireNormalizedJson: true
    parse:
      format: json
      items:
        mode: object-entries
        jsonPath: "$"
      fields:
        id:
          template: "{key}"
          required: true
        title:
          template: "{key} price"
        bodyText:
          template: "{key}: {usd}"
        topics:
          template: "crypto,price,{key}"
        metrics:
          price_usd:
            jsonPath: "$.usd"
            default: 0
          market_cap:
            jsonPath: "$.usd_market_cap"
            default: 0
          volume_24h:
            jsonPath: "$.usd_24h_vol"
            default: 0
        raw:
          mode: item

  trending:
    when:
      sourceAdapterOperation: [trending]
      urlPatterns: ["/search/trending"]
    request:
      method: GET
      urlTemplate: "https://api.coingecko.com/api/v3/search/trending"
      estimatedSizeKb:
        TLSN: 8
        DAHR: 8
      matchHints:
        - "{topic}"
    compatibility:
      responseFormats: [json]
      tlsn:
        allowed: true
      dahr:
        allowed: true
        requireNormalizedJson: true
    parse:
      format: json
      items:
        mode: json-path
        jsonPath: "$.coins[*].item"
      fields:
        id: { jsonPath: "$.id", required: true }
        title: { jsonPath: "$.name" }
        summary:
          template: "{name} ({symbol}) - rank #{market_cap_rank}"
        bodyText:
          template: "Trending: {name} ({symbol})"
        topics:
          template: "crypto,trending,{symbol}"
        metrics:
          market_cap_rank: { jsonPath: "$.market_cap_rank", default: 0 }
          score: { jsonPath: "$.score", default: 0 }
        raw: { mode: item }

  market-chart:
    when:
      sourceAdapterOperation: [market-chart]
      urlPatterns: ["/market_chart"]
    request:
      method: GET
      urlTemplate: "https://api.coingecko.com/api/v3/coins/{assetId}/market_chart"
      query:
        vs_currency: usd
        days: "{days}"
      estimatedSizeKb:
        TLSN: 6
        DAHR: 12
      matchHints:
        - "{assetId}"
    variables:
      assetId:
        sources: [vars.asset, topic]
        transforms: [trim, lowercase, slug]
      days:
        sources:
          - literal: "7"
        default: "7"
    compatibility:
      responseFormats: [json]
      tlsn:
        allowed: true
        rewriteQuery:
          days:
            default: 1
            max: 1
      dahr:
        allowed: true
        requireNormalizedJson: true
    parse:
      format: json
      items:
        mode: single-object
      fields:
        id:
          template: "chart-{source.id}"
          required: true
        title:
          template: "Price chart"
        bodyText:
          template: "Market chart for {assetId}"
        topics:
          template: "crypto,chart,price"
        raw:
          mode: parsed-root
```

### 3. FRED

This is the best early win because `sources/catalog.json` already contains FRED URLs under `provider: generic`.

```yaml
schemaVersion: 1

provider:
  name: fred
  displayName: FRED
  matches:
    providers: [fred]
    hosts: [api.stlouisfed.org]
    urlPatterns: ["/fred/series"]
  domains: [economics, macro, fed]
  rateLimit:
    bucket: fred
    maxPerMinute: 60
    maxPerDay: 2000
  auth:
    mode: query-param-env
    envVar: FRED_API_KEY
    queryParam: api_key
  defaults:
    responseFormat: json
    parseFailureMode: empty-entries
    normalizeJson: true

operations:
  series-observations:
    when:
      sourceAdapterOperation: [series-observations]
      urlPatterns: ["/fred/series/observations"]
      default: true
    request:
      method: GET
      urlTemplate: "https://api.stlouisfed.org/fred/series/observations"
      query:
        series_id: "{series}"
        file_type: json
        limit: "{limit}"
        sort_order: desc
      estimatedSizeKb:
        TLSN: 5
        DAHR: 5
      matchHints:
        - "{series}"
        - "{topic}"
    variables:
      series:
        sources: [vars.series, vars.query, topic]
        required: true
        transforms:
          - trim
          - uppercase
          - map:
              fed-funds: DFF
              inflation: CPIAUCSL
              unemployment: UNRATE
      limit:
        sources:
          - literal: "10"
        default: "10"
    compatibility:
      responseFormats: [json]
      tlsn:
        allowed: true
        rewriteQuery:
          limit:
            default: 10
            max: 10
      dahr:
        allowed: true
        requireNormalizedJson: true
    parse:
      format: json
      items:
        mode: json-path
        jsonPath: "$.observations[*]"
      fields:
        id:
          template: "{series}-{date}"
          required: true
        title:
          template: "{series} observation {date}"
        summary:
          template: "{series}: {value}"
        bodyText:
          template: "{series} on {date}: {value}"
        publishedAt:
          jsonPath: "$.date"
        topics:
          template: "economics,macro,{series}"
        metrics:
          value:
            jsonPath: "$.value"
          realtime_start:
            jsonPath: "$.realtime_start"
          realtime_end:
            jsonPath: "$.realtime_end"
        raw:
          mode: item

  series-info:
    when:
      sourceAdapterOperation: [series-info]
      urlPatterns: ["/fred/series\\?"]
    request:
      method: GET
      urlTemplate: "https://api.stlouisfed.org/fred/series"
      query:
        series_id: "{series}"
        file_type: json
      estimatedSizeKb:
        TLSN: 2
        DAHR: 2
      matchHints:
        - "{series}"
    variables:
      series:
        sources: [vars.series, vars.query, topic]
        required: true
        transforms: [trim, uppercase]
    compatibility:
      responseFormats: [json]
      tlsn:
        allowed: true
      dahr:
        allowed: true
        requireNormalizedJson: true
    parse:
      format: json
      items:
        mode: json-path
        jsonPath: "$.seriess[*]"
      fields:
        id:
          jsonPath: "$.id"
          required: true
        title:
          jsonPath: "$.title"
        summary:
          jsonPath: "$.notes"
        bodyText:
          template: "{title} | {frequency} | {units}"
        topics:
          template: "economics,macro,{id}"
        metrics:
          frequency: { jsonPath: "$.frequency_short" }
          units: { jsonPath: "$.units_short" }
          popularity: { jsonPath: "$.popularity", default: 0 }
        raw:
          mode: item
```

## Engine Interface

No implementation code is needed yet, but the engine contract should look like this.

```ts
export interface DeclarativeProviderSpec {
  schemaVersion: 1;
  provider: ProviderSpecMeta;
  operations: Record<string, OperationSpec>;
}

export interface DeclarativeHookModule {
  resolveVariables?: (
    input: BuildCandidatesContext,
    operation: OperationSpec,
    resolved: Record<string, string>
  ) => Record<string, string>;
  validateCandidate?: (
    candidate: CandidateRequest,
    operation: OperationSpec
  ) => CandidateValidation | null;
  postParse?: (
    source: SourceRecordV2,
    response: FetchedResponse,
    parsedRoot: unknown,
    entries: EvidenceEntry[]
  ) => ParsedAdapterResponse;
}

export interface DeclarativeEngineOptions {
  specDir: string;
  strictValidation: boolean;
}

export function loadDeclarativeProviderAdapters(
  options: DeclarativeEngineOptions
): Map<string, ProviderAdapter>;
```

### Runtime behavior

`buildCandidates()`:

- resolve operation from `source.adapter.operation`, then URL regex, then `default: true`
- resolve variables from `ctx.vars`, `topic`, `tokens`, literals, and maps
- inject auth from env when required
- build URL from `urlTemplate` + `query`
- attach `estimatedSizeKb` and `matchHints`
- return zero candidates if required vars are unresolved or attestation is blocked

`validateCandidate()`:

- enforce `requireHttps`
- enforce `compatibility.tlsn/dahr.allowed`
- apply `rewriteQuery` max/default rules
- apply `requireQuery` rules like `format=json`
- call optional hook for custom validation or rewrite

`parseResponse()`:

- parse JSON if `parse.format=json`; return empty entries on invalid JSON
- for XML/RSS regex mode, extract blocks first, then extract fields per block
- skip malformed items instead of failing the whole response
- return `{ entries: [], normalized: null }` for JSON parse failure
- return `{ entries: [] }` for XML parse failure
- call optional `postParse` hook only after declarative extraction

### Graceful failure policy

This needs to be explicit because `matcher.ts` already tolerates empty results.

- invalid provider spec at startup:
  - CI/admin mode: fail fast
  - runtime mode: log and skip that provider
- bad response body:
  - never throw from `parseResponse()`
  - return empty entries
- missing optional fields:
  - omit field
- missing required `id`:
  - drop that item only
- partial item parse:
  - keep the item if `id` and `bodyText` can still be produced

## Migration Strategy

### Provider-by-provider matrix

| Provider | Migration target | Notes |
| --- | --- | --- |
| `hn-algolia` | Full declarative | Straight JSON API; TLSN rewrite is simple query-cap logic. |
| `coingecko` | Full declarative | Multi-operation JSON is a good fit for spec-driven operations. |
| `defillama` | Full declarative | Operation gating by attestation method fits the schema. |
| `github` | Full declarative | Needs per-operation rate-limit override for search vs non-search. |
| `wikipedia` | Full declarative | Simple JSON summary/search endpoints. |
| `worldbank` | Full declarative | Needs JSONPath support for tuple-like root `$[1][*]`. |
| `pubmed` | Full declarative | Compact JSON endpoints; `retmode=json` enforcement is declarative. |
| `binance` | Full declarative | Requires variable maps and tuple-array parsing for klines. |
| `arxiv` | Spec + hook | XML/Atom regex extraction is possible declaratively, but keep a hook for canonical URL cleanup and DAHR hard-block handling. |
| `kraken` | Spec + hook | Response envelope is declarative, but pair normalization and dynamic result keys are cleaner with a small hook. |
| `generic` | Stay hand-written | Keep as quarantine-only fallback; it is intentionally non-authoritative. |

### What can be replaced immediately

Phase 1 candidates:

- `hn-algolia`
- `coingecko`
- `defillama`
- `github`
- `wikipedia`
- `worldbank`
- `pubmed`
- `binance`
- new `fred`

That gives the scaling win quickly and also promotes FRED out of `generic`.

### What should stay hybrid

`arxiv`:

- response is Atom XML
- current parser uses provider-specific regex helpers
- DAHR must stay blocked until the pipeline accepts non-JSON or XML normalization is introduced

`kraken`:

- pair naming is not normal string templating
- OHLC URLs need a relative-time `since=now-5h` TLSN clamp
- `result` contains dynamic keys that map to the requested pair rather than fixed field paths

### Hybrid approach

Do not keep full custom adapters unless needed. Prefer:

1. declarative spec for provider identity, auth, URL templates, and most parsing
2. tiny optional hook for the irreducible edge case

That preserves the scaling model while avoiding a schema that tries to encode arbitrary code.

## File Structure

```text
tools/lib/sources/providers/
  declarative-engine.ts
  provider-spec.schema.json
  specs/
    hn-algolia.yaml
    coingecko.yaml
    defillama.yaml
    github.yaml
    wikipedia.yaml
    worldbank.yaml
    pubmed.yaml
    binance.yaml
    fred.yaml
    arxiv.yaml
    kraken.yaml
  hooks/
    arxiv.ts
    kraken.ts
  generic.ts
  index.ts
  types.ts
```

Registry behavior:

- `index.ts` loads handwritten adapters that still exist: `generic`, and any temporary custom adapters
- `index.ts` loads all declarative specs from `specs/`
- duplicate provider names are a startup error in strict mode
- `getProviderAdapter()` remains unchanged for callers

## Catalog Changes

No breaking `SourceRecordV2` change is required.

Recommended catalog changes during migration:

- change FRED records from `provider: generic` to `provider: fred`
- set explicit `adapter.operation` values that match spec operations exactly
- leave `tlsn_safe`, `dahr_safe`, and `responseFormat` in the catalog as prefilter metadata

Optional future improvement:

- add `providerSpecVersion?: number` if rollback/version pinning becomes necessary

## What Should Remain Hand-Written

The declarative system should not try to absorb everything. Keep custom TypeScript for:

- providers requiring multi-step request choreography
- signed auth flows like HMAC or OAuth refresh
- providers where variable resolution depends on large or fast-changing alias logic
- providers needing true XML parsing rather than safe regex extraction
- providers whose response must be interpreted with stateful or statistical logic rather than field extraction
- the `generic` quarantine fallback

Practical examples in this repo today:

- `generic` should stay TS
- `arxiv` should stay spec + hook until XML handling is better
- `kraken` should stay spec + hook unless the engine later adds pair resolvers and dynamic-key envelope helpers

## Effort Estimate

### Phase 0: Schema and engine design

- 1-2 days
- deliver `provider-spec.schema.json`, minimal selector syntax, and hook contract

### Phase 1: Engine and registry integration

- 2-4 days
- build `declarative-engine.ts`
- integrate loader into `providers/index.ts`
- add startup validation and duplicate detection

### Phase 2: Migrate easy JSON providers

- 2-3 days
- migrate `hn-algolia`, `coingecko`, `defillama`, `github`, `wikipedia`, `worldbank`, `pubmed`, `binance`
- add `fred`

### Phase 3: Hybrid providers

- 1-2 days
- add `arxiv.yaml` + hook
- add `kraken.yaml` + hook

### Phase 4: Cleanup and confidence

- 1-2 days
- remove superseded handwritten adapters
- add golden-response tests for spec parsing
- verify `policy.ts` and `matcher.ts` behavior stays stable

Total estimate: **7-13 working days** for one engineer, depending on how much test coverage is added during migration.

## Recommended Order

1. Ship the engine with `hn-algolia`, `coingecko`, and `fred`.
2. Migrate the remaining easy JSON providers.
3. Add hybrid hooks for `arxiv` and `kraken`.
4. Keep `generic` untouched as the quarantine fallback.

That sequence gives an immediate scale win, validates the schema against real providers, and avoids blocking the whole effort on the two weirdest adapters.
