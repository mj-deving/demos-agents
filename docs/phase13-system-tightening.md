---
summary: "Phase 13 plan: system tightening — audit, fix, and test all publish paths for production reliability."
read_when: ["phase 13", "next phase", "system audit", "tightening", "what's broken"]
---

# Phase 13: System Tightening

> Goal: Every session should publish 1-2 posts. Currently 0-post sessions are common.
> Method: Audit each publish path end-to-end, fix blockers, add catalog coverage.
> Delegation: Most tasks are Codex-delegatable with clear prompts.
>
> **Batch 1 COMPLETE (2026-04-08).** Key discovery: v3-loop and agent-loop are two separate data pipelines feeding the same strategy engine. v3-loop has `fetchApiEnrichment()` wiring all 10 rules; agent-loop's `defaultObserve()` returns empty evidence/enrichment, limiting templates to 2/10 rules. Phase 13 Batch 2 targets the **v3-loop path** (sentinel sessions). Agent-loop enrichment is a separate future workstream.

## Root Cause Analysis (Sessions 84-88)

| Session | Posts | Why 0 |
|---------|-------|-------|
| 84 | 0 | Strategy planned 0 PUBLISH (threshold=108, signals broken shape) |
| 85 | 1 | Threshold capped, 2 drafted, 1 published, 1 match-rejected |
| 86 | 0 | Dedup: same signal topics within 24h |
| 87 | 0 | Dedup + publish_to_gaps 0/52 evidence |
| 88 | 0 | Dedup + divergence "no source" + publish_to_gaps 0/63 |

**The agent has 4 publish paths but only 1 has ever worked (signal-aligned). The other 3 are blocked.**

## Tasks (Priority Order)

### 13a — Fix publish_to_gaps evidence path (CRITICAL) — COMPLETE

**Problem:** 0/63 gap topics match evidence despite 80 evidence entries available.

**Root cause:** Prior fix (`7dc8d7f`) tokenized gap topics but evidence index still stored exact normalized subjects (multi-word phrases). Phrase-based evidence like "Bitcoin ETF institutional flows" couldn't match gap tokens like "bitcoin", "etf", "custody".

**Fix:** New `tokenizeTopic()` and `findTopicEvidenceMatches()` in `engine-helpers.ts`. Gap tokens now match against phrase-shaped evidence keys. Debug logging added behind `DEMOS_DEBUG_PUBLISH_TO_GAPS=1` env var.

**Test:** `tests/toolkit/strategy/publish-to-gaps-debug.test.ts` — realistic crypto/defi/macro evidence, verifies intersections, explicit failure diagnostics.

### 13b — Add missing asset sources to catalog (LOW RISK) — COMPLETE

**Problem:** Divergence analysis found ARB bearish vs +10.7%, but no ARB source for attestation.

**Fix:** Added CoinGecko `simple/price` entries for ARB, XRP, SOL, OP (new). Set existing LINK, DOT, AVAX to `status: quarantined`. All 7 assets now have attestable sources. JSON validated, tsc passes.

**Catalog count:** 232 sources (was 225).

### 13c — Test publish_prediction path (UNKNOWN) — COMPLETE

**Problem:** The `publish_prediction` rule has never triggered in any observed session.

**Finding:** Not a code bug. Rule is enabled, conditions are simple and achievable:
1. `bettingPool` exists in apiEnrichment
2. `bettingPool.totalBets >= 3`
3. `prices` array exists and non-empty

**Blocker:** SENSE phase hardcodes `getPool({ asset: "BTC" })` (`v3-loop-sense.ts:276`). Only sees BTC pools. If no active BTC pool has 3+ bets at session time, rule is dead.

**Future improvement:** Fetch pools for multiple assets (ARB, ETH, SOL, etc.) to dramatically increase firing rate. This is the simplest of the 4 publish paths — just needs data availability, not code changes.

**Test:** `tests/toolkit/strategy/publish-prediction.test.ts` — 8 tests covering fire/no-fire cases + config alignment. YAML condition text cleaned up (removed deprecated ballot accuracy references).

**Unused config:** `minBallotAccuracy: 0.5` is loaded but never checked by the rule. The old ballot-accuracy gate was removed but config wasn't cleaned up.

### 13d — Audit evidence freshness/richness semantics (CRITICAL)

**Problem:** `available-evidence.ts` sets `richness: cached.responseSize` (bytes, e.g., 5000) but the strategy engine filters `item.richness > threshold` where threshold is 50-95 (designed for 0-100 scale). This semantic mismatch means richness filtering is effectively disabled — all evidence passes because bytes >> 95.

**Context from 13g:** This affects the v3-loop path. Evidence is populated via `computeAvailableEvidence()` which is called in the SENSE phase. The evidence filtering in `engine.ts:~199` uses `item.richness > adjustedRichnessThreshold` where threshold is capped at 95. Since byte counts are 200-5000+, everything passes — meaning the richness filter provides no quality signal.

**Codex task:**
```
Read src/toolkit/colony/available-evidence.ts (richness assignment)
Read src/toolkit/strategy/engine.ts (richness filtering, ~line 199)
Read src/toolkit/strategy/engine-helpers.ts (MIN_PUBLISH_EVIDENCE_RICHNESS)
Determine: should richness be byte count or normalized 0-100?
If byte count: adjust the threshold constants to byte-scale (e.g., min 100 bytes)
If 0-100: normalize responseSize to a quality score in available-evidence.ts
Write a test that verifies the chosen approach.
```

### 13e — Catalog coverage audit (MEDIUM)

**Problem:** 232 sources (after 13b additions) but divergence/gap paths can't find matching sources for many assets.

