# Skill Dojo Integration Research

> Research output from creative + science + council analysis session.
> Basis for future agent architecture planning.
>
> **Date:** 2026-03-19
> **Status:** Research complete. Codex-reviewed. Contract-tested.
> **Note:** Skill Dojo is testnet-only. API/skills may change before mainnet. Treat as directional, not authoritative.

---

## 1. Skill Dojo Inventory (15 Skills, 6 Categories, 11 Chains)

### API
- **Base URL:** `https://skillsdojo-production.up.railway.app`
- **Endpoints:** `GET /api/skills`, `GET /api/skills/{id}`, `POST /api/execute`, `GET /api/agent-spec`
- **Rate Limit:** 5 req/hr per IP on `/api/execute`. **All agents share one egress IP = 5 req/hr total budget.**
- **Response envelope:** `{ ok, skillId, executionTimeMs, result: { status, message, data, timestamp } }`

### Attestation Proof Fields (contract-tested 2026-03-19)

Skills return attestation proof data, but the shape varies per skill:

**defi-agent** — `result.data.dahrAttestation`:
```json
{
  "attested": true,
  "api": "Binance order book (api.binance.com/api/v3/depth)",
  "responseHash": "86307d3d6b2cf4739a21...",
  "txHash": "acbd52d439bf46e9e5ef...",
  "explorerUrl": "https://explorer.demos.sh/tx/acbd52..."
}
```

**prediction-market-agent** — `result.data.demosAttestation.proofs`:
```json
{
  "polymarket": {
    "responseHash": "5d87e7be9f79a846...",
    "source": "gamma-api.polymarket.com",
    "marketsAttested": 16,
    "explorerUrl": "https://explorer.demos.sh/block/1887365"
  },
  "kalshi": {
    "responseHash": "736a184a45dbc1f2...",
    "marketsAttested": 0,
    "explorerUrl": "https://explorer.demos.sh/block/1887365"
  }
}
```

**Implication:** Typed skill adapters with proof normalization are required — a bare `POST /execute` wrapper is not enough. Each adapter must extract proof fields into a common `{ responseHash, txHash?, explorerUrl, source }` shape.

### Skills by Category

| Category | Skill ID | Description | Chains | Our Agent Match |
|----------|----------|-------------|--------|----------------|
| **monitoring** | `address-monitoring-agent` | Wallet balance/tx patterns via nodeCall | demos, evm, solana, dahr, tlsn | infra-ops, **nexus** |
| **monitoring** | `network-monitor-agent` | Network health, mempool, on-chain events | demos, evm | infra-ops |
| **chain-ops** | `chain-operations-agent` | Unified balance/sign/transfer across 10+ chains | 9 chains | nexus (overlaps sdk.ts) |
| **chain-ops** | `multi-step-operations-agent` | DemosWork batch/conditional/cross-chain workflows | demos, evm, solana, ton | nexus (BLOCKED: ESM bug) |
| **chain-ops** | `solana-operations-agent` | SOL balance/sign/transfer | solana | skip (overlaps sdk.ts) |
| **chain-ops** | `ton-operations-agent` | TON balance/sign/transfer | ton | skip (overlaps sdk.ts) |
| **chain-ops** | `near-operations-agent` | NEAR balance/sign/transfer | near | skip (overlaps sdk.ts) |
| **chain-ops** | `bitcoin-operations-agent` | BTC balance/sign/transfer | bitcoin | skip (overlaps sdk.ts) |
| **chain-ops** | `cosmos-operations-agent` | ATOM balance/sign/transfer | cosmos | skip (overlaps sdk.ts) |
| **defi** | `defi-agent` | Order book (Binance DAHR), liquidity, limit orders, bridge/swap (Rubic) | demos, evm, solana | **defi-markets** |
| **agents** | `prediction-market-agent` | Polymarket/Kalshi DAHR-attested data, conditional bets | demos, evm, dahr | **sentinel, pioneer** |
| **identity** | `identity-agent` | CCI profiles — create/resolve/link wallets | demos, evm, solana | deferred (CCI still TBD in omniweb arch) |
| **identity** | `tlsnotary-attestation-agent` | MPC-TLS cryptographic proofs of HTTPS | demos, tlsn | evaluate vs existing Playwright bridge |
| **identity** | `demos-wallet-agent` | Browser wallet integration, SIWD | demos, evm, solana | skip (browser-only) |
| **setup** | `00-sdk-setup` | SDK connectivity validation | demos, evm, solana | skip (setup-only) |

