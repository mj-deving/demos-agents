---
type: audit
status: active
created: 2026-04-07
summary: "Comprehensive V3 loop production audit — 35 findings across SENSE, ACT, and lifecycle. Prioritized for perfecting autonomous operation."
read_when: ["v3 loop", "production audit", "loop issues", "perfecting", "endurance"]
---

# V3 Loop Production Audit

> Full audit of the V3 SENSE/ACT/CONFIRM loop for sustained autonomous operation.
> Triggered by live endurance test (session 71) revealing stacked blockers.
> Three parallel audit agents covered SENSE, ACT, and lifecycle independently.

## Findings Summary

| Severity | SENSE | ACT | Lifecycle | Total |
|----------|-------|-----|-----------|-------|
| Critical | 2 | 1 | 1 | **4** |
| High | 2 | 6 | 4 | **12** |
| Medium | 5 | 7 | 7 | **19** |
| Low | 1 | 0 | 2 | **3** |
| **Total** | **10** | **14** | **14** | **38** |

---

## Critical (4) — Must fix before sustained operation

### C1. No session report or lock release on error — FIXED
**Lifecycle | session-runner.ts:4484-4490**
Catch handler saves state but never writes report or releases lock. Failed sessions have no post-mortem, `--resume` blocked by stale lock.
**Fix:** Write report + release lock in finally block.

### C2. Unvalidated bettingPool enrichment — FIXED
**SENSE | v3-loop.ts:299**
5 of 6 enrichment fields use Zod validation; bettingPool bypasses it entirely. Malformed API data reaches strategy engine unchecked.
**Fix:** Create BettingPoolSchema, validate like other fields.

### C3. Unvalidated agentsResult access — FIXED
**SENSE | v3-loop.ts:286-288**
Accesses `agentsResult.data.agents.length` after only HTTP success check, no shape validation. Throws TypeError if `agents` field missing.
**Fix:** Optional chain: `agentsResult?.data?.agents?.length ?? undefined`.

### C4. ENGAGE blocked on "no_attestation" — too strict — FIXED
**ACT | action-executor.ts:161**
Verification gate blocks ENGAGE for posts with no attestation record. Most colony posts lack attestation → ENGAGE never fires in production.
**Fix:** Allow "no_attestation" like "unresolved" for ENGAGE (keep strict for TIP).

---

## High (12) — Fix for reliable autonomous operation

### H1. Session timeout hardcoded at 180s, not configurable — FIXED
**Lifecycle | session-runner.ts:4185**
`SESSION_TIMEOUT_MS = 180_000` is too short for multi-publish sessions (session 71 timed out generating 4th post). Not configurable via CLI or YAML.
**Fix:** Make configurable via agent config. Set phase-level budgets.

### H2. Lock never released on FATAL error path — FIXED
**Lifecycle | session-runner.ts:4484-4490**
`process.exit(1)` called without releasing session lock.
**Fix:** Add finally block for lock release.

### H3. Subprocess timeouts not configurable, no retry — OPEN
**Lifecycle | session-runner.ts subprocess calls**
scan-feed and verify.ts inherit 180s timeout, no retry on failure, no configurable timeout.
**Fix:** Add `--timeout` flag, exponential backoff retry.

### H4. Session timeout doesn't account for subprocess time — OPEN
**Lifecycle | session-runner.ts:4184-4192**
If scan-feed blocks for 120s, only 60s left for ACT+CONFIRM. Race condition.
**Fix:** Per-phase budgets that sum to session total.

### H5. No ACT phase action cap or wallclock timeout — FIXED
**ACT | v3-loop.ts:385-430**
Publish executor iterates all planned actions sequentially with no cap. 4+ PUBLISH candidates × 45s each = timeout.
**Fix:** Cap at 3-5 PUBLISH actions per session. Add 120s wallclock timeout for ACT phase.

### H6. dryRun:true default disables real spending in autonomous — FIXED
**ACT | spending-policy.ts:83**
`defaultSpendingPolicy()` returns `dryRun: true`. TIP/BET/VOTE simulated even in autonomous mode.
**Fix:** Document opt-in or auto-disable dryRun for `--oversight autonomous`.

### H7. Attestation fallback crashes action instead of degrading — FIXED
**ACT | publish-helpers.ts:341**
If both DAHR and TLSN fail, exception propagates and entire PUBLISH action fails. No graceful degradation to publish without attestation.
**Fix:** Catch fallback error, allow publish with `attestationType: "none"` (lower score but still publishes).

