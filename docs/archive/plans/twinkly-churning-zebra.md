# Plan: D402 pay() Wiring + PR1 Core Package Migration

## Context

Two independent tasks to advance the toolkit:
1. **D402 pay()** — the pay tool has full guards (Zod, SSRF, spend cap, idempotency) but throws `"D402 integration pending"` where the actual HTTP 402 challenge/response flow should be. The SDK's D402 module is available at `@kynesyslabs/demosdk/d402/client`.
2. **PR1 migration** — create `packages/core/` with npm workspaces so toolkit can be imported as `@omniweb-agents/core`. No file moves — just re-export barrel.

No file overlap. D402 lands in `src/toolkit/`, then PR1 re-exports it.

---

## Part 1: D402 pay() Full Wiring

### SDK API (verified from node_modules)

```typescript
// @kynesyslabs/demosdk/d402/client
class D402Client {
  constructor(demos: Demos);
  createPayment(requirement: D402PaymentRequirement): Promise<Transaction>;
  settle(payment: Transaction): Promise<D402SettlementResult>;
  handlePaymentRequired(requirement: D402PaymentRequirement, url: string, requestInit?: RequestInit): Promise<Response>;
}

interface D402PaymentRequirement {
  amount: number;      // smallest unit (18 decimals)
  recipient: string;   // payee address
  resourceId: string;  // resource ID
  description?: string;
}

interface D402SettlementResult {
  success: boolean;
  hash: string;        // txHash (payment proof)
  blockNumber?: number;
  message?: string;    // error message if !success
}
```

### Design: Use `createPayment` + `settle` (NOT `handlePaymentRequired`)

`handlePaymentRequired` uses global `fetch` (no SSRF protection on retry), doesn't expose amount for receipt logging, and gives no hook for payee validation. We use the lower-level API.

### New: `payD402` on SdkBridge

**File:** `src/toolkit/sdk-bridge.ts`

```typescript
// Add to SdkBridge interface:
payD402(requirement: D402PaymentRequirement): Promise<D402SettlementResult>;

// Add types (our own copies for testability):
export interface D402PaymentRequirement {
  amount: number;
  recipient: string;
  resourceId: string;
  description?: string;
}

export interface D402SettlementResult {
  success: boolean;
  hash: string;
  blockNumber?: number;
  message?: string;
}
```

Implementation in `createSdkBridge`: lazy-import `D402Client` inside try-catch (matches `connectSdk` pattern for import failure), cache instance, call `createPayment` + `settle`. If D402 import fails, throw `TX_FAILED` with descriptive message.

**Nonce safety:** `D402Client.createPayment()` derives nonce internally. Concurrent `pay()` calls can collide on nonce. Wrap bridge `payD402` in a wallet-scoped mutex. The existing `src/lib/tx-queue.ts` provides `createTxQueue()` with serialized nonce management — use it or implement an equivalent lock in the bridge closure.

### D402 Flow in pay.ts (replaces the throw)

After guards pass (line 68):
1. Make initial HTTP request via `fetch(opts.url, { method, headers, body, redirect: "manual" })` — wrap in try-catch for network errors → `err(NETWORK_ERROR, retryable: true)`. `redirect: "manual"` prevents SSRF bypass via 30x to internal IP.
2. If response is a redirect (30x) → validate `Location` via `validateUrl()` → follow manually or reject
3. **If NOT 402** → return `ok(PayResult)` with response, no receipt
3. **If 402:**
   a. Parse JSON body → validate with internal `D402RequirementSchema` (Zod)
   b. **Payee validation:** if `session.payPolicy.requirePayeeApproval` AND `recipient` not in `trustedPayees` → `err(INVALID_INPUT)`
   c. **Amount guard:** if `requirement.amount > opts.maxSpend` → `err(SPEND_LIMIT)` (defense-in-depth)
   d. Call `bridge.payD402(requirement)` → `D402SettlementResult`
   e. If `!result.success` → `err(TX_FAILED, result.message)`
   f. Retry HTTP with `X-Payment-Proof: <result.hash>` header + `redirect: "manual"` (SSRF: prevent proof leaking via redirect)
   g. If retry redirect (30x) → validate `Location` header against `validateUrl()` before following
   h. If retry NOT 2xx → `err(TX_FAILED)` with txHash in detail — do NOT record receipt (prevents poisoned idempotency cache)
   i. **Only on retry 2xx:** Record `recordPayment(store, wallet, requirement.amount, url)` + `recordPayReceipt(store, wallet, receipt)`
   j. Return `ok(PayResult)` with retry response + receipt

