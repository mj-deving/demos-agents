# Codex Review: PR6 Matcher Hardening (Implementation Review)

## Context

PR6 added two features to the matcher (tools/lib/sources/matcher.ts):
1. LLM-assisted claim extraction (extractClaimsLLM, extractClaimsAsync)
2. Cross-source diversity scoring (calculateDiversityBonus)

Plus a /simplify follow-up that added:
- 10s timeout via Promise.race on LLM calls
- postText truncation to 1500 chars
- Prompt extracted to CLAIMS_EXTRACTION_PROMPT constant
- Case-insensitive code fence regex
- Variable rename for clarity

## Files to Read

```bash
cat tools/lib/sources/matcher.ts
cat tests/matcher.test.ts
```

## Questions for Review

Q1: Is the 10s LLM timeout appropriate? Could it be too short for some providers, too long for the match pipeline?

Q2: The diversity bonus applies equally to ALL scored candidates. Should it only apply to candidates that contributed corroborated claims?

Q3: extractClaimsAsync always runs regex extraction even when LLM succeeds. The intent is to merge both for maximum coverage. Is there a case where this causes worse results (e.g., regex noise diluting LLM precision)?

Q4: The prompt uses simple string replacement (`{TEXT}`, `{TAGS}`) — is there a risk of prompt injection if postText contains `{TEXT}` or `{TAGS}` literally?

Q5: Are the 12 new tests sufficient for production confidence, or are there missing edge cases?

## Output Format

Write findings to `claude-codex-coop/REVIEW-matcher-hardening-impl.md`. Structure:
1. Answers to Q1-Q5
2. P0/P1/P2 findings with file locations and line numbers
3. Missing test coverage
4. Risk assessment
