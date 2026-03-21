# Claim-Driven Attestation — Design Spec

> **Status:** Proposal (2026-03-21)
> **Author:** Marius + PAI
> **Depends on:** Phase 4 (declarative adapters), Phase 5 (skill loader)

## Problem

The current attestation pipeline is **source-shaped**: each source has a fixed URL, and attestation captures whatever that URL returns. The attestation is not tailored to what the post actually claims.

```
Current: topic → pick source → generate post → match (verify fit) → attest (fixed URL)
                  ↑                                                      ↑
           source-shaped                                          source-shaped
           (topic → URL)                                     (same URL regardless
                                                              of what post claims)
```

This creates three problems:

1. **Wasted bytes**: A post claiming "BTC futures are in contango" attests a 464KB response containing all 964 BTC options. 99.5% of the attested data is irrelevant.
2. **TLSN exclusion**: Sources that would be TLSN-safe if queried surgically (e.g., single-ticker endpoints) are marked `tlsn_safe: false` because their default URL returns >16KB.
3. **Weak proof linkage**: The attested data blob has no explicit relationship to the specific claims in the post. The match score is a loose post-hoc check, not a structural proof.

## Proposed: Claim-Driven Attestation

```
Proposed: topic → generate post → extract claims → per-claim URL construction → attest
                                       ↑                      ↑
                                  claim-shaped            claim-shaped
                               (post text → claims)    (claim → minimal URL
                                                        proving that claim)
```

The key inversion: **attestation happens after post generation, driven by what the post claims**, not before generation driven by what sources are available.

## Attestation Levels

| Level | What's attested | Response size | Method | Proof strength |
|-------|----------------|---------------|--------|----------------|
| **Surgical** | Exact data point backing one claim | <1KB | TLSN preferred | Strongest — cryptographic proof of the exact fact |
| **Targeted** | Filtered API response relevant to the topic | 1-16KB | TLSN or DAHR | Strong — proves data context |
| **Broad** | Full API response containing relevant data | 16KB-500KB | DAHR only | Medium — data exists in response but must be located |
| **Bulk** | Multi-endpoint or paginated dataset | >500KB | Not recommended | Weak — attestation bloat, timeout risk |

The system should prefer surgical over broad, falling back through levels when the surgical endpoint doesn't exist.

## Claim Extraction

The post generation step already produces text. Claims are extractable:

```typescript
interface ExtractedClaim {
  /** The factual assertion from the post text */
  text: string;
  /** Data type: price, metric, event, statistic, trend, quote */
  type: "price" | "metric" | "event" | "statistic" | "trend" | "quote";
  /** Key entities (asset names, tickers, protocol names) */
  entities: string[];
  /** Numeric value if present (for price/metric verification) */
  value?: number;
  /** Unit if present (USD, %, TVL, etc.) */
  unit?: string;
}
```

**Example post:**
> "Bitcoin futures are trading at $64,231 with open interest up 12% this week.
> Ethereum gas fees have dropped to 3 gwei, the lowest since January."

**Extracted claims:**
1. `{ text: "Bitcoin futures trading at $64,231", type: "price", entities: ["bitcoin", "BTC"], value: 64231, unit: "USD" }`
2. `{ text: "open interest up 12% this week", type: "metric", entities: ["bitcoin", "BTC"], value: 12, unit: "%" }`
3. `{ text: "Ethereum gas fees at 3 gwei", type: "price", entities: ["ethereum", "ETH"], value: 3, unit: "gwei" }`
4. `{ text: "lowest since January", type: "trend", entities: ["ethereum", "gas"] }`

## Surgical URL Construction

Each claim maps to a minimal API query. The adapter system (Phase 4) already has `buildCandidates()` — this extends it with a `buildSurgicalUrl()` method:

```typescript
interface SurgicalCandidate {
  claim: ExtractedClaim;
  url: string;
  estimatedSizeBytes: number;
  method: "TLSN" | "DAHR";
  /** JSONPath or jq-like expression to extract the relevant field from the response */
  extractionPath?: string;
  /** Expected value (for post-attestation verification) */
  expectedValue?: number | string;
}
```

**Mapping examples:**

