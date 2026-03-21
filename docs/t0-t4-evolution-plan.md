# T0-T4 Source & Attestation Evolution Plan

> **Status:** In Progress — Sessions 1-2 complete
> **Author:** PAI Algorithm session 2026-03-21
> **Depends on:** Claim-driven attestation Phases 1-4 (shipped 2026-03-21)

## Executive Summary

Five workstreams to increase attestation hit rate from ~0% to >50% of publish attempts. Currently, claim-driven attestation rarely fires because (1) only 66 active sources with sparse domain coverage, (2) only 8/26 YAML specs declare `claimTypes`, (3) LLM-generated posts lack numeric claims, (4) no reputation layer, and (5) feed history limited to ~20k posts via API.

**Attestation pipeline gates (all must pass for attestation to fire):**
```
Gate 1: Post contains extractable claim     ←── T2 (currently ~10% pass rate)
Gate 2: Claim type matches a spec           ←── T1 (currently 8/26 = 31%)
Gate 3: Spec has a matching catalog source   ←── T0 (currently sparse ~30%)
Gate 4: Attestation executes successfully    ←── existing infra (~95%)
Combined: 0.10 × 0.31 × 0.30 × 0.95 ≈ 0.9% → target 0.50 × 0.69 × 0.90 × 0.95 ≈ 29.5%
```

**Revised dependency graph (first principles analysis):**
```
T2 (nudge) ─────────── independent, do first (highest ROI per effort)
T1-existing (claimTypes on existing specs) ─── independent, parallel with T0
T0-existing (more entries for already-spec'd providers) ─── no T1 dependency
T1-new (9 new YAML specs for new providers) ──┐
                                               ├── T0-new (catalog entries for new providers)
T0-cleanup (fix 70+ invalid entries) ──────────┘
T3 (reputation) ─── fully independent, spike first
T4 (feed history) ─── fully independent, spike first (known blocker)
```

**Key insight:** T0 is NOT blocked by T1 for most sources. Adding more CoinGecko/Binance/DefiLlama entries uses existing specs. Only genuinely new providers (~9 of ~130 new entries) need new specs.

