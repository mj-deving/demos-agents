# Attested Data Fix Review

## Findings

1. Medium: pre-fetch failures are mostly silent. In `tools/session-runner.ts:1670-1698`, the new block only logs on thrown exceptions. But `fetchSource()` reports many failures by returning `{ ok: false, error, attempts, totalMs }` without throwing, including rate-limit denial and exhausted retries (`tools/lib/sources/fetch.ts:61-75`, `tools/lib/sources/fetch.ts:172-177`). Because the runner only handles `fetchResult.ok && fetchResult.response`, non-OK results are dropped with no log, metric, or fallback, so the LLM can lose source context invisibly.

2. Medium: the fix double-fetches the source in the normal sources-enabled path. `runPublishAutonomous()` now fetches `preflightDecision.candidates[0]` before `generatePost()` (`tools/session-runner.ts:1668-1679`), then `runAfterPublishDraft()` passes the same preflight candidate list into `match()` (`tools/session-runner.ts:1753-1763`), and `match()` fetches every candidate again via `fetchSource()` (`tools/lib/sources/matcher.ts:517-542`). So the top candidate is fetched once for prompt seeding and again for match scoring. Attestation later is an additional network hit on the selected URL.

3. Low: the prompt can be seeded from one source while publish later attests another. The pre-fetch always uses `preflightDecision.candidates[0]` (`tools/session-runner.ts:1669`), but publish prefers `matchDecision.best` when post-generation matching succeeds (`tools/session-runner.ts:1775-1780`). If the matcher picks a different candidate, the LLM writes against source A while the final attestation uses source B.

4. Low: there is no secondary-candidate fallback for prompt seeding. If the first preflight candidate fetch fails or returns unusable data, the code does not try the remaining preflight candidates before calling `generatePost()` (`tools/session-runner.ts:1668-1699`), even though those candidates are later available to `match()`.

Residual test gap:

- I did not find a test that exercises this new `session-runner.ts` pre-fetch path end-to-end. Existing tests around `runAfterPublishDraft()` and matcher wiring do not cover the new `attestedData` fetch-before-generate behavior.

## Answers

### 1. Is the source data fetched BEFORE `generatePost()` is called?

Yes.

- The pre-fetch block runs at `tools/session-runner.ts:1666-1699`.
- `generatePost()` is called later at `tools/session-runner.ts:1701-1724`.

So the fetch attempt happens before the LLM generation call.

### 2. Is `attestedData` passed correctly to `generatePost()`?

Yes.

- `attestedData` is populated from the pre-fetch result at `tools/session-runner.ts:1689-1693`.
- It is passed into `generatePost()` at `tools/session-runner.ts:1715-1717`.
- `generatePost()` accepts `attestedData` on `GeneratePostInput` in `tools/lib/llm.ts:55-59`.
- `generatePost()` appends it into the user prompt at `tools/lib/llm.ts:178-181`.

So the wiring from runner to LLM prompt is correct.

### 3. Are there any error handling gaps in the pre-fetch?

Yes.

- Non-throwing fetch failures are silent. `fetchSource()` commonly returns `ok: false` instead of throwing, but the runner does not log `fetchResult.error`, `attempts`, or `totalMs`.
- Only thrown errors reach the `catch` block in `tools/session-runner.ts:1696-1698`.
- The code does not try another preflight candidate if the first fetch fails.
- The code also gives no indication to downstream logic that prompt seeding failed; `generatePost()` just runs without `attestedData`.

This is survivable because the pre-fetch is intentionally non-fatal, but it is weak operationally: failures are hard to diagnose and easy to miss.

### 4. Does the fix double-fetch the source (once here, once in `match`)?

Yes.

- First fetch: `tools/session-runner.ts:1674`.
- Second fetch: `tools/lib/sources/matcher.ts:525`.

Because `runAfterPublishDraft()` receives `preflightDecision.candidates` from the same preflight step (`tools/session-runner.ts:1760`), the matcher re-fetches candidates that may already have been fetched for prompt context.

## Bottom Line

The core fix works: source data is fetched before `generatePost()` and `attestedData` is threaded correctly into the LLM prompt. The main problems are around efficiency and resilience, not basic wiring:

- pre-fetch failures are too quiet,
- the same source is fetched again during `match()`,
- and the prompt may be conditioned on a different source than the one ultimately attested.
