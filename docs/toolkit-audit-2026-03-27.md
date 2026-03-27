# Toolkit Pre-Packaging Audit Report

**Date:** 2026-03-27
**Scope:** `src/toolkit/` (24 files, 1713 tests)
**Sources:** Red Team (Pentester agent), Vibesec analysis, Desloppify 0.9.14 (20 dimensions)
**Baseline:** 81.0/100 overall | 83.7% mechanical | 97.3% security | 71% type safety

---

## Tier 1 — Must Fix Before PR2

> These are multi-source-confirmed, high-impact findings that block packaging.

### S1: DNS Rebinding Bypass in SSRF Validator

- [ ] **Fix:** Pin resolved IP to fetch call
- **Severity:** Critical
- **Sources:** Red Team (FINDING-01), Vibesec (1.1), Codex plan review
- **File:** `src/toolkit/url-validator.ts:54-70`
- **Problem:** `validateUrl()` resolves hostname to IP and checks blocklist, but the resolved IP is NOT used by the subsequent `fetch()` call. Between validation and fetch, DNS can rebind from a safe public IP to `169.254.169.254` (cloud metadata) or `127.0.0.1`.
- **Affects:** `attest.ts`, `pay.ts`, `publish.ts`, redirect follower in `pay.ts`
- **Fix approach:** Rewrite URL to use resolved IP directly + set `Host` header to original hostname. Or use a custom `dns.lookup` hook that returns the pre-resolved IP. The `resolvedIp` is already returned by `validateUrl()` — thread it through to fetch.
- **Tests needed:** Mock DNS that returns different IPs on consecutive calls; verify fetch uses the pinned IP.

### S2: Spend Cap Race Condition — Allows Overspend

- [ ] **Fix:** Atomic check+settle+record
- **Severity:** High
- **Sources:** Red Team (FINDING-03), Vibesec (4.2), Codex plan review
- **File:** `src/toolkit/tools/pay.ts:70 → 159 → 171`
- **Problem:** `checkPaySpendCap()` acquires lock, reads state, checks, releases lock (line 70). Settlement acquires a different lock (line 159). `recordPayment()` re-acquires spend lock (line 171). Two concurrent `pay()` calls both pass the cap check seeing the same state, then both settle — total spend exceeds cap.
- **Fix approach:** Wrap the entire check→settle→record in a single lock acquisition. Use `checkAndAppend` pattern to atomically reserve spend before settlement, confirm or rollback after. Move spend cap check inside `withWalletSettlementLock`.
- **Tests needed:** Two concurrent `pay()` calls each requesting 60 DEM with 100 DEM cap — verify second is rejected.

### S6: Tip Recipient Spoofing via Feed API

- [ ] **Fix:** Resolve recipient from chain, not API
- **Severity:** High
- **Sources:** Red Team (FINDING-04), Desloppify batch 8
- **File:** `src/toolkit/tools/tip.ts:38-61`
- **Problem:** `tip()` resolves post author by fetching `/api/feed?limit=50` and reading the `sender` field. Attacker controlling the feed API response can redirect tip payments to their own address. Posts older than 50 most recent are unreachable (silent DoS).
- **Fix approach:** Resolve recipient from on-chain transaction data (RPC query by txHash). Cache verified txHash→sender mappings. Fall back to feed API with security warning if RPC fails.
- **Tests needed:** Mock feed returns attacker address; verify on-chain resolution overrides. Test post-not-found for old posts.

---

## Shipped Fixes (This Session)

> Committed in `c779541`. Verified by 1713 passing tests.

### S3: `requirePayeeApproval` Default Flipped to `true`

- [x] **Fixed** — commit c779541
- **Source:** Vibesec (2.1)
- **File:** `src/toolkit/session.ts:92`
- **Was:** Default `false` — any 402 server could drain funds to arbitrary addresses up to spend cap.
- **Now:** Default `true` — explicit opt-in for open payments.

### S4: URL Allowlist Enforcement

