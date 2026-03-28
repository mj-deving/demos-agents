# Session: TLSN Debug & KyneSys Report

**Date:** 2026-03-14 08:24
**Duration:** ~4 hours
**Mode:** full
**Working Directory:** ~/projects/demos-agents

## Summary

Exhaustive TLSN MPC-TLS debugging session culminating in a definitive proof that the failure is server-side infrastructure on `node2.demos.sh`. Created a comprehensive KyneSys report, made the repo public, and applied several code correctness fixes.

## Work Done

- Applied `?token=<hostname>` fix to both TLSN bridges (`tlsn-playwright-bridge.ts`, `tlsn-node-bridge.ts`) — correctness fix found by Codex
- Removed unsupported `PATCH` method from TLSN bridge type union and switch
- Built `tools/tlsn-sdk-test.ts` — definitive test using SDK's own `Prover.notarize()` static path
- Verified on-chain: 51 `tlsn_request` txs, 0 `tlsn_store` txs — TLSN never completed
- Verified network-wide: 100 recent posts, 47 publishers, 0 TLSN attestations — nobody has working TLSN
- Tested multi-target (blockstream.info + coingecko) — same failure, not target-specific
- Created `docs/TLSN-Report-KyneSys-2026-03-14.md` — 9-section report for KyneSys team
- Made repo public (`gh repo edit --visibility public`)
- Gitignored `CLAUDE.md` and `MEMORY/WORK/`, removed from git tracking
- Updated README with WIP notice and accurate loop version description
- Updated memory files with all TLSN debug findings

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Definitive SDK test before reporting to KyneSys | Need 100% certainty it's server-side before engaging vendor | Could have reported earlier with less evidence |
| Make repo public | User requested — share diagnostic scripts with KyneSys | Keep private and share report only |
| Gitignore CLAUDE.md | Contains local operational context not suitable for public repo | Keep tracked but sanitize |
| Keep `?token=` fix despite not solving the problem | Correctness fix — will be needed when infrastructure is repaired | Revert since it didn't fix the issue |

## Key Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| `tools/lib/tlsn-playwright-bridge.ts` | edited | `?token=` fix, PATCH removal, console logging |
| `tools/lib/tlsn-node-bridge.ts` | edited | `?token=` fix for correctness |
| `tools/tlsn-sdk-test.ts` | created | Definitive SDK reference path test (245 lines) |
| `docs/TLSN-Report-KyneSys-2026-03-14.md` | created | Comprehensive KyneSys report (219 lines) |
| `README.md` | edited | WIP notice, accurate loop description, current state |
| `.gitignore` | edited | Added MEMORY/WORK/, CLAUDE.md |
| `claude-codex-coop/REPORT-tlsn-debug.md` | edited | Added definitive evidence section |

## Learnings

- `tlsn-js` has divergent static vs instance API paths — `Prover.notarize()` handles `?token=` internally, `prover.sendRequest()` does not
- `@kynesyslabs/demosdk` `TLSNotary.attest()` has the same `?token=` bug at two call sites
- `page.evaluate()` with tsx/esbuild can inject `__name` helpers that don't exist in browser context — keep evaluate bodies minimal
- On-chain transaction history (`getTransactionHistory`) is a powerful diagnostic — can count `tlsn_request` vs `tlsn_store` to verify pipeline completion
- Network-wide feed analysis is the strongest evidence for server-side issues — if nobody has TLSN attestations, it's not our problem

## Open Items

- [ ] Deliver KyneSys report and await their response
- [ ] Phase 4: Provider adapters (next implementation work)
- [ ] Pioneer calibration tuning (avg error -9.7rx)
- [ ] Shadow session validation of catalog-preferred mode

## Context for Next Session

TLSN debugging is complete — definitively server-side, KyneSys report ready at `docs/TLSN-Report-KyneSys-2026-03-14.md`. Repo is now public. Next implementation work is Phase 4 (provider adapters) of the unified loop architecture v2. The `?token=` fix is applied to both bridges and will be needed when KyneSys fixes their infrastructure.