**Context from 13g:** publish_on_divergence is wired in v3-loop (oracle data flows through) but needs attestable sources for each divergent asset. 13b added 7 CoinGecko assets. This audit maps the full coverage gap.

**Codex task:**
```
Read config/sources/catalog.json.
Extract unique (provider, topic) pairs.
Cross-reference against the top 50 crypto assets by market cap (from CoinGecko).
Report: which assets have sources? Which are missing?
Also check: which domain tags exist in the catalog? Map to gap topics from session 88.
Output a coverage matrix.
```

### 13f — End-to-end publish path tests (HIGH VALUE)

**Problem:** No integration test exercises the full publish pipeline from strategy → LLM draft → match → attest → publish.

**Context from 13g:** The v3-loop path is the only path that can reach publish rules. The test must exercise the v3-loop pipeline, not the agent-loop path. This means wiring realistic apiEnrichment (signals, oracle, prices) alongside evidence.

**Codex task:**
```
Write an integration test in tests/cli/publish-path-e2e.test.ts that:
1. Creates a mock colony DB with realistic data
2. Calls decideActions() with evidence that triggers publish_to_gaps
3. Wires apiEnrichment with realistic signals/oracle/prices (v3-loop shape)
4. Verifies a PUBLISH action is produced
5. Calls the publish executor with mocked LLM + attestation
6. Verifies the post would be published (dry-run mode)
Mock: LLM provider, SDK bridge, attestation. Real: strategy engine, dedup, match, evidence.
```

### 13g — Strategy rule configuration audit (MEDIUM) — COMPLETE

**Problem:** Are all 10 rules correctly configured and enabled in the sentinel YAML?

**Finding — two data pipelines, different reachability:**

The strategy engine is fed by two separate observe paths:

| Path | Source | apiEnrichment | evidence | Rules reachable |
|------|--------|---------------|----------|-----------------|
| **v3-loop** (sentinel sessions) | `fetchApiEnrichment()` in `v3-loop-sense.ts` | leaderboard, oracle, prices, bettingPool, signals | from `computeAvailableEvidence()` | All 10 wired, some blocked by data quality |
| **agent-loop** (templates) | `defaultObserve()` in `agent-loop.ts` | None | `[]` (hardcoded empty) | 2/10 (reply_to_mentions, tip_valuable) |

**Per-rule audit (v3-loop path):**

| Rule | Enabled | v3-loop Wired | v3-loop Blocker |
|------|---------|---------------|-----------------|
| reply_to_mentions | Yes | Yes | None — works |
| engage_verified | Yes | Yes | evidence matching quality (13a fixed) |
| reply_with_evidence | Yes | Yes | activeDiscussions empty in v3 colony state |
| publish_to_gaps | Yes | Yes | evidence matching (13a fixed), richness semantics (13d) |
| tip_valuable | Yes | Yes | recentTips guard unwired (duplicate tips possible) |
| engage_novel_agents | Yes | Yes | None — leaderboard wired |
| publish_signal_aligned | Yes | Yes | evidence quality, has published before |
| publish_on_divergence | Yes | Yes | source coverage (13b helped), divergenceThreshold unused |
| publish_prediction | Yes | Yes | BTC-only pool fetch (data availability) |
| disagree_contradiction | Yes | Yes | contradictions intelligence wired but scanner rarely finds matches |

**Dead config values (loaded but never used by any code path):**
- `enrichment.divergenceThreshold` — loaded in config-loader.ts but publish_on_divergence only checks `severity !== 'low'`
- `enrichment.minBallotAccuracy` — loaded but publish_prediction doesn't check ballot accuracy
- `rateLimits.disagreesPerCycle` — configured at 3 but no enforcement code exists

**Cross-reference:** All 10 rules in code are in config. All config rules are in code. No orphans either direction.

### 13h — Clean dead config values (LOW RISK)

**Problem:** 13g found 3 config values loaded by config-loader.ts but never used by any code path. They create confusion about what's actually configurable.

**Dead values:**
- `enrichment.divergenceThreshold` — publish_on_divergence checks `severity !== 'low'`, ignores numeric threshold
- `enrichment.minBallotAccuracy` — publish_prediction checks pool size + prices, ignores ballot accuracy
- `rateLimits.disagreesPerCycle` — configured at 3 but no enforcement code exists in engine or engine-contradiction

**Codex task:**
```
Read src/toolkit/strategy/config-loader.ts — find where these 3 values are loaded.
Read src/toolkit/strategy/engine-enrichment.ts and engine-contradiction.ts — confirm they're unused.
Remove the 3 dead values from:
1. config-loader.ts (schema + defaults + parsing)
2. agents/sentinel/strategy.yaml
3. types.ts (if typed)
Run npx tsc --noEmit and npm test to verify nothing breaks.
```

## Delegation Summary

| Task | Codex? | Mode | Status | Actual tokens |
|------|--------|------|--------|--------------|
| 13a publish_to_gaps fix | Yes | safe | **COMPLETE** | 171K |
| 13b add asset sources | Yes | --auto (scoped) | **COMPLETE** | 160K |
| 13c test publish_prediction | Yes | safe | **COMPLETE** | 190K |
| 13g strategy config audit | Yes | safe | **COMPLETE** | 283K |
| 13d richness semantics | Yes | --auto (scoped) | Open | est 40K |
| 13e catalog coverage audit | Yes | safe | Open | est 50K |
| 13f e2e publish test | Yes | --auto (scoped) | Open | est 60K |
| 13h clean dead config | Yes | --auto (scoped) | Open | est 30K |

**Batch 1 COMPLETE (4/8).** Batch 2: 13d + 13e + 13f + 13h. All Codex-delegatable. 13d is highest priority (richness semantics blocks evidence quality). 13h is lowest risk (dead code removal).
