# TLSN & DAHR Attestation — Design, Constraints & Drift Analysis

> Consolidated from deep-dive across `omniweb-agents` (active) and `DEMOS-Work` (archived).
> Created 2026-03-14 as debugging reference for TLSN reliability work.

## The Original Design (from DEMOS-Work)

TLSN works via **MPC-TLS** — the notary participates in the TLS handshake without seeing the plaintext, then co-signs a proof that the response came from the claimed server. The pipeline:

```
Token request → poll for token (30s) → proxy allocation (30s) →
WASM prover init (30s) → session negotiate (30s) → prover setup (45s) →
MPC-TLS request (50-120s) → transcript → notarize/proof (30-60s) → presentation
```

## Hard Constraints

| Constraint | TLSN | DAHR |
|---|---|---|
| **Response size** | **16KB hard limit** (`maxRecvData: 16384`) — WASM prover **crashes** (no graceful error) if exceeded | No limit |
| **Response format** | JSON required | JSON required (XML/RSS/HTML **rejected**) |
| **Protocol** | HTTPS only | HTTP or HTTPS |
| **Authentication** | None (public APIs only) | None (public APIs only) |
| **Total time** | 50-180s+ (MPC-TLS dominates) | <2s |
| **Cost** | 1 + ceil(proofSizeKB) DEM (~12 avg) | ~1 DEM |
| **Notary URL** | `ws://` from node → must convert to `http://` | N/A |

## Why TLSN Mostly Fails Now

### Verified by Diagnostic (2026-03-14)

Systematic testing with `tools/tlsn-diagnose.ts` confirmed:

| Component | Status | Timing |
|---|---|---|
| Notary info (`tlsnotary.getInfo`) | OK | 0.3s |
| Notary HTTP reachability | OK (200) | 0.2s |
| Token request + broadcast | OK | 5-10s |
| Token poll | OK | 0.5-1.4s |
| Proxy allocation | OK | 1.2-3.5s |
| **MPC-TLS (Playwright bridge)** | **TIMEOUT** | **>300s (5 min not enough)** |
| Node bridge WASM init | **HANGS** | Never completes (non-functional) |

**It's infrastructure, not code.** The notary responds to HTTP and WebSocket info queries instantly. Token/proxy allocation is fast (7-14s total). The failure is specifically in the MPC-TLS protocol phase — the WASM prover connects to the notary via WebSocket proxy but the cryptographic handshake never completes, even with a 5-minute timeout.

**Timeline of timeout tuning:**
- Original: 120s → too tight (sessions ~15 took exactly 120s)
- Bumped: 180s → still too tight (sessions ~15 took exactly 180s)
- Bumped: 300s (5 min) → **still fails** → confirms infrastructure issue, not timeout

**Node bridge:** Never functional — hangs at WASM init. Codex built it speculatively. Playwright bridge is the only production path.

**Proxy ports:** Dynamically assigned (55003, 55008 observed), not limited to documented 55001/55002.

### Key Gotchas

1. **`hitsPerPage=2` guardrail** for HN Algolia — 5+ hits = >16KB = WASM crash
2. **`startProxy()` IS the complete DAHR operation** — no `stopProxy()` exists
3. **DAHR rejects XML/RSS** — arXiv, PubMed will fail (they return XML)
4. **Token polling** takes up to 60s before MPC-TLS even starts
5. **Proof size varies** 8.7KB–34.1KB depending on response content

## What Drift Happened

The diagnostic scripts (`tlsn-debug.ts`, `tlsn-diagnose.ts`, `tlsn-attest.ts`, `dahr-inspect.ts`, `test-dahr-sources.ts`) stayed in DEMOS-Work when it was archived. The implementation moved to omniweb-agents but the **testing/diagnostic tooling didn't follow**. Now ported: `tools/tlsn-diagnose.ts` provides step-by-step pipeline testing with timing.

The bridge code is correct — timeouts are generous (5 min), guardrails are in place. The failure is purely the Demos notary node MPC-TLS infrastructure.

## Performance Difference

TLSN outperforms DAHR when it works: **12.4 avg reactions (score 96) vs 9.0 avg reactions (score 90)** — +38% engagement. This makes TLSN worth pursuing despite infrastructure issues.

## TLSN Pipeline Detail

### Step 1: Token Request (`tlsn-playwright-bridge.ts:122-183`)
- Create `tlsn_request` tx with target URL
- Sign + confirm + broadcast
- Poll node for token ID (30 attempts × 1000ms = 30s max)
- Request proxy URL from node (30 attempts × 1000ms = 30s max)
- Returns: `proxyUrl`, `tokenId`, `requestTxHash`

### Step 2: Notary Discovery (`tlsn-playwright-bridge.ts:384-389`)
- Call `tlsnotary.getInfo` to get notary URL
- **Convert `ws://` → `http://`** (critical — Prover expects HTTP)

### Step 3: Browser Attestation via Playwright (`tlsn-playwright-bridge.ts:259-370`)
- Launch headless Chromium with COOP/COEP headers (required for SharedArrayBuffer/WASM threading)
- Navigate to TLSN bridge HTML page
- Page evaluate runs WASM prover in browser:
  - Initialize tlsn-js (30s timeout)
  - Create Prover with `maxSentData`/`maxRecvData` = 16KB
  - Request session from NotaryServer (30s timeout)
  - Prover setup (45s timeout)
  - Send attested request via proxy (90s timeout) — **MPC-TLS happens here**
  - Get transcript of sent/recv bytes
  - Notarize (generate proof) — 180s timeout (**this is where timeouts occur**)
  - Create Presentation with reveal ranges
  - Return JSON presentation

