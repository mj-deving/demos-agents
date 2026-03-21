# Claim-Driven Attestation — Design Spec

> **Status:** Proposal v2 (2026-03-21) — incorporates Codex architectural review
> **Author:** Marius + PAI
> **Depends on:** Phase 4 (declarative adapters), Phase 5 (skill loader)
> **Review:** Codex found 4 High, 2 Medium gaps in v1. All addressed below.

## Problem

The current attestation pipeline is **source-shaped**: each source has a fixed URL, and attestation captures whatever that URL returns. The attestation is not tailored to what the post actually claims.

```
Current: topic → preflight → prefetch → ground LLM → generate post → match → attest (fixed URL)
                  ↑            ↑                                               ↑
           source-shaped  data grounding                                source-shaped
           (topic → URL)  (feeds LLM)                              (same URL regardless
                                                                    of what post claims)
```

This creates three problems:

1. **Wasted bytes**: A post claiming "BTC futures are in contango" attests a 464KB response containing all 964 BTC options. 99.5% of the attested data is irrelevant.
2. **TLSN exclusion**: Sources that would be TLSN-safe if queried surgically (e.g., single-ticker endpoints) are marked `tlsn_safe: false` because their default URL returns >16KB.
3. **Weak proof linkage**: The attested data blob has no explicit relationship to the specific claims in the post. The match score is a loose post-hoc check, not a structural proof.

## Proposed: Claim-Driven Attestation

