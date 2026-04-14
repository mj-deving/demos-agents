# Plan: Chain-First Toolkit Migration

## Context

The omniweb-agents toolkit has 4 tools (scan, verify, tip, react) that depend on the SuperColony web API (supercolony.ai). This is architecturally wrong — SuperColony runs on the Demos blockchain, the web API is just a frontend dashboard. When DNS went down on 2026-03-26, the toolkit broke entirely despite the blockchain being fully operational.

**Principle (from Marius):** No toolkit function or primitive should depend on DNS or API availability. All interactions must go through blockchain nodes and the Demos SDK.

**Goal:** Migrate ALL 4 tools to chain-first. API becomes optional fallback/enrichment, never a dependency. Everything on-chain.

## Current API Dependencies

| Tool | Current | What breaks without API |
|------|---------|------------------------|
| `verify.ts` | Searches /api/feed for txHash | Cannot confirm transactions |
| `tip.ts` | Falls back to /api/feed for author | Author resolution fails |
| `scan.ts` | Reads /api/feed for posts | Cannot discover posts at all |
| `react.ts` | POSTs to /api/react | Cannot react to posts at all |

## SDK Chain Methods Available

| Method | Purpose |
|--------|---------|
| `getTxByHash(hash)` | Get single transaction — replaces verify + tip author |
| `getTransactionHistory(addr, type?, opts?)` | Address-scoped tx history — targeted scan |
| `getTransactions(start?, limit?)` | Global recent transactions — broad scan |
| `getMempool()` | Unconfirmed transactions — verify very recent broadcasts |
| `nodeCall(message, args?)` | Arbitrary RPC calls |

HIVE posts = storage transactions with 4-byte "HIVE" prefix + JSON payload.

## Migration Plan

### Step 1: Connect + Auth + Bridge Infrastructure (PREREQUISITE)

**Files:** `src/toolkit/sdk-bridge.ts`, `src/toolkit/tools/connect.ts`, `src/toolkit/types.ts`

**Codex review finding: auth must move first — chain-first cannot exist until connect() stops requiring API.**

1. `connect.ts`: Remove `DEFAULT_SUPERCOLONY_API`. When no `supercolonyApi` provided, skip `ensureAuth()`, set `AUTH_PENDING_TOKEN`. Chain operations use wallet signatures, not API tokens.
2. `createSdkBridge()`: Make `apiBaseUrl` optional. When undefined, `apiCall()` returns deterministic `{ ok: false, status: 0, data: "API not configured — chain-only mode" }`.
3. Add `ChainTransaction` interface (validated against SDK `Transaction` shape):
   ```typescript
   interface ChainTransaction {
     hash: string;
     from: string;        // content.from
     to: string;          // content.to
     type: string;        // content.type ("storage", "native", etc.)
     data: unknown;       // content.data (HIVE payload for storage txs)
     status: string;
     blockNumber: number;
     timestamp: number;   // content.timestamp
   }
   ```
4. Add **domain-aware** bridge methods (not raw SDK pass-throughs — matches existing pattern):
   - `verifyTransaction(txHash)` → wraps getTxByHash, returns `{confirmed, blockNumber, from}` or null
   - `getHivePosts(limit, opts?)` → wraps getTransactions + HIVE decode, returns `ScanPost[]`
   - `resolvePostAuthor(txHash)` → wraps getTxByHash, extracts `content.from`
   - `publishHiveReaction(target, type)` → HIVE-encoded reaction via store/confirm/broadcast
5. Add `apiAccess` with 3 states: `"none" | "configured" | "authenticated"` (not boolean — Codex review)
6. Define test compatibility matrix: no API / API+pending auth / API+authenticated

### Step 2: verify.ts — getTxByHash replaces feed search

**Files:** `src/toolkit/tools/verify.ts`

Replace `checkConfirmation()`:
```
const tx = await bridge.getTxByHash(txHash)
if (!tx) → confirmed: false (retry)
if (tx.blockNumber > 0 && tx.status confirmed) → confirmed: true, blockHeight
```

Remove: `parseFeedPosts` import, `FEED_LIMIT`, all apiCall usage.
Keep: retry logic with sleep delays (handles propagation delay).
Add: Check `getMempool()` on first attempt for very recent broadcasts (Codex researcher suggestion).

### Step 3: tip.ts — Remove feed fallback

**Files:** `src/toolkit/tools/tip.ts`

Replace two-phase resolution:
```
const tx = await bridge.getTxByHash(opts.txHash)
if (!tx) → err("INVALID_INPUT", "Transaction not found on chain")
recipientAddress = tx.from
```

Remove: `parseFeedPosts` import, `FEED_LIMIT`, `RPC_RESOLUTION_TIMEOUT_MS`, entire feed fallback block.

### Step 4: scan.ts — Paginated chain scan with optional API enrichment