### Step 4: Proof Storage (`tlsn-playwright-bridge.ts:185-203`)
- Calculate storage fee = 1 + ceil(proofSize / 1024) DEM
- Create `tlsn_store` tx with proof
- Broadcast
- Returns: `proofTxHash`, `storageFee`

### Timing Breakdown (Empirical)

| Step | Typical | Timeout | Notes |
|---|---|---|---|
| Token polling | 5-30s | 30s | Usually fast |
| Proxy allocation | 5-30s | 30s | Usually fast |
| WASM init | ~30s | 30s | One-time per browser session |
| MPC setup | ~30s | 30s | Session negotiate with notary |
| Prover setup | ~45s | 45s | - |
| **MPC-TLS request** | **50-120s** | 90s | **Primary bottleneck** |
| **Proof generation** | **30-60s** | 180s | **Secondary bottleneck** |
| Presentation | ~5s | 30s | - |
| **Total** | **~150-300s** | - | Often exceeds 180s |

### Proof Sizes & Costs

| Response Type | Proof Size | Cost (DEM) |
|---|---|---|
| Simple API (block height) | 8.7KB | 9 |
| Medium API (price data) | ~16KB | 17 |
| Large API (market data) | 34.1KB | 35 |
| **Average** | - | **~12** |

## DAHR Pipeline Detail

### Single Operation (`publish-pipeline.ts`)

```typescript
const result = await dahr.startProxy({ url, method: "GET" });
// Returns: { data, responseHash, txHash, statusCode }
// That's it. There is NO stopProxy(). This IS the complete operation.
```

### Response Validation Guards

1. **HTTP status check** — rejects non-2xx (401/403/429)
2. **XML/HTML detection** — `response.trim().startsWith("<")` → reject
3. **JSON parse** — string responses must parse as JSON
4. **Error body detection** — checks fields (`error`, `message`, `detail`) for keywords: "unauthorized", "forbidden", "rate limit", "api key", "authentication", "access denied"

### Compatible APIs (Verified in DEMOS-Work)

**Works:** GitHub, CoinGecko, DefiLlama, PyPI, HackerNews (Firebase), HN Algolia, Reddit (`/top.json`), Etherscan, Blockchain.info, CryptoCompare, Wikipedia REST, Blockstream

**Fails:** arXiv (XML), PubMed (XML), RSS feeds, HTML pages, authenticated APIs

## Source Safety Classification

A source is **TLSN-safe** if: HTTPS + JSON + public + response < 16KB + deterministic

A source is **DAHR-safe** if: HTTP(S) + JSON + public

Both flags are set manually in source records. The attestation plan (`resolveAttestationPlan()`) decides method per topic. Most topics are `tlsn_preferred` with `DAHR` fallback — which currently means everything falls back to DAHR due to infrastructure timeouts.

## Source Discovery Constraints (for external systems)

For any external content/source discovery system feeding into omniweb-agents:

1. **Sources must be JSON APIs** (not RSS/XML/HTML) for both TLSN and DAHR
2. **TLSN sources must respond under 16KB** — small, focused API endpoints preferred
3. **No authentication** — only public APIs qualify
4. **Response must be deterministic** enough to produce meaningful proof
5. **DAHR has no size limit** but still needs JSON format
6. **URL templates work** — `{asset}`, `{symbol}` placeholders resolved at runtime

## Implementation Files

| File | Role |
|---|---|
| `tools/lib/tlsn-playwright-bridge.ts` | **Production** TLSN bridge (Chromium + WASM) |
| `tools/lib/tlsn-node-bridge.ts` | **Experimental** TLSN bridge (Node.js Worker) |
| `tools/lib/publish-pipeline.ts` | Attestation orchestrator (DAHR + TLSN) + publish |
| `tools/lib/attestation-policy.ts` | Plan resolution, source compatibility, URL helpers |
| `tools/lib/sources/policy.ts` | V2 preflight + source selection (catalog index) |
| `tools/lib/sources/matcher.ts` | Post-generation source matching |

## Diagnostic Scripts (Archived — DEMOS-Work)

| File | Purpose |
|---|---|
| `~/projects/DEMOS-Work/src/tlsn-debug.ts` | Full TLSN flow with verbose logging |
| `~/projects/DEMOS-Work/src/tlsn-diagnose.ts` | Notary connectivity + token test |
| `~/projects/DEMOS-Work/src/tlsn-attest.ts` | Complete pipeline test with timing |
| `~/projects/DEMOS-Work/src/dahr-inspect.ts` | DAHR object method introspection |
| `~/projects/DEMOS-Work/src/test-dahr-sources.ts` | 19-source DAHR compatibility test |

**Note:** These scripts stayed in DEMOS-Work when it was archived. Consider porting `tlsn-diagnose.ts` and `test-dahr-sources.ts` to omniweb-agents for active debugging.

## Notary Infrastructure

- **Notary ports:** 7047, 55001, 55002 on `node2.demos.sh` — all OPEN
- **Primary RPC:** `demosnode.discus.sh`, backup: `node2.demos.sh`
- **Faucet:** `faucetbackend.demos.sh`
- **Current status:** MPC-TLS consistently >180s (infrastructure issue, not code)
