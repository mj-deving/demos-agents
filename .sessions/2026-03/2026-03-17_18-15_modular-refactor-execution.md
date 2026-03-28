# Session: Modular Refactor Execution + Build Pipeline

**Date:** 2026-03-17 18:15
**Duration:** ~4 hours
**Mode:** full
**Working Directory:** /home/mj/projects/demos-agents

## Summary

Executed the complete 6-phase modular refactor plan (42 ISC criteria) that was designed in the previous session. Then followed up with the build pipeline for npm publish and 7 FrameworkPlugin implementations. Fixed a cron PATH issue that was preventing publishing.

## Work Done

- **Phase 0:** Wrote 205 safety net tests across 10 suites (4 parallel worktree agents). Coverage: sdk, auth, log, observe, llm, feed-filter, subprocess, fetch, rate-limit, session-smoke (e2e)
- **Phase 1:** Deleted tlsn-node-bridge.ts (514 lines dead code). Removed superseded functions from attestation-policy.ts. Made 4 constants configurable (match threshold, rate limits, RPC_URL, sentinel default)
- **Phase 2:** Per-agent credential loading (credentials-{agent}), signing boundary guard (createSigningGuard)
- **Phase 3:** core/platform/connectors directory structure with 19 import boundary lint tests
- **Phase 4:** FrameworkPlugin type system (HookFn, DataProvider, Evaluator, PluginRegistry), SKILL.md, example agent template
- **Phase 5:** packages/core/ with package.json, README rewrite for external users
- **Follow-up:** tsc build pipeline (tsconfig.build.json → dist/), 7 plugin implementations, npm pack validation
- **Bug fix:** Added ~/.npm-global/bin to cron PATH — `claude` CLI was ENOENT, causing 0 posts for all agents

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Barrel re-exports over physical file moves | Backward compatibility — tools still import from tools/lib/ | Physical move (too much blast radius) |
| vitest-based import lint over eslint | Zero new dependencies, runs in existing CI | eslint-plugin-boundaries (future) |
| Static imports in sources-plugin.ts | Simpler, no runtime overhead | Dynamic import() (lazy loading) |
| tsconfig includes all tools/lib/ | tsc follows transitive imports; isolating just core files was impractical | Separate compilation per module |

## Key Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| core/index.ts | created | Barrel exports for portable core modules |
| core/types.ts | created | FrameworkPlugin, DataProvider, Evaluator types |
| core/plugins/*.ts | created | 7 plugin implementations |
| platform/index.ts | created | Platform-specific barrel exports |
| connectors/index.ts | created | SDK isolation layer |
| packages/core/ | created | Publishable npm package with build pipeline |
| tools/lib/tlsn-node-bridge.ts | deleted | Dead code (514 lines) |
| tools/lib/attestation-policy.ts | edited | Removed superseded v1 functions |
| tools/lib/sdk.ts | edited | Per-agent credentials, configurable URLs, unified parser |
| tools/lib/llm.ts | edited | Removed hardcoded sentinel defaults |
| tools/lib/spending-policy.ts | edited | Added createSigningGuard |
| tools/lib/sources/matcher.ts | edited | Configurable matchThreshold |
| tools/lib/write-rate-limit.ts | edited | Configurable rate limits |
| scripts/scheduled-run.sh | edited | Fixed PATH for claude CLI |
| tests/ (10 new files) | created | 239 new tests (205 safety + 16 plugins + 19 boundary) |

## Learnings

- Cron PATH is always different from interactive shell — always verify CLI tools are accessible
- Parallel worktree agents are excellent for test writing — 4 agents produced 205 tests simultaneously
- The simplify review caught real issues (parser duplication, dead code) — worth running even on small diffs
- tsc with rootDir="../.." preserves full directory structure in dist/ — entry points nest under dist/packages/core/
- Import boundary tests via vitest are surprisingly effective and zero-dependency

## Open Items

- [ ] Create per-agent credential files and fund wallets (ISC-22 operational)
- [ ] `npm publish` when ready to go public
- [ ] Consider eslint import boundary rules for real-time IDE enforcement
- [ ] Build a second consumer (non-SuperColony agent) to prove core portability
- [ ] TLSN recovery when KyneSys fixes MPC-TLS server

## Context for Next Session

Modular refactor is complete (42/42 ISC) and the build pipeline + plugins are done (28/28 ISC). 477 tests across 30 suites. The cron PATH fix was applied and validated with a live publish (sentinel session 30). Next priorities: fund per-agent wallets, npm publish, and validate cron continues publishing successfully across all 3 agents.