**Files:** `src/toolkit/tools/scan.ts`, NEW: `src/toolkit/tools/hive-decoder.ts`

**Codex review finding: fixed `limit * 3` is a heuristic, not a strategy. Use paginated budgeted loop.**

**Primary path (chain) — paginated:**
```
const MAX_PAGES = 5
const PAGE_SIZE = 100
let posts: ScanPost[] = []
let cursor = "latest"

for (let page = 0; page < MAX_PAGES && posts.length < limit; page++) {
  const txs = await bridge.getRecentTransactions(cursor, PAGE_SIZE)
  if (txs.length === 0) break
  const decoded = txs.map(decodeHiveTransaction).filter(Boolean)
  posts.push(...decoded)
  cursor = /* next page offset */
}
return posts.slice(0, limit)
```

**New hive-decoder.ts:**
- `decodeHiveTransaction(tx: ChainTransaction): ScanPost | null`
- Checks storage type, HIVE prefix, parses JSON payload
- Maps to ScanPost shape

**Codex review finding: reaction counts must be "unknown", not zero.** In chain-only mode:
- `reactions` field becomes `{ agree: undefined, disagree: undefined }` or type changes to `number | undefined`
- `identifyOpportunities()` skips reaction-dependent heuristics when reactions are unknown
- This prevents false "reply" opportunities and eliminated "trending" detection

**Optional API enrichment:** If `bridge.apiAccess === "authenticated"`, merge reaction counts. This is additive.

**Targeted scan deferred:** `getTransactionHistory(address, "storage")` is a future enhancement. Not in this migration — `ScanOptions` doesn't have an `address` field (Codex review: keep scope honest).

### Step 5: react.ts — On-chain HIVE reaction (Marius override)

**Marius directive: Everything on-chain. API only as fallback.** Council recommended indexer-only but the principle is clear — if it's a toolkit operation, it belongs on-chain.

**Primary path (chain):** Publish reaction as HIVE storage transaction:
```json
{ "v": 1, "action": "react", "target": "<txHash>", "type": "agree|disagree" }
```

Add `publishHiveReaction(target, type)` to SdkBridge — reuses store/confirm/broadcast pipeline. Returns `{ txHash }` on success.

**Fallback (API):** If chain broadcast fails and `bridge.apiAccess === "authenticated"`, fall back to API POST. Log warning that reaction is indexer-only.

```
try chain reaction → success: return { txHash, success: true }
catch → if API available, try API fallback → return { success: true }
catch → return err("TX_FAILED", "Reaction failed on both chain and API")
```

## Graceful Degradation Pattern

Every tool follows: `chain operation (primary) → optional API fallback → error`

No exceptions. All 4 tools are chain-first.

## Backward Compatibility

- `supercolonyApi` in ConnectOptions remains optional — users who pass it get API enrichment + reactions
- `apiCall()` stays on SdkBridge, returns deterministic error when no API configured
- `parseFeedPosts` stays exported (used for API enrichment path)
- ScanPost gets `reactionsKnown: boolean` flag. Reactions stay `number` (safe for arithmetic). Consumers check flag before reaction-dependent logic. (Red team: `undefined` would cause silent NaN corruption in 6+ call sites.)

## Test Impact

| File | Change |
|------|--------|
| verify-timers.test.ts | Mock getTxByHash instead of apiCall |
| tip-direct.test.ts | Remove feed fallback tests, test chain-only |
| scan-direct.test.ts | Add paginated chain scan + HIVE decode tests |
| react.test.ts | Test on-chain HIVE reaction via publishHiveReaction + API fallback |
| NEW: hive-decoder.test.ts | Unit tests for HIVE transaction decoding |
| connect-errors.test.ts | Test connect without supercolonyApi (no auth call) |
| NEW: compatibility-matrix.test.ts | 3 states: no-API, API+pending, API+authenticated |

## Verification

1. All existing tests pass after migration
2. New tests cover chain-only paths for all 3 migrated tools
3. `connect()` works with only `rpcUrl` + `walletPath` (no `supercolonyApi`)
4. Toolkit still works WITH API configured (enrichment + reactions)
5. Live smoke test: `npx tsx cli/session-runner.ts --agent sentinel` against `demosnode.discus.sh` with no API

## Session Estimate

| Step | Effort |
|------|--------|
| Step 1: Connect + Auth + Bridge | 1 session |
| Step 2-3: verify + tip | 0.5 session |
| Step 4: scan + hive-decoder | 1 session |
| Step 5: react + tests + verification | 0.5 session |
| **Total** | **~3 sessions** |

## Review Findings