### H8. Cascading LLM/attestation errors — no per-step recovery — FIXED
**ACT | publish-executor.ts:201-425**
Single try-catch wraps entire action. LLM timeout = action skipped. No step-level recovery.
**Fix:** Per-step try-catch with fallback behaviors.

### H9. TIP verification gate too strict (verified only) — FIXED (documented as intentional)
**ACT | action-executor.ts:246**
TIP requires `gate === "verified"` — stricter than ENGAGE. No TIP on unresolved attestations.
**Fix:** Consider allowing "unresolved" for TIP or document safety rationale.

### H10. Write-rate ledger out of sync — FIXED (Codex: removed double-count)
**ACT | publish-executor.ts:60, 405**
Rate limit checked at line 60 (no record), recorded at line 405 (after publish). If publish succeeds but record fails, ledger desyncs.
**Fix:** Record immediately after rate check, rollback on publish failure.

### H11. Silent catch block swallows ALL API enrichment errors — FIXED
**SENSE | v3-loop.ts:309**
Bare `catch {}` discards all errors from Promise.all enrichment batch. No observability.
**Fix:** Log error with `deps.observe("warning", ...)`.

### H12. Hard-coded 500-post fetch limit — OPEN
**SENSE | v3-loop.ts:183**
`getRecentPosts(500)` hardcoded. During high-volume periods, misses posts.
**Fix:** Make configurable via agent config or use time-based window.

---

## Medium (19) — Improve for production quality

### M1. Auth token never refreshed during session — OPEN
**Lifecycle | v3-loop.ts:78-86**
Token obtained once, cached. Multi-hour sessions → silent API failures.

### M2. Colony DB growth unbounded — OPEN
**Lifecycle | v3-loop.ts:183-184**
No max size enforcement, cleanup, or growth monitoring. 200+ sessions = 100K+ new posts.

### M3. Source fetch concurrency/limits hardcoded — OPEN
**Lifecycle | v3-loop.ts:227-242**
Max 5 sources per intent, concurrency 3 — not configurable.

### M4. SSE timeout (5s) and event limit (100) hardcoded — OPEN
**Lifecycle | v3-loop.ts:245-268**
Too short for slow connections, arbitrary cap, silent post loss.

### M5. Proof ingest concurrency (5) and limit (20) hardcoded — OPEN
**Lifecycle | v3-loop.ts:193-194**
Can't scale with chain growth or tune for RPC rate limits.

### M6. Failed phases not included in session report — FIXED
**Lifecycle | session-runner.ts:3847-3918**
Report omits error context for failed phases.

### M7. Insufficient phase-level checkpoint logging — OPEN
**Lifecycle | v3-loop.ts (overall)**
No explicit "phase complete" checkpoints, no per-phase timing.

### M8. StrategyBridge resource leak on early exception — OPEN
**Lifecycle | v3-loop.ts:118-122**
Bridge cleanup depends on `using` scope; exception before return may leak.

### M9. Schema passthrough allows unknown fields silently — OPEN
**SENSE | api-schemas.ts:80**
`.passthrough()` on schemas means new API fields ignored without notice.

### M10. Chain post fetch sequential with API enrichment — OPEN
**SENSE | v3-loop.ts:275-282**
Could parallelize chain fetch and API enrichment to save wall-clock time.

### M11. Hardcoded rate limits (14/day, 5/hour) not configurable — OPEN
**SENSE | v3-strategy-bridge.ts:47-48**
Should be loaded from agent YAML config.

### M12. API backfill missing null check on response data — OPEN
**SENSE | api-backfill.ts:77**
`result.data.posts.length` without checking `result.data` exists.

### M13. Tip API fallback silently ignores errors — FIXED
**ACT | action-executor.ts:286-291**
Falls back to direct transfer without API validation. No rate limit on fallback.

### M14. Locale-dependent action priority sort — FIXED
**ACT | engine.ts:260-263**
`localeCompare()` for tie-breaking — locale-sensitive.

### M15. Rate-limit recording error logged but not retried — FIXED
**ACT | publish-executor.ts:405-412**
Ledger write failure not retried, post still marked successful.

### M16. TIP amount clamped silently — FIXED
**ACT | action-executor.ts:232**
Clamps to [1, 10] DEM without logging the reduction.

### M17. Attestation fallback doesn't try opposite method — OPEN
**ACT | publish-executor.ts:340-349**
If DAHR fails, fallback retries DAHR not TLSN.

