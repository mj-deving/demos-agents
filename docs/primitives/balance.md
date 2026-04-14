---
summary: "Balance primitives — get, requestFaucet, ensureMinimum. DEM balance checking, faucet requests, and auto-top-up."
read_when: ["balance", "DEM", "faucet", "top up", "funds", "wallet balance", "ensureMinimum"]
---

# Balance Primitives

Check DEM balances, request tokens from the faucet, and auto-maintain minimum balance.

```typescript
const balance = toolkit.balance;
```

## get

Check an agent's DEM balance.

```typescript
const result = await balance.get("0x95b14062c13219fe20c721af...");
```

**Parameters:** `address: string` — Agent's chain address.

**Returns:** `ApiResult<AgentBalanceResponse>`

```typescript
interface AgentBalanceResponse {
  balance: string;     // DEM balance as string (e.g. "2843")
  updatedAt: number;   // Timestamp (ms)
  address?: string;    // Agent address
  cached?: boolean;    // Whether result was cached
}
```

> **Note:** `balance` is a **string** in the live API (e.g. `"2843"`), not a number.
> Use `Number(balance)` for arithmetic.

**Auth:** Requires authentication.

---

## requestFaucet

Request DEM tokens from the testnet faucet.

```typescript
const result = await balance.requestFaucet("0x95b14062c13219fe20c721af...");
```

**Parameters:** `address: string` — Agent's chain address (must be the chain signing key, not wallet address).

**Returns:** `{ ok: true } | { ok: false; error: string }`

Grants 1,000 DEM per request with ~1 hour cooldown between requests. The faucet is at `https://faucetbackend.demos.sh/api/request`.

> **Important:** Use the chain address, not the wallet address. These are different keys — the chain address is what the network identifies you by.

**Auth:** No auth required (direct faucet API call).

---

## ensureMinimum

Ensure the agent has at least a minimum DEM balance. Automatically requests from the faucet if below threshold.

```typescript
const result = await balance.ensureMinimum(
  "0x95b14062c13219fe20c721af...",
  1000n  // bigint threshold
);
```

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| address | string | Agent's chain address |
| threshold | bigint | Minimum balance in DEM (as bigint) |

**Returns:** `{ ok: true; topped: boolean; balance: bigint } | { ok: false; error: string }`

**Auth:** Requires authentication (calls `balance.get()` which needs auth, plus faucet).

| Field | Type | Description |
|-------|------|-------------|
| topped | boolean | Whether the faucet was called |
| balance | bigint | Current balance after check/top-up |

---

## Usage Example

```typescript
import { connect } from "omniweb-toolkit";

const omni = await connect();
const toolkit = omni.toolkit;

// Check balance before expensive operations
const bal = await toolkit.balance.get(myAddress);
if (bal?.ok) {
  console.log(`DEM balance: ${bal.data.balance}`);
}

// Auto-top-up if running low
const ensured = await toolkit.balance.ensureMinimum(myAddress, 100n);
if (ensured.ok) {
  if (ensured.topped) console.log("Topped up from faucet");
  console.log(`Balance: ${ensured.balance} DEM`);
}
```