---

## 2. Creative Analysis: 12 Novel Agent + Skill Combinations

### Tier 1: Highest Value (direct score improvement)

**C1. "DeFi Agent Goes Live"** — `defi-agent` as DataProvider for defi-markets
- Wire `defi-agent` order-book mode as a DataProvider plugin
- Posts contain DAHR-attested Binance data with proof fields (`txHash`, `responseHash`)
- **Contract-tested:** Returns real bid/ask data + on-chain attestation hash
- Compare against existing sources-registry providers, not just keyword skeleton (Codex correction)

**C2. "Pioneer as Algorithmic Contrarian"** — `prediction-market` + `tlsnotary`
- Check Polymarket consensus → hunt for attested counter-evidence → TLSNotary proof
- Posts: "Market says X [DAHR], but [source] shows Y [TLSNotary]"
- Algorithmically generates highest-signal post type

**C3. "Self-Correcting via Market Feedback"** — `prediction-market` for calibration
- Inject market data at `beforeSense` (not `beforePublishDraft`) — reusable across scan, gating, and evaluation (Codex correction)
- Dual-signal calibration: social (reactions) + market (outcomes)
- **Note:** Market probability != predicted_reactions. Hypothesis H2 needs re-specification.

**C4. "Network Immune System"** — `network-monitor` + `tlsnotary` for infra-ops
- infra-ops uses network-monitor data in cron session (not as reactive EventSource — rate limit incompatible)
- TLSNotary attests status page → posts incident report
- Detection → verification → reporting in one session cycle

### Tier 2: High Value (new capabilities, not near-term)

**C5. "Intelligence Cascade"** — Multi-agent data pipeline
- crawler detects whale movement → pioneer frames thesis → defi-markets adds data → sentinel synthesizes
- **Codex caution:** SC-tier agents lack cross-agent orchestration. This requires StorageProgram or external coordination.

**C6. "Executable Intelligence"** — Posts as DemosWork scripts
- nexus queries cross-chain prices → finds arbitrage → publishes WITH the DemosWork script
- **Blocked** on DemosWork ESM bug

**C7. "Address Monitoring as Cron DataProvider"**
- Wire `address-monitoring` as a DataProvider in cron session loop (NOT EventSource — rate limit)
- Track whale wallets, protocol treasuries at session time
- Also bind to nexus for cross-chain wallet monitoring (Codex correction)

**C8. "TLSNotary Source Quality Layer"**
- High-value sources get TLSNotary proofs (not just DAHR)
- **Codex caution:** We already have a TLSN pipeline via Playwright bridge. Evaluate whether Skill Dojo's path is materially better before integrating.

### Tier 3: Future Value (blocked, premature, or infrastructure)

**C9. "Cross-Chain Identity Mesh"** — `identity-agent` for CCI profiles
- **Deferred:** CCI is TBD in omniweb architecture. No concrete score/workflow benefit yet. (Codex correction)

**C10. "Agent Playbooks via DemosWork"** — `multi-step-operations` (blocked)
- Deferred until DemosWork ESM bug is fixed

**C11. "Demos Weather Report"** — Multi-skill synthesis post
- **Codex caution:** Requires 5+ API calls per post. At shared 5 req/hr, this consumes the ENTIRE hourly budget for one post from one agent. Only viable if rate limits increase.

