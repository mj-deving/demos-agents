# T0-T4 Source & Attestation Evolution Plan

> **Status:** Draft — pending Codex review
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
2. T1: Add claimTypes to fred.yaml → metric claims match
3. T0: Add Binance catalog entries → source found
4. Run session → verify attestation fires

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
- **Fix invalid entries (indices 138-208):** 70+ entries imported by feed-mine with malformed schemas. Either fix or remove.
- **Validate all existing active sources:** Run `npx tsx cli/scan-feed.ts --agent sentinel` and mark unreachable sources as degraded.
- **Effort:** S (1-2 hours)

#### Phase 1: New YAML Specs for Unrepresented Providers
Create YAML spec files for providers that have no spec yet but will have catalog entries:

| New Spec | Operations | claimTypes | Auth |
|----------|-----------|------------|------|
| `l2beat.yaml` | tvl, scaling-summary | [metric] | none |
| `owlracle.yaml` | gas-price | [metric] | API key (free tier) |
| `coinbase.yaml` | spot-price | [price] | none |
| `opensea.yaml` | collection-stats | [metric] | API key (free) |
| `magiceden.yaml` | collection-stats | [metric] | none |
| `snapshot.yaml` | proposals | [event] | none (GraphQL) |
| `tally.yaml` | dao-stats | [metric] | none (GraphQL) |
| `solscan.yaml` | token-info | [metric] | none |
| `deribit.yaml` | ticker | [price] | none |

**Effort:** M (one session per 3-4 specs, ~3 sessions total)

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
    "importedFrom": ["manual"]
  },
  "runtime": {
    "timeoutMs": 8000,
    "retry": { "maxAttempts": 2, "backoffMs": 1000, "retryOn": ["timeout", "5xx"] }
  },
  "trustTier": "new",
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
- Consider lowering match threshold from 10 to 8 for sources with `claimTypes` (incentivize attestable sources)

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
| `fred.yaml` | `metric` | `$.observations[0].value` | Economic indicators (GDP, CPI, unemployment) |
| `worldbank.yaml` | `metric` | `$[1][0].value` | Development indicators |
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

### Declarative Engine Impact
No changes needed. `buildSurgicalUrl()` (declarative-engine.ts:1165) already:
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
| **1** | T2 (nudge) + T1 batch 1 (fred, cryptocompare, mempool, blockchain-info) | Highest leverage: enables extraction + matching | Gate 1+2 improvement |
| **2** | T0 cleanup (invalid entries) + T0 existing batch 1 (Binance, Kraken entries) + T4 spike | Unblock catalog, add first sources, fail-fast on T4 | Gate 3 + T4 go/no-go |
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
| Active sources | 66 | 200+ |
| Specs with claimTypes | 8/26 | 18+/26+ |
| Claim extraction hit rate | ~10% | >50% |
| "No matching source" rate | ~80% | <5% |
| Attestation fire rate | ~0% | >33% of publishes |
| Domain coverage | 8 domains | 12+ domains |
| Reputation providers | 0 | 3 |
| Feed history access | ~20k posts | 50k+ (or documented blocker) |