### Council Debate (all 4 positions)
- **Architect:** Reactions indexer-only. Gas cost vs signal value wrong for social signals.
- **Engineer:** Reactions indexer-only. Real DEM cost for zero sovereignty benefit.
- **Researcher:** Reactions ON-CHAIN. Farcaster/Lens/Nostr all put reactions on-chain as signed messages.
- **Security:** Reactions ON-CHAIN. Indexer-only = censorable and fakeable. Integrity gap.
- **Split: 2:2.** Marius tiebreak: **everything on-chain.** Reactions as HIVE storage transactions.

### Codex CLI Review (6 concerns, all addressed)
1. **HIGH — Migration order wrong:** Auth must be Step 1, not Step 6. → Fixed: auth+connect is now Step 1.
2. **HIGH — Reactions inconsistent:** Plan said both pending and decided. → Fixed: explicitly API-gated.
3. **HIGH — Scan scalability:** `limit * 3` is heuristic. → Fixed: paginated budgeted loop with MAX_PAGES.
4. **HIGH — Scan semantics change:** Zero reactions breaks opportunity detection. → Fixed: reactions become `undefined`, heuristics skip when unknown.
5. **MEDIUM — Targeted scan not in contract.** → Fixed: deferred from this migration.
6. **MEDIUM — `hasApiAccess()` too ambiguous.** → Fixed: 3-state enum (none/configured/authenticated).

### Codex Researcher (9 findings)
1. StorageProgram too expensive for reactions → Marius override: on-chain anyway, use lightweight storage not StorageProgram
2. `getTransactionHistory` with type filter → future enhancement for targeted scan
3. Auth dependency on API → addressed in Step 1
4. Verify `getTransactionHistory` type filtering on live nodes → open question
5. `getMempool()` for recent broadcasts → added to Step 2
6. HIVE post decoding needs new decoder (check storage type, HIVE prefix, parse JSON) → hive-decoder.ts
7. `RawTransaction` vs `Transaction` may be different shapes → verify before implementation
8. **Bridge should expose domain-aware methods** (`verifyTransaction`, `getHivePosts`, `resolvePostAuthor`) not raw SDK pass-throughs → adopted in Step 1
9. Scan reaction counts CANNOT come from chain alone (aggregation problem) → use `reactionsKnown` flag

## Red Team Findings (5 attack vectors)

### CRITICAL — Undefined reactions cause silent NaN corruption
`post.reactions.agree + post.reactions.disagree` is used in 6+ call sites without null guards. JS `undefined + undefined = NaN`, which silently poisons all arithmetic comparisons — opportunity detection, tip scoring, topic indexing all break without crashing.

**Files affected:** `scan.ts:52,62`, `tips.ts:163,176`, `feed-filter.ts:280`, `cli/scan-feed.ts:228,391`

**Mitigation:** Do NOT use `number | undefined`. Instead add `reactionsKnown: boolean` flag to ScanPost. When `reactionsKnown: false`, reactions stay `{agree: 0, disagree: 0}` (safe for arithmetic) but `identifyOpportunities()` and downstream consumers check the flag before using reaction-dependent logic.

### CRITICAL — Single RPC node is sole trust anchor for tip funds
Removing the feed API fallback makes `demosnode.discus.sh` the only source for tip recipient resolution. No client-side tx signature verification exists. A compromised node could return a forged `from` address to redirect tips.

**Mitigation:** For tip resolution specifically:
1. Query 2 RPC nodes and compare results (primary + `node2.demos.sh` backup)
2. Or verify the transaction signature client-side using the SDK's `verify()` method
3. At minimum, log a warning when resolving recipients from a single untrusted source

### HIGH — Verify retry budget may be insufficient
`getTxByHash` is binary (found/not-found). The current 18s retry budget (3+5+10) may miss transactions during block propagation.

**Mitigation:** Increase to 30s budget (3+5+10+12). Check `getMempool()` on first attempt for unconfirmed txs.

### HIGH — react.ts must require "authenticated", not just "configured"
The 3-state `apiAccess` model has a gap: `"configured"` means API URL set but auth may have failed. react() sending unauthenticated requests will get 401s.

**Mitigation:** react.ts checks `bridge.apiAccess === "authenticated"`, not `!== "none"`.

### MEDIUM — Mixed mode during multi-session migration
Chain-decoded `author` field may use different address format than API-decoded `author`. Tip routed to wrong address.

**Mitigation:** Ship verify + tip atomically in same session. Add cross-tool consistency test.

## Open Questions

- [ ] Live RPC test: Does `getTransactionHistory(addr, "storage")` filter by type?
- [ ] What % of chain transactions are HIVE posts? (determines scan page efficiency)
- [ ] `RawTransaction` vs `Transaction` — are they interchangeable? Check SDK types
- [ ] Client-side tx signature verification: does SDK expose `verify()` for arbitrary transactions?
- [ ] StoragePayload shape: how does binary HIVE data appear in `content.data`? (Uint8Array? hex string?)
- [ ] Does `getMempool()` work on the Demos public nodes? (some nodes disable it)
