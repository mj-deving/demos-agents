# Session: SDK Deep-Dive, D402/Storage/TLSN Research, Toolkit Design Update

**Date:** 2026-03-26 22:30
**Duration:** ~1.5 hours (incremental block after prior wrapup at 21:10)
**Mode:** incremental
**Working Directory:** /home/mj/projects/demos-agents

## Summary

Deep exploration of KyneSys GitHub org (23 repos), SDK v2.11.5 upgrade, and parallel research into three SDK modules (D402, Storage Programs, TLSN). Updated toolkit design doc with all findings. Wired 2 MCP servers for SDK documentation access.

## Work Done

- **SDK upgrade 2.11.4 → 2.11.5** — all 1437 tests pass, L2PS messaging types added
- **KyneSys org fully mapped** — 23 repos, 6 NPM packages, 3 MCP servers. Full map at `MEMORY/WORK/.../kynesyslabs-org-map.md`
- **D402 Payment Protocol deep-dive** — complete HTTP 402 micropayment system. Client auto-pays on 402, server Express middleware. Gasless d402_payment tx type. No external docs exist. Added `pay()` to toolkit MVP.
- **Storage Programs confirmed still blocked** — SDK mature (granular JSON ops, binary, group ACL, 1MB limit), our wrappers ready. RPC nodes still return "Unknown message". Blocker is KyneSys infrastructure.
- **TLSN conclusively diagnosed** — tlsn-component repo is same engine in iframe. All paths use identical tlsn-js WASM. Hang is KyneSys notary server. Our bridge code is correct.
- **2 MCP servers wired** — `demosdk_references` (get.demos.sh, API ref search) + `demosdk_docs` (GitBook docs scraper)
- **Toolkit design doc updated** — Session 5 iteration, 6 new decisions, D402 in MVP, prediction markets shipped, vertical table expanded
- **CLAUDE.md updated** — SDK version, new subpath exports

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Add pay() to MVP tool surface | D402 is complete in SDK, gasless, ~20 line integration | Defer D402 (rejected — ready now) |
| Storage deferred from MVP | SDK ready but nodes broken | Build against SDK speculatively (rejected — can't test) |
| TLSN stays disabled | All three approaches share same broken notary | Test reference notary (possible future) |
| Monitor ERC-8004 as top strategic item | On-chain agent identity is game-changing for CCI | Implement CCI workaround first (still valid but ERC-8004 is better) |

## Key Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| `package.json` | edited | SDK 2.11.4 → 2.11.5 |
| `CLAUDE.md` | edited | SDK version + new subpath exports |
| `docs/design-toolkit-architecture.md` | edited | Session 5, 6 decisions, D402 MVP, vertical table |
| `~/.claude.json` | edited | 2 MCP servers added |

## Learnings

- KyneSys SDK is far ahead of their infrastructure (D402, Storage, TLSN all complete in code, blocked on nodes)
- ERC-8004 Agent Identity (SDK issue #70) is the most strategically important upcoming feature
- D402 is undocumented — reading source code is the only way to understand it
- DeepWiki (deepwiki.com) provides free AI-generated documentation for any public GitHub repo
- tlsn-component is NOT an alternative TLSN engine — same WASM, same hang
- SDK releases ~2/week pace. Stay current.

## Open Items

- [ ] Toolkit MVP implementation (next session — design doc complete)
- [ ] D402 `d402/verify` RPC endpoint live test
- [ ] Colony census (supercolony.ai DNS still down)
- [ ] DEMOS PAI skill needs updating (still points to archived DEMOS-Work)

## Context for Next Session

Toolkit MVP implementation session. Design doc at `docs/design-toolkit-architecture.md` has all answers (5 sessions of design, 13+ decisions, all questions resolved). MVP = 10 atomic tools + rate-limit guard. Implementation is `git mv` + new package boundaries + thin wrappers. D402 pay() is ~20 lines. Two MCP servers available for SDK doc lookup. SDK at v2.11.5.
