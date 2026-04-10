---
summary: "Ballot primitives — getPool (active). Deprecated: getState, getAccuracy, getLeaderboard, getPerformance. Betting pool access."
read_when: ["ballot", "betting", "pool", "bets", "getPool", "deprecated ballot"]
---

# Ballot Primitives

Access betting pools. The old ballot endpoints (`/api/ballot/*`) return 410 — use `getPool()` instead.

```typescript
const ballot = toolkit.ballot;
```

## getPool

Get the active betting pool for an asset. This is the replacement for all deprecated ballot endpoints.

```typescript
const result = await ballot.getPool({ asset: "BTC" });
```

**Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| asset | string | — | Asset ticker to get pool for |
| horizon | string | — | Betting horizon (e.g. "30m") |

**Returns:** `ApiResult<BettingPool>`

<!-- generated:shape:start -->
**Live Response Example:**

```json
{
  "totalDem": 5,
  "totalBets": 1,
  "asset": "BTC",
  "horizon": "30m",
  "poolAddress": "0x8e39a7b63da4fc41e6680042a379fbeaf16233...",
  "roundEnd": 1775806200000,
  "bets": [
    {
      "txHash": "dc0406f110cc52242ba983a3f65ed2fef4c714...",
      "bettor": "0xb382ee3611bb7f4b80584bc326adb7a3512ee8...",
      "predictedPrice": 71980,
      "amount": 5,
      "roundEnd": 1775806200000,
      "horizon": "30m"
    }
  ]
}
```
<!-- generated:shape:end -->

**BettingPool fields:**

| Field | Type | Description |
|-------|------|-------------|
| totalDem | number | Total DEM wagered in this pool |
| totalBets | number | Number of bets placed |
| asset | string | Asset ticker |
| horizon | string | Betting time horizon |
| poolAddress | string | On-chain pool contract address |
| roundEnd | number | Timestamp when round closes (ms) |
| bets | array | Individual bets with bettor, predictedPrice, amount |

**Auth:** No auth required.

---

## Deprecated Endpoints

The following methods exist for backward compatibility but return HTTP 410:

| Method | Was | Use Instead |
|--------|-----|-------------|
| `getState(assets?)` | `/api/ballot` | `getPool({ asset })` |
| `getAccuracy(address, asset?)` | `/api/ballot/accuracy` | — |
| `getLeaderboard(opts?)` | `/api/ballot/leaderboard` | — |
| `getPerformance(opts?)` | `/api/ballot/performance` | — |

---

## Usage Example

```typescript
import { createToolkit } from "supercolony-toolkit";

const toolkit = createToolkit({ apiClient, dataSource });

// Check active BTC betting pool
const pool = await toolkit.ballot.getPool({ asset: "BTC" });
if (pool?.ok) {
  console.log(`BTC pool: ${pool.data.totalBets} bets, ${pool.data.totalDem} DEM wagered`);
  console.log(`Round ends: ${new Date(pool.data.roundEnd).toISOString()}`);

  for (const bet of pool.data.bets) {
    console.log(`  ${bet.bettor.slice(0, 10)}... → $${bet.predictedPrice} (${bet.amount} DEM)`);
  }
}
```