### Internal Zod Schema (not exported)

```typescript
const D402RequirementSchema = z.object({
  amount: z.number().positive().finite(),
  recipient: z.string().min(1),
  resourceId: z.string().min(1),
  description: z.string().optional(),
});
```

### Error Handling

| Failure | Code | Retryable | Detail step |
|---------|------|-----------|-------------|
| 402 body not valid JSON | TX_FAILED | false | parse_requirement |
| 402 body missing fields | TX_FAILED | false | parse_requirement |
| Payee not trusted | INVALID_INPUT | false | payee_validation |
| Amount > maxSpend | SPEND_LIMIT | false | amount_check |
| settle() fails | TX_FAILED | true | settle |
| Retry network error | NETWORK_ERROR | true | retry |
| Retry non-2xx | TX_FAILED | false | retry (txHash in detail) |

### Tests (TDD — write first)

**File:** `tests/toolkit/tools/pay-d402.test.ts` (~11 test cases)

1. Non-402 response → PayResult with no receipt
2. 402 → payment → retry 200 → PayResult with receipt
3. Payee rejected (requirePayeeApproval + untrusted recipient)
4. Payee allowed (requirePayeeApproval false)
5. Amount > maxSpend → SPEND_LIMIT
6. Settlement failure → TX_FAILED
7. Retry returns non-2xx → TX_FAILED with txHash
8. Invalid 402 JSON body → TX_FAILED
9. Missing fields in 402 body → TX_FAILED
10. Receipt recorded after payment
11. recordPayment called (spend cap updated)
12. Initial fetch network error → NETWORK_ERROR (retryable)
13. Retry returns 402 again (payment insufficient) → TX_FAILED with txHash

**Mock strategy:** mock `fetch` via `vi.stubGlobal`, mock bridge `payD402` via session's signingHandle pattern.

**Amount precision note:** D402 uses 18-decimal smallest units. `opts.maxSpend` is in DEM (whole units). The comparison `requirement.amount > opts.maxSpend` must account for this — either convert requirement.amount to DEM or document that maxSpend is in smallest units. Check SDK convention.

**File:** `tests/toolkit/sdk-bridge.test.ts` — extend with `payD402` describe block (3 tests)

### Files Modified (Part 1)

| File | Change |
|------|--------|
| `src/toolkit/sdk-bridge.ts` | Add `D402PaymentRequirement`, `D402SettlementResult` types + `payD402` to interface + implementation |
| `src/toolkit/tools/pay.ts` | Replace throw with full D402 flow |
| `tests/toolkit/tools/pay-d402.test.ts` | **New** — 11 D402-specific test cases |
| `tests/toolkit/sdk-bridge.test.ts` | Add `payD402` test block |

---

## Part 2: PR1 — Core Package Skeleton

### npm Workspaces (not pnpm)

npm is already the package manager. Zero new tooling. `"private": true` already set in root.

### New Files

**`packages/core/package.json`**
```json
{
  "name": "@omniweb-agents/core",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts"
    }
  },
  "peerDependencies": {
    "@kynesyslabs/demosdk": "^2.11.5"
  }
}
```