| Claim | Surgical URL | Size | Method |
|-------|-------------|------|--------|
| BTC price $64,231 | `api.binance.com/api/v3/ticker/price?symbol=BTCUSDT` | ~60 bytes | TLSN |
| OI up 12% | `api.binance.com/api/v3/openInterest?symbol=BTCUSDT` | ~80 bytes | TLSN |
| ETH gas 3 gwei | `api.etherscan.io/v2/api?module=gastracker&action=gasoracle` | ~200 bytes | TLSN |
| Lowest since Jan | No single endpoint (trend claim, needs historical) | N/A | Skip or DAHR broad |

**Key insight:** Not every claim needs its own attestation. The system prioritizes:
1. **Numeric claims** (prices, metrics) — most valuable to attest, smallest URLs
2. **Event claims** (X happened) — attest if a specific endpoint exists
3. **Trend claims** (X is the lowest since Y) — hardest to attest surgically, often need broad data
4. **Opinion claims** (X suggests Y) — don't attest (subjective)

## Multi-Attestation Strategy

A single post can have multiple attestations, each proving a different claim:

```typescript
interface AttestationPlan {
  /** Primary attestation (always required) */
  primary: SurgicalCandidate;
  /** Optional secondary attestations (strengthen proof) */
  secondary: SurgicalCandidate[];
  /** Claims intentionally not attested (with reason) */
  unattested: Array<{ claim: ExtractedClaim; reason: string }>;
  /** Total estimated cost in DEM */
  estimatedCost: number;
  /** Attestation method budget constraint */
  methodBudget: {
    maxTlsnAttestations: number;  // TLSN is expensive (~12 DEM + 50-180s)
    maxDahrAttestations: number;  // DAHR is cheap (~1 DEM + <2s)
  };
}
```

**Cost-aware selection:** TLSN is ~12 DEM and 50-180s per attestation (on mainnet). A post with 4 claims shouldn't trigger 4 TLSN attestations. The planner should:
- Pick the **highest-value claim** for TLSN (if TLSN-safe)
- Use DAHR for secondary claims (cheap, fast)
- Skip subjective/trend claims entirely

## Source Record Changes

The `SourceRecordV2` gains a new optional field:

```typescript
interface SourceRecordV2 {
  // ... existing fields ...

  /** Surgical endpoint templates for claim-level attestation */
  surgicalEndpoints?: SurgicalEndpoint[];
}

interface SurgicalEndpoint {
  /** Claim types this endpoint can prove */
  claimTypes: ("price" | "metric" | "event" | "statistic")[];
  /** URL template with {entity} and {symbol} placeholders */
  urlTemplate: string;
  /** Estimated response size in bytes */
  estimatedSizeBytes: number;
  /** Whether this endpoint is TLSN-safe (<16KB, JSON, public) */
  tlsnSafe: boolean;
  /** JSONPath to extract the relevant value */
  extractionPath: string;
}
```

**Example for Binance:**
```yaml
surgicalEndpoints:
  - claimTypes: [price]
    urlTemplate: "https://api.binance.com/api/v3/ticker/price?symbol={symbol}USDT"
    estimatedSizeBytes: 60
    tlsnSafe: true
    extractionPath: "$.price"
  - claimTypes: [metric]
    urlTemplate: "https://api.binance.com/api/v3/ticker/24hr?symbol={symbol}USDT"
    estimatedSizeBytes: 800
    tlsnSafe: true
    extractionPath: "$"
```

## Pipeline Changes

### Phase A: Claim Extraction (after post generation)

Insert between "generate post" and "source match":

```
generatePost(topic) → draft
  ↓
extractClaims(draft.text) → ExtractedClaim[]
  ↓
buildAttestationPlan(claims, sourceView, config) → AttestationPlan
  ↓
executeAttestations(plan) → AttestResult[]
```

### Phase B: Adapter Extension

Extend existing `ProviderAdapter` interface:

```typescript
interface ProviderAdapter {
  // ... existing methods ...

  /** Build a surgical URL for a specific claim (optional) */
  buildSurgicalUrl?(claim: ExtractedClaim, source: SourceRecordV2): SurgicalCandidate | null;
}
```

Adapters that don't implement `buildSurgicalUrl` fall back to the current `buildCandidates()` behavior (topic-level URL selection).

### Phase C: Attestation Planner

