# Review: Matcher Hardening

## Findings

1. High: The Phase 5 LLM claim-extraction path is not implemented in the matcher. [`tools/lib/sources/matcher.ts:359`](./tools/lib/sources/matcher.ts#L359) still calls the synchronous `extractClaims()` at lines 371-372, and the file contains no `extractClaimsLLM()` or `extractClaimsAsync()` implementation at all. That means the required `llm-provider.ts` integration, JSON parsing, empty-array failure handling, fallback behavior, and async pipeline change from the task are all currently missing.

2. High: The diversity bonus logic is also absent. [`tools/lib/sources/matcher.ts:410`](./tools/lib/sources/matcher.ts#L410) scores each candidate independently, then immediately sorts by base score at lines 443-445. There is no post-pass that counts claims corroborated by 2+ sources, no `+5` per corroborated claim, no `+15` cap, and no application of that bonus to the best candidate. The task’s diversity-scoring contract is therefore unmet.

3. Medium: The tests do not validate any of the new hardening contracts. [`tests/matcher.test.ts:90`](./tests/matcher.test.ts#L90) covers only the legacy `extractClaims()` behavior, and [`tests/matcher.test.ts:108`](./tests/matcher.test.ts#L108) covers evidence/metadata scoring. There are no tests for `extractClaimsLLM`, `extractClaimsAsync`, LLM failure fallback, merged deduplication, diversity bonus behavior, or verification that `match()` calls the async extractor. The current suite passing does not validate the task requirements.

## Q1-Q5

Q1: Use `standard` by default. This path is part of a verification step, so precision matters more than marginal latency savings. If cost or latency becomes a problem, make the tier configurable and downgrade to `fast` only behind an explicit setting.

Q2: Apply the diversity bonus only to the best candidate. That keeps ranking based on each candidate’s own evidence score and uses diversity as a final confidence uplift instead of a second scoring system that can reorder the whole list unpredictably.

Q3: `+5` per corroborated claim is reasonable, but the `+15` cap is aggressive relative to a `50` threshold. I would start with the same increment and a lower cap such as `+10` unless evaluation data shows the higher cap improves precision.

Q4: Yes, add a timeout. The current provider abstraction can block much longer than the match pipeline should tolerate, so `extractClaimsAsync()` should fail closed after a short timeout and return the regex-only result.

Q5: Yes, include `postTags` as context, but treat them as hints rather than mandatory claims. They should help disambiguate extraction, not force claims that are absent from the post text.

## Test Contract Validation

Current status: `npx vitest run tests/matcher.test.ts` passes, but it validates only pre-hardening behavior.

Required contracts vs current implementation:

- `extractClaimsLLM` valid JSON parse: Fail. Function does not exist.
- `extractClaimsLLM` returns `[]` on throw: Fail. Function does not exist.
- `extractClaimsLLM` returns `[]` on non-JSON text: Fail. Function does not exist.
- `extractClaimsLLM` returns `[]` on empty response: Fail. Function does not exist.
- `extractClaimsAsync` merges LLM + regex claims: Fail. Function does not exist.
- `extractClaimsAsync` falls back to regex claims on LLM failure: Fail. Function does not exist.
- `extractClaimsAsync` deduplicates merged claims: Fail. Function does not exist.
- Diversity bonus is `0` with one source: Fail. Logic does not exist.
- Diversity bonus is `+5` for one corroborated claim: Fail. Logic does not exist.
- Diversity bonus is `+10` for two corroborated claims: Fail. Logic does not exist.
- Diversity bonus is capped at `+15`: Fail. Logic does not exist.
- Diversity bonus never reduces base score: Fail. Logic does not exist.
- `match()` calls `extractClaimsAsync`: Fail. [`tools/lib/sources/matcher.ts:371`](./tools/lib/sources/matcher.ts#L371) still calls `extractClaims()`.
- `match()` applies diversity bonus to best candidate: Fail. No diversity pass exists after candidate scoring.