**Minimum viable slice (1 session, proves end-to-end):**
1. T2: Add LLM nudge → posts include exact values
2. T1a: Add claimTypes to `cryptocompare.yaml` → price claims match (crypto entity extraction already works)
3. T0: Add Binance + CryptoCompare catalog entries → source found
4. Run session → verify attestation fires
> Note: FRED was replaced with crypto-native providers for MVP (Codex Finding #3: entity extraction is crypto-only)

**Execution order:** T2+T1-existing → T0-existing + T1-new (parallel) → T0-new → T3/T4 (parallel spikes early)

---

## T0: Source Registry Expansion

### Goal
Grow from 66 → 200+ active sources across 12 domains so that every agent topic has at least 2 matching sources with surgical attestation capability.

### Current State

| Domain | Active Sources | Providers | Coverage |
|--------|---------------|-----------|----------|
| Crypto prices | 5 | coingecko | Single provider |
| DeFi/TVL | 6 | defillama | Single provider |
| On-chain data | 4 | blockstream, mempool, blockchain-info | BTC-only |
| Macro/economics | 2 | fred, worldbank | Requires API keys |
| Gas/fees | 3 | etherscan | ETH-only |
| DEX/trading | 1 | dexscreener | Single provider |
| NFTs/gaming | 0 | — | No coverage |
| Stablecoins | 0 | — | No coverage |
| News/events | 22 | hn-algolia, generic | Text-only, no numeric data |
| Governance | 0 | — | No coverage |
| Derivatives | 2 | generic | No specs |
| Network health | 1 | blockstream | BTC-only |
| Other (github, arxiv, etc.) | 20 | github, arxiv, etc. | Text-only |

### Target State

| Domain | Target Sources | Target Providers | Key APIs to Add |
|--------|---------------|-----------------|-----------------|
| **Crypto prices** | 15+ | coingecko, binance, kraken, cryptocompare, coinbase | Binance ticker, Kraken ticker, CryptoCompare price, Coinbase spot |
| **DeFi/TVL** | 10+ | defillama, l2beat | L2Beat API, DefiLlama protocols endpoint |
| **On-chain data** | 10+ | blockstream, mempool, blockchain-info, etherscan, solscan | Blockchain.com, Solscan, more Etherscan ops |
| **Macro/economics** | 8+ | fred, worldbank, bls, treasury | BLS series, Treasury rates, ECB data portal |
| **Gas/fees** | 6+ | etherscan, owlracle | Owlracle gas oracle, Etherscan gas oracle |
| **DEX/trading** | 6+ | dexscreener, uniswap | 1inch prices, Jupiter price |
| **NFTs/gaming** | 4+ | opensea, magiceden | OpenSea collection stats, Magic Eden stats |
| **Stablecoins** | 4+ | defillama | DefiLlama stablecoins, USDC/USDT supply |
| **News/events** | 22 (keep) | hn-algolia, generic | No change — text sources don't need claimTypes |
| **Governance** | 4+ | snapshot, tally | Snapshot proposals, Tally DAO stats |
| **Derivatives** | 4+ | binance, deribit | Binance futures, Deribit options |
| **Network health** | 5+ | blockstream, mempool | Ethernodes count, Solana Beach validators |

### Implementation Plan

#### Phase 0: Catalog Cleanup (prerequisite)
- **Revalidate catalog state:** ~~70+ invalid entries at indices 138-208~~ (Codex review: catalog is now 139 records and loads cleanly — this blocker may be stale). Verify current validation status before assuming cleanup is needed.
- **Validate all existing active sources:** Use lifecycle plugin health checks (NOT `scan-feed.ts`, which is a feed scanner, not a source health tool).
- **Effort:** S (1-2 hours)

> **Codex Finding #8 (Medium):** The cleanup prerequisite should be revalidated, not treated as fact. The current catalog may already be clean.

#### Phase 1: New YAML Specs for Unrepresented Providers
Create YAML spec files for providers that have no spec yet but will have catalog entries:

| New Spec | Operations | claimTypes | Auth | Notes |
|----------|-----------|------------|------|-------|
| `coinbase.yaml` | spot-price | [price] | none | ~200B, highly reliable |
| ~~`owlracle.yaml`~~ | ~~gas-price~~ | ~~[metric]~~ | ~~API key~~ | **BLOCKED: auth-key leakage** (see below) |
| `deribit.yaml` | ticker | [price] | none | Derivatives/options |
| ~~`opensea.yaml`~~ | ~~collection-stats~~ | ~~[metric]~~ | ~~API key~~ | **BLOCKED: auth-key leakage** (see below) |
| `magiceden.yaml` | collection-stats | [metric] | none | Solana NFTs |
| `snapshot.yaml` | proposals | [event] | none (GraphQL POST) | TLSN POST needs testing |
| `blockchair.yaml` | stats | [metric] | none | Multi-chain on-chain stats |
| ~~`coinalyze.yaml`~~ | ~~open-interest, funding-rate~~ | ~~[metric]~~ | ~~API key~~ | **BLOCKED: auth-key leakage** (see below) |

**Removed from original plan:**
- ~~`l2beat.yaml`~~ — no public REST API (use DefiLlama `/v2/chains`)
- ~~`tally.yaml`~~ — GraphQL + key, low priority
- ~~`solscan.yaml`~~ — Pro API only (paid)
- ~~`owlracle.yaml`~~ — auth-key leakage blocker (see below)
- ~~`opensea.yaml`~~ — auth-key leakage blocker (see below)
- ~~`coinalyze.yaml`~~ — auth-key leakage blocker (see below)

> **Codex Finding #1 (HIGH): Auth-Key Leakage in Attestation URLs**
> `buildUrl()` in `declarative-engine.ts:410` appends `query-param-env` credentials directly into the final attested URL. This means API keys for FRED, Owlracle, OpenSea, etc. would be published on-chain in the attestation record. **Until a secret-safe URL redaction/proxy model exists, auth-required APIs MUST NOT be counted as attestation-capable sources.** They can still be used for data fetching (scan phase) but not for surgical attestation (publish phase).
>
> **Impact:** Reduces Wave 2 attestable sources. FRED, Etherscan, CoinMarketCap, Owlracle, OpenSea, Coinalyze all affected. Only no-auth APIs count toward Gate 3 attestation capacity.
>
> **Resolution options:**
> 1. Strip auth params from attested URL before on-chain submission (requires executor change)
> 2. Proxy auth-required requests through a local endpoint that adds keys server-side
> 3. Accept: auth-required sources are scan-only, not attestation-capable (simplest)

**Effort:** M (one session per 3-4 specs, ~2 sessions for remaining no-auth specs)

#### Phase 2: Catalog Entry Batch Creation
Template for new catalog entries (batch 20-30 per session):

```json
{
  "id": "{provider}-{hash}",
  "name": "{provider}-{operation}",
  "provider": "{provider}",
  "url": "{base_url}",
  "urlPattern": "{url_pattern}",
  "topics": ["{domain}", "{sub-domain}"],
  "tlsn_safe": true,
  "dahr_safe": true,
  "max_response_kb": 16,
  "topicAliases": [],
  "domainTags": ["{domain}"],
  "responseFormat": "json",
  "scope": {
    "visibility": "scoped",
    "agents": ["sentinel", "crawler"],
    "importedFrom": ["sentinel"]
  },
  "runtime": {
    "timeoutMs": 8000,
    "retry": { "maxAttempts": 2, "backoffMs": 1000, "retryOn": ["timeout", "5xx"] }
  },
  "trustTier": "experimental",
  "status": "quarantined",
  "rating": {
    "overall": 50, "uptime": 50, "relevance": 50, "freshness": 50,
    "sizeStability": 50, "engagement": 50, "trust": 50,
    "testCount": 0, "successCount": 0, "consecutiveFailures": 0
  },
  "lifecycle": {
    "discoveredAt": "{now}",
    "discoveredBy": "manual"
  },
  "adapter": {
    "operation": "{operation_id}"
  }
}
```

**Key:** New sources start as `"status": "quarantined"` and promote to active after 3 successful passes (existing lifecycle logic handles this).

> **Codex Finding #2 (HIGH): Quarantine-to-Active Promotion Math**
> Lifecycle plugin samples only **10 sources per session**. Promotion requires **3 consecutive passes** per source (`lifecycle.ts:22`). With 130+ new quarantined sources, promotion needs ~40 sessions at current sample rate — not the single "health check sweep" planned.
>
> **Required:** Build a bulk quarantine test/promotion workflow before Session 10:
> - Option A: Increase lifecycle sample size to 50 for quarantined sources specifically
> - Option B: Create `cli/bulk-health-check.ts` that tests all quarantined sources in one run and applies lifecycle transitions
> - Option C: Directly insert as `"status": "active"` with manual health verification per batch (skip quarantine)
> **Recommended:** Option B — new CLI tool, run 3 times to trigger promotion

**Batching strategy:**
- Session 1: Crypto prices (Binance, Kraken, CryptoCompare, Coinbase) — ~15 entries
- Session 2: DeFi + On-chain (L2Beat, more DefiLlama, more Etherscan) — ~15 entries
- Session 3: Macro + Gas (BLS, Treasury, Owlracle) — ~12 entries
- Session 4: DEX + NFTs + Stablecoins — ~15 entries
- Session 5: Governance + Derivatives + Network health — ~12 entries
- Session 6: Health check sweep + promote quarantined → active

**Effort:** L (5-6 sessions)

#### Phase 3: TLSN Safety Assessment
For each new source, assess TLSN suitability:
- Response size < 16KB → `tlsn_safe: true`
- No authentication headers required → `tlsn_safe: true`
- CORS/anti-bot protection → `tlsn_safe: false` (DAHR only)

Assessment happens during Phase 2 entry creation by checking `estimatedSizeKb` in the YAML spec.

#### Phase 4: Topic-Source Matching Improvement
Current matching uses `topics` and `domainTags` fields with a threshold of 10. To improve match rates:
- Ensure new sources have comprehensive `topics` arrays (not just domain, but specific subtopics)
- Add `topicAliases` for common variations (e.g., "BTC" → "bitcoin", "ETH" → "ethereum")
- ~~Consider lowering match threshold from 10 to 8~~ (Codex Finding #9: increases false-positive risk; keep at 10)

**Effort:** S (part of Phase 2 work)

#### Scope Assignment
- **sentinel:** All price, DeFi, macro sources (analysis-oriented)
- **crawler:** All on-chain, network health, gas sources (infrastructure-oriented)
- **pioneer:** Governance, NFTs, derivatives (emerging markets)
- Overlap is fine — agents share one CCI/wallet

### Success Criteria
- [ ] 200+ active sources in catalog
- [ ] Every domain has 2+ providers
- [ ] "No matching source" drops to <5% of publish attempts
- [ ] Zero broken sources after health check sweep

### Test Strategy
- Unit tests: validate catalog entry schema for each new batch
- Integration: `scan-feed.ts` health check per batch
- E2E: One full session run after all batches, verify attestation fires

---

## T1: Add claimTypes to Remaining YAML Specs

### Goal
Increase claimTypes coverage from 8/26 to 18+/26 specs (the remaining specs that return numeric/verifiable data).

### Current Coverage

**WITH claimTypes (8):**
1. `alternative-fng.yaml` — Fear & Greed Index
2. `binance.yaml` — ticker price
3. `blockstream.yaml` — block data
4. `coingecko.yaml` — simple price, trending
5. `defillama.yaml` — TVL, stablecoins
6. `dexscreener.yaml` — pair data
7. `etherscan.yaml` — gas oracle, balance
8. `kraken.yaml` — ticker price

**WITHOUT claimTypes — CAN add (10):**
| Spec | Recommended claimType | extractionPath | Notes |
|------|----------------------|----------------|-------|
| `fred.yaml` | `metric` | `$.observations[0].value` | **NEEDS ENTITY PLUMBING** — see Finding #3 below |
| `worldbank.yaml` | `metric` | `$[1][0].value` | **NEEDS ENTITY PLUMBING** — see Finding #3 below |
| `cryptocompare.yaml` | `price` | `$.{ASSET}.USD` | Crypto prices (CoinGecko redundancy) |
| `yahoo-finance.yaml` | `price` | `$.chart.result[0].meta.regularMarketPrice` | Equities, commodities |
| `usgs.yaml` | `metric` | `$.features[0].properties.mag` | Earthquake magnitude |
| `nasa.yaml` | `metric` | `$.near_earth_objects[*].close_approach_data[0].miss_distance.kilometers` | Asteroid distance |
| `mempool.yaml` | `metric` | `$.fastestFee` | Bitcoin mempool fee rates |
| `blockchain-info.yaml` | `metric` | `$.market_price_usd` (stats op) | BTC price + network stats |
| `ipinfo.yaml` | `event` | `$.ip` | IP geolocation (low priority) |
| `npm.yaml` | `metric` | `$.downloads` | Package download counts |

**WITHOUT claimTypes — CANNOT add (text-only, 8):**
| Spec | Why Not |
|------|---------|
| `arxiv.yaml` | Returns paper metadata (text), not numeric claims |
| `github.yaml` | Returns repo/issue data (text-heavy), stars/forks possible but low attestation value |
| `hn-algolia.yaml` | Returns news items (text), points are too volatile for attestation |
| `openlibrary.yaml` | Returns book metadata (text) |
| `pubmed.yaml` | Returns paper metadata (text) |
| `reddit.yaml` | Returns posts (text) |
| `stackexchange.yaml` | Returns Q&A (text) |
| `wikipedia.yaml` | Returns articles (text) |

### Implementation Plan

For each spec, add these fields to the appropriate operation:
```yaml
claimTypes: [price]  # or [metric] or [event]
extractionPath: "$.path.to.value"
```

**Batch 1 (high value — crypto/finance):** `cryptocompare.yaml`, `yahoo-finance.yaml`, `blockchain-info.yaml`, `mempool.yaml`
**Batch 2 (macro/science):** `fred.yaml`, `worldbank.yaml`, `usgs.yaml`, `nasa.yaml`
**Batch 3 (low priority):** `npm.yaml`, `ipinfo.yaml`

> **Codex Finding #3 (HIGH): Entity Extraction is Crypto-Only**
> `buildSurgicalUrl()` synthesizes `asset`/`symbol` vars from claim entities via `inferAssetAlias()`, which uses `ASSET_MAP` — a crypto-only mapping (BTC, ETH, SOL, etc.). Macro claims like "GDP at 3.2%" won't resolve because "GDP" is not in `ASSET_MAP`. Adding `claimTypes` to `fred.yaml` alone is NOT sufficient — the entity resolution pipeline also needs extension.
>
> **T1 must be split into two tiers:**
> - **T1a (field-only):** Specs where existing entity extraction works: `cryptocompare`, `mempool`, `blockchain-info`, `yahoo-finance` (crypto tickers). Just add YAML fields.
> - **T1b (needs entity plumbing):** Specs where entities are non-crypto: `fred`, `worldbank`, `usgs`, `nasa`. Requires extending `ASSET_MAP` or `buildSurgicalUrl()` to handle macro entity types (series IDs, indicator codes).
>
> **Revised MVP slice:** Replace FRED with a crypto-native existing-provider slice (e.g., Binance ticker + CryptoCompare price) that works with current entity extraction.

### Declarative Engine Impact
No changes needed for T1a specs. `buildSurgicalUrl()` (declarative-engine.ts:1165) already:
1. Iterates operations looking for `claimTypes` match
2. Checks `extractionPath` exists
3. Resolves variables and builds URL
4. Returns `SurgicalCandidate`

The engine is designed for this — just add the YAML fields.

### Test Strategy
- For each spec: add a test case in `tests/surgical-url.test.ts` that calls `buildSurgicalUrl()` with a claim of the right type and verifies the URL is correctly constructed
- Verify `extractionPath` actually resolves against a real API response (integration test)

### Effort: M (2-3 sessions)

### Success Criteria
- [ ] 18+ specs have claimTypes (from 8)
- [ ] Every numeric-returning spec has extractionPath
- [ ] All new extractionPaths verified against real API responses
- [ ] surgical-url tests pass for all new specs

---

## T2: LLM Prompt Nudge for Verifiable Claims

### Goal
Increase the rate of extractable numeric claims in LLM-generated posts from ~10% to >50% without degrading post quality or naturalness.

### Current State

The system prompt in `src/actions/llm.ts:137-160` already says:
```
"text": "post text (300-600 chars, dense with data, no filler)"
...
- Include specific numbers, percentages, agent names, or data points
```

This is insufficient — "include specific numbers" is vague and doesn't encourage the precise claim patterns that `extractStructuredClaimsAuto` can parse (e.g., "$67,432", "TVL $2.1B", "gas at 14 gwei").

### Proposed Nudge

Add to the system prompt rules section (after line 156):

```
- When source data includes prices, TVL, rates, or metrics, include the EXACT value with unit
  (e.g., "$67,432", "TVL $2.1B", "14 gwei", "CPI 3.2%"). These enable on-chain attestation.
- At least ONE sentence should contain a verifiable numeric claim from the source data.
```

### Exact Location
`src/actions/llm.ts:155-156` — insert after "Include specific numbers..." line.

### Risk Mitigation
- **Over-fitting to numbers:** The nudge says "at least ONE sentence" — not every sentence. Posts remain natural.
- **Quality degradation:** The nudge only applies when source data IS available. Posts without attested data are unaffected.
- **Measurement:** Add `observe("insight", ...)` in the claim extraction path to log extraction hit rate:
  - `claims_extracted: N` after `extractStructuredClaimsAuto`
  - `claims_planned: N` after `buildAttestationPlan`
  - This allows before/after comparison without code changes

### attestedData Injection Flow
Already wired in `cli/session-runner.ts:2188-2193`:
```typescript
if (input.attestedData) {
  userPrompt += `\n\nAttested data source: ${input.attestedData.source}
URL: ${input.attestedData.url}
Data: ${input.attestedData.summary}`;
}
```

The nudge reinforces that when `attestedData` is present, exact values should be used.

### Test Strategy
- Generate 10 test posts with and without the nudge (manual comparison)
- Run claim extraction on both sets, compare hit rate
- Verify no quality regression (text length, diversity of topics)

### Effort: S (1 session)

### Success Criteria
- [ ] Nudge text added to system prompt
- [ ] Claim extraction hit rate >50% for posts with attestedData
- [ ] No quality regression (text still 300-600 chars, no robotic tone)
- [ ] Logging added for extraction stats

---

## T3: Tier 1 Reputation Plugins

### Goal
Add reputation/identity data providers that enrich agent identity on SuperColony. Three target APIs: Nomis, Ethos, Human Passport.

### Architecture
These integrate as `FrameworkPlugin` instances (see `src/types.ts`):
```typescript
interface FrameworkPlugin {
  name: string;
  version: string;
  register(context: PluginContext): void | Promise<void>;
}
```

Each reputation provider becomes a `DataProvider` plugin that:
1. Queries the external API for reputation scores
2. Returns structured data that can be included in posts or used for identity attestation
3. Caches results (reputation scores don't change frequently)

### Target Providers

#### Nomis
- **What:** Multi-chain wallet scoring (0-100 reputation score)
- **API:** `https://api.nomis.cc/api/v1/{chain}/wallet/{address}/score`
- **Auth:** API key (free tier available, rate-limited)
- **Data model:** `{ score: number, stats: { totalTransactions, uniqueContracts, age, ... } }`
- **Integration:** RPC-direct (no SDK dependency, avoids NAPI crash)
- **Rate limit:** ~100 req/day free tier

#### Ethos
- **What:** On-chain reputation for Ethereum ecosystem
- **API:** Subgraph-based (The Graph)
- **Auth:** None for public subgraph queries
- **Data model:** `{ score: number, vouches: number, reviews: number }`
- **Integration:** GraphQL query via fetch

#### Human Passport (Gitcoin Passport)
- **What:** Sybil-resistance score based on identity stamps
- **API:** `https://api.passport.gitcoin.co/v2/stamps/{address}`
- **Auth:** API key (free for non-commercial use)
- **Data model:** `{ score: number, stamps: [{ provider, credential }] }`
- **Integration:** REST API via fetch

### Implementation Plan

1. Create `src/plugins/reputation/` directory
2. Implement `NomisPlugin`, `EthosPlugin`, `HumanPassportPlugin` as FrameworkPlugins
3. Each plugin implements `DataProvider` interface with:
   - `fetch(address: string): Promise<ReputationScore>`
   - `cache(address: string, score: ReputationScore): void` (TTL: 24h)
4. Register plugins in agent config YAML
5. Wire reputation data into post generation (optional enrichment)

### Prerequisites
- Verify Nomis free tier API key availability
- Verify Gitcoin Passport API key for non-commercial
- Confirm Ethos subgraph is still active

### Test Strategy
- Unit tests: mock API responses, verify parsing
- Integration: one real API call per provider to verify connectivity
- Plugin registration: verify plugins load in session runner

### Effort: M (2-3 sessions)

### Success Criteria
- [ ] 3 reputation plugins implemented as FrameworkPlugins
- [ ] Each plugin returns valid reputation scores
- [ ] 24h caching prevents excessive API calls
- [ ] Plugins load cleanly in session runner
- [ ] No NAPI crash (RPC-direct, no SDK deps)

---

## T4: Feed History via GCR/RPC

### Goal
Access full 112k+ post feed history (API caps at ~20k via offset pagination). Enable historical analysis, trend detection, and better source discovery.

### Current State
- `cli/feed-mine.ts` uses SC Feed API with `?limit=100&offset=N`
- API appears to cap around 20k posts
- GCR (Global Content Registry) stores all posts on-chain
- SDK `StorageProgram` has known issues ("Unknown message", "GCREdit mismatch")

### Approach: RPC-Direct Query (avoid SDK)

Since SDK's StorageProgram is buggy, query GCR data via RPC directly:

1. **RPC endpoint:** `demosnode.discus.sh` (primary), `node2.demos.sh` (backup)
2. **Query method:** Use `DemosTransactions.query()` (same pattern as identity.ts bypass)
3. **Data format:** GCR entries contain post hash, author, timestamp, content pointer

### Implementation Plan

#### Phase 1: Feasibility Spike (MUST DO FIRST)
- Write a minimal script that queries GCR via RPC for 10 posts
- Verify: Can we read? What's the data format? Rate limits?
- If this fails (SDK bugs), the entire workstream is blocked → defer to SDK fix
- **Effort:** S (1-2 hours)

#### Phase 2: Ingestion Pipeline (if Phase 1 succeeds)
- Paginated GCR query with cursor-based pagination
- Parse GCR entries into `FeedPost` format
- Store locally in `~/.cache/demos-agents/feed-history/` as JSONL
- Batch size: 1000 posts per query, rate-limited to 10 queries/min

#### Phase 3: Indexing
- Build simple JSON index: by author, by topic, by date range
- Enable queries like "all posts about BTC in last 7 days"
- Used by: source discovery (feed-mine), trend analysis, attestation verification

### Fallback if GCR is Blocked
If RPC query fails due to SDK issues:
- **Option A:** Scrape SC web UI (fragile, not recommended)
- **Option B:** Request API pagination fix from KyneSys team
- **Option C:** Use existing 20k posts as "good enough" for now, revisit when SDK improves
- **Recommended:** Option C (defer, focus on T0-T2 which have no blockers)

### Test Strategy
- Phase 1 spike: manual verification, no tests needed
- Phase 2: unit tests for GCR parser, integration test for pagination
- Phase 3: unit tests for index queries

### Effort: M-L (depends on Phase 1 outcome)

### Success Criteria
- [ ] Phase 1 spike determines GCR accessibility (pass/fail)
- [ ] If pass: ingestion pipeline retrieves 50k+ posts
- [ ] If pass: index supports query by author, topic, date
- [ ] If fail: documented blocker with recommended alternative

---

---

## Codex Review Findings (2026-03-21)

9 findings incorporated into the plan. Summary of changes made:

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | **HIGH** | Auth-key leakage in attestation URLs | Auth-required specs blocked from attestation; only no-auth APIs count for Gate 3 |
| 2 | **HIGH** | Quarantine promotion math (10/session, 3 passes needed) | Added bulk health-check CLI requirement; Option B recommended |
| 3 | **HIGH** | Entity extraction is crypto-only (`ASSET_MAP`) | T1 split into T1a (field-only, crypto) and T1b (needs entity plumbing, macro); MVP changed to crypto-native |
| 4 | **Medium** | Catalog template uses invalid `trustTier: "new"` | Fixed to `"experimental"`; `importedFrom` fixed to agent names |
| 5 | **Medium** | Success criteria don't measure per-gate verification | Add per-gate metrics: claims extracted, URL built, attestation executed, numeric verification passed |
| 6 | **Medium** | T3 `FrameworkPlugin.register()` doesn't match actual interface | T3 must use `hooks/providers/evaluators/actions/init/destroy` + `loadExtensions()` |
| 7 | **Medium** | T0 metric should be per-agent coverage, not raw count | Success criteria updated to per-agent visible attestable sources |
| 8 | **Medium** | Catalog cleanup prerequisite may be stale | Revalidate before assuming cleanup needed |
| 9 | **Low** | Lowering match threshold from 10→8 adds false-positive risk | Removed from plan; keep threshold at 10 |

---

## Cross-Cutting Concerns

### Dependency Graph

```
T2 (LLM nudge) ── no deps, smallest change, highest leverage
    ↓ (enables more claims to extract)
T1 (claimTypes) ── no deps, amplifies T2 benefit
    ↓ (enables more surgical URLs)
T0 (sources) ── depends on T1 for new specs
    ↓ (provides attestation targets)
T3 (reputation) ── independent, no deps on T0/T1/T2
T4 (feed history) ── independent, has hard blocker (spike first)
```

### Recommended Sequencing (Revised — First Principles)

| Session | Work | Why | Proves |
|---------|------|-----|--------|
| **1** ✅ | T2 (nudge) + T1a batch 1 (cryptocompare, mempool, blockchain-info) | Commits: c11a509, 068aa75 | 3 specs got claimTypes, 2 Binance entries, LLM nudge |
| **2** ✅ | T0 cleanup (25 adapter fixes) + T0 batch 1 (Kraken, DefiLlama) + T4 spike | Commits: 16de6b0, d56a1d5 | 25 adapters fixed, 3 active entries, T4 PARTIAL PASS (deferred) |
| **3** | T1 batch 2 (worldbank, usgs, nasa, yahoo-finance) + T0 existing batch 2 (more DefiLlama, Etherscan) | More specs + more sources in parallel | Scaling |
| **4** | T1-new batch 1 (l2beat, coinbase, owlracle specs) + T3 spike (API availability) | New provider specs + reputation feasibility | New providers + T3 go/no-go |
| **5** | T0-new batch 1 (entries for new providers from S4) | Catalog entries using new specs | New domain coverage |
| **6** | T1-new batch 2 (opensea, snapshot, deribit specs) + T1 batch 3 (npm, ipinfo) | Remaining specs | Full spec coverage |
| **7** | T0-new batch 2 (entries for S6 providers) + T0 existing batch 3 (stablecoins, gas) | More entries | Approaching 200 target |
| **8** | T3 implementation (if spike passed) | Build reputation plugins | Reputation layer |
| **9** | T0 existing batch 4 (governance, derivatives, network health) | Final domain coverage | All 12 domains |
| **10** | T0 health check sweep + quarantined→active promotion | Finalize and validate | Quality gate |
| **11-12** | T4 pipeline (if spike passed) OR T3 finish | Feed history or reputation wrap-up | Stretch goals |
| **13** | Integration testing: full session run with all sources | End-to-end validation | Success criteria |

### Effort Summary

| Task | Effort | Sessions | Dependencies |
|------|--------|----------|-------------|
| T2 | S | 1 | None |
| T1 | M | 2-3 | None |
| T0 | L-XL | 6-8 | T1 (for new specs) |
| T3 | M | 2-3 | None |
| T4 | M-L | 2-4 | Phase 1 spike result |
| **Total** | **XL** | **13-19** | — |

### LLM OAuth Expiry Risk
`claude --print` uses OAuth tokens that can expire during cron. Mitigations:
- Token refresh before session start (already in cron script)
- Fallback: `LLM_PROVIDER=openai-compatible` with API key (no OAuth)
- Monitor: check exit code of `claude --print` in session runner, log auth failures

### Measurable Success Criteria (End State)

| Metric | Current | Target |
|--------|---------|--------|
| Active sources (no-auth, attestable) | 66 → **80** (S1-S2) | 150+ (no-auth only count for attestation) |
| Active sources (all, including scan-only) | 66 → **80** (S1-S2) | 200+ |
| Per-agent visible attestable sources | sentinel:39, crawler:49, pioneer:20 | Each agent: 60+ visible attestable |
| Specs with claimTypes (T1a, field-only) | 8/26 → **11/26** (S1) | 14+/26+ |
| Specs with claimTypes (T1b, needs entity plumbing) | 0 | 4+ (fred, worldbank, usgs, nasa) |
| Claim extraction hit rate (Gate 1) | ~10% | >50% |
| Surgical URL built rate (Gate 2+3) | ~10% | >60% |
| Attestation executed rate (Gate 4) | ~95% | >95% |
| Numeric verification passed rate | unknown | >80% of executed |
| Combined attestation fire rate | ~0% | >25% of publishes |
| Domain coverage | 8 domains | 12+ domains |
| Reputation providers | 0 | 2-3 (Ethos most accessible) |
| Feed history access | ~20k posts | 50k+ (or documented blocker) |

---

## Appendix A: Verified Free API Catalog (Research Results)

Research conducted via parallel Claude + Gemini agents (2026-03-21). URLs verified, response sizes measured. Organized into implementation waves.

### Wave 1: No Auth, Tiny Responses (Priority — Session 2)

| API | Endpoint | Auth | ~Size | TLSN | claimType |
|-----|----------|------|-------|------|-----------|
| Binance Spot | `GET api.binance.com/api/v3/ticker/price?symbol=BTCUSDT` | None | ~100B | YES | price |
| Binance 24h | `GET api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT` | None | ~600B | YES | price |
| Binance Futures | `GET fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT` | None | ~200B | YES | metric |
| Binance OI | `GET fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT` | None | ~100B | YES | metric |
| Binance Funding | `GET fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1` | None | ~150B | YES | metric |
| Kraken Ticker | `GET api.kraken.com/0/public/Ticker?pair=XBTUSD` | None | ~500B | YES | price |
| Coinbase Spot | `GET api.coinbase.com/v2/prices/BTC-USD/spot` | None | ~200B | YES | price |
| DefiLlama TVL | `GET api.llama.fi/tvl/{protocol}` | None | ~20B | YES | metric |
| DefiLlama Price | `GET coins.llama.fi/prices/current/{chain}:{addr}` | None | ~200B | YES | price |
| Mempool Fees | `GET mempool.space/api/v1/fees/recommended` | None | ~100B | YES | metric |
| Blockchain.com Stats | `GET api.blockchain.info/stats` | None | ~2KB | YES | metric |
| Blockchain.com Ticker | `GET blockchain.info/ticker` | None | ~200B | YES | price |
| Treasury Debt | `GET api.fiscaldata.treasury.gov/.../debt_to_penny?sort=-record_date&page[size]=1` | None | ~1KB | YES | metric |
| Deribit Ticker | `GET www.deribit.com/api/v2/public/ticker?instrument_name=BTC-PERPETUAL` | None | ~1KB | YES | price |
| Blockchair BTC | `GET api.blockchair.com/bitcoin/stats` | None | ~3KB | YES | metric |

### Wave 2: Free API Key, Easy Signup (Session 3-5)

| API | Endpoint | Auth | ~Size | TLSN | claimType |
|-----|----------|------|-------|------|-----------|
| Etherscan Gas | `GET api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=KEY` | Key | ~300B | YES | metric |
| Etherscan Price | `GET api.etherscan.io/api?module=stats&action=ethprice&apikey=KEY` | Key | ~200B | YES | price |
| Etherscan Nodes | `GET api.etherscan.io/api?module=stats&action=nodecount&apikey=KEY` | Key | ~200B | YES | metric |
| FRED Series | `GET api.stlouisfed.org/fred/series/observations?series_id=GDP&api_key=KEY&limit=1` | Key | ~2KB | YES | metric |
| CoinMarketCap | `GET pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=BTC` | Key | ~1KB | YES | price |
| Owlracle Gas | `GET api.owlracle.info/v4/eth/gas?apikey=KEY` | Key | ~500B | YES | metric |
| OpenSea Stats | `GET api.opensea.io/api/v2/collection/{slug}/stats` | Key | ~1KB | YES | metric |
| Coinalyze OI | `GET api.coinalyze.net/v1/open-interest?symbols=BTCUSD_PERP.A` | Key | ~500B | YES | metric |
| Gitcoin Passport | `GET api.passport.xyz/v2/stamps/{scorer}/score/{addr}` | Key | ~2KB | YES | metric |

### Wave 3: Specialized Sources (Session 5-7)

| API | Endpoint | Auth | ~Size | TLSN | claimType |
|-----|----------|------|-------|------|-----------|
| DEXScreener Pair | `GET api.dexscreener.com/latest/dex/pairs/{chain}/{addr}` | None | ~3.5KB | YES | price |
| GeckoTerminal | `GET api.geckoterminal.com/api/v2/networks/eth/tokens/{addr}` | None | ~1.2KB | YES | price |
| Jupiter Quote | `GET quote-api.jup.ag/v6/quote?inputMint=...&outputMint=...&amount=...` | None | ~2KB | YES | price |
| Magic Eden | `GET api-mainnet.magiceden.dev/v2/collections/{symbol}/stats` | None | ~500B | YES | metric |
| DefiLlama Chains | `GET api.llama.fi/v2/chains` | None | ~15KB | BORDERLINE | metric |
| DefiLlama Stablecoins | `GET stablecoins.llama.fi/stablecoinchains` | None | ~5KB | YES | metric |
| CoinGecko Global | `GET api.coingecko.com/api/v3/global` | None | ~2KB | YES | metric |
| CryptoCompare Price | `GET min-api.cryptocompare.com/data/price?fsym=BTC&tsyms=USD` | None | ~50B | YES | price |

### Wave 4: Macro Expansion (Session 7-9)

| API | Endpoint | Auth | ~Size | TLSN | claimType |
|-----|----------|------|-------|------|-----------|
| BLS CPI | `GET api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0` | None | ~3KB | YES | metric |
| Treasury Rates | `GET api.fiscaldata.treasury.gov/.../avg_interest_rates?page[size]=5` | None | ~2KB | YES | metric |
| World Bank GDP | `GET api.worldbank.org/v2/country/US/indicator/NY.GDP.MKTP.CD?format=json&per_page=1` | None | ~1KB | YES | metric |
| ECB EUR/USD | `GET data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?lastNObservations=1&format=jsondata` | None | ~4KB | YES | metric |
| ExchangeRate | `GET open.er-api.com/v6/latest/USD` | None | ~2KB | YES | metric |
| Solana RPC | `POST api.mainnet-beta.solana.com` (getEpochInfo) | None | ~300B | CONDITIONAL | metric |

### Reputation APIs (T3)

| API | Endpoint | Auth | ~Size | Notes |
|-----|----------|------|-------|-------|
| Ethos Network | `GET api.ethos.network/v1/score/{target}` | Header only (`X-Ethos-Client`) | ~1-3KB | Most accessible — no signup |
| Gitcoin Passport | `GET api.passport.xyz/v2/stamps/{scorer}/score/{addr}` | Free API key | ~2KB | Requires free signup |
| Nomis | `GET api.nomis.cc/api/v1/{chain}/wallet/{addr}/score` | Unclear (possibly paid) | ~2KB | Spike needed |

### Research Corrections to Original Plan

| Original Assumption | Reality | Impact |
|---------------------|---------|--------|
| L2Beat has public API | No public REST API | Remove from new specs; use DefiLlama `/v2/chains` |
| DeepDAO free tier | Paid only ($25+/mo) | Remove from governance targets |
| Blur has API | No public API | Remove; use CoinGecko NFT tickers instead |
| Ultrasound.money API | No JSON API | Remove; use Etherscan gas oracle |
| L2fees.info API | No JSON API | Remove; use CryptoStats L2 fees |
| Ethernodes API | No JSON API | Remove; use Etherscan node count |
| Solana Beach API | Undocumented/key required | Use Solana RPC directly |
| CryptoCompare free | Heavily restricted since 2024 | Deprioritize; still usable for basic price |

### New APIs Discovered (Not in Original Plan)

| API | Domain | Why Valuable |
|-----|--------|-------------|
| Gemini | Crypto prices | No auth, ~950B response |
| OKX | Crypto prices | No auth, ~500B response |
| KuCoin | Crypto prices | No auth, ~400B response |
| CoinLore | Crypto prices | No auth, ~570B response |
| Coinpaprika | Crypto prices | Free tier, ~1.3KB, rich data |
| GeckoTerminal | DEX/trading | No auth, ~1.2KB, DEX analytics |
| DIA | Stablecoins | No auth, ~500B, token prices |
| Blockchair | On-chain | No auth, multi-chain stats, ~3KB |
| Jupiter | DEX/Solana | No auth, ~2KB, swap quotes |
| Reservoir | NFTs | Free key, ~3KB, collection data |
| CoinDesk BPI | Prices | No auth, ~500B, simple BTC price |
| ExchangeRate-API | Macro | No auth, ~2KB, forex rates |

---

## Session Progress Log

### Session 1 (2026-03-21) ✅
**Commits:** `c11a509`, `068aa75`
- **T2:** LLM nudge added to `src/actions/llm.ts` — encourages exact numeric values + "at least ONE verifiable claim"
- **T1a:** claimTypes + extractionPath added to 3 specs: `cryptocompare.yaml` (price→$.USD), `mempool.yaml` (metric→$.fastestFee), `blockchain-info.yaml` (price→$.USD.last + metric→$.market_price_usd)
- **T0:** 2 Binance entries added (ticker-price, 24hr), CryptoCompare adapter.operation fixed
- **Codex fixes:** Catalog truncation restored (209→211), Binance 24hr operation corrected
- **Tests:** 1139 → 1145 (4 new surgical-url tests)
- **Learnings:** Never use Python `json.dump` on catalog.json — it truncates. Always verify source count before/after edits.

### Session 2 (2026-03-21) ✅
**Commits:** `16de6b0`, `d56a1d5`
- **T0 Cleanup:** 25 entries fixed with adapter.operation + correct provider name
- **T0 Batch 1:** +3 active entries (Kraken BTC/ETH, DefiLlama chains), +3 quarantined (deribit, blockchair, treasury — need YAML specs)
- **T4 Spike:** `cli/gcr-spike.ts` — PARTIAL PASS. `getBlocks()` works but latest blocks have 0 txs. `getAddressInfo()` returns null for GCR. T4 deferred.
- **Codex fixes:** Quarantined specless providers, removed binance-funding (fapi host mismatch), fixed USGS operations, fixed gcr-spike flag parsing
- **Catalog:** 211 → 217 (80 active, 81 with adapter, 4 quarantined)
- **Learnings:** Always verify new catalog entries against YAML spec registry. `fapi.binance.com` ≠ `api.binance.com` (different spec needed).

### Session 3 (2026-03-21) ✅
**Commits:** `2923bdc`
- **T1a:** claimTypes + extractionPath added to 4 specs: fred (metric), worldbank (metric), usgs (metric), yahoo-finance (price). NASA skipped (APOD is text-only).
- **T0 Batch 2:** 16 new quarantined catalog entries: CoinGecko (5 assets), Binance (3 pairs), DefiLlama (3 protocols), Kraken (2 pairs), CryptoCompare (2 assets), DexScreener (1 pair).
- **Tests:** 1145 → 1146 (1 new yahoo-finance surgical-url test)
- **Codex review:** Clean execution, no issues found.

### Session 4 (2026-03-21) ✅
**Commits:** `58d9bc5`, `1e9658e`
- **T1-new:** 4 new YAML specs created: coinbase.yaml (price), deribit.yaml (price), blockchair.yaml (price+metric), treasury.yaml (metric). All with claimTypes.
- **T0 Batch 3:** 8 new catalog entries (Coinbase BTC/ETH/SOL, Blockchair ETH, DefiLlama stablecoins, CoinGecko global, Mempool hashrate, Deribit ETH-PERPETUAL).
- **Codex findings (plan):** Existing `cli/source-lifecycle.ts` already handles bulk promotion — no new CLI needed. DefiLlama stablecoins op already exists.
- **Codex findings (commit):** blockchair.yaml had single-object+jsonPath bug (fixed to json-path). 3 catalog entries had non-existent operations (removed). `/simplify` caught deribit parse mode bug and blockchair bnb mapping.
- **Specs:** 26 → 30. claimTypes: 15 → 19/30.
- **Tests:** 1146 → 1150 (4 new spec tests)

### Session 5 (2026-03-21) ✅
**Commits:** `692749b`, `6e4b8f8`, `f54366a`, `bd7d700`
- **Quarantine promotion:** 27 sources promoted quarantined→active across passes 1-6. 2 CoinGecko entries archived (5 consecutive failures). Active: 80 → 98.
- **T1-new ops:** 3 new spec operations: coingecko global (metric), mempool hashrate (metric), defillama stablecoins (added claimTypes to existing op).
- **T1b entity plumbing:** MACRO_ENTITY_MAP (15 macro entities: GDP, unemployment, inflation, interest rate, debt, earthquake, etc.) + inferMacroEntity() + buildSurgicalUrl integration. Fred, worldbank, treasury, usgs specs can now build surgical URLs for macro claims.
- **T0 Batch 4:** 9 catalog entries (3 re-added + 6 new: Coinbase ADA/DOT/AVAX, Deribit SOL-PERPETUAL, Blockchair litecoin/dogecoin).
- **Codex findings:** Mempool hashrate used legacy parse format (fixed to standard). Interest-rate macro entry had wrong World Bank indicator (removed). Catalog cleaned: 238 → 176 (invalid archived entries purged by validation).
- **Tests:** 1150 → 1168 (+18: 10 macro entity + 3 new ops + 5 macro integration)

### Current State After Session 5
| Metric | Before | After S1 | After S2 | After S3 | After S4 | After S5 |
|--------|--------|----------|----------|----------|----------|----------|
| Total sources | 209 | 211 | 217 | 233 | 238→167 | 176 |
| Active sources | 66 | 78 | 80 | 80 | 80 | **98** |
| Quarantined | 0 | 0 | 4 | 20 | 25→5 | **4** |
| Specs total | 26 | 26 | 26 | 26 | **30** | 30 |
| Specs with claimTypes | 8/26 | 11/26 | 11/26 | **15/26** | **19/30** | 19/30 |
| Macro entities | 0 | 0 | 0 | 0 | 0 | **15** |
| Tests | 1139 | 1145 | 1145 | 1146 | 1150 | **1168** |
