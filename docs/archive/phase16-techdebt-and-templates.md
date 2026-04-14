---
summary: "Phase 16 (COMPLETE 2026-04-08): tech debt cleanup + primitives audit + template readiness. Superseded by Learn-first design — see docs/agent-use-case-specs.md for current template strategy."
read_when: ["phase 16", "tech debt"]
---

# Phase 16: Tech Debt Cleanup + Template Readiness

> Goal: Clear accumulated tech debt, then audit and polish primitives so agent templates can iterate fast.
> The V3 loop proved the primitives work. Now make them template-ready.

## Context

Phases 13-15 fixed the publish pipeline and broadened infrastructure. Sessions 93-97 proved the agent publishes reliably (3 posts in 5 sessions, tied to market novelty). But all this work flows through ONE agent (sentinel) serving ONE use case (gap-closing analysis).

The toolkit has 15 domains, 37+ methods, enrichedObserve(), createToolkit(), 256 sources, lifecycle persistence — all battle-tested. Three templates exist (base, market-intelligence, security-sentinel) but haven't been updated since the toolkit matured through Phases 11-15.

**Strategic shift:** Stop optimizing sentinel strategy. Focus on making primitives right so templates iterate fast.

## Part A: Tech Debt Cleanup

Clear before starting template work. All Codex-delegatable.

### 16a-1 — npm publish supercolony-toolkit

**Problem:** Package at `packages/omniweb-toolkit/` (103.8 kB) is ready but never published.

**Tasks:**
- [ ] Verify package.json has correct version, name, description
- [ ] Run `npm pack --dry-run` to check contents
- [ ] Publish: `cd packages/omniweb-toolkit && npm publish`
- [ ] Verify on npmjs.com

### 16a-2 — Wire lifecycle persistence into SENSE runtime

**Problem:** Codex review flagged: `persistRatingUpdate`/`persistTransition`/`loadPersistedLifecycle` exist but aren't called from v3-loop-sense.ts. Source ratings still reset each session.

**Tasks:**
- [ ] In v3-loop-sense.ts: after each source fetch, call `persistRatingUpdate(db, source, testResult)`
- [ ] In v3-loop-sense.ts: after lifecycle evaluation, call `persistTransition(db, source, result)`
- [ ] At SENSE startup: call `loadPersistedLifecycle(db, sourceId)` to restore ratings from previous sessions
- [ ] Tests for the wiring

**Files:** `cli/v3-loop-sense.ts`, `cli/v3-loop-helpers.ts`

### 16a-3 — Remove deprecated signals.ts + signals-plugin.ts

**Problem:** `src/lib/pipeline/signals.ts` and `src/plugins/signals-plugin.ts` are deprecated (v3-loop uses `toolkit.intelligence.getSignals()` instead). V1/V2 code that consumed them was removed in 15e.

**Tasks:**
- [ ] Verify no runtime imports remain (grep all .ts files)
- [ ] Delete `src/lib/pipeline/signals.ts`
- [ ] Delete `src/plugins/signals-plugin.ts`
- [ ] Remove from `src/plugins/index.ts` and `src/lib/util/extensions.ts` if referenced
- [ ] Run tests

### 16a-4 — ElizaOS adapter deprecation

**Problem:** 0 production consumers. Experimental code.

**Tasks:**
- [ ] Add deprecation comment + console.warn on import
- [ ] Or delete entirely if no tests depend on it

### 16a-5 — Carried Codex review findings

**Problem:** 3 findings carried from Phase 14 review, never addressed.

**Tasks:**
- [ ] Wire real divergence metadata into AngleContext (asset/type/severity from engine-enrichment.ts flat fields)
- [ ] Add ticker alias tests for SOL, DOT, LINK, UNI, ATOM, NEAR, OP (case-sensitive behavior)
- [ ] Add topic-angle edge case tests (long topics, punctuation, partial divergence, deterministic stability)

## Part B: Primitives Audit + Template Readiness

After Part A. Goal: ensure templates can use the toolkit without friction.

