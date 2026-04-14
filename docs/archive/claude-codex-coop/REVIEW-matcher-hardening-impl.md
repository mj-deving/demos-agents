# Matcher Hardening Implementation Review

## Answers to Q1-Q5

### Q1

The 10s timeout in `tools/lib/sources/matcher.ts:125` and `tools/lib/sources/matcher.ts:160-165` is defensible as a hard ceiling because LLM extraction is optional and the code falls back to regex claims on failure. It is still long for a synchronous match pipeline, and some CLI or cold-started hosted providers can exceed it. I would treat 10s as a maximum tolerated stall, not an ideal target; 3-5s is probably a better default unless production latency data says otherwise.

One caveat: this timeout only stops awaiting the result. It does not cancel the underlying provider call, because `LLMProvider.complete()` has no abort path.

### Q2

No. The diversity bonus should only apply to candidates that actually matched corroborated claims, and it should be computed from distinct source/claim pairs. The current implementation computes one global bonus and adds it to every scored candidate in `tools/lib/sources/matcher.ts:570-576`, which means a candidate that did not corroborate anything can still get pushed upward by other sources' agreement.

### Q3

Yes. Always merging regex claims after a successful LLM extraction can make results worse.

The issue is not just "regex noise" in the abstract. Both `scoreEvidence()` and `scoreMetadataOnly()` normalize some sub-scores by the total number of claims:

- `scoreEvidence()` divides title/body matches by `claimSet.size` at `tools/lib/sources/matcher.ts:271-300`
- `scoreMetadataOnly()` divides topic overlap by `claimTokens.size` at `tools/lib/sources/matcher.ts:381-390`

So when `extractClaimsAsync()` unconditionally appends many generic regex tokens at `tools/lib/sources/matcher.ts:190-207`, the denominator grows and the same evidence can score lower. That creates a real false-negative risk.

### Q4

This is not really a `{TEXT}` problem, and it is not classic prompt injection in the usual sense. The concrete bug is placeholder collision caused by sequential string replacement at `tools/lib/sources/matcher.ts:154-156`.

If `postText` contains the literal substring `{TAGS}`, the second `.replace("{TAGS}", ...)` can rewrite that user text inside the already-inserted `Text:` block, while leaving the actual `Tags:` placeholder untouched. So the prompt can be corrupted by input content. A literal `{TEXT}` inside `postText` does not have the same issue here; `{TAGS}` does.

### Q5

No. The new tests show that the main implementation exists and the happy paths work, but they are not sufficient for production confidence.

The current suite covers valid/invalid LLM JSON parsing, merge fallback, and basic diversity behavior in `tests/matcher.test.ts`. It does not cover timeout behavior, truncation, placeholder collision, distinct-source diversity accounting, or the score-dilution case from merged regex noise.

## P0/P1/P2 Findings

### P0

None.

### P1

1. Diversity can be falsely "corroborated" by a single source because `calculateDiversityBonus()` counts raw `matchedClaims` occurrences, not distinct sources per claim.

`scoreMetadataOnly()` appends to `matchedClaims` from multiple scoring components without deduping at `tools/lib/sources/matcher.ts:383-387`, `tools/lib/sources/matcher.ts:398-402`, `tools/lib/sources/matcher.ts:433-435`, and `tools/lib/sources/matcher.ts:448-450`, then returns the raw array at `tools/lib/sources/matcher.ts:455-458`. `calculateDiversityBonus()` then increments claim counts for every entry in that array at `tools/lib/sources/matcher.ts:227-230`. That means one source can contribute the same claim multiple times and be mistaken for multi-source corroboration.

Impact: a single strong metadata match plus one unrelated candidate can earn a diversity bonus that was supposed to require 2+ confirming sources.

2. The diversity bonus is applied to every candidate, including candidates that did not contribute corroborated claims.

`match()` computes one global bonus at `tools/lib/sources/matcher.ts:571` and adds it to all scored candidates at `tools/lib/sources/matcher.ts:572-576`. This can move an unrelated candidate across the pass threshold purely because other sources agreed with each other.

Impact: false-positive passes are possible when the top-ranked candidate did not itself benefit from corroboration.

### P2

1. Unconditional regex+LLM merging can lower match scores and create false negatives.

`extractClaimsAsync()` always merges regex claims after LLM success at `tools/lib/sources/matcher.ts:194-205`. Because downstream scorers normalize against total claim count at `tools/lib/sources/matcher.ts:285`, `tools/lib/sources/matcher.ts:300`, and `tools/lib/sources/matcher.ts:389-390`, extra unmatched regex tokens can dilute precise LLM claims and reduce the final score.

Impact: the "enhanced" extraction path can underperform the LLM-only path on posts where regex extraction is noisy.

2. Prompt construction is vulnerable to placeholder collision when post text contains literal `{TAGS}`.

The prompt is built with sequential `.replace()` calls at `tools/lib/sources/matcher.ts:154-156`. If `postText` includes `{TAGS}`, the second replacement can mutate the inserted text rather than the intended `Tags:` field.

Impact: malformed prompts, degraded claim extraction, and easy prompt-shape manipulation by user content.

## Missing Test Coverage

- No test for the 10s timeout path in `extractClaimsLLM()` and regex fallback after timeout.
- No test for 1500-character truncation before prompting.
- No test for uppercase or mixed-case fenced JSON responses, despite the implementation explicitly claiming case-insensitive support.
- No test for literal `{TAGS}` or `{TEXT}` substrings in `postText` or `postTags`.
- No test that diversity counts distinct sources only once per claim.
- No test that non-contributing candidates do not receive a diversity bonus.
- No test demonstrating the score-dilution case when LLM claims are merged with noisy regex claims.

## Risk Assessment

Implementation status: complete. `extractClaimsLLM()`, `extractClaimsAsync()`, `calculateDiversityBonus()`, and the async `match()` path all exist in `tools/lib/sources/matcher.ts`, and `npm test -- tests/matcher.test.ts` passed with 15/15 tests in this workspace.

Production risk is still moderate. The core feature set from the task is present, but the current diversity logic can create false-positive passes, and the regex merge strategy can create false negatives. Those are scoring correctness issues, not just polish gaps.
