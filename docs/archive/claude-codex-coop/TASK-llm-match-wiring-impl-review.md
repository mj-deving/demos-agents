# Codex Review: LLM Match Wiring (Implementation Review)

## Context

Wired the LLM provider from session-runner through the extension hook system into match(). 3 lines changed across 2 files, 8 new tests.

## Changes Made

1. `tools/lib/extensions.ts`: Added `import type { LLMProvider }`, added `llm?: LLMProvider | null` to `AfterPublishDraftContext`, passed `llm: ctx.llm` to `sourcesMatch()` call
2. `tools/session-runner.ts`: Added `llm: provider` to `runAfterPublishDraft()` context (line ~1727)
3. `tests/extensions-llm-wiring.test.ts`: 8 tests covering llm threading, null/undefined handling, skip guards, and full MatchInput propagation

## Questions for Review

Q1: Does the LLM provider reach match() correctly? Verify the argument threading from session-runner → extensions → matcher.

Q2: Are the 8 tests sufficient? Check edge cases — null, undefined, missing sourceView, missing preflightCandidates.

Q3: Any type safety issues with the new field on AfterPublishDraftContext?

Q4: Does this introduce any circular import risk? extensions.ts now imports LLMProvider from llm-provider.ts.

Q5: Any backward compatibility concerns? Other callers of runAfterPublishDraft that don't pass llm?

## Files to Read

```bash
cat tools/lib/extensions.ts
sed -n '1715,1730p' tools/session-runner.ts
cat tests/extensions-llm-wiring.test.ts
```

## Output Format

Write findings to `claude-codex-coop/REVIEW-llm-match-wiring-impl.md`. Answer Q1-Q5. Do NOT modify source code.
