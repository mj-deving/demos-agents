# LLM Match Wiring Review

Date: 2026-03-14

Reviewed files:
- [tools/lib/extensions.ts](/home/mj/projects/omniweb-agents/tools/lib/extensions.ts)
- [tools/lib/sources/matcher.ts](/home/mj/projects/omniweb-agents/tools/lib/sources/matcher.ts)
- [tools/lib/llm-provider.ts](/home/mj/projects/omniweb-agents/tools/lib/llm-provider.ts)
- [tools/session-runner.ts](/home/mj/projects/omniweb-agents/tools/session-runner.ts)
- [tests/matcher.test.ts](/home/mj/projects/omniweb-agents/tests/matcher.test.ts)

## Findings

- P2: The proposed test contract misses the explicit `null` path. `match()` already treats `llm?: LLMProvider | null` as a supported regex-only fallback surface at [tools/lib/sources/matcher.ts:184](/home/mj/projects/omniweb-agents/tools/lib/sources/matcher.ts#L184), but the contract only asks for "present" and "undefined" in hook wiring. If `AfterPublishDraftContext` mirrors matcher with `llm?: LLMProvider | null`, add a test for `llm: null` to ensure the hook forwards it cleanly and preserves regex-only behavior.

- P2: The proposed tests stop at argument threading and do not verify that wiring changes runtime behavior. Existing matcher coverage proves `extractClaimsLLM()` and `extractClaimsAsync()` fall back safely on errors at [tests/matcher.test.ts:197](/home/mj/projects/omniweb-agents/tests/matcher.test.ts#L197) and [tests/matcher.test.ts:243](/home/mj/projects/omniweb-agents/tests/matcher.test.ts#L243), but there is no automated contract that a wired `llm` actually reaches `match()` from the session path and causes LLM claim extraction to be attempted. Add one integration test that asserts the same provider instance reaches `sourcesMatch()` / `match()` and one that exercises timeout or rejection without failing the hook.

- P3: The contract does not preserve the existing skip guards in `runSourcesMatchHook()`. Today the hook returns `void` unless both `sourceView` and `preflightCandidates` are present at [tools/lib/extensions.ts:151](/home/mj/projects/omniweb-agents/tools/lib/extensions.ts#L151). Since the PR changes this context shape, add a regression test that `llm` does not accidentally cause matcher execution when source prerequisites are absent.

## Q1

Yes. Threading `llm` through `AfterPublishDraftContext` is the right layer.

`session-runner.ts` already owns provider resolution at [tools/session-runner.ts:1643](/home/mj/projects/omniweb-agents/tools/session-runner.ts#L1643), while `matcher.ts` already consumes an abstract `LLMProvider` at [tools/lib/sources/matcher.ts:184](/home/mj/projects/omniweb-agents/tools/lib/sources/matcher.ts#L184) and [tools/lib/sources/matcher.ts:494](/home/mj/projects/omniweb-agents/tools/lib/sources/matcher.ts#L494). Having `runSourcesMatchHook()` call `resolveProvider()` directly would couple the extension layer to env/config discovery and make the hook harder to test.

## Q2

`llm` should be optional, and mirroring matcher with `llm?: LLMProvider | null` is reasonable.

`AfterPublishDraftContext` is an exported hook contract at [tools/lib/extensions.ts:50](/home/mj/projects/omniweb-agents/tools/lib/extensions.ts#L50). Making the field required would create unnecessary breakage for any current or future caller that does not have an LLM. Keeping it optional preserves compatibility, and allowing `null` matches the existing matcher API so callers do not need to normalize the value.

## Q3

Keeping `provider` resolved inside the per-topic loop is fine for this PR.

`resolveProvider()` is effectively stateless discovery over env and CLI availability at [tools/lib/llm-provider.ts:261](/home/mj/projects/omniweb-agents/tools/lib/llm-provider.ts#L261). Hoisting it once per run would be a small cleanup, but it is not necessary to justify this wiring change. Reusing the already-resolved per-topic `provider` in the `runAfterPublishDraft()` context is the minimal and correct change.

## Q4

Yes for correctness; no blocker.

`extractClaimsLLM()` is bounded by a 10 second `Promise.race()` and catches timeout/error/parse failures to `[]` at [tools/lib/sources/matcher.ts:157](/home/mj/projects/omniweb-agents/tools/lib/sources/matcher.ts#L157). `extractClaimsAsync()` then falls back to regex claims at [tools/lib/sources/matcher.ts:191](/home/mj/projects/omniweb-agents/tools/lib/sources/matcher.ts#L191). That is sufficient to prevent hard publish-pipeline failure from LLM claim extraction. The remaining tradeoff is latency: worst case, it can still add about 10 seconds per topic before matching continues.

## Q5

Yes, but the log should live at the runtime boundary, not inside `matcher.ts`.

`matcher.ts` is a library module; `observe()` usage is concentrated in the runner/runtime path such as [tools/session-runner.ts:1632](/home/mj/projects/omniweb-agents/tools/session-runner.ts#L1632) and [tools/session-runner.ts:1746](/home/mj/projects/omniweb-agents/tools/session-runner.ts#L1746). A low-cardinality observation like `llm-claims-used` vs `llm-claims-fallback` with provider name would make this wiring debuggable without coupling the matcher to session logging.

## Verification

I ran `npx vitest run tests/matcher.test.ts`; 15 tests passed. That confirms matcher-level LLM extraction/fallback behavior already exists, but it does not cover the new extension/session wiring.