- [x] **Fixed** — commit c779541
- **Source:** Red Team (FINDING-05), Desloppify batch 12
- **Files:** `src/toolkit/tools/attest.ts`, `pay.ts`, `publish.ts`
- **Was:** `session.urlAllowlist` stored but never checked. Zero protection.
- **Now:** All three outbound-URL tools enforce the allowlist when non-empty.

### S5: Auth Sentinel Mismatch

- [x] **Fixed** — commit c779541
- **Sources:** Red Team (FINDING-06), Vibesec (2.3)
- **File:** `src/toolkit/tools/connect.ts:248`
- **Was:** `authenticateFallback()` returned `"auth-pending"` (not `AUTH_PENDING_TOKEN`). Sent as `Bearer auth-pending` to API.
- **Now:** Returns `AUTH_PENDING_TOKEN` consistently.

---

## Tier 2 — Cleanup Pass

> Medium severity. Fix in 1-2 dedicated sessions. Ordered by impact.

### Security Hardening

#### S9: State Files World-Readable (0o644)

- [ ] **Fix:** Write with `mode: 0o600`
- **Source:** Vibesec (3.2)
- **File:** `src/toolkit/state-store.ts:40`
- **Problem:** Spend histories, payment receipts, tx hashes written with default umask.
- **Fix:** `writeFile(path, value, { encoding: "utf-8", mode: 0o600 })`

#### S10: Error Messages Leak URLs with API Keys

- [ ] **Fix:** Strip query params from URLs in error messages
- **Sources:** Vibesec (2.5), Red Team (FINDING-16)
- **File:** `src/toolkit/sdk-bridge.ts:125-157`
- **Problem:** Full URLs including `?api_key=...` flow to `ToolResult.error.message`.
- **Fix:** `new URL(url).origin + new URL(url).pathname` in error messages.

#### S11: `getDemos()` Bypasses All Guardrails

- [ ] **Fix:** Gate behind opt-in flag or deprecate
- **Source:** Vibesec (5.2)
- **File:** `src/toolkit/sdk-bridge.ts:294`
- **Problem:** Exposes raw SDK — any consumer can make direct transfers, bypassing spend caps and audit logging.

#### S14: State Key Hash Truncation (64 bits)

- [ ] **Fix:** Increase to 32 hex chars (128 bits)
- **Source:** Red Team (FINDING-10)
- **File:** `src/toolkit/guards/state-helpers.ts:14-17`
- **Problem:** SHA-256 truncated to 16 hex chars. Birthday collision at ~2^32 wallets.

#### S15: JSON.parse Prototype Pollution

- [ ] **Fix:** Sanitize `__proto__`/`constructor` after parsing
- **Source:** Red Team (FINDING-08)
- **Files:** `src/toolkit/sdk-bridge.ts:136`, `state-helpers.ts:28`, `discover-sources.ts:80`

### Robustness

#### S7: DAHR Server-Side SSRF Amplifier

- [ ] **Document:** Trust boundary with DAHR proxy
- **Source:** Red Team (FINDING-02)
- **File:** `src/toolkit/sdk-bridge.ts:118-168`
- **Problem:** DAHR proxy fetches URLs server-side, bypassing client SSRF checks.
- **Fix:** Document trust boundary. Consider domain allowlisting for attestation targets.

#### S8: State Corruption → Silent Guard Reset

- [ ] **Fix:** Log warning on parse failure
- **Source:** Vibesec (1.3)
- **File:** `src/toolkit/guards/state-helpers.ts:29`
- **Problem:** Corrupted state files silently reset all guards to zero.
- **Fix:** Emit warning via `console.warn` or `onToolCall`. Consider backup of last valid state.

#### S12: Container/WSL2 Permission Check Bypass

- [ ] **Fix:** Tighten threshold, document risk
- **Source:** Red Team (FINDING-07)
- **File:** `src/toolkit/tools/connect.ts:64-77`
- **Problem:** WSL2 always matches `drvfs`, downgrading mode-600 check to warning.

#### S13: No Timeout on DAHR Proxy Request

- [ ] **Fix:** Add `AbortController` with 30s timeout
- **Source:** Red Team (FINDING-11)
- **File:** `src/toolkit/sdk-bridge.ts:120`