**C12. "Multi-Source Attested Posts"**
- **Codex correction:** Attestation bonus is BINARY (40 points — you have it or you don't). Extra attested sources don't stack in the scoring formula. Value comes from richer content, not more attestation points.

---

## 3. Scientific Hypotheses (Codex-corrected)

| ID | Hypothesis | Metric | Test Design | Status |
|----|-----------|--------|-------------|--------|
| H1 | Skill Dojo DeFi data improves defi-markets scores vs **existing provider path** | Average post score | 10 sessions existing-providers vs 10 with defi-agent DataProvider | **Revised** — baseline is existing sources-registry, not keyword skeleton |
| H2 | Prediction market data improves post **topic selection quality** | Topic relevance score + engagement | Inject market data at beforeSense. Compare topic selection with/without. | **Revised** — original metric (calibration error) was mis-specified: market probability != predicted_reactions |
| H3 | Address-monitoring DataProvider surfaces **3+ novel topics per session** not found via feed scan | Novel topic count | Run 10 sessions with/without address-monitoring in cron loop | **Revised** — was "5x more publishable events" but now cron-only, not EventSource |
| H4 | ~~Multi-source attested posts score 40%+ higher~~ | ~~Post score~~ | ~~10 single vs 10 multi-source~~ | **DROPPED** — attestation is binary. Extra sources don't add score points. |
| H5 | Contrarian + prediction-market posts score higher than average | Reactions | 10 consensus vs 10 contrarian from pioneer. **Increase N from 5 to 10** for statistical power. | **Revised** — doubled sample size |
| H6 | Network-monitor data in cron session enables infra-ops to publish **1+ incident report per week** | Reports published/week | Run infra-ops with network-monitor DataProvider for 4 weeks | **Revised** — was "sub-minute detection" but cron runs every 6h |
| H7 | 5 req/hr shared budget supports **at most 2 agents** calling skills per session | Quota exhaustion events | Profile: simulate 3 agents each needing 2 skill calls per 6h session | **PREREQUISITE** — must run before Wave 1 implementation |

---

## 4. Architecture (Council + Codex Synthesis)

### Integration Pattern
**Thin shared client + typed skill adapters:**

```
src/lib/skill-dojo-client.ts          ~80 lines — HTTP transport + shared rate budget
src/lib/skill-dojo-proof.ts           ~60 lines — Proof normalization (dahrAttestation → common shape)
src/plugins/skill-dojo-defi-provider.ts    — Typed adapter: DataProvider wrapping defi-agent
src/plugins/skill-dojo-prediction-provider.ts — Typed adapter: DataProvider wrapping prediction-market
src/plugins/skill-dojo-monitoring-provider.ts — Typed adapter: DataProvider wrapping network-monitor + address-monitoring
```

**Key design decisions (informed by Codex review):**
- Client handles HTTP + rate budget only. NOT a generic platform.
- Each skill gets a typed adapter with request/response validation and proof normalization.
- Rate budget is a shared persistent counter (extends write-rate-limit pattern). ALL agents deduct from one pool.
- Monitoring skills are cron-only DataProviders, NOT reactive EventSources (5 req/hr kills polling).
- Prediction-market data injected at `beforeSense` hook (not `beforePublishDraft`) for reuse in scan, gating, evaluation.

### Revised Implementation Sequence (Codex-recommended)

| Step | What | Why | Est. |
|------|------|-----|------|
| **0. Contract test** | ~~Done~~ — defi-agent + prediction-market proof fields verified | Resolves biggest unknown | Done |
| **1. H7 rate profiling** | Simulate 3 agents x 2 calls per session against 5 req/hr shared budget | Must know budget feasibility before building | 1 day |
| **2. Shared client** | `skill-dojo-client.ts` + `skill-dojo-proof.ts` | Transport + proof normalization | 1 day |
| **3. Pilot: defi-agent** | `skill-dojo-defi-provider.ts` as DataProvider for defi-markets | One pull-only integration end-to-end | 2 days |
| **4. Measure** | Run 10 defi-markets sessions. Compare scores vs existing providers (H1) | Prove value before expanding | 1 week |
| **5. prediction-market** | `skill-dojo-prediction-provider.ts` + beforeSense hook | Second pull-only integration | 2 days |
| **6. Monitoring** | `skill-dojo-monitoring-provider.ts` for infra-ops cron | Third integration, cron-only | 2 days |
| **Deferred** | identity-agent, tlsnotary (evaluate vs Playwright bridge), multi-step-ops | Premature or blocked | TBD |

### Budget Math (shared 5 req/hr)

With agents running on 6h cron cycles and staggered starts:
- Each cron session needs ~2 skill calls (1 data fetch + maybe 1 monitoring)
- 5 req/hr = 30 req in a 6h window
- With 3 active agents each needing 2 calls = 6 calls per cycle
- **Feasible for cron.** But leaves no headroom for reactive use or retries.
- H7 should validate this math empirically.

---

## 5. Agent-to-Skill Binding Map (Revised)

| Agent | Pilot Skills | Later Skills | Rationale |
|-------|-------------|--------------|-----------|
| **defi-markets** | `defi-agent` (order-book, liquidity) | — | **First pilot.** Fills empty data pipeline with DAHR-attested Binance data. |
| **sentinel** | `prediction-market` (compare-markets) | — | Calibration oracle via beforeSense hook. |
| **pioneer** | `prediction-market` (compare-markets) | — | Contrarian thesis fuel — market consensus as foil. |
| **infra-ops** | `network-monitor`, `address-monitoring` | — | Cron-only DataProviders for chain health + wallet patterns. |
| **nexus** | `address-monitoring` | `multi-step-ops` (post-ESM-fix) | Cross-chain wallet monitoring. Address-monitoring is as natural for nexus as infra-ops. |
| **crawler** | — | Evaluate `tlsnotary-attestation` vs existing Playwright bridge | Only if Skill Dojo path is materially better. |

---

## 6. Key Risks (Updated)

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Shared 5 req/hr exhaustion** | **High** | Centralized rate budget. H7 profiling as prerequisite. Stagger agent cron times. |
| Skill Dojo API changes on mainnet | High | Typed adapters isolate skill-specific changes. Client handles transport. |
| Proof field shapes vary per skill | Medium | `skill-dojo-proof.ts` normalizes to common shape. Contract-test each new skill. |
| Scoring ROI overstated (attestation is binary) | Medium | Measure actual score improvement (H1) before expanding. |
| `tlsnotary-attestation` duplicates Playwright bridge | Medium | Evaluate before integrating. Skip if no material improvement. |
| `identity-agent` CCI rollout premature | Medium | Deferred until concrete score/workflow benefit demonstrated. |
| Testnet data != mainnet data quality | Medium | Instrument everything, don't hardcode thresholds. |
| DemosWork ESM bug persists | Low (accepted) | Deferred to Wave 3+, not blocking. |

---

## 7. Next Actions (Revised)

1. **Run H7 rate profiling** — simulate 3 agents x 2 calls per 6h against shared 5 req/hr budget
2. **Build `skill-dojo-client.ts` + `skill-dojo-proof.ts`** — shared transport + proof normalization
3. **Pilot `defi-agent` DataProvider** for defi-markets — end-to-end with proof extraction
4. **Measure H1** — 10 sessions comparing defi-agent vs existing source-registry providers
5. **If H1 positive:** Expand to prediction-market (sentinel/pioneer) and monitoring (infra-ops)
6. **If H1 negative:** Re-evaluate whether Skill Dojo adds value over direct DAHR attestation

---

## Appendix: Codex Review Summary (2026-03-19)

### High Findings (resolved)
1. **Proof fields unknown** → **Resolved:** Contract-tested. Both defi-agent and prediction-market return `responseHash`, `txHash`/`explorerUrl`. Shapes differ per skill → need typed adapters.
2. **Rate limit kills reactive EventSources** → **Resolved:** Monitoring skills redesigned as cron-only DataProviders.
3. **Scoring ROI overstated** → **Resolved:** Attestation is binary (40pts). H4/C12 dropped. H1 baseline corrected to existing providers.

### Medium Findings (incorporated)
4. `address-monitoring` also binds to nexus (not just infra-ops)
5. `prediction-market` hook moved to `beforeSense` (not `beforePublishDraft`)
6. `identity-agent` deferred (CCI premature)
7. `tlsnotary-attestation` evaluate vs existing Playwright bridge before integrating
8. Thin client needs typed adapters + proof normalization layer
9. H2/H3/H5/H6 experimental designs tightened
10. C5/C11/C12 have hidden dependencies — noted as non-near-term
