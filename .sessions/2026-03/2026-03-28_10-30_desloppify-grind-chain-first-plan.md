# Session: Desloppify Grind + Chain-First Architecture Plan

**Date:** 2026-03-28 10:30
**Duration:** ~4 hours
**Mode:** full
**Working Directory:** ~/projects/omniweb-agents

## Summary

Massive desloppify grind session: merged the code-health branch, fixed 72+ open items across all categories (smells, unused code, security, deprecated, review findings), reorganized src/lib/ into 8 subdirectories, deleted 25 re-export shims, removed 8 deprecated functions, deleted 6 orphaned files. Then pivoted to planning the chain-first toolkit migration after discovering all 4 tools depend on the web API instead of the blockchain. Council + Codex + Red Team reviewed the plan.

## Work Done

- Merged `desloppify/code-health` branch into main (19 commits, 203 files)
- Fixed 30 code smells (magic numbers, async_no_await, complexity, dead code)
- Fixed 8 unused code items, 4 deprecated items, 4 security items, 5 logging items
- Fixed 14 holistic review items (verify exhaustion, isDemosErrorLike dedup, reply wrapper)
- Added 84 new tests (react, state-helpers, scan, tip, agent-config, catalog)
- Package reorg: 16 files moved into network/, pipeline/, util/ subdirectories
- Deleted 25 re-export shims, migrated 153+ imports to direct paths
- Deleted 8 deprecated guard functions + updated all tests
- Deleted 6 confirmed dead orphaned files (941 LOC)
- Fixed extensions.ts import cycle
- Ran 3 blind review cycles with attested scores
- Established "on-chain first" + "security-first" as non-negotiable architecture principles
- Created chain-first migration plan with Council (4 agents), Codex CLI, Codex Researcher, Red Team reviews

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Reactions go on-chain as HIVE transactions | Marius directive: everything on-chain. Security + Researcher agreed. | Council split 2:2, indexer-only was the pragmatic alternative |
| Skip desloppify triage pipeline | 6-stage bureaucracy doesn't fix code — directly fix bottom 5 dimensions | Full triage workflow |
| Bridge exposes domain-aware methods | Match existing pattern (publishHivePost, attestDahr) not raw SDK pass-throughs | Raw getTxByHash/getTransactions proxies |
| reactionsKnown flag instead of undefined | Red team: undefined causes silent NaN corruption in 6+ call sites | number \| undefined type change |
| Auth skipped in chain-only mode | Chain operations use wallet signatures, not API tokens | Always require auth |

## Key Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| src/toolkit/index.ts | edited | Removed 8 deprecated guard exports |
| src/toolkit/guards/*.ts | edited | Deleted deprecated functions, added removal timelines |
| src/toolkit/tools/verify.ts | edited | Returns err on exhaustion instead of ok(confirmed:false) |
| src/toolkit/tools/publish.ts | edited | Extracted guardAndPublish, reply routes through withToolWrapper |
| src/toolkit/tools/scan.ts | edited | Magic numbers extracted, error logging added |
| src/toolkit/session.ts | edited | Policy default constants extracted |
| src/lib/**/ | reorganized | 8 subdirs, 25 shims deleted, 153+ imports migrated |
| CLAUDE.md | edited | Architecture principles, test counts, chain-first principle |
| Plans/chain-first-toolkit-migration.md | created | Full migration plan with reviews |

## Learnings

- Desloppify subjective scores don't auto-update — need blind review after each fix round
- Re-export shims inflate file count and get penalized by reviewers as organizational debt
- The whole toolkit wrongly depends on supercolony.ai web API — blockchain should be sole dependency
- `ensureAuth()` calls web API but chain operations don't need auth tokens (wallet signs directly)
- Red team found NaN corruption from undefined reactions — silent bugs that never crash but poison all arithmetic

## Open Items

- [ ] Chain-first migration: ~3 sessions (plan ready at Plans/chain-first-toolkit-migration.md)
- [ ] Desloppify remaining: design_coherence 68, type_safety 72, incomplete_migration 76
- [ ] Verify RawTransaction vs Transaction SDK types before implementation
- [ ] Test getTransactionHistory type filtering on live RPC node
- [ ] WS2 (OpenClaw adapter) after chain-first ships

## Context for Next Session

The chain-first migration plan is fully reviewed and ready to execute. Start with Step 1 (connect + auth + bridge infrastructure). The plan is at `Plans/chain-first-toolkit-migration.md`. Key: make apiBaseUrl optional, skip ensureAuth in chain-only mode, add domain-aware bridge methods (verifyTransaction, getHivePosts, resolvePostAuthor, publishHiveReaction). Architecture principles "on-chain first" and "security-first" are now in CLAUDE.md. 1899 tests passing, 16 commits this session.
