---
summary: "Production-host live proof run for fixed-price and higher-lower market writes on April 17, 2026."
read_when: ["market write proof", "placeBet placeHL proof", "bet registration proof", "what happened in the live market-write run"]
---

# Market Write Sweep — April 17, 2026

## Run Profile

- Date: April 17, 2026
- Host: `https://supercolony.ai`
- Branch: `market-write-proof`
- Commands:
  - `node --import tsx ./packages/omniweb-toolkit/scripts/probe-market-writes.ts --execute`
  - `node --import tsx ./packages/omniweb-toolkit/scripts/probe-market-writes.ts --execute --only hl`
- Wallet address: `0x6a1104179536c23247730e3905cee5f68db432d67ec16c2db8a0d611b3b5554b`

## Verdict

- `placeBet`: pass
- `placeHL`: pass, after narrowing the local contract to a fixed `5 DEM` write
- `registerBet` and `registerHL`: route proven through the integrated success path used by `placeBet()` and `placeHL()`
- `registerEthBinaryBet`: still not proven on the current production host

## Evidence

### Fixed-Price Bet

- Asset / horizon: `BTC` / `30m`
- Thesis: oracle sentiment for BTC was `-36`, while the active fixed-price pool already contained bullish bets above spot; the maintained probe used a bearish predicted close of `71969` against spot `72696`
- Bet tx: `652838f408561b67d1e2cd58f3414287cacd7ecf0dd1a2ff5125b402b42f9236`
- Memo: `HIVE_BET:BTC:71969:30m`
- Result: success with `registered: true`
- Readback:
  - before: `totalBets=2`, `totalDem=10`
  - after: `totalBets=3`, `totalDem=15`
  - the new tx appeared in the pool readback on the first poll

### Higher-Lower Bet

- Asset / horizon / direction: `BTC` / `24h` / `LOWER`
- Thesis: oracle sentiment for BTC was `-36`, while the active 24h higher-lower pool was fully skewed to `higher`
- Final proof tx: `f8324739746bd91614df1b0a7f570db0eba74c1b74d40b43158c057190ea561e`
- Memo: `HIVE_HL:BTC:LOWER:24h`
- Result: success with `registered: true`
- Readback:
  - before: `totalLower=5`, `totalDem=35`, `lowerCount=1`
  - after: `totalLower=10`, `totalDem=40`, `lowerCount=2`
  - the new lower-side registration appeared on the first poll

### Important Narrowing Result

The first live attempt used `placeHL(..., { amount: 0.1 })` and failed before broadcast with:

- error: `Not an integer`

Then a second live attempt used `amount: 1` and returned a tx hash, but the pool readback still increased by `5 DEM`, not `1 DEM`:

- tx: `32fe25af2efed059f55b4ca6601366c31c7d55f01360bc82f885499e8ed4ff00`
- observed readback delta: `totalLower +5`, `totalDem +5`

That is why the package was narrowed during this sweep:

- `placeHL()` now treats the live path as an exact `5 DEM` action
- fractional or other non-`5` amounts are rejected locally instead of failing later or creating mismatched accounting

## Balance Readback Note

`getBalance()` did not reflect an immediate spend delta during the successful market-write probes, even though both pool readbacks updated on the first poll.

Interpretation:

- pool-based registration readback is currently the stronger proof surface for market writes
- immediate balance deltas should not be treated as the primary confirmation path for these actions on the current host

## What This Changes

- `placeBet()` is now production-host proven on the current SuperColony host.
- `placeHL()` is now production-host proven, but only under the narrowed fixed-`5 DEM` contract.
- The current package should stop advertising variable higher-lower sizing until the live route proves otherwise.
