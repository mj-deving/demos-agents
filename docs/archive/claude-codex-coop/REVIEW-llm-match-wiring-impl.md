# LLM Match Wiring Implementation Review

## Findings

No functional findings in the implementation reviewed.

Residual test gap:

1. The new suite covers the `extensions.ts -> matcher.ts` boundary well, but it does not exercise the `session-runner.ts -> extensions.ts` call site at `tools/session-runner.ts:1717-1726`. Since Q1 is specifically about end-to-end threading from session-runner into `match()`, one thin integration test at that boundary would make the wiring review complete.

## Answers to Q1-Q5

### Q1

Yes. The provider reaches `match()` correctly.

- `tools/session-runner.ts:1717-1726` passes `llm: provider` into `runAfterPublishDraft(...)`.
- `tools/lib/extensions.ts:51-63` adds `llm?: LLMProvider | null` to `AfterPublishDraftContext`.
- `tools/lib/extensions.ts:154-166` forwards `llm: ctx.llm` into `sourcesMatch(...)`.
- `tools/lib/sources/matcher.ts:46-54` accepts `llm?: LLMProvider | null` on `MatchInput`.
- `tools/lib/sources/matcher.ts:494-507` destructures `llm` and passes it into `extractClaimsAsync(...)`.

So the runtime path is intact from session-runner to extension dispatcher to matcher.

### Q2

Mostly yes for the changed wiring, but not fully end-to-end.

What is covered in `tests/extensions-llm-wiring.test.ts`:

- `llm` present: `tests/extensions-llm-wiring.test.ts:94-103`
- `llm` omitted / `undefined`: `tests/extensions-llm-wiring.test.ts:105-113`
- `llm = null`: `tests/extensions-llm-wiring.test.ts:115-123`
- dispatch still returns a normal decision: `tests/extensions-llm-wiring.test.ts:125-144`
- missing `sourceView`: `tests/extensions-llm-wiring.test.ts:146-154`
- missing `preflightCandidates`: `tests/extensions-llm-wiring.test.ts:156-163`
- full `MatchInput` propagation: `tests/extensions-llm-wiring.test.ts:165-178`

That covers the edge cases called out in the task. The remaining gap is that all tests call `runAfterPublishDraft(...)` directly with a mocked matcher, so they do not verify the production `session-runner.ts` call site.

### Q3

No material type-safety issue.

`AfterPublishDraftContext.llm?: LLMProvider | null` in `tools/lib/extensions.ts:51-63` matches `MatchInput.llm?: LLMProvider | null` in `tools/lib/sources/matcher.ts:46-54`, so the types line up across the boundary. Making the field optional also preserves compatibility with callers that do not provide it.

The only minor note is that this is intentionally tri-state (`undefined`, `null`, or provider). That is more permissive than strictly necessary, but the matcher already handles both falsy states correctly.

### Q4

No practical circular import risk from this change.

- `tools/lib/extensions.ts:19` uses `import type { LLMProvider } from "./llm-provider.js";`, which is type-only.
- The repo is using TypeScript ESM with `module: "ESNext"` and `moduleResolution: "bundler"` in `tsconfig.json:2-6`.
- `tools/lib/llm-provider.ts` does not import `extensions.ts`.

So this adds a compile-time type dependency, not a new runtime module edge. Also, `tools/lib/sources/matcher.ts` already has the same kind of type-only dependency on `llm-provider.ts`.

### Q5

No backward-compatibility concern from the new field.

- The only production call site I found is `tools/session-runner.ts:1717-1726`, and it now passes `llm`.
- `runAfterPublishDraft(...)` still accepts the same shape plus one optional field in `tools/lib/extensions.ts:258-274`.
- If any other caller existed and omitted `llm`, the behavior would remain unchanged because the matcher treats missing or `null` `llm` as "use regex-only extraction" rather than failing.

## Verification

Ran `npx vitest run tests/extensions-llm-wiring.test.ts` and the suite passed: 8 tests, 1 file.
