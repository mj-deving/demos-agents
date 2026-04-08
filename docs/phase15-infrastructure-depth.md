---
summary: "Phase 15: infrastructure depth — multi-asset pools, macro sources, source registry DB, prefetch cascade, session-runner retirement."
read_when: ["phase 15", "infrastructure", "macro sources", "source registry", "session-runner", "prefetch", "pool fetch", "what's next"]
---

# Phase 15: Infrastructure Depth

> Goal: Broaden the agent's data coverage beyond crypto prices, persist source lifecycle state, and retire legacy code.
> Builds on Phase 13+14 pipeline reliability. Agent now publishes 1-2 posts/session — this phase widens what it can publish about.

## Context

Phases 13+14 fixed the publish pipeline: 8 serial gates all work, 4/5 publish paths fire, sessions produce 1-2 posts. But coverage is narrow:
- **publish_prediction** only sees BTC pools (hardcoded)
- **Sources** are 95% crypto — no macro/economic data (FRED, VIX, ECB blocked by auth/format)
- **Source lifecycle** resets every session (fire-and-forget ratings, no persistence)
- **Prefetch cascade** was deferred in Phase 12 (architecture mismatch)
- **Session-runner** has 17 shared imports with v3-loop — retirement is overdue but high-effort

## Tasks

### 15a — Dynamic pool + prediction market discovery (Medium)

**Problem:** `src/toolkit/api-enrichment.ts:39` hardcodes `toolkit.ballot.getPool({ asset: "BTC" })`. publish_prediction only sees BTC betting pools. The oracle response already includes Polymarket prediction markets (25+ markets, crypto + politics) but we ignore them entirely.

**Approach:** Don't hardcode asset lists. Use data we already fetch to discover what's active:

1. **Oracle assets** — the oracle response (`apiEnrichment.oracle.assets[]`) lists every asset the colony tracks with sentiment, prices, and predictions. Extract asset tickers from there.
2. **Fetch pools for ALL oracle-tracked assets** in parallel — lightweight API calls, non-fatal on failure.
3. **Return ALL qualifying pools** (totalBets >= 3), not just the "best" one. Extend `ApiEnrichmentData.bettingPool` to `bettingPools: BettingPool[]`.
4. **Wire prediction markets** — fetch `/api/predictions/markets`, validate with schema, add to `ApiEnrichmentData.predictionMarkets`.
5. **Extend publish_prediction** to consider both betting pools AND prediction markets as publish triggers.

**Files:**
- `src/toolkit/api-enrichment.ts` — dynamic pool discovery from oracle assets, prediction markets fetch
- `src/toolkit/strategy/types.ts` — extend ApiEnrichmentData: `bettingPools: BettingPool[]`, `predictionMarkets: PredictionMarket[]`
- `src/toolkit/strategy/engine-enrichment.ts` — iterate pools, consider prediction markets
- `src/toolkit/supercolony/api-schemas.ts` — fix PredictionMarket schema (marketId not market, flat outcomes)
- Tests for all changes

**Sub-tasks:**
- [ ] 15a-1: Extract oracle asset tickers → fetch pools for all in parallel
- [ ] 15a-2: Return bettingPools[] (array), not single bettingPool
- [ ] 15a-3: Wire /api/predictions/markets into enrichment (fix schema mismatch)
- [ ] 15a-4: Extend publish_prediction to iterate pools + consider prediction markets
- [ ] 15a-5: Tests for dynamic discovery, multi-pool, prediction markets

### 15b — Source activation sweep + macro adapters (Medium-Large)

**Problem:** The agent is a crypto commenter when it should be an omniweb intelligence publisher. 247 catalog sources exist but most are quarantined. The colony supports 10 post categories but the agent only publishes in 2-3 because all evidence is crypto prices.

**Two-pronged approach:**

**Prong 1 — Activate quarantined sources (low-hanging fruit):**
Many of the 247 sources are quarantined but functional — they just never got lifecycle-promoted because ratings reset each session (15c fixes this). Before building new adapters, sweep the catalog for sources that:
- Have `status: quarantined` but `responseFormat: json` and no auth requirement
- Already have working URL patterns (CoinGecko, CryptoCompare, DeFiLlama, etc.)
- Cover non-crypto domains: GitHub (software/AI), HN (tech), Reddit (sentiment), arXiv (research)

Batch-promote these to `active` status. This alone could double the agent's publishable topic space.

**Prong 2 — Build adapters for auth/non-JSON sources:**
- FRED (free API key, JSON) — GDP, CPI, unemployment, rates, yield curve, housing starts
- VIX/CBOE (no auth, CSV) — volatility index, put/call ratio
- ECB (no auth, XML/SDMX or JSON alternative) — EUR/USD, policy rates
- World Bank (no auth, JSON) — GDP per capita, trade data, global indicators

**Prong 3 — Domain expansion in strategy config:**
Update `agents/sentinel/strategy.yaml` topic weights to value non-crypto topics. Current weights: `defi: 1.2, crypto: 1.0, macro: 0.8`. Add: `tech: 1.0, geopolitics: 0.9, science: 0.7, economics: 1.1`.

**Sub-tasks:**
- [ ] 15b-1: Audit catalog — list all quarantined sources by domain, flag those ready to promote
- [ ] 15b-2: Batch-promote functional quarantined sources (test URL, verify JSON, promote to active)
- [ ] 15b-3: FRED adapter + 6 FRED catalog entries (GDP, CPI, UNRATE, DFF, T10Y2Y, HOUST)
- [ ] 15b-4: VIX adapter (CSV parsing) + catalog entry
- [ ] 15b-5: ECB adapter (JSON endpoint preferred) + catalog entries (EUR/USD, policy rate)
- [ ] 15b-6: Update sentinel strategy.yaml topic weights for broader coverage
- [ ] 15b-7: Tests for new adapters + promotion validation

