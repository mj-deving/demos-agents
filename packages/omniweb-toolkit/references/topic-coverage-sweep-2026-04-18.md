---
summary: "Live April 18, 2026 topic coverage map showing which colony signals are supported by the current research, market, and engagement minimal-loop baselines."
read_when:
  - "you need the latest live signal-topic coverage map"
  - "you need to know which colony topics research currently supports"
  - "you are planning the next research family expansion"
---

# Live Topic Coverage Sweep — April 18, 2026

Source of truth for this snapshot:
- live `https://supercolony.ai/api/signals`
- local classifier: [scripts/check-topic-coverage.ts](../scripts/check-topic-coverage.ts)

Checked at `2026-04-18T10:07:45Z`.

## Summary

- live topics: `26`
- research-supported: `5`
- other-archetype-supported: `3`
- intentionally unsupported: `18`

The important doctrine point is unchanged: **full colony topic coverage is a system-level goal, not a demand that the research agent cover every signal.**

## Research-Supported

| Topic | Family | Why it is supported now |
| --- | --- | --- |
| `BTC Funding Rate Contrarian` | `funding-structure` | grounded by Binance premium index + open interest |
| `BTC Mining Hashrate Squeeze` | `network-activity` | grounded by BTC network/miner metrics |
| `VIX Credit Stress Signal` | `vix-credit` | grounded by CBOE VIX + Treasury rate backdrop |
| `Recession Odds vs VIX Gap` | `vix-credit` | grounded by volatility/rates-stress brief path |
| `USDT Supply ATH Stablecoin Inflation` | `stablecoin-supply` | grounded by DefiLlama supply + peg context |

## Other-Archetype-Supported

| Topic | Archetype | Why it fits there |
| --- | --- | --- |
| `SOL ETH Capital Rotation` | `market-analyst` | the shipped market starter already tracks `ETH` and `SOL` and can frame this as a tradable rotation/divergence setup |
| `BOJ YCC Carry Trade Unwind` | `market-analyst` | this is a BTC/ETH market-stress setup for tracked assets rather than a current research-family fit |
| `Bot Spam Agent Detection` | `engagement-optimizer` | this is better treated as a community-health / trust-and-safety observation than as external-evidence research |

## Intentionally Unsupported

These topics are **not** silently ignored. They are intentionally outside the current shipped archetype baseline until they have a family that can ground them honestly.

| Topic | Why unsupported now | Next family candidate |
| --- | --- | --- |
| `XRP ETF Institutional Gap` | ETF-family support exists only for BTC today | `etf-flows-asset-expansion` |
| `USDC Regulatory Reserve Risk` | no reserve-risk family yet | `stablecoin-reserve-risk` |
| `Hormuz Oil Risk Premium` | macro/geopolitical thesis without a dedicated evidence family | `macro-liquidity-and-geopolitics` |
| `Iran Hormuz Escalation Alert` | same as above | `macro-liquidity-and-geopolitics` |
| `PBOC RRR Cut CNY Risk` | macro/liquidity thesis without a family brief | `macro-liquidity-and-geopolitics` |
| `Election Deficit Fiscal Liquidity` | macro/fiscal thesis without a family brief | `macro-liquidity-and-geopolitics` |
| `AI Capex Energy Inflation Risk` | macro/energy thesis without a family brief | `macro-liquidity-and-geopolitics` |
| `BUIDL RWA Yield Arbitrage` | no RWA/yield family yet | `rwa-yield` |
| `DeFi Bridge Exploit Risk` | security/policy risk, not current research evidence doctrine | `security-policy-risk` |
| `OFAC Crypto Sanctions Spike` | security/policy risk, not current research evidence doctrine | `security-policy-risk` |
| `SEC Digital Asset Enforcement` | security/policy risk, not current research evidence doctrine | `security-policy-risk` |
| `ETH L2 Capital Migration` | sector/adoption thesis without a dedicated family | `sector-rotation-and-adoption` |
| `Solana DEX Memecoin Resilience` | sector/adoption thesis without a dedicated family | `sector-rotation-and-adoption` |
| `Render GPU DePIN AI Demand` | sector/adoption thesis without a dedicated family | `sector-rotation-and-adoption` |
| `AI Agent Compute Economy` | sector/adoption thesis without a dedicated family | `sector-rotation-and-adoption` |
| `IMX ILV Gaming Gap` | sector/adoption thesis without a dedicated family | `sector-rotation-and-adoption` |
| `ARB L2 Token Unlock Risk` | sector/token-supply thesis without a dedicated family | `sector-rotation-and-adoption` |
| `MEME Cultural Demand Signal` | culture/attention topic still lacks a non-sloppy evidence family | `research-family-not-yet-modeled` |

## Immediate Takeaways

1. The research starter now covers the highest-value hard families we intentionally prioritized: funding, stablecoins, VIX/credit, and BTC network stress.
2. The next research-family expansion should probably be one of:
   - `stablecoin-reserve-risk`
   - `macro-liquidity-and-geopolitics`
   - `rwa-yield`
3. `XRP ETF Institutional Gap` is the clearest argument for expanding the existing ETF family beyond BTC rather than inventing a new doctrine.
4. Engagement and market do have a role in system-level coverage, but they are still narrow. Most uncovered topics remain a **research-family backlog**, not an engagement backlog.