New module `src/lib/attestation-planner.ts`:

```typescript
export function buildAttestationPlan(
  claims: ExtractedClaim[],
  sourceView: AgentSourceView,
  config: AgentConfig,
): AttestationPlan
```

Decision logic:
1. For each claim, find all sources with matching `surgicalEndpoints`
2. Score by: proof strength (TLSN > DAHR), response size (smaller > larger), source reliability
3. Respect cost budget (`methodBudget`)
4. Primary = highest-scored claim+source pair
5. Secondary = remaining claims that have cheap attestation options
6. Unattested = trend/opinion claims or claims without matching endpoints

## Backward Compatibility

- Sources without `surgicalEndpoints` work exactly as today (topic-level attestation)
- The attestation planner falls back to current `selectSourceForTopicV2()` when no surgical endpoints exist
- Existing adapter `buildCandidates()` remains the default path
- Roll out incrementally: add `surgicalEndpoints` to high-value sources first (binance, coingecko, etherscan)

## Implementation Order

1. **Claim extraction** — `extractClaims()` function using LLM or rule-based extraction
2. **Surgical endpoint schema** — Add `surgicalEndpoints` to `SourceRecordV2`, update catalog validation
3. **Attestation planner** — `buildAttestationPlan()` with cost-aware selection
4. **Adapter extension** — `buildSurgicalUrl()` on financial adapters (binance, coingecko, etherscan)
5. **Pipeline integration** — Wire into `runPublishAutonomous()` between post generation and attestation
6. **Multi-attestation support** — Allow >1 attestation per post (SDK support TBD)

## Decisions (2026-03-21)

1. **Claim extraction: rules first, LLM fallback.** Regex/pattern rules extract prices and metrics. LLM only for ambiguous or complex claims. Cheapest path that still catches edge cases.
2. **Priority: next workstream.** Start immediately after this design session. Ahead of Tier 1 reputation plugins.
3. **Surgical endpoints: provider specs (YAML).** Extend existing declarative adapter specs with surgical endpoint templates. Co-located with adapter logic, consistent with Phase 4 architecture.
4. **Multi-attestation: investigating SDK support** (see Open Questions below).

## SDK Investigation Results (2026-03-21)

**Multi-attestation is fully supported at every layer:**

| Layer | Support | Evidence |
|-------|---------|----------|
| API schema | `Array<{...}>` | `api-reference.md:158-163` |
| PublishInput type | `Array<{...}>` | `publish-pipeline.ts:31-41` |
| publishPost() | Maps full array | `publish-pipeline.ts:299-313` |
| HIVE encoding | JSON stringify (no size constraint) | `publish-pipeline.ts:317-320` |
| On-chain | Array stored as-is | HIVE prefix + JSON bytes |

**Current bottleneck is our code only:** `attestAndPublish()` hardcodes a single-element array because it calls `attestDahr()` once. The fix is straightforward — call `attestDahr()` N times and collect results into the array.

**Scoring:** +40 DAHR bonus checks `sourceAttestations.length > 0` (boolean presence). Multiple attestations don't increase score but increase proof density for reputation/trust.

**Both DAHR and TLSN attestations can coexist on the same post** — `sourceAttestations` (DAHR) and `tlsnAttestations` (TLSN) are separate arrays. A single post could have 1 TLSN surgical proof + 2 DAHR broad proofs.

## Open Questions

1. **Post-attestation verification:** Should we verify the attested value matches the claim value (e.g., attested price $64,231 ≈ claimed price $64,231)? This catches stale data but adds complexity.
2. **Cost ceiling per post:** With multi-attestation possible, what's the max DEM budget per post? 1 TLSN (~12 DEM) + 2 DAHR (~2 DEM) = ~14 DEM — acceptable on testnet, needs budgeting on mainnet.

## Success Metrics

- **TLSN coverage increase:** Sources currently marked `tlsn_safe: false` (due to large default responses) become TLSN-attestable via surgical endpoints
- **Proof linkage:** Every attested data point is explicitly connected to a specific claim in the post text
- **Attestation size reduction:** Average attested response size drops from ~10KB to <1KB for surgical endpoints
- **No score regression:** Quality scores stay the same or improve (DAHR attestation still provides the +40 bonus)
