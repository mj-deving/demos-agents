# Codex Review: PR6 Matcher Hardening (Design Review)

## Context

Upgrading the matcher (tools/lib/sources/matcher.ts) with:
1. LLM-assisted claim extraction — replaces regex-only approach
2. Cross-source evidence diversity scoring — bonus for multi-source corroboration

## Design

### New: extractClaimsLLM(postText, postTags)
- Async function calling llm-provider.ts complete()
- Prompt: "Extract structured claims from this text: entities, numeric facts, causal relationships, temporal claims. Return JSON array of strings."
- Parses JSON response into string[]
- Returns [] on any failure (parse error, LLM unavailable, timeout)

### New: extractClaimsAsync(postText, postTags)
- Tries extractClaimsLLM first
- If LLM returns claims, merges with regex claims (union, deduped)
- If LLM fails, falls back to regex-only extractClaims()
- Original sync extractClaims() unchanged for backward compatibility

### New: diversity scoring in match()
- After scoring all candidates individually, count claims matched by 2+ sources
- Diversity bonus: +5 per corroborated claim, max +15
- Applied to best candidate's final score only
- No penalty for single-source (bonus is additive, never subtractive)

### Updated: match() pipeline
- Replace extractClaims() call with await extractClaimsAsync()
- Add diversity scoring after candidate scoring loop

## Test Contracts

### extractClaimsLLM
- Returns parsed claims from valid JSON LLM response
- Returns empty array when LLM throws
- Returns empty array when LLM returns non-JSON text
- Returns empty array when LLM returns empty response

### extractClaimsAsync
- Returns LLM claims merged with regex claims when LLM succeeds
- Returns regex-only claims when LLM fails
- Deduplicates merged claims

### Diversity scoring
- 0 bonus when only 1 source (single candidate)
- +5 when 1 claim matched by 2 sources
- +10 when 2 claims matched by 2+ sources
- Capped at +15 regardless of corroboration count
- Does not reduce any candidate's base score

### match() integration
- match() calls extractClaimsAsync (verified via mock)
- match() applies diversity bonus to best candidate

## Questions for Review

Q1: Should extractClaimsLLM use "fast" or "standard" model tier? Fast is cheaper but may miss nuanced claims.

Q2: Should diversity scoring apply to ALL scored candidates or only the best? Applying to all changes ranking; applying to best only is simpler.

Q3: Is the +5 per corroborated claim / +15 cap the right balance? Too high risks false positives.

Q4: Should extractClaimsAsync timeout the LLM call (e.g., 5s) to avoid blocking the match pipeline?

Q5: Should the LLM prompt include the postTags as context for better claim extraction?

## Files to Read
```bash
cat tools/lib/sources/matcher.ts
cat tools/lib/llm-provider.ts
cat tests/matcher.test.ts
```

## Output Format
Write findings to `claude-codex-coop/REVIEW-matcher-hardening.md`.
