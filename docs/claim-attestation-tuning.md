# Claim-Driven Attestation — Tuning Task

> **Status:** Open
> **Priority:** High — T0 (source expansion) is a prerequisite for reliable attestation
> **Depends on:** Phases 1-4 complete (shipped 2026-03-21)

## Problem

Claim-driven attestation is wired but rarely fires in practice. Session 38 live test showed the fallback path activating because:

1. **Posts lack numeric claims** — LLM-generated posts about "block production" or "network activity" contain no `$` amounts or `%` values, so `extractStructuredClaimsAuto` returns `[]`.
2. **No Binance sources in catalog** — only CoinGecko has price sources. Binance YAML spec has `claimTypes` but no catalog entries exist for it.
3. **Topic-source mismatch** — the planner searches all sourceView sources, but the matched source may be a different provider than the ones with `claimTypes`.

## Tasks

### T0: Source registry expansion — 100-200 high-value sources (HIGH PRIORITY)

**Goal:** Eliminate "no good matching source" as a failure mode. The catalog currently has 74 active sources — too sparse for reliable attestation across all topics the agents publish on.

**Target:** 200-300 active sources covering every domain the agents touch, with redundancy (2-3 providers per domain).

**Domain coverage targets:**

| Domain | Current sources | Target | Key APIs to add |
|--------|----------------|--------|-----------------|
| **Crypto prices** | CoinGecko (1) | 5+ | Binance, Kraken, CoinMarketCap, CryptoCompare, Coinbase |
| **DeFi/TVL** | DefiLlama (1) | 4+ | DefiLlama protocols, DeFi Pulse, L2Beat, Dune |
| **On-chain data** | Blockstream, Mempool (2) | 6+ | Glassnode, Etherscan (more ops), Blockchain.com, Solscan |
| **Macro/economics** | FRED (1) | 5+ | BLS, Census, Treasury, BEA, ECB |
| **Gas/fees** | Etherscan (1) | 3+ | Blocknative, Ultrasound.money, L2fees.info |
| **DEX/trading** | DEXScreener (1) | 4+ | Uniswap subgraph, 1inch, Jupiter, Raydium |
| **NFTs/gaming** | None | 3+ | OpenSea, Magic Eden, Blur |
| **Stablecoins** | DefiLlama stablecoins (0 active) | 3+ | DefiLlama stablecoins, Circle USDC reserves, Tether transparency |
| **News/events** | HN, Reddit (2) | 5+ | CoinDesk API, The Block, Decrypt, CoinTelegraph RSS |
| **Governance** | None | 3+ | Snapshot, Tally, DeepDAO |
| **Derivatives** | Deribit, Polymarket (2) | 4+ | CME futures (via FRED), Binance futures, Coinalyze |
| **Network health** | Blockstream (1) | 3+ | Ethernodes, Solana Beach, Chainlist |

**Approach:**
1. Research free/no-auth JSON APIs per domain (avoid APIs requiring paid keys initially)
2. For each API: create catalog entry with correct `adapter.operation`, `provider`, response format, size estimates
3. Write YAML specs for new providers not yet in `specs/` directory
4. Add `claimTypes` + `extractionPath` to every price/metric-returning spec
5. Run health checks (`npx tsx cli/scan-feed.ts`) to verify sources respond
6. Batch in groups of 20-30 per session to avoid catalog bloat from untested sources

**Key constraint:** Every source must be free-tier or no-auth. Paid APIs can be added later when we know which domains need them.

### T1: Add Binance sources to catalog
Add `binance-ticker-price` as an active source in `config/sources/catalog.json` with `adapter.operation: "ticker-price"`, scoped to sentinel/crawler. This gives the planner a second price provider alongside CoinGecko.

### T2: LLM prompt nudge for verifiable claims
The LLM post generation prompt (`src/actions/llm.ts`) doesn't encourage including specific data points. A small nudge — "include specific prices, metrics, or data points when available from source data" — would increase the rate of extractable claims without changing post quality.

### T3: Add `claimTypes: [metric]` to more specs
Current coverage: 8/26 specs. Good candidates for `metric` type:
- `fred.yaml` — economic indicators (GDP, CPI, unemployment)
- `worldbank.yaml` — development indicators
- `usgs.yaml` — earthquake magnitude
- `nasa.yaml` — asteroid close approach distance

### T4: Log claim extraction stats
Add `observe("insight", ...)` when claims ARE extracted (even if planner returns null) so we can see extraction hit rate in session review without a code change.

### T5: Expand `claimTypes` to `event` and `statistic`
Currently only `price` and `metric` are used in YAML specs. `event` type could match HN/Reddit sources for event claims ("X launched Y", "Z acquired W"). Lower priority since event verification is string-containment, not numeric.

## Success Criteria

- **T0:** 200+ active sources, every agent topic has at least 2 matching sources
- **T0:** "No matching source" errors drop to <5% of publish attempts
- At least 1 in 3 sessions uses claim-driven attestation (surgical path, not fallback)
- Claim extraction produces >0 claims for >50% of posts
- No increase in publish failures or attestation errors
