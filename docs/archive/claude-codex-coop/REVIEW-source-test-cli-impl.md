# Review: Source Testing CLI (Implementation)

## Findings

1. High: `testSource()` does not actually enforce the canonical adapter pipeline.
   It never checks `adapter.supports(source)` before building candidates, even though `supports()` is part of the provider contract in `tools/lib/sources/providers/types.ts:150-169` and the runtime path gates on it in `tools/lib/sources/policy.ts:158-180`. It also ignores `validateCandidate().ok`; `tools/lib/sources/health.ts:195-198` always fetches the candidate URL even when validation rejects it. That means the health check can probe URLs the real runtime would skip, so Q1 is not fully satisfied.

2. High: the fallback from adapter generation to direct URL resolution is too broad and can produce false positives.
   In `tools/lib/sources/health.ts:185-206`, any `buildCandidates()` failure or empty candidate list falls back to `resolveTestUrl(source.url, ...)`. The runtime selector only falls back to template filling when there is no supporting adapter; when a supporting adapter yields no valid candidates, it skips the source instead of fabricating a request (`tools/lib/sources/policy.ts:158-185`). For supported providers, this implementation can report `OK`, `EMPTY`, or `FETCH_FAILED` for a URL path the adapter explicitly refused to generate.

3. Medium: `--agent` is parsed and shown in output, but never used to filter sources.
   `tools/source-test.ts:39-45` reads `--agent`, and `tools/source-test.ts:118-119` includes it in the label, but `tools/source-test.ts:69-73` filters only by `sourceId`, `provider`, and `quarantined`. So the CLI does load the raw catalog, which is the right choice for quarantined access, but `--agent sentinel` currently tests all raw-catalog sources instead of that agent's visible subset.

## Q1-Q5

Q1: No, not completely.
`testSource()` uses `buildCandidates()` and `validateCandidate()`, so it is closer to the reviewed design than the original direct-substitution proposal. But it misses two required parts of the real pipeline: `adapter.supports(source)` is never checked, and `validateCandidate().ok === false` does not stop the fetch. Because of that, the implementation does not yet match the canonical `supports -> buildCandidates -> validateCandidate -> fetch -> parse` flow.

Q2: No, the fallback is not correct as implemented.
Falling back to direct URL resolution when `buildCandidates()` returns empty or throws is only defensible for sources that do not have a supporting adapter path. The runtime contract in `tools/lib/sources/policy.ts:158-185` treats "adapter exists but produced no valid candidates" as "do not use this source", not "substitute `source.url` directly". The current fallback is therefore too permissive.

Q3: Partially yes.
The six statuses are all present and the obvious mappings are implemented:
- `NO_ADAPTER`: no adapter found in `tools/lib/sources/health.ts:168-177`
- `UNRESOLVED_VARS`: unresolved placeholders in `tools/lib/sources/health.ts:208-218`
- `FETCH_FAILED`: fetch returned `ok=false` or threw in `tools/lib/sources/health.ts:232-240` and `tools/lib/sources/health.ts:279-286`
- `PARSE_FAILED`: parser threw in `tools/lib/sources/health.ts:269-277`
- `EMPTY`: parse succeeded with zero entries in `tools/lib/sources/health.ts:247-255`
- `OK`: parse succeeded with entries in `tools/lib/sources/health.ts:258-268`

The caveat is that unsupported or validation-rejected candidates are not mapped cleanly today. Because those checks are bypassed, the tool can assign one of the six statuses to a request the runtime would never attempt.

Q4: Yes for raw catalog loading, no for agent scoping.
The CLI correctly uses `loadCatalog()` directly in `tools/source-test.ts:59-60`, which avoids `loadAgentSourceView()` and its default `allowStatuses: ["active", "degraded"]` filter in `tools/lib/sources/catalog.ts:616-620` and `tools/lib/sources/catalog.ts:639-663`. That part is correct for quarantined access. However, `--agent` is currently ignored during filtering, so agent-scoped runs are not implemented.

Q5: Yes, there are missing edge-case tests.
- Missing: `testSource()` should verify `adapter.supports(source)` is consulted before candidate generation.
- Missing: `validateCandidate({ ok: false })` should prevent fetch; there is no test for rejected candidates.
- Missing: `validateCandidate().rewrittenUrl` should be asserted to prove the rewritten URL is what gets fetched.
- Missing: `buildCandidates()` empty/throw behavior should be tested against the intended contract; the current test only asserts the fallback path exists.
- Missing: CLI-level coverage is absent. There is no test that `--agent` actually filters, that raw catalog loading enables quarantined records, or that summary/output behavior matches the implemented CLI.

## Verification

Ran `npm test -- tests/source-health.test.ts` on 2026-03-14. The suite passed: 18 tests, 1 file.