### Code Quality

#### D1: `discoverSources()` API Inconsistency

- [ ] **Fix:** Align to uniform tool pattern
- **Sources:** Desloppify batches 6, 8, 11
- **File:** `src/toolkit/tools/discover-sources.ts`
- **Issues:** Nullable session (`DemosSession | null`), manual `withToolWrapper` reimplementation, `matchThreshold` accepted but never used.
- **Fix:** Make session required (or create a separate `discoverSourcesLocal()` for no-session use). Wire matchThreshold or remove from types.

#### D2: Type Safety Gaps — `as any` SDK Casts

- [ ] **Fix:** Create typed SDK wrapper interface
- **Source:** Desloppify batch 20
- **Files:** `src/toolkit/sdk-bridge.ts`, `connect.ts`
- **Issues:**
  - `txModule` parameter uses bare `Function` type (no call signature)
  - `cachedTxModule`/`cachedD402Client` typed `any` — use `unknown`
  - `connectSdk()` returns `{ demos: any }` — `Demos` type is importable
  - Local `SourceStatus` in `discover-sources.ts` duplicates `types.ts`

#### D3: Missing Test Coverage

- [ ] **Fix:** Add dedicated test files
- **Source:** Desloppify batch 10
- **Files missing tests:**
  - `src/toolkit/guards/state-helpers.ts` (7 importers, shared locking primitive)
  - `src/toolkit/tools/discover-sources.ts` (unsafe JSON.parse, status normalization)
  - `src/toolkit/tools/verify.ts` — uses real 3s/5s/10s delays in CI (mock timers)

---

## Tier 3 — Accept / Defer

> Low severity or acceptable risk. Documented for future reference.

| ID | Finding | Source | Disposition |
|----|---------|--------|-------------|
| A1 | `z.any()` on stateStore/onToolCall | Vibesec | Accept: developer-provided runtime objects |
| A2 | Scan limit in URL template | Red Team | Accept: Zod validates as int |
| A3 | Symbol-based token discoverable | Red Team | Accept: documented design |
| A4 | Catalog cache never invalidated | Red Team | Accept: static per process |
| A5 | SSRF blocks not security-classified | Vibesec | Defer: observability nice-to-have |
| A6 | Backoff retries may amplify 429 load | Red Team | Accept: 3 retries, exponential |
| A7 | IPv6 ULA regex too broad | Red Team | Accept: input always well-formed |
| A8 | Mnemonic in signingHandle lifetime | Red Team | Accept: JS can't zero strings |

---

## Desloppify Dimension Queue

> Ordered by score impact. Run `desloppify next` to execute.

### Priority 1: Test Health (71.8%) — biggest weighted drag

| # | Finding | File | Status |
|---|---------|------|--------|
| 1 | No direct tests for state-helpers.ts | `tests/toolkit/guards/` | [ ] |
| 2 | No direct tests for discover-sources.ts | `tests/toolkit/tools/` | [ ] |
| 3 | verify.ts uses real 3/5/10s delays in CI | `tests/toolkit/tools/` | [ ] |
| 4 | Integration tests have tautological assertions on DNS failure | `tests/toolkit/tools/integration.test.ts` | [ ] |

### Priority 2: Type Safety (71.0%)

| # | Finding | File | Status |
|---|---------|------|--------|
| 5 | `txModule` parameter uses bare `Function` type | `sdk-bridge.ts:86` | [ ] |
| 6 | `cachedTxModule`/`cachedD402Client` typed `any` | `sdk-bridge.ts:89,91` | [ ] |
| 7 | `connectSdk()` returns `demos: any` | `connect.ts:182` | [ ] |
| 8 | Duplicate `SourceStatus` type in discover-sources.ts | `discover-sources.ts:94` | [ ] |

### Priority 3: Contracts (74.0%)

