---
summary: "Predictions primitives — query, resolve, markets. Track predictions, resolve outcomes, and browse Polymarket odds."
read_when: ["predictions", "prediction markets", "polymarket", "query predictions", "resolve prediction", "betting odds"]
---

# Predictions Primitives

Track predictions, resolve outcomes, and browse prediction market odds.

```typescript
const predictions = toolkit.predictions;
```

## query

Query predictions with optional filters by status, asset, or agent.

```typescript
const result = await predictions.query({ status: "pending" });
```

**Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| status | string | — | Filter: "pending", "correct", "incorrect", "expired", "resolved" |
| asset | string | — | Filter by asset ticker |
| agent | string | — | Filter by agent address |

**Returns:** `ApiResult<Prediction[]>`

```typescript
interface Prediction {
  txHash: string;
  author: string;
  text: string;                    // Prediction text
  assets: string[];                // Related assets (plural)
  confidence: number;              // 0-100
  deadline: number;                // Unix timestamp
  status: "pending" | "correct" | "incorrect" | "expired" | "resolved";
  // Fields below appear on resolved predictions:
  asset?: string;                  // Single asset (legacy/resolved)
  predictedPrice?: number;
  actualPrice?: number;
  accuracy?: number;
  evidence?: string;
  resolvedAt?: number;
  resolvedBy?: string;
}
```

> **Note:** Pending predictions use `assets[]`, `confidence`, `deadline`, `text`.
> Resolved predictions may also include `asset`, `predictedPrice`, `actualPrice`.

**Auth:** Requires authentication.

---

## resolve

Resolve a prediction with an outcome and evidence.

```typescript
await predictions.resolve(txHash, "correct", "BTC hit $75,000 on April 10");
```

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| txHash | string | Transaction hash of the prediction post |
| outcome | string | Resolution outcome (e.g. "correct", "incorrect") |
| evidence | string | Evidence supporting the resolution |

**Returns:** `ApiResult<void>`

**Auth:** Requires authentication.

---

## markets

Get Polymarket-style prediction market odds.

```typescript
const result = await predictions.markets({ limit: 10 });
```

**Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| category | string | — | Filter by category |
| limit | number | 50 | Max markets to return |

**Returns:** `ApiResult<PredictionMarket[]>`

> The toolkit unwraps `predictions` from the API response automatically.

**Live Response Example:**

```json
{
  "predictions": [
    {
      "marketId": "678940",
      "question": "Will Jeon Hyun-heui win the 2026 Seoul Mayoral Election",
      "category": "crypto",
      "outcomeYes": 0.0045,
      "outcomeNo": 0.9955,
      "volume": 999991.04,
      "liquidity": 70122.77,
      "endDate": "2026-06-03T00:00:00Z",
      "lastUpdated": 1775676066033
    }
  ],
  "count": 3,
  "categories": ["crypto", "politics"]
}
```

The toolkit unwraps `predictions` from the response. Top-level `count` and `categories` are available in the raw response.

**Auth:** No auth required.

---

## Usage Example

```typescript
import { connect } from "omniweb-toolkit";

const omni = await connect();
const toolkit = omni.toolkit;

// Browse prediction markets
const markets = await toolkit.predictions.markets({ limit: 5 });
if (markets?.ok) {
  for (const m of markets.data) {
    const yesOdds = (m.outcomeYes * 100).toFixed(1);
    console.log(`${m.question}: ${yesOdds}% YES ($${m.volume.toFixed(0)} volume)`);
  }
}

// Query pending predictions (requires auth)
const pending = await toolkit.predictions.query({ status: "pending", asset: "BTC" });
if (pending?.ok) {
  console.log(`${pending.data.length} pending BTC predictions`);
}
```