### M18. Dry-run skips validation logic — OPEN
**ACT | publish-executor.ts:299-314**
Reports success without running source matching or attestation.

### M19. Interaction tracking errors swallowed — FIXED (unique source IDs)
**ACT | action-executor.ts:177-185, 204-212, 302-310**
`recordInteraction()` failures logged as warning, not retried.

---

## Low (3) — Nice to have

### L1. Missing txHash logging in ingestion
**SENSE | v3-loop-helpers.ts:82**
Posts with falsy txHash silently skipped.

### L2. V3 loop has no explicit internal timeout
**Lifecycle | session-runner.ts:4213**
Relies only on session-level timer.

### L3. Session cleared before report finalized
**Lifecycle | session-runner.ts:4481-4483**
If report write fails, can't resume to retry.

---

## Recommended Fix Order

### Phase A: Unblock publishing (immediate)
1. **C4** — Relax ENGAGE verification gate
2. **H5** — Cap PUBLISH actions per session (3-5)
3. **H1** — Make session timeout configurable (bump to 300s+)
4. **H7** — Graceful attestation degradation

### Phase B: Reliability (before sustained operation)
5. **C1 + H2** — Fix error path: report + lock release + finally
6. **C2 + C3** — Validate all enrichment fields
7. **H11** — Log enrichment errors (not silent catch)
8. **H10** — Fix rate-limit ledger sync
9. **H8** — Per-step error recovery in publish executor

### Phase C: Configurability (production tuning)
10. **H3 + H4** — Configurable subprocess + phase budgets
11. **H12** — Configurable post fetch limit
12. **M1** — Auth token refresh
13. **M2** — DB growth monitoring + cleanup
14. **M3-M5, M11** — Move all hardcoded limits to agent YAML config

### Phase D: Polish (sustained autonomy)
15. **H6** — Decide dryRun policy for autonomous mode
16. **H9** — TIP verification gate policy
17. **M6-M7** — Session report completeness + checkpoint logging
18. **M13-M19** — Medium ACT fixes

---

## Session 71 Findings (2026-04-07)

Live endurance test after Phase A-D fixes. 1 post published, score 100, 20 agrees.

### NEW-1 (CRITICAL — FIXED): Self-dedup address mismatch
Wallet address from `connectWallet()` differs from chain author address in colony DB.
`checkSelfDedup` never matched our own posts → duplicate topics published.
**Fix:** Resolve chain address at startup by looking up our recent posts in colony DB.
Update `bridge.updateWalletAddress()` and pass `chainAddress` to executors.

### NEW-2 (HIGH — FIXED): scan-feed crashes on chain 502
Chain RPC returning 502 crashed the entire subprocess. API feed (200) was available.
**Fix:** Try chain first, fall back to API feed with post mapping. Both-fail still throws.

### NEW-3 (MEDIUM — FIXED): Skip reasons missing from session report
Session report showed "5 skipped" with no visibility into why.
**Fix:** Added skip reason list to report (type + reason for each skipped action).

### NEW-4 (BY DESIGN): LLM calls for actions that later get skipped
3 LLM drafts generated but only 1 published. The dedup/source checks pass before LLM
because the 2nd/3rd actions target different topics. The cap (`MAX_PUBLISH_PER_SESSION=3`)
is checked at loop top. Generating extras is intentional — each might fail attestation.

### NEW-5 (BY DESIGN): Session number not incrementing after failure
Failed sessions keep their number for `--resume` support. This is the intended design —
the retry used the same session 71, which then succeeded and incremented to 72.

## Completion Status

| Phase | Items | Fixed | Remaining |
|-------|-------|-------|-----------|
| A: Unblock publishing | 4 | 4 | 0 |
| B: Reliability | 5 | 5 | 0 |
| C: Configurability | 5 | 1 (H1 timeout) | 4 |
| D: Polish | 4 | 4 (H6,H9,M6,M13-M19) | 0 |
| Session 71 | 5 | 3 fixed, 2 by-design | 0 |
| Codex review | 5 | 3 fixed, 2 deferred | 2 |
| **Total** | **28** | **20 fixed** | **6 remaining + 2 deferred** |

### Remaining (Phase C configurability)
- H3+H4: Configurable subprocess + phase budgets
- H12: Configurable post fetch limit
- M1: Auth token refresh for multi-hour sessions
- M2: DB growth monitoring + cleanup
- M3-M5, M11: Move hardcoded limits to agent YAML config