**Critical constraint (Codex #1):** The existing preflight → prefetch → LLM grounding → generation → match pipeline is preserved unchanged. Claim-driven attestation is an **additive step after match**, not a replacement of the existing flow.

```
Proposed: topic → preflight → prefetch → ground LLM → generate post → match
                                                                         ↓ (pass only)
                                                              extract claims from draft
                                                                         ↓
                                                              build attestation plan
                                                                         ↓
                                                              execute attestations
                                                                         ↓
                                                              verify attested values
                                                                         ↓
                                                                      publish
```

The key insight: **attestation planning happens after match passes**, so we never spend attestation cost on rejected drafts. The existing source preflight and match remain as quality gates. Claim-driven attestation replaces only the final "attest fixed URL" step with "attest per-claim surgical URLs."

## Attestation Levels

| Level | What's attested | Response size | Method | Proof strength |
|-------|----------------|---------------|--------|----------------|
| **Surgical** | Exact data point backing one claim | <1KB | TLSN preferred | Strongest — cryptographic proof of the exact fact |
| **Targeted** | Filtered API response relevant to the topic | 1-16KB | TLSN or DAHR | Strong — proves data context |
| **Broad** | Full API response containing relevant data | 16KB-500KB | DAHR only | Medium — data exists in response but must be located |
| **Bulk** | Multi-endpoint or paginated dataset | >500KB | Not recommended | Weak — attestation bloat, timeout risk |

The system prefers surgical over broad, falling back through levels per the fallback policy (see below).

## Claim Extraction

**Decision (Codex #2):** Rules-first extraction handles numeric claims (prices, metrics, percentages). LLM fallback for complex claims (trends, comparisons). This requires **new extraction code** — the existing `matcher.ts` bag-of-terms extractor returns `string[]`, not structured claims. The LLM path also needs upgrading from `string[]` to `ExtractedClaim[]`.

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
  /** Unit if present (USD, %, TVL, gwei, etc.) */
  unit?: string;
}
```

### Rule-based extraction (Phase 1)

Regex patterns that cover the high-value subset:

| Pattern | Example | Extracted |
|---------|---------|-----------|
| `$X,XXX` / `$X.XX` | "trading at $64,231" | `{ type: "price", value: 64231, unit: "USD" }` |
| `X%` | "up 12% this week" | `{ type: "metric", value: 12, unit: "%" }` |
| `X gwei/sats/DEM` | "fees at 3 gwei" | `{ type: "price", value: 3, unit: "gwei" }` |
| `X TVL/volume/mcap` | "$2.3B TVL" | `{ type: "metric", value: 2.3e9, unit: "TVL" }` |
| Entity from `inferAssetAlias()` | "Bitcoin", "ETH" | `entities: ["bitcoin", "BTC"]` |

**Trend/comparison claims** ("lowest since January", "outperforming X") are not extractable by rules → LLM fallback or skip.

### LLM fallback (Phase 2)

Structured prompt returning `ExtractedClaim[]` as JSON. Only invoked when rules produce 0 claims or the post contains complex comparative language. Cost: ~1s + minimal tokens (post text is <1KB).

**Example post:**
> "Bitcoin futures are trading at $64,231 with open interest up 12% this week.
> Ethereum gas fees have dropped to 3 gwei, the lowest since January."

**Extracted claims:**
1. `{ text: "Bitcoin futures trading at $64,231", type: "price", entities: ["bitcoin", "BTC"], value: 64231, unit: "USD" }`
2. `{ text: "open interest up 12% this week", type: "metric", entities: ["bitcoin", "BTC"], value: 12, unit: "%" }`
3. `{ text: "Ethereum gas fees at 3 gwei", type: "price", entities: ["ethereum", "ETH"], value: 3, unit: "gwei" }`
4. `{ text: "lowest since January", type: "trend", entities: ["ethereum", "gas"] }` — LLM only, rules skip this

## Surgical URL Construction

Each claim maps to a minimal API query. The adapter system (Phase 4) already has `buildCandidates()` — this extends it with a `buildSurgicalUrl()` method.

**Decision (Codex #4):** Surgical endpoint templates live exclusively in **provider YAML specs**, not in `SourceRecordV2` catalog records. This avoids duplicating adapter logic across sources and stays consistent with the Phase 4 declarative engine architecture.

```typescript
interface SurgicalCandidate {
  claim: ExtractedClaim;
  url: string;
  estimatedSizeBytes: number;
  method: "TLSN" | "DAHR";
  /** JSONPath to extract the relevant field from the response */
  extractionPath: string;
  /** Expected value (for mandatory post-attestation verification) */
  expectedValue?: number | string;
  /** Tolerance for numeric comparison (e.g., 0.01 = 1% drift allowed) */
  tolerance?: number;
}
```

**Mapping examples:**

| Claim | Surgical URL | Size | Method |
|-------|-------------|------|--------|
| BTC price $64,231 | `api.binance.com/api/v3/ticker/price?symbol=BTCUSDT` | ~60 bytes | TLSN |
| OI up 12% | `api.binance.com/api/v3/openInterest?symbol=BTCUSDT` | ~80 bytes | TLSN |
| ETH gas 3 gwei | `api.etherscan.io/v2/api?module=gastracker&action=gasoracle` | ~200 bytes | TLSN |
| Lowest since Jan | No single endpoint (trend claim) | N/A | Skip (unattestable) |

**Provider YAML example (Binance):**
```yaml
operations:
  # ... existing operations ...

  ticker-price:
    description: "Single symbol price — surgical attestation"
    claimTypes: [price]
    urlTemplate: "https://api.binance.com/api/v3/ticker/price?symbol={symbol}USDT"
    estimatedSizeBytes: 60
    extractionPath: "$.price"
    compatibility:
      tlsn:
        maxResponseKb: 1
      dahr:
        maxResponseKb: 1

  open-interest:
    description: "Symbol open interest — surgical attestation"
    claimTypes: [metric]
    urlTemplate: "https://api.binance.com/api/v3/openInterest?symbol={symbol}USDT"
    estimatedSizeBytes: 80
    extractionPath: "$.openInterest"
    compatibility:
      tlsn:
        maxResponseKb: 1
      dahr:
        maxResponseKb: 1
```

**Key insight:** Not every claim needs its own attestation. The system prioritizes:
1. **Numeric claims** (prices, metrics) — most valuable to attest, smallest URLs
2. **Event claims** (X happened) — attest if a specific endpoint exists
3. **Trend claims** (X is the lowest since Y) — hardest to attest surgically, often need broad data
4. **Opinion claims** (X suggests Y) — don't attest (subjective)

## Post-Attestation Value Verification

**Decision (Codex #3):** This is **mandatory**, not optional. Without it, the system can attest the right endpoint but prove the wrong fact (stale data, price moved between generation and attestation).

```typescript
interface VerificationResult {
  claim: ExtractedClaim;
  attestedValue: number | string | null;
  expectedValue: number | string | null;
  /** Whether the attested value matches within tolerance */
  verified: boolean;
  /** Drift between claimed and attested value (for numeric claims) */
  drift?: number;
  /** Reason if verification failed */
  failureReason?: string;
}

/**
 * Verify that attested response data matches the claims in the post.
 * Runs after attestation, before publish.
 */
function verifyAttestedValues(
  attestResults: AttestResult[],
  candidates: SurgicalCandidate[],
): VerificationResult[]
```

**Verification rules:**
- **Price claims:** attested value must be within 2% of claimed value (markets move between generation and attestation)
- **Metric claims:** attested value must be within 5% (metrics update less frequently)
- **Event claims:** response must contain the event reference (string match)
- **Trend claims:** not verified (too complex for automated check)

**On failure:** If primary attestation fails verification, fall back to broad attestation (which is the current behavior). If broad also fails, publish with whatever attestation passed. Never abort a post that passed the match gate — the match already validated the draft against source data.

## Multi-Attestation Strategy

A single post can have multiple attestations, each proving a different claim:

```typescript
interface AttestationPlan {
  /** Primary attestation (always required — best claim+source pair) */
  primary: SurgicalCandidate;
  /** Optional secondary attestations (strengthen proof) */
  secondary: SurgicalCandidate[];
  /** Claims intentionally not attested (with reason) */
  unattested: Array<{ claim: ExtractedClaim; reason: string }>;
  /** Total estimated cost in DEM */
  estimatedCost: number;
  /** Cost ceiling per post */
  maxCostDem: number;
  /** Attestation method budget constraint */
  methodBudget: {
    maxTlsnAttestations: number;  // TLSN is expensive (~12 DEM + 50-180s each)
    maxDahrAttestations: number;  // DAHR is cheap (~1 DEM + <2s each)
  };
}
```

**Cost-aware selection:** TLSN is ~12 DEM and 50-180s per attestation (on mainnet). A post with 4 claims shouldn't trigger 4 TLSN attestations. The planner should:
- Pick the **highest-value claim** for TLSN (if TLSN-safe)
- Use DAHR for secondary claims (cheap, fast)
- Skip subjective/trend claims entirely
- Enforce cost ceiling (default: 15 DEM/post on testnet, configurable for mainnet)

## Fallback Policy

**Decision (Codex #6):** Explicit fallback chain per claim. Failed attestations never abort the post.

```
Per-claim fallback:
  surgical URL → targeted URL → broad URL (current behavior) → skip claim

Post-level policy:
  - At least 1 attestation must succeed (primary)
  - If primary fails all fallback levels, use current source-shaped attestation
  - If current source-shaped also fails, publish with error observation (existing behavior)
  - Never abort a post that passed the match gate
```

**Example scenario:**
1. Claim: "BTC at $64,231" → surgical `ticker/price` endpoint → TLSN attest → **success**
2. Claim: "OI up 12%" → surgical `openInterest` endpoint → 429 rate limit → targeted `ticker/24hr` → **success**
3. Claim: "lowest since January" → no surgical endpoint → skip (trend claim, unattestable)

Result: 2 attestations published, 1 claim unattested (documented in plan).

## Rate Limiting and Budget Controls

**Decision (Codex #7):** Attestation calls must respect provider rate limits and have cost guardrails.

### Provider Rate Limits

Attestation calls (`attestDahr()`, `attestTlsn()`) must go through the same rate-limit buckets as `fetchSource()`. Currently attestation bypasses `src/lib/sources/rate-limit.ts` — this must be fixed.

```typescript
// Before attestation, acquire a rate-limit token for the provider
const token = await acquireRateLimitToken(provider, providerRateLimit);
if (!token.granted) {
  // Fall back to next attestation level
}
```

### Execution Order

Multiple attestations execute **sequentially**, not in parallel:
- Avoids provider 429 storms from concurrent requests
- TLSN attestations take 50-180s each — parallel would not meaningfully speed up
- DAHR attestations take <2s — sequential overhead is negligible (2-4s total for 2-3 claims)

### Cost Budget

```typescript
interface AttestationBudget {
  /** Max DEM per post (testnet: 15, mainnet: configurable) */
  maxCostPerPost: number;
  /** Max TLSN attestations per post (default: 1 — expensive) */
  maxTlsnPerPost: number;
  /** Max DAHR attestations per post (default: 3 — cheap) */
  maxDahrPerPost: number;
  /** Max total attestations per post */
  maxAttestationsPerPost: number;
}
```

Configured in agent persona.yaml under `attestation.budget`.

## SDK Investigation Results (2026-03-21)

**Multi-attestation is fully supported at every layer:**

| Layer | Support | Evidence |
|-------|---------|----------|
| API schema | `Array<{...}>` | `api-reference.md:158-163` |
| PublishInput type | `Array<{...}>` | `publish-pipeline.ts:31-41` |
| publishPost() | Maps full array | `publish-pipeline.ts:299-313` |
| HIVE encoding | JSON stringify (no size constraint) | `publish-pipeline.ts:317-320` |
| On-chain | Array stored as-is | HIVE prefix + JSON bytes |

**Bottleneck is in our code (Codex #5):** Not just `attestAndPublish()` — also `session-runner.ts:2192-2224` and `cli/publish.ts:739-746` hardcode single-element attestation arrays. All 3 call sites need updating.

**Scoring:** +40 DAHR bonus checks `sourceAttestations.length > 0` (boolean presence). Multiple attestations don't increase score but increase proof density for reputation/trust.

**Both DAHR and TLSN attestations can coexist on the same post** — `sourceAttestations` (DAHR) and `tlsnAttestations` (TLSN) are separate arrays. A single post could have 1 TLSN surgical proof + 2 DAHR broad proofs.

## Pipeline Changes

### Phase A: Claim Extraction (new module)

New module `src/lib/claim-extraction.ts`:

```typescript
export function extractClaims(postText: string, tags: string[]): ExtractedClaim[]
export async function extractClaimsWithLLM(postText: string, llm: LLMProvider): Promise<ExtractedClaim[]>
```

Rules first, LLM fallback when rules produce 0 claims. Neither reuses `matcher.ts` bag-of-terms — this is new code.

### Phase B: Surgical Operations in Provider Specs

Extend existing YAML specs with `claimTypes` and `extractionPath` on operations. Add `buildSurgicalUrl()` to `ProviderAdapter` interface:

```typescript
interface ProviderAdapter {
  // ... existing methods ...

  /** Build a surgical URL for a specific claim (optional) */
  buildSurgicalUrl?(claim: ExtractedClaim, source: SourceRecordV2): SurgicalCandidate | null;
}
```

Adapters that don't implement `buildSurgicalUrl` fall back to the current `buildCandidates()` behavior (topic-level URL selection).

### Phase C: Attestation Planner + Verifier

New module `src/lib/attestation-planner.ts`:

```typescript
export function buildAttestationPlan(
  claims: ExtractedClaim[],
  sourceView: AgentSourceView,
  config: AgentConfig,
): AttestationPlan

export async function executeAttestationPlan(
  plan: AttestationPlan,
  demos: Demos,
): Promise<AttestResult[]>

export function verifyAttestedValues(
  attestResults: AttestResult[],
  candidates: SurgicalCandidate[],
): VerificationResult[]
```

### Phase D: Pipeline Wiring

Insert into `runPublishAutonomous()` **after match passes, before publish**:

```
[existing] preflight → prefetch → generate → match
                                                ↓ (match.pass === true)
[new]                                    extractClaims(draft)
                                                ↓
[new]                                    buildAttestationPlan(claims)
                                                ↓
[new]                                    executeAttestationPlan(plan)
                                                ↓
[new]                                    verifyAttestedValues(results)
                                                ↓
[existing]                                   publish(attestResults[])
```

### Phase E: Multi-Attestation Call Sites

Update all 3 locations that hardcode single attestations:
- `src/actions/publish-pipeline.ts:attestAndPublish()` — accept `AttestResult[]`
- `cli/session-runner.ts:2192-2224` — pass array from planner
- `cli/publish.ts:739-746` — pass array from planner

## Backward Compatibility

- Sources without surgical operations work exactly as today (topic-level attestation)
- The attestation planner falls back to current `selectSourceForTopicV2()` when no surgical operations exist
- Existing adapter `buildCandidates()` remains the default path
- Roll out incrementally: add surgical operations to high-value providers first (binance, coingecko, etherscan)

## Implementation Order

1. **Claim extraction** — `extractClaims()` with regex rules for prices/metrics/percentages
2. **Surgical operations in provider specs** — extend YAML schema, update declarative engine
3. **Attestation planner** — `buildAttestationPlan()` with cost-aware selection + fallback policy
4. **Value verifier** — `verifyAttestedValues()` with per-type tolerance rules
5. **Adapter extension** — `buildSurgicalUrl()` on financial adapters (binance, coingecko, etherscan)
6. **Pipeline wiring** — insert between match and publish in `runPublishAutonomous()`
7. **Multi-attestation call sites** — update `attestAndPublish()`, session-runner, cli/publish
8. **Rate-limit integration** — attestation calls through provider rate-limit buckets

## Decisions (2026-03-21)

1. **Claim extraction: rules first, LLM fallback.** Regex/pattern rules extract prices and metrics. LLM only when rules produce 0 claims. New code required — matcher.ts bag-of-terms is insufficient.
2. **Priority: next workstream.** Start immediately. Ahead of Tier 1 reputation plugins.
3. **Surgical endpoints: provider specs (YAML) only.** Not in SourceRecordV2 catalog records. Co-located with adapter logic, consistent with Phase 4 architecture.
4. **Post-attestation value verification: mandatory.** Without it, attesting the right endpoint can still prove the wrong fact.
5. **Fallback policy: surgical → targeted → broad → skip claim.** Never abort a post that passed match gate.
6. **Execution order: sequential.** Avoids provider 429 storms. TLSN is slow anyway.
7. **Cost budget: configurable per agent.** Default: 1 TLSN + 3 DAHR max per post, 15 DEM ceiling.
8. **Multi-attestation bottleneck: 3 call sites** need updating (attestAndPublish, session-runner, cli/publish).

## Open Questions

1. **Cost ceiling for mainnet:** Testnet has no real DEM cost. Mainnet budget TBD based on token economics.
2. **Verification tolerance tuning:** 2% for prices, 5% for metrics — needs calibration against real post-to-attestation latency.

## Success Metrics

- **TLSN coverage increase:** Sources currently marked `tlsn_safe: false` (due to large default responses) become TLSN-attestable via surgical operations
- **Proof linkage:** Every attested data point is explicitly connected to a specific claim in the post text
- **Attestation size reduction:** Average attested response size drops from ~10KB to <1KB for surgical endpoints
- **No score regression:** Quality scores stay the same or improve (DAHR attestation still provides the +40 bonus)
- **Zero wasted attestation cost:** Attestations only execute after match gate passes (Codex #1)
- **Value verification rate:** >95% of numeric claims pass post-attestation verification