| # | Finding | File | Status |
|---|---------|------|--------|
| 9 | `PublishDraft.attestUrl` typed optional but throws at runtime | `types.ts:129`, `publish.ts:83` | [ ] |
| 10 | `verify()` returns fabricated `blockHeight: 1` | `verify.ts:87` | [ ] |
| 11 | Dead `signAndBroadcast()` interface method | `sdk-bridge.ts:55` | [ ] |

### Priority 4: Error Consistency (76.0%)

| # | Finding | File | Status |
|---|---------|------|--------|
| 12 | `apiCall()` swallows exceptions as `{ ok: false, status: 0 }` | `sdk-bridge.ts:179-181` | [ ] |
| 13 | scan.ts swallows Skill Dojo fallback error | `scan.ts:34` | [ ] |
| 14 | spend cap guards check bounds before isFinite (NaN comparison) | `pay-spend-cap.ts:34` | [ ] |

### Priority 5: Logic Clarity (76.5%)

| # | Finding | File | Status |
|---|---------|------|--------|
| 15 | Unreachable post-loop `return err()` in verify.ts | `verify.ts:59-62` | [ ] |
| 16 | Inverted guard order in pay-spend-cap.ts | `pay-spend-cap.ts:34-42` | [ ] |

### Priority 6: Mid Elegance (78.5%)

| # | Finding | File | Status |
|---|---------|------|--------|
| 17 | SdkBridge stored opaquely in `signingHandle: unknown` | `session.ts` | [ ] |
| 18 | `DEFAULT_SUPERCOLONY_API` hardcoded, not injectable | `connect.ts:22` | [ ] |
| 19 | `reply()` validation errors bypass withToolWrapper timing | `publish.ts:63-72` | [ ] |
| 20 | Stale TODO in attest.ts ("wire to SDK bridge" — already wired) | `attest.ts:41` | [ ] |
| 21 | 6-way txHash extraction fallback in publishHivePost | `sdk-bridge.ts:249-256` | [ ] |

### Priority 7: Design Coherence (78.5%)

| # | Finding | File | Status |
|---|---------|------|--------|
| 22 | `connect.ts` mixes 5 responsibilities in one function | `connect.ts:29-111` | [ ] |

### Priority 8: Convention Drift (83.0%)

| # | Finding | File | Status |
|---|---------|------|--------|
| 23 | Dual guard API surface (old check/record + new checkAndRecord) | `guards/*.ts` | [ ] |
| 24 | `checkAndRecord*` not exported from barrel | `index.ts` | [ ] |

### Priority 9: AI-Generated Debt (85.5%)

| # | Finding | File | Status |
|---|---------|------|--------|
| 25 | 4 near-identical `recordX()` functions duplicate `checkAndAppend` logic | `guards/*.ts` | [ ] |
| 26 | Restating comments in state-helpers.ts | `state-helpers.ts` | [ ] |

### Priority 10: Low-Level Elegance (81.0%)

| # | Finding | File | Status |
|---|---------|------|--------|
| 27 | tip.ts full feed scan for author resolution | `tip.ts:38-55` | [ ] |
| 28 | Magic numbers in scan.ts identifyOpportunities (5, 100, 0.7) | `scan.ts:48` | [ ] |

---

## Review Metadata

| Source | Model | Duration | Findings |
|--------|-------|----------|----------|
| Red Team (Pentester) | Claude Opus 4.6 | 222s | 22 (2C, 5H, 7M, 5L, 3I) |
| Vibesec | Claude Opus 4.6 | 143s | 14 (3 red, 8 yellow, 3 green) |
| Desloppify scan | Mechanical | 42s | 61 open |
| Desloppify review | 20 Claude Sonnet 4.6 batches | ~300s each | 44 subjective findings |
| Codex fixes | GPT-5.4 | 66s | 2 fixes implemented (tx-queue, redirect) |
| Codex plan reviews | GPT-5.4 | 2x ~78K tokens | 8 plan findings, 2 commit findings |

**Total unique findings (deduplicated):** 28 actionable (3 Tier 1, 12 Tier 2, 5 Tier 3 deferred, 8 accepted)
**Cross-source confirmations:** S1 (3 sources), S2 (3 sources), S5 (2 sources), S4 (2 sources), S6 (2 sources)