**`packages/core/tsconfig.json`**
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "rootDir": "../../",
    "outDir": "../../dist/core"
  },
  "include": ["src/**/*.ts"]
}
```

**`packages/core/src/index.ts`**
```typescript
export * from "../../../src/toolkit/index.js";
```

### Root Changes

**`package.json`** — add:
```json
{ "workspaces": ["packages/*"] }
```

**`tsconfig.json`** — add paths:
```json
{
  "compilerOptions": {
    "paths": {
      "@omniweb-agents/core": ["./packages/core/src/index.ts"]
    }
  }
}
```

**`vitest.config.ts`** — add resolve alias:
```typescript
resolve: {
  alias: {
    "@omniweb-agents/core": "./packages/core/src/index.ts",
  },
},
```

### Tests (TDD)

**File:** `tests/toolkit/core-package.test.ts` (~5 tests)

1. Re-exports `connect` function
2. Re-exports `DemosSession` class
3. Re-exports `pay` function
4. Re-exports `ok`, `err`, `demosError` helpers
5. Re-exports `FileStateStore`

### Files Modified (Part 2)

| File | Change |
|------|--------|
| `packages/core/package.json` | **New** |
| `packages/core/tsconfig.json` | **New** |
| `packages/core/src/index.ts` | **New** — re-export barrel |
| `tests/toolkit/core-package.test.ts` | **New** — workspace resolution tests |
| `package.json` | Add `"workspaces"` |
| `tsconfig.json` | Add `paths` alias |
| `vitest.config.ts` | Add `resolve.alias` |

---

## Implementation Sequence

### Part 1 (D402)
1. Write `tests/toolkit/tools/pay-d402.test.ts` (red)
2. Add types + `payD402` to `src/toolkit/sdk-bridge.ts`
3. Extend `tests/toolkit/sdk-bridge.test.ts`
4. Replace throw in `src/toolkit/tools/pay.ts` with D402 flow
5. Run tests → green
6. `npm test` → full suite green

### Part 2 (PR1)
7. Write `tests/toolkit/core-package.test.ts` (red)
8. Create `packages/core/` structure
9. Add workspaces to `package.json`
10. Add paths to `tsconfig.json` + `vitest.config.ts`
11. `npm install` (regenerate lockfile)
12. Run tests → green
13. `npm test` → full suite green

### Review + Commit
14. `/simplify` on changed files
15. Fabric `review_code` native + Codex commit review (parallel)
16. Fix all findings
17. Commit + push (two commits: one per task)

## Design Review Findings (incorporated)

| # | Severity | Finding | Source | Resolution |
|---|----------|---------|--------|------------|
| 1 | **Critical** | Receipt recorded before retry — poisoned idempotency if retry fails (caller loses funds, gets fake 200 next call) | Codex | **Fixed:** receipt only recorded after successful 2xx retry. Flow step reordered. |
| 2 | **High** | Redirect SSRF bypass — `fetch` follows 30x, leaking `X-Payment-Proof` to internal IP | Codex | **Fixed:** `redirect: "manual"` on both initial + retry fetch. Validate `Location` before following. |
| 3 | **High** | Concurrent pay() nonce collision — D402Client.createPayment() derives nonce internally | Codex | **Fixed:** wrap bridge payD402 in wallet-scoped tx-queue mutex (reuse `src/lib/tx-queue.ts`). |
| 4 | Medium | Workspace alias tests give false confidence — don't prove npm resolution works | Codex | Acknowledged: add `npm install` verification step + test that import resolves via actual workspace, not just alias. |
| 5 | Medium | D402Client lazy import needs try-catch for SDK version mismatch | Fabric | Added to bridge implementation note |
| 6 | Medium | Initial fetch needs network error handling before 402 check | Fabric | Added try-catch + NETWORK_ERROR to flow |
| 7 | Medium | Amount precision: D402 uses 18 decimals, maxSpend is DEM whole units | Fabric | Check SDK convention during implementation |
| 8 | Low | Re-export barrel uses deep relative path | Fabric | Acceptable for PR1, replaced in PR2 |

### Additional Tests from Codex Review

- Concurrency test: two simultaneous `pay()` calls → exactly one settlement
- Recovery test: `settle()` ok, retry fails → next `pay()` must NOT return cached fake success
- Redirect tests: initial and retry requests reject cross-origin/private-IP redirects
- Retry 402 test: distinct from generic non-2xx (payment accepted but insufficient)
- Workspace: verify via actual `npm install` resolution, not just vitest alias

## Verification

```bash
# Part 1: D402 tests
npx vitest run tests/toolkit/tools/pay-d402.test.ts
npx vitest run tests/toolkit/sdk-bridge.test.ts

# Part 2: Package resolution
npx vitest run tests/toolkit/core-package.test.ts

# Full suite
npm test
```
