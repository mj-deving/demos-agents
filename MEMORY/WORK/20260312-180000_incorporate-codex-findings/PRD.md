---
task: Incorporate 7 Codex findings then re-review
slug: 20260312-180000_incorporate-codex-findings
effort: advanced
phase: verify
progress: 21/24
mode: interactive
started: 2026-03-12T18:00:00Z
updated: 2026-03-12T18:10:00Z
---

## Context

Incorporating 7 unfixed Codex review findings from 2026-03-12 into the demos-agents codebase.

### Risks
- Manual schema validation is permissive on extra fields (by design)
- CLIProvider whitespace splitting won't handle quoted args (acceptable — current commands don't use them)

## Criteria

- [x] ISC-1: CLIProvider uses spawn() without shell for command execution
- [x] ISC-2: LLM_CLI_COMMAND parsed into executable + args array
- [x] ISC-3: Prompt piped via stdin.write() without shell interpolation
- [x] ISC-4: apiCall() strips Authorization header for non-supercolony.ai URLs
- [x] ISC-5: apiCall() allows unauthenticated requests to any URL (no token attached)
- [x] ISC-6: persona.yaml validated with typed checks on load
- [x] ISC-7: Invalid persona.yaml types throw clear error messages
- [x] ISC-8: Missing persona.yaml fields still get defaults (backward compat)
- [x] ISC-9: envFile removed from AgentConfig interface
- [x] ISC-10: envFile field no longer loaded from persona.yaml
- [x] ISC-11: envFile removal is clean — no runtime references remain
- [x] ISC-12: attestDahr() returns attestUrl (rewritten URL) as url field
- [x] ISC-13: AttestResult type includes both requestedUrl and url fields
- [x] ISC-14: Callers see the actual URL that was attested for audit trail
- [x] ISC-15: ensureAuth() removed from runPublishAutonomous()
- [x] ISC-16: Token variable removed from publish phase scope
- [x] ISC-17: ensureAuth import removed from session-runner (no other usage)
- [x] ISC-18: loadMnemonic() handles unquoted DEMOS_MNEMONIC values
- [x] ISC-19: loadMnemonic() handles single-quoted DEMOS_MNEMONIC values
- [x] ISC-20: loadMnemonic() trims whitespace from parsed mnemonic
- [x] ISC-21: All changes compile without TypeScript errors
- [ ] ISC-22: No existing functionality regressed
- [ ] ISC-23: Changes committed with descriptive message
- [ ] ISC-24: Codex re-review requested on the commit

## Decisions

- envFile: removed from model (was always null, never wired). Can re-add in Phase 4 if needed.
- Schema validation: manual typed checks, no new dependency. Permissive on extra fields.
- CLIProvider: stdin pipe instead of temp file + shell redirect. Simpler and safer.
- attestDahr URL: `url` field now holds attested URL, `requestedUrl` holds original.

## Verification
