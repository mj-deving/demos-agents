---
summary: "Phase 13 plan: system tightening — audit, fix, and test all publish paths for production reliability."
read_when: ["phase 13", "next phase", "system audit", "tightening", "what's broken"]
---

# Phase 13: System Tightening

> Goal: Every session should publish 1-2 posts. Currently 0-post sessions are common.
> Method: Audit each publish path end-to-end, fix blockers, add catalog coverage.
> Delegation: Most tasks are Codex-delegatable with clear prompts.

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

### 13a — Fix publish_to_gaps evidence path (CRITICAL)

**Problem:** 0/63 gap topics match evidence despite 80 evidence entries available.

**Diagnosis needed:** Run a debug session that logs:
- All evidence index keys (subjects)
- All gap topic tokens after tokenization
- The intersection (or lack thereof)

**Codex task:**
```
Read src/toolkit/strategy/engine.ts publish_to_gaps section (~line 171).
Add temporary debug logging that outputs:
1. Number of evidence index keys and a sample of 10
2. For each gap topic: the tokens generated and whether any matched
3. The first 3 matches found (if any)
Write this as a test in tests/toolkit/strategy/publish-to-gaps-debug.test.ts
that constructs realistic evidence + gap data and verifies matching works.
```

### 13b — Add missing asset sources to catalog (LOW RISK)

**Problem:** Divergence analysis found ARB bearish vs +10.7%, but no ARB source for attestation.

**Codex task:**
```
Read config/sources/catalog.json to understand the schema.
Read the existing coingecko sources for format reference.
Add CoinGecko simple/price sources for: ARB, XRP, SOL, LINK, DOT, AVAX, OP.
Use the same format as existing coingecko-simple entries.
Status: quarantined. discoveredBy: manual. Provider: coingecko.
Validate JSON after edit. Run npx tsc --noEmit.
```

### 13c — Test publish_prediction path (UNKNOWN)

**Problem:** The `publish_prediction` rule has never triggered in any observed session.

**Codex task:**
```
Read src/toolkit/strategy/engine-enrichment.ts publish_prediction section.
Determine: what conditions must be met for this rule to fire?
Check the YAML strategy config for sentinel (agents/sentinel/strategy.yaml)
to see if publish_prediction is enabled.
Write a unit test that verifies the rule fires with valid input.
Report: is this rule correctly configured? What's missing?
```

### 13d — Audit evidence freshness/richness semantics (CRITICAL)

**Problem:** `available-evidence.ts` sets `richness: cached.responseSize` (bytes, e.g., 5000) but the strategy engine filters `item.richness > threshold` where threshold is 50-95 (designed for 0-100 scale). This semantic mismatch means richness filtering is effectively disabled.

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

**Problem:** 225 sources but divergence/gap paths can't find matching sources for many assets.

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

**Codex task:**
```
Write an integration test in tests/cli/publish-path-e2e.test.ts that:
1. Creates a mock colony DB with realistic data
2. Calls decideActions() with evidence that triggers publish_to_gaps
3. Verifies a PUBLISH action is produced
4. Calls the publish executor with mocked LLM + attestation
5. Verifies the post would be published (dry-run mode)
Mock: LLM provider, SDK bridge, attestation. Real: strategy engine, dedup, match.
```

### 13g — Strategy rule configuration audit (MEDIUM)

**Problem:** Are all 10 rules correctly configured and enabled in the sentinel YAML?

**Codex task:**
```
Read agents/sentinel/strategy.yaml (or wherever strategy config lives).
List all rules and their enabled/disabled status.
Cross-reference with the 10 rules in engine*.ts.
Report: any rules disabled? Any misconfigured thresholds?
Any rules with conditions that can never be met given current data?
```

## Delegation Summary

| Task | Codex? | Mode | Estimated tokens |
|------|--------|------|-----------------|
| 13a publish_to_gaps debug | Yes | safe | 40K |
| 13b add asset sources | Yes | --auto (scoped) | 30K |
| 13c test publish_prediction | Yes | safe | 30K |
| 13d richness semantics | Yes | --auto (scoped) | 40K |
| 13e catalog coverage audit | Yes | safe | 50K |
| 13f e2e publish test | Yes | --auto (scoped) | 60K |
| 13g strategy config audit | Yes | safe | 30K |

**All 7 tasks are Codex-delegatable.** Run 13a + 13b + 13c + 13g in parallel (safe/read-only first), then 13d + 13e + 13f with results.
