# Session: Demos-First Identity, Quantum Wallet, Feed-Mining

**Date:** 2026-03-20 21:00
**Duration:** ~3 hours
**Mode:** full
**Working Directory:** /home/mj/projects/omniweb-agents

## Summary

Massive session establishing Demos-first development philosophy. Built Phase 5 agent composition plan (Codex-reviewed), upgraded wallet to post-quantum (Falcon), replaced all scaffold blockers with silent-fail pattern, mined ~20k feed posts for 71 new sources, created identity and feed-mine CLIs, built master INDEX.md, and added Phase 7 (full SDK integration) to roadmap.

## Work Done

- Phase 5 agent composition plan written and Codex-reviewed (3 design principles from biology/music/systems theory)
- PQC wallet: `connectWallet()` now accepts `{ algorithm: "falcon", dualSign: true }`
- CCI identity plugin: scaffold blocker → real `getIdentities` RPC query
- 4 scaffold plugins → silent-fail: cci-identity, chain-query, address-watch, demoswork
- Agent Auth Protocol analysis: complementary to Demos CCI (passport + boarding pass model)
- `@auth/agent@0.3.0` SDK evaluated (loads, keypair gen works, discovery works)
- Identity CLI: proof generation, Twitter/GitHub linking, identity query, removal
- Feed-mine CLI: pagination, URL filtering, catalog persistence, mined ~20k posts → 71 new sources
- Master INDEX.md: project narrative, SDK capability map, doc index, session changelog
- Phase 7 added to roadmap: systematic full Demos SDK integration across 6 tiers
- SDK upgraded to 2.11.4
- Stale backlog items cleaned from MEMORY.md

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Bypass `Identities` class via DemosTransactions directly | NAPI SIGSEGV in abstraction barrel | Wait for KyneSys fix; use subprocess |
| Silent-fail for all scaffold plugins | Demos-first: try features, warn on failure, never exclude | Keep throwing errors (old approach) |
| Feed-mine filter: allow-list APIs/feeds, deny-list social/articles | Prevent catalog pollution with non-reusable URLs | No filter (too noisy); strict API-only (misses RSS) |
| All agents share ONE CCI identity | Architecture: sentinel/crawler/pioneer are sub-agents of future master orchestrator | Per-agent identities (rejected — they're roles, not entities) |
| Phase 7 tier ordering: Identity → Chain Query → Cross-chain → Comms → Storage → External | Identity/reputation is the moat; storage blocked externally | Build in SDK barrel order (no strategic priority) |

## Key Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| `src/lib/sdk.ts` | edited | PQC wallet support (algorithm, dualSign options) |
| `src/lib/identity.ts` | created | Web2 identity operations via DemosTransactions (bypass NAPI) |
| `cli/identity.ts` | created | Identity management CLI (proof, add-twitter, add-github, list, remove) |
| `cli/feed-mine.ts` | created | Feed-mining CLI with pagination, URL filtering, catalog persistence |
| `src/plugins/cci-identity-plugin.ts` | edited | Scaffold → real RPC getIdentities query |
| `src/plugins/chain-query-plugin.ts` | edited | Scaffold → real RPC address query |
| `src/plugins/address-watch-plugin.ts` | edited | Scaffold → real RPC watch queries |
| `src/plugins/demoswork-plugin.ts` | edited | Scaffold → lazy SDK check + silent-fail |
| `tests/omniweb-plugins.test.ts` | edited | Updated for silent-fail pattern (version bumps, new test cases) |
| `docs/INDEX.md` | created | Master project document |
| `docs/phase5-agent-composition-plan.md` | created | Phase 5 design plan |
| `docs/agent-auth-demos-cci-analysis.md` | created | Agent Auth + Demos CCI strategic analysis |
| `docs/roadmap-unified.md` | edited | Added Phase 7 (full SDK integration) |
| `config/sources/catalog.json` | edited | 138 → 209 sources (71 feed-mined) |

## Learnings

- Demos `abstraction` barrel SIGSEGV is from transitive FHE/PQC/zK native module loading, not Identities class
- Workaround: reconstruct RPC calls using `DemosTransactions.empty()` + `demos.sign()` + `demos.confirm()`
- SC feed API caps at ~20k posts via `offset` param. `skip` param is non-functional. Full 112k needs GCR/RPC query.
- 73.5% of recent SC posts carry attestations — the feed is a self-curating source ecosystem
- `Demos` class natively supports PQC: `connectWallet(mnemonic, { algorithm: "falcon", dual_sign: true })`
- Codex found most session-loop plugins have NO real dependencies on each other (3 assumed edges disproved)
- Plugin files were empty shells — real hook logic was in session-runner.ts closures (Phase 0 prerequisite)

## Open Items

- [ ] Create dedicated agent Twitter account → link via identity CLI
- [ ] Phase 5, Phase 0: move hook logic from session-runner closures into 9 plugin files
- [ ] Curate 74 quarantined sources (promote good ones to active)
- [ ] Report NAPI crash to KyneSys (abstraction barrel needs splitting/lazy-loading)
- [ ] Tier 1 reputation plugins (Nomis/Ethos/Human Passport via RPC-direct)
- [ ] Tier 5 feed history via GCR/RPC (access full 112k posts)

## Context for Next Session

Big session: 9 commits, 3 new CLIs, 71 new sources, Phase 5 plan + Phase 7 roadmap. The immediate next step is either Phase 5 Phase 0 (move hook logic into plugins — critical path for composition framework) or curating the 74 quarantined sources. Identity linking waits for a dedicated agent Twitter account. The Demos SDK has ~25 more capabilities to integrate per the Phase 7 roadmap.
