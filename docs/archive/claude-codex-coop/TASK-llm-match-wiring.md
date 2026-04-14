# Codex Review: LLM Match Wiring (Design Review)

## Context

PR6 shipped LLM-assisted claim extraction in `matcher.ts` — the `match()` function accepts an optional `llm` field on `MatchInput`. But the session loop never passes it. The `runSourcesMatchHook()` in `extensions.ts` calls `sourcesMatch()` without `llm`, so LLM claim extraction is dead code in production.

This PR wires the LLM provider from session-runner through the extension hook system into match().

## Design

### Changes (2 files, ~5 lines)

**`tools/lib/extensions.ts`:**
1. Add `llm?: LLMProvider | null` to `AfterPublishDraftContext` interface (import the type)
2. In `runSourcesMatchHook()`, pass `ctx.llm` to the `sourcesMatch()` call

**`tools/session-runner.ts`:**
1. In the `runAfterPublishDraft()` call (~line 1717), add `llm: provider` to the context object
   - `provider` is already resolved at line 1643 via `resolveProvider(flags.env)`

### No changes needed
- `matcher.ts` — already accepts `llm` via `MatchInput.llm`
- `llm-provider.ts` — no changes
- No new dependencies

## Test Contracts

### extensions.test.ts (new or added to existing)
- `runSourcesMatchHook` passes `llm` from context to `sourcesMatch()` when present
- `runSourcesMatchHook` passes `undefined` for `llm` when context has no `llm` field
- `AfterPublishDraftContext` with `llm` set does not break existing hook dispatch
- `runAfterPublishDraft` propagates `llm` through the extension registry to the hook

### Integration behavior (verify manually or in existing tests)
- When LLM_PROVIDER is set, match() receives the provider and uses LLM claim extraction
- When no LLM is available, match() falls back to regex-only claims (existing behavior preserved)

## Questions for Review

Q1: Is threading `llm` through `AfterPublishDraftContext` the right layer? Alternative: could `runSourcesMatchHook` call `resolveProvider()` directly. But that breaks the dependency inversion — extensions shouldn't know about env config.

Q2: Should `llm` be required or optional on the context? I say optional (`llm?: LLMProvider | null`) to preserve backward compatibility — other callers of `runAfterPublishDraft` that don't have an LLM provider shouldn't break.

Q3: The `provider` variable in session-runner is scoped inside the for-loop body (line 1643). It's resolved per-topic. Is that fine, or should we hoist it to the function scope and resolve once? (I'd say per-topic is fine — resolveProvider is cheap and stateless.)

Q4: Any risk of the LLM timeout (10s in matcher.ts) blocking the publish pipeline? The existing `Promise.race` in `extractClaimsLLM` handles this — on timeout it falls back to regex claims. Confirm this is sufficient.

Q5: Should we add an observation log entry when LLM claim extraction is used vs. regex-only fallback, for debugging?

## Files to Read

```bash
cat tools/lib/extensions.ts
cat tools/lib/sources/matcher.ts
cat tools/lib/llm-provider.ts
# session-runner context (line 1640-1730):
sed -n '1640,1730p' tools/session-runner.ts
```

## Output Format

Write findings to `claude-codex-coop/REVIEW-llm-match-wiring.md`. Answer Q1-Q5. Flag any missing test contracts. Do NOT modify source code.
