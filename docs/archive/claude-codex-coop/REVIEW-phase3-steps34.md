# Review: Phase 3 Steps 3+4 — Codex Findings

**Reviewed by:** Codex (gpt-5.4), 2026-03-13
**Commit reviewed:** 8bb54b6 + 8a64869
**Session:** 019ce941-b092-79d3-a9da-6c91372a6655

## Findings

### 1. P1 — Extension hooks bypassed in session-runner

**Issue:** The v2 runner calls source policy directly in `session-runner.ts:1402` (gate) and `:1571`/`:1638` (publish), bypassing `beforePublishDraft`/`afterPublishDraft` hooks in `extensions.ts:201`/`:223`. This means `match()` is never called post-generation.

**Resolution:** By design for Phase 3 — gate and publish call `preflight()` directly because the extension dispatcher is not yet wired into the session loop (that's Phase 4 integration). The hooks exist as entry points for when the dispatcher is wired. The direct calls are correct for now. **WONTFIX — tracked for Phase 4.**

### 2. P1 — PreflightCandidate dedup drops fallback method

**Issue:** `preflight()` deduplicates fallback candidates by `sourceId`, which drops the second attestation method when the same source supports both TLSN and DAHR. This removes a valid fallback path.

**Location:** `tools/lib/sources/policy.ts:177`

**Resolution:** FIXED — changed dedup to key by `sourceId + method` so both TLSN and DAHR candidates for the same source are preserved.

### 3. P1 — sourceRegistryMode silently coerces unknown values

**Issue:** Unknown persona values silently coerce to `catalog-preferred` instead of failing fast or logging a warning.

**Location:** `tools/lib/agent-config.ts:423`

**Resolution:** FIXED — added `info()` warning log when unknown mode is coerced. Full fail-fast is too aggressive during migration (persona.yaml might have typos), but silent acceptance is wrong.

### 4. P2 — selectSourceForTopicV2() misses alias/domain-only matches

**Issue:** Index retrieves candidates by `byTopicToken` and `byDomainTag`, but scoring only checks `sourceTopicTokens(source)`, so alias-only or domain-tag-only matches score 0 and are discarded.

**Location:** `tools/lib/sources/policy.ts:63`, `:91`

**Resolution:** FIXED — scoring now includes alias token overlap and domain tag overlap in addition to topic token overlap.

### 5. P2 — preflight() reports wrong success reason for fallback-only

**Issue:** A `tlsn_preferred` topic with only a DAHR candidate returns PASS with "TLSN source available" instead of indicating it's a DAHR fallback.

**Location:** `tools/lib/sources/policy.ts:194`

**Resolution:** FIXED — success reason now distinguishes between primary method match and fallback method match.

### 6. P2 — attestation-policy.ts retains v1 source registry API

**Issue:** Old v1 source registry API and duplicate tokenization/preflight logic remain in `attestation-policy.ts`, creating drift risk with the v2 implementation.

**Location:** `tools/lib/attestation-policy.ts`

**Resolution:** DEFERRED — removing v1 API is a Phase 4 task (requires updating all callers). The shared helpers are already properly imported from attestation-policy.ts by policy.ts to avoid duplication.

## Validation

- `npx tsc --noEmit` — PASS
- `grep -n 'discoverSourceForTopic\|persistSourceToRegistry\|loadSourceRegistry' tools/session-runner.ts` — no matches
- `source-migrate.ts` — 196 V1 → 138 unique V2, 58 dupes removed
- Preflight for "bitcoin price analysis" — PASS (1 candidate, blockstream)

## Summary

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | P1 | Extension hooks bypassed | WONTFIX (Phase 4) |
| 2 | P1 | PreflightCandidate dedup drops fallback | FIXED |
| 3 | P1 | sourceRegistryMode silent coercion | FIXED |
| 4 | P2 | selectSourceForTopicV2 misses alias/domain matches | FIXED |
| 5 | P2 | preflight() wrong success reason | FIXED |
| 6 | P2 | attestation-policy.ts retains v1 API | DEFERRED (Phase 4) |