**Human design needed:** API key management pattern, which quarantined sources to promote (requires testing each URL).

### 15c — Source registry as DB (Medium, Codex-delegatable)

**Problem:** Source lifecycle (ratings, transitions, test history) resets every session because `updateRating()` and `evaluateTransition()` in `lifecycle.ts` are pure functions operating on in-memory catalog data. No persistence between sessions.

**Fix:** Store source metadata in colony DB. Already has `source_response_cache` table — extend with `source_lifecycle` table for ratings, transition history, test results.

**Files:**
- `src/toolkit/colony/schema.ts` — add `source_lifecycle` table (migration v9)
- `src/toolkit/colony/source-lifecycle-store.ts` — CRUD for lifecycle data
- `src/toolkit/sources/lifecycle.ts` — wire persistence into updateRating/evaluateTransition
- Tests for the new store + integration with lifecycle

**Sub-tasks:**
- [ ] 15c-1: Schema migration v9 — source_lifecycle table (sourceId, status, rating JSON, lastTestAt, testCount, transitionHistory JSON)
- [ ] 15c-2: source-lifecycle-store.ts — upsert/get/list lifecycle records
- [ ] 15c-3: Wire lifecycle.ts to read/write from store (load on startup, persist after each fetch)
- [ ] 15c-4: Tests for store + integration

### 15d — Prefetch cascade redesign (Medium)

**Problem:** Source resolution produces a single candidate, but the prefetch-cascade pattern (Phase 12 deferred) needs a ranked list of candidates so it can fall back to the next source if the top one fails.

**Current flow:** `selectSourceForTopicV2()` returns one `SourceSelectionResult`. If that source's fetch fails, the publish is abandoned.

**Desired flow:** Return a ranked list of 3-5 candidates. Prefetch top candidate. On failure, try next. This makes publishing resilient to individual source outages.

**Files:**
- `src/toolkit/sources/policy.ts` — `selectSourceForTopicV2` returns array, not single
- `cli/publish-helpers.ts` — `resolveSourceForAction` iterates candidates
- `cli/publish-executor.ts` — prefetch loop with fallback
- Tests for multi-candidate resolution

**Sub-tasks:**
- [ ] 15d-1: selectSourceForTopicV2 returns ranked array (top N by match score)
- [ ] 15d-2: resolveSourceForAction iterates candidates until one resolves
- [ ] 15d-3: Prefetch with fallback in publish-executor
- [ ] 15d-4: Tests for cascade behavior

### 15e — Session-runner retirement (Large, phased)

**Problem:** `cli/session-runner.ts` is 1600+ lines of legacy code. 17 of its 21 imports are shared with v3-loop. It predates the toolkit architecture and duplicates many patterns now in toolkit/.

**Approach:** Phase the retirement — don't delete, redirect:
1. Identify which session-runner features are NOT in v3-loop
2. Port missing features to v3-loop or toolkit
3. Make session-runner a thin wrapper that delegates to v3-loop
4. Eventually deprecate

**Sub-tasks:**
- [ ] 15e-1: Audit session-runner features vs v3-loop — produce a diff matrix
- [ ] 15e-2: Port unique features (if any) to v3-loop or toolkit
- [ ] 15e-3: Slim session-runner to thin wrapper
- [ ] 15e-4: Deprecation notice + migration guide

**This is NOT Codex-delegatable** — requires architectural judgment about what to keep vs port.

## Delegation Summary

| Task | Codex? | Mode | Effort | Priority |
|------|--------|------|--------|----------|
| 15a-1/2 dynamic pool discovery | Yes | --auto (scoped) | Medium | High — unblocks ALL pools |
| 15a-3/4 prediction markets | Yes | --auto (scoped) | Medium | High — new publish trigger |
| 15b-1 catalog audit | Yes | safe | Small | High — find ready-to-promote sources |
| 15b-2 batch promotion | Yes | --auto (scoped) | Small | High — instant coverage boost |
| 15b-3 FRED adapter | Yes | --auto (scoped) | Small | High — first macro source |
| 15b-4 VIX adapter | Yes | --auto (scoped) | Small | Medium |
| 15b-5 ECB adapter | Partial | safe then --auto | Medium | Low (XML/JSON decision) |
| 15b-6 strategy weights | Yes | --auto (scoped) | Small | After source activation |
| 15c-1/2 DB schema + store | Yes | --auto (scoped) | Medium | High — persistence foundation |
| 15c-3/4 lifecycle wiring | Yes | --auto (scoped) | Medium | After store |
| 15d prefetch cascade | Partial | safe then --auto | Medium | Medium — resilience |
| 15e session-runner | No | human design | Large | Low — works fine |

**Recommended batch order:**
- **Batch 1** (parallel, high impact): 15a-1/2 (pool discovery) + 15b-1 (catalog audit) + 15c-1/2 (DB schema + store)
- **Batch 2** (parallel, source activation): 15b-2 (batch promote) + 15b-3 (FRED) + 15a-3/4 (prediction markets) + 15c-3/4 (lifecycle wiring)
- **Batch 3** (adapters + weights): 15b-4 (VIX) + 15b-5 (ECB) + 15b-6 (strategy weights)
- **Batch 4** (resilience): 15d (prefetch cascade) + 15a-5 (tests)
- **Batch 5** (large, low priority): 15e (session-runner retirement)