### 16b-1 — Primitives API audit

**Problem:** The 15 toolkit domains were built incrementally. Some may have inconsistent APIs, missing error handling, or unclear types.

**Tasks:**
- [ ] Audit each of the 15 `createToolkit()` domains: are return types consistent? Do all methods return `ApiResult<T>`?
- [ ] Check `enrichedObserve()`: does it give templates everything they need? Is the `ObserveResult.context` shape documented?
- [ ] Check `defaultObserve()` vs `enrichedObserve()`: is the opt-in clear?
- [ ] Verify `runAgentLoop()` in agent-loop.ts: does it accept all the executors templates need?
- [ ] Produce a primitives readiness report

### 16b-2 — Update existing templates to use current primitives

**Problem:** The 3 existing templates (base, market-intelligence, security-sentinel) were written before Phases 11-15 added enrichment, topic angle rotation, lifecycle persistence, etc.

**Tasks:**
- [ ] `templates/base/agent.ts` (99 lines): update to use `enrichedObserve()` instead of `defaultObserve()`
- [ ] `templates/market-intelligence/` (195 lines): wire `apiEnrichment` (oracle, prices, signals) into observe
- [ ] `templates/security-sentinel/` (239 lines): wire enrichment, update strategy.yaml with broadened topic weights
- [ ] Verify all templates compile and pass basic smoke test
- [ ] Update `templates/README.md` with current architecture

### 16b-3 — Template developer guide

**Problem:** No documentation for "how to build a new agent template." The architecture decision (memory file) exists but not a practical guide.

**Tasks:**
- [ ] Write `.ai/guides/agent-template-guide.md`
- [ ] Cover: three-layer stack, how to use createToolkit(), how to write observe(), strategy YAML format, how to test
- [ ] Include examples from base template
- [ ] Reference ADR-0002 (boundary), ADR-0019 (executor injection)

### 16b-4 — Define next 2 use cases

**Problem:** Only sentinel (gap-closing analysis) has been production-tested. Need to identify 2 more use cases that exercise different primitives.

**Reference:** `reference_supercolony_agent_use_cases.md` lists 6 agent types.

**Candidates:**
1. **Prediction tracker** — uses `ballot.getPool`, `predictions.markets`, `prices.get`. Publishes when prediction resolves or new market opens. Exercises prediction primitives unused by sentinel.
2. **Engagement optimizer** — uses `scores.getLeaderboard`, `agents.getProfile`, `feed.search`. Focuses on high-quality replies and strategic tipping. Exercises the engage/tip primitives more deeply than sentinel.
3. **Research synthesizer** — uses evidence from non-crypto sources (FRED, VIX, ECB, GitHub). Cross-domain analysis. Exercises the macro adapters built in Phase 15.

**Tasks:**
- [ ] Evaluate candidates against existing primitives
- [ ] Pick 2 that exercise the most untested toolkit paths
- [ ] Write minimal specs (one page each)

## Delegation Summary

| Task | Codex? | Effort | Priority |
|------|--------|--------|----------|
| 16a-1 npm publish | No (manual) | Small | High |
| 16a-2 lifecycle wiring | Yes | Small | High |
| 16a-3 remove signals.ts | Yes | Small | Medium |
| 16a-4 ElizaOS deprecation | Yes | Small | Low |
| 16a-5 carried findings | Yes | Small | Medium |
| 16b-1 primitives audit | Partial | Medium | High |
| 16b-2 update templates | Yes | Medium | High |
| 16b-3 template guide | No (writing) | Medium | High |
| 16b-4 define use cases | No (design) | Small | High |

**Recommended execution:**
- **Batch 1** (parallel, Codex): 16a-2 (lifecycle wiring) + 16a-3 (remove signals) + 16a-5 (carried findings)
- **Manual**: 16a-1 (npm publish) + 16a-4 (ElizaOS)
- **Batch 2** (after Part A): 16b-1 (primitives audit) + 16b-4 (use case definition)
- **Batch 3** (after audit): 16b-2 (update templates) + 16b-3 (template guide)
