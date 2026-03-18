# SDK Exploration Results — Phase 0

> Runtime verification of StorageProgram, DemosWork, and L2PS SDK modules.
> **Date:** 2026-03-18 | **SDK:** @kynesyslabs/demosdk v2.11.2

## Summary

| Module | Import | Offline Ops | Live Network | Status |
|--------|--------|-------------|--------------|--------|
| **StorageProgram** | `@kynesyslabs/demosdk/storage` | 21/21 pass | 3 skipped (need DEMOS_LIVE=1) | **READY** |
| **DemosWork** | `@kynesyslabs/demosdk/demoswork` | 1 pass, 4 skipped | Not tested | **BLOCKED — SDK ESM bug** |
| **L2PS** | `@kynesyslabs/demosdk/l2ps` | 8/10 pass, 2 document limitation | N/A (local crypto) | **PARTIAL — encrypt/decrypt broken in Node** |

## StorageProgram — READY

All offline operations work correctly:

- `deriveStorageAddress()` — deterministic `stor-` prefixed addresses, varies with nonce
- `createStorageProgram()` — valid payloads for JSON and binary
- `writeStorage()`, `readStorage()`, `setField()`, `appendItem()`, `deleteField()` — all produce valid payloads
- `validateSize()` — correctly accepts <1MB, rejects >1MB
- `calculateStorageFee()` — returns bigint, scales with data size, minimum 1 DEM
- ACL helpers — `publicACL()`, `privateACL()`, `restrictedACL()`, `groupACL()`, `blacklistACL()` all work
- `checkPermission()` — correctly grants owner access, denies non-owner on private
- `validateNestingDepth()` — accepts shallow objects

**Import:** Named export from `@kynesyslabs/demosdk/storage`
**Conclusion:** StorageProgram is production-ready for omniweb agents. All payload creation is local (no network), network ops (getByAddress, getByOwner, searchByName) need live testing with `DEMOS_LIVE=1`.

## DemosWork — BLOCKED

**Issue:** ESM directory import bug in SDK packaging.

```
Error: Directory import '.../demoswork/operations/' is not supported
resolving ES modules imported from .../demoswork/operations/baseoperation.js
```

The barrel export at `@kynesyslabs/demosdk/demoswork` re-exports `BaseOperation` from `baseoperation.js`, which uses `from "."` (bare directory import). Node.js ESM mode rejects directory imports — they must be `./index.js`.

**Root cause:** `baseoperation.js` line 1: `import { DemosWorkOperation } from "."` should be `import { DemosWorkOperation } from "./index.js"`.

**Fix required:** KyneSys needs to fix the SDK build. Alternatively, we could patch `node_modules` locally but that's fragile.

**Conclusion:** DemosWork is architecturally sound (types verified in design phase) but unusable at runtime until the SDK is patched. WEAVER agent (workflow orchestration) is blocked on this fix.

## L2PS — PARTIAL

Instance management works perfectly:
- `L2PS.create()` — generates instances with unique SHA-256 IDs
- `getInstance()`, `hasInstance()`, `removeInstance()`, `getInstances()` — all work
- `getKeyFingerprint()` — returns 16-char fingerprint
- `setConfig()`/`getConfig()` — round-trips correctly

**Encryption is broken** in Node.js:
```
TypeError: Cannot read properties of undefined (reading 'from')
at L2PS.encryptTx (l2ps.ts:240)
```

The SDK's L2PS implementation uses browser `Buffer` polyfill that doesn't exist in Node.js's ESM mode. The `encryptTx()`/`decryptTx()` methods fail.

**Fix options:**
1. KyneSys fixes SDK to use `Uint8Array` instead of browser `Buffer`
2. We add a Buffer polyfill (`globalThis.Buffer = require('buffer').Buffer`) before importing L2PS
3. We run L2PS ops in a Playwright browser context (like TLSN)

**Conclusion:** L2PS instance management works. Encryption blocked by Node.js compatibility. SHADE agent (privacy) can use L2PS for identity/config but not for encrypted transactions until the Buffer issue is resolved.

## Impact on Omniweb Architecture

| Agent | Primary SDK Module | Status | Can Proceed? |
|-------|--------------------|--------|-------------|
| **NEXUS** | StorageProgram | READY | **YES** — Phase 1 can start |
| **WEAVER** | DemosWork | BLOCKED | **NO** — wait for SDK fix |
| **SHADE** | L2PS | PARTIAL | **PARTIAL** — identity ops yes, encryption no |

**Recommended next step:** Begin NEXUS implementation (Phase 1-3 from architecture doc) using StorageProgram. Defer WEAVER and SHADE encryption until SDK fixes ship.

## Test Files

- `tests/sdk-exploration-storage.test.ts` — 24 tests (21 pass, 3 skipped/live)
- `tests/sdk-exploration-demoswork.test.ts` — 5 tests (1 pass documenting bug, 4 skipped)
- `tests/sdk-exploration-l2ps.test.ts` — 10 tests (10 pass, 2 documenting limitations)
