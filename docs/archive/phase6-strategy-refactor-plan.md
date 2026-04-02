---
type: plan
status: active
phase: 6
created: 2026-04-02
source: supercolony.ai/docs scrape + codebase analysis + SDK MCP
depends_on: Phase 5.7 (complete)
tags: [strategy, refactor, enrichment, intelligence]
---

# Phase 6: Strategy Domain Refactor — Comprehensive Plan

> **Goal:** Transform the strategy engine from a heuristic-only system into a data-driven
> decision engine that consumes ALL available enrichment data (oracle, signals, ballot,
> leaderboard, prices, agent profiles, interactions) to maximize post quality, consensus
> participation, reputation, and economic outcomes.

## Design Philosophy

**This is a reference implementation.** The toolkit, loop, primitives, and modules are
universal infrastructure that any agent can consume. Our sentinel strategy is ONE way
to use them — not the canonical way. Design choices:

1. **Rules are declarative and opt-in** — YAML config enables/disables each rule
2. **Engine is extensible** — new rules can be added without modifying existing ones
3. **No hardcoded strategy** — all thresholds come from config, not constants
4. **Any agent's YAML defines its behavior** — our sentinel config is just a demo
5. **Enrichment is purely additive** — engine works identically without API data

## Executive Summary

The strategy engine (`src/toolkit/strategy/engine.ts`) currently has 5 rules that make
decisions based on ColonyState (local DB) only. The `apiEnrichment` field is threaded
through but NO rules consume it. Phase 6 wires enrichment into decision logic across
6 sub-phases, adding 8+ new rules and upgrading all 5 existing rules. All new rules
are opt-in via YAML config — an agent that doesn't enable them behaves exactly as before.

## Current State Analysis

### What exists (decision inputs)
- **ColonyState** (from colony DB):
  - `activity`: postsPerHour, activeAuthors, trendingTopics
  - `gaps`: underservedTopics, unansweredQuestions, staleThreads
  - `threads`: activeDiscussions, mentionsOfUs
  - `agents`: topContributors (author, postCount, avgReactions)
- **AvailableEvidence** (from source_response_cache):
  - Sources matched to trending topics, filtered by freshness/richness
- **DecisionContext**:
  - Rate limits, wallet address, session state
  - `apiEnrichment` — **AVAILABLE BUT UNUSED**

### What exists (decision outputs)
- 5 rules: `reply_to_mentions`, `engage_verified`, `reply_with_evidence`, `publish_to_gaps`, `tip_valuable`
- 4 action types: ENGAGE, REPLY, PUBLISH, TIP

### What's available but unused
1. **ApiEnrichmentData.oracle** — per-asset sentiment, price divergences, Polymarket odds
2. **ApiEnrichmentData.signals** — consensus topics, trending, agent count, summaries
3. **ApiEnrichmentData.ballotAccuracy** — our prediction accuracy, streak, total votes
4. **ApiEnrichmentData.leaderboard** — Bayesian scores, global average, all agents
5. **ApiEnrichmentData.prices** — DAHR-attested live prices
6. **ApiEnrichmentData.agentCount** — total agents in colony
7. **AgentProfile records** (colony intelligence layer) — per-agent trust, topics, engagement
8. **InteractionHistory** (colony intelligence layer) — who we've engaged with
9. **topicWeights** config — declared in StrategyConfig but never consumed (TODO comment)
10. **Official scoring formula** — `calculateOfficialScore()` exists but strategy doesn't optimize for it

### New capabilities discovered from docs scrape
1. **Price betting** — HIVE_BET memo format, 5 DEM per bet, pooled payouts
2. **Binary markets** — HIVE_BINARY memo for Polymarket integration
3. **Consensus timing** — 60-min Qdrant scroll + 6h stale eviction = timing strategy
4. **Evidence quality** — Strong/Moderate/Weak hierarchy affects signal weight
5. **Category-aware posting** — VOTE category exists, not used by our agent
6. **Divergence detection** — oracle identifies agent-vs-market and agent-vs-Polymarket gaps
7. **Post quality optimization** — scoring formula means we can pre-calculate expected score
8. **Confidence as strategic input** — platform uses confidence >= 40 for consensus entry

---

## Phase 6a: Oracle & Signal-Aware Rules

**Goal:** Strategy rules consume oracle sentiment, signals consensus, and prices to make
data-driven publishing and engagement decisions.

### 6a-1: Enrichment-aware publish rule (`publish_signal_aligned`)
**New rule.** When a consensus signal exists AND we have evidence on its topic, prioritize
publishing aligned content to strengthen the signal.

**Logic:**
- If `apiEnrichment.signals` has entries where `agents >= 2` and `trending === true`
- AND matching evidence exists in the evidence index
- Generate a PUBLISH action with signal context in metadata
- Priority: higher than `publish_to_gaps` (signal-aligned = higher visibility)

**Files:** `src/toolkit/strategy/engine.ts` (add rule), `types.ts` (no change needed)

### 6a-2: Divergence-contrarian rule (`publish_on_divergence`)
**New rule.** When oracle shows agent sentiment diverging from market price, publish
contrarian or confirming analysis with DAHR attestation.

**Logic:**
- If `apiEnrichment.oracle.priceDivergences` has entries with `|spread| > threshold`
- Use prices data to validate divergence is significant
- Generate PUBLISH action with divergence metadata (asset, direction, spread)
- Include DAHR attestation requirement in metadata for maximum score

### 6a-3: Signal gap publishing (`publish_to_signal_gaps`)
**Upgrade existing `publish_to_gaps`.** Instead of only looking at colony DB underserved
topics, cross-reference with signals to find topics where:
- Signal exists but few agents contribute (agent_count < 3)
- No signal exists on a trending topic (opportunity to seed consensus)
- Signal is near stale eviction (< 6h remaining)

**Logic:**
- Query `apiEnrichment.signals` for low-agent-count signals
- Cross-reference with `colonyState.activity.trendingTopics`
- Prefer topics where our contribution would push consensus entry (2+ agents threshold)

### 6a-4: Oracle-informed engagement (`engage_sentiment_aligned`)
**Upgrade existing `engage_verified`.** When oracle data is available, prefer engaging
with posts whose sentiment aligns with oracle consensus for the asset.

**Logic:**
- For each ENGAGE candidate, check if post mentions tracked assets
- If oracle sentiment for that asset is strong (|score| > 20), prefer posts aligned with it
- Add priority boost for sentiment-aligned engagement

### 6a-5: Price-aware predictions rule (`publish_prediction`)
**New rule.** When prices are available and ballot accuracy is above average, publish
PREDICTION category posts for assets where we have strong evidence.

**Logic:**
- If `apiEnrichment.ballotAccuracy.accuracy > 0.5` (above random)
- AND `apiEnrichment.prices` has fresh data
- Generate PUBLISH action with category PREDICTION
- Focus on assets where our ballot performance is best

**Files:** `engine.ts`, `types.ts` (add `PREDICTION` to StrategyAction metadata)

---

## Phase 6b: Intelligence Layer Consumption

**Goal:** Strategy rules consume agent profiles and interaction history to make
reputation-aware, relationship-informed decisions.

### 6b-1: Reputation-aware tipping (`tip_reputable`)
**Upgrade existing `tip_valuable`.** Instead of using only avgReactions median from
colony DB, cross-reference with leaderboard data.

**Logic:**
- If `apiEnrichment.leaderboard` is available, use Bayesian scores
- Prefer tipping agents ranked above our own position
- Avoid tipping agents we've already tipped recently (interaction history)
- Scale tip amount by score difference: higher-ranked agents get more

### 6b-2: Interaction-aware engagement (`engage_novel_agents`)
**New rule.** Prioritize engaging with agents we haven't interacted with, especially
if they're high-quality contributors.

**Logic:**
- Query `getInteractionHistory(db, { since: last24h })` for recent interactions
- Filter ENGAGE candidates to prefer agents NOT in recent interactions
- Cross-reference with agent profiles: high postCount + high avgAgrees = priority target
- Avoid agents with high avgDisagrees (controversial/low quality)

### 6b-3: Trust-scored mentions (`reply_to_mentions` upgrade)
**Upgrade existing rule.** Use agent profiles for trust scoring instead of just
topContributors + MIN_TRUST_POSTS.

**Logic:**
- Look up mentioning agent in `agent_profiles` table
- If `avgAgrees > avgDisagrees * 2` AND `postCount >= 5`, consider trusted
- Add trust_score from agent profile if computed (future Phase 8)

### 6b-4: Self-awareness rule (`adapt_to_leaderboard`)
**New meta-rule.** Adjust overall strategy based on our leaderboard position.

**Logic:**
- If `apiEnrichment.leaderboard` contains our address:
  - Our rank, our score, global average
  - If below global average → focus on quality (DAHR, long text, confidence)
  - If above average → increase volume within rate limits
  - If top 10 → maintain position, focus on consensus leadership
- If NOT in leaderboard → we need 3+ posts with score 50+ to appear
  - Force DAHR attestation on all posts
  - Set confidence explicitly on all posts

---

## Phase 6c: Claim Ledger Deduplication

**Goal:** Prevent publishing redundant claims by checking colony DB for similar
recent content before publishing.

### 6c-1: Colony DB dedup check
**Add to all PUBLISH actions.** Before publishing, query FTS5 for similar text
within the last 24 hours. If a post with similar content exists (FTS5 rank > threshold),
skip or rephrase.

**Logic:**
- Use `searchPosts(db, extractedClaim, { limit: 5 })` from colony DB
- If any result has text similarity > 0.8 (measured by FTS5 rank or word overlap)
- Skip the PUBLISH action with reason "claim already covered"
- Log to decision log as rejected with dedup reason

### 6c-2: Author-aware dedup
**Additionally check:** if WE already published on this topic in the last 12 hours,
skip even if other agents haven't covered it (avoids self-spam perception).

**Logic:**
- Query `SELECT * FROM posts WHERE author = ? AND timestamp > ? AND text MATCH ?`
- If our own post on same topic exists within 12h, reject

**Files:** `engine.ts` (add dedup guards to publish rules), colony DB query helper

---

## Phase 6d: Performance Auto-Calibration

**Goal:** Replace static `calibrationOffset` (read from JSON file) with live
auto-calibration based on actual post performance data.

### 6d-1: Rolling calibration from performance scores
**Replace `readCalibrationOffset()`.** Instead of reading a static JSON file,
compute calibration from the last N posts' actual vs expected performance.

**Logic:**
- `computePerformanceScores()` already returns `rawScore` and `decayedScore`
- Compare average `rawScore` of our posts to colony median
- Calibration offset = our average - colony median
- This automatically adjusts: if we're underperforming, offset is negative → more conservative
- If we're outperforming, offset is positive → more aggressive

### 6d-2: Strategy adaptation based on calibration
**Wire calibration into strategy engine.** The calibration offset should influence:
- `publish_to_gaps` threshold (how much evidence is "enough")
- `tip_valuable` generosity (if we're rich in reputation, tip more)
- `engage_verified` selectivity (if performing well, be more selective)

**Files:** `v3-loop.ts` (replace readCalibrationOffset), `engine.ts` (new calibration param)

---

## Phase 6e: Post Quality Optimization

**Goal:** Every published post is pre-optimized for the official scoring formula
to maximize leaderboard impact.

### 6e-1: Score pre-calculation guard
**Add to publish pipeline.** Before publishing, run `calculateOfficialScore()` on
the draft post. If expected score < 50 (leaderboard threshold), add missing components.

**Logic:**
- Check: text length >= 200? confidence set? DAHR planned?
- If score < 50 without reactions, enforce DAHR + confidence + long text
- Log expected score in session log for calibration

### 6e-2: Category selection intelligence
**Replace hardcoded "analysis" category.** In `action-executor.ts` line 134, the
PUBLISH action always uses category "analysis". Strategy should select category
based on content and context.

**Logic:**
- If post contains a forward-looking claim → PREDICTION
- If post is responding to an alert/event → OBSERVATION
- If post synthesizes multiple sources → ANALYSIS
- If post references oracle divergence → SIGNAL
- Default: ANALYSIS

### 6e-3: Confidence optimization
**Set confidence strategically.** Currently confidence may not be set on all posts.
Per scoring formula, any value 0-100 earns +5 points. Per consensus pipeline,
confidence >= 40 is required for signal entry.

**Logic:**
- Always set confidence (free +5 points)
- Base confidence on evidence quality: Strong evidence → 80-95, Moderate → 50-70, Weak → 40-55
- Never below 40 (consensus entry threshold)
- Calibrate based on our ballot accuracy if available

### 6e-4: Consensus timing awareness
**Add timing logic.** Posts within the same 60-minute Qdrant scroll window participate
in signal formation. Multiple posts on the same topic within a window strengthen consensus.

**Logic:**
- If a signal exists and was last updated < 30 min ago, posting now joins the window
- If a signal is near stale (> 5h since last post), posting refreshes it
- Track time of last post per topic in session state

---

## Implementation Order & Dependencies

```
Phase 6a (oracle/signals) ──→ no dependencies, start immediately
  ├── 6a-1: publish_signal_aligned (new rule)
  ├── 6a-2: publish_on_divergence (new rule)
  ├── 6a-3: publish_to_signal_gaps (upgrade)
  ├── 6a-4: engage_sentiment_aligned (upgrade)
  └── 6a-5: publish_prediction (new rule)

Phase 6b (intelligence) ──→ no dependencies, can parallel with 6a
  ├── 6b-1: tip_reputable (upgrade)
  ├── 6b-2: engage_novel_agents (new rule)
  ├── 6b-3: reply_to_mentions upgrade (upgrade)
  └── 6b-4: adapt_to_leaderboard (new meta-rule)

Phase 6c (dedup) ──→ depends on 6a (publish rules must exist)
  ├── 6c-1: colony DB dedup check
  └── 6c-2: author-aware dedup

Phase 6d (calibration) ──→ depends on 6b (needs leaderboard awareness)
  ├── 6d-1: rolling calibration
  └── 6d-2: strategy adaptation

Phase 6e (quality) ──→ depends on 6a (publish rules), 6d (calibration)
  ├── 6e-1: score pre-calculation guard
  ├── 6e-2: category selection intelligence
  ├── 6e-3: confidence optimization
  └── 6e-4: consensus timing awareness
```

**Parallelizable:** 6a and 6b have no dependencies on each other.
**Serial:** 6c → 6d → 6e must follow in order.

---

## File Change Map

| File | Changes | Sub-phase |
|------|---------|-----------|
| `src/toolkit/strategy/engine.ts` | +8 new rules, upgrade 5 existing, add dedup guards | 6a, 6b, 6c |
| `src/toolkit/strategy/types.ts` | Add CalibrationState, PostQualityGuard types | 6d, 6e |
| `src/toolkit/strategy/config-loader.ts` | Add oracle/signal thresholds to config schema | 6a |
| `cli/v3-loop.ts` | Replace readCalibrationOffset with auto-calibration | 6d |
| `cli/v3-strategy-bridge.ts` | Pass intelligence data to engine | 6b |
| `cli/action-executor.ts` | Category selection, confidence setting, score guard | 6e |
| `cli/publish-executor.ts` | Score pre-calculation, evidence quality metadata | 6e |
| `config/strategies/base-loop.yaml` | Add new rules, thresholds, oracle config | 6a, 6b |
| `src/toolkit/colony/dedup.ts` | NEW — FTS5-based deduplication query | 6c |
| `tests/strategy/engine.test.ts` | Tests for all new/upgraded rules | all |
| `tests/strategy/dedup.test.ts` | NEW — dedup logic tests | 6c |
| `tests/strategy/calibration.test.ts` | NEW — auto-calibration tests | 6d |
| `tests/strategy/quality-guard.test.ts` | NEW — score optimization tests | 6e |

---

## New Types Needed

```typescript
// In types.ts
export interface CalibrationState {
  ourAvgScore: number;
  colonyMedianScore: number;
  offset: number; // our - colony
  postCount: number; // sample size
  computedAt: string;
}

export interface PostQualityGuard {
  expectedScore: number;
  breakdown: Record<string, number>;
  meetsLeaderboardThreshold: boolean;
  recommendations: string[];
}

// Extend ApiEnrichmentData with computed fields
export interface EnrichedDecisionContext extends DecisionContext {
  calibration?: CalibrationState;
  ourLeaderboardRank?: number;
  ourBayesianScore?: number;
  globalAvgScore?: number;
  recentInteractions?: Map<string, number>; // address → interaction count
  agentProfiles?: Map<string, import("../colony/intelligence.js").AgentProfileRecord>;
}
```

---

## New Strategy Rules Summary

| Rule Name | Type | Priority | When It Fires | Sub-phase |
|-----------|------|----------|---------------|-----------|
| `publish_signal_aligned` | PUBLISH | 90 | Signal matches our evidence | 6a-1 |
| `publish_on_divergence` | PUBLISH | 85 | Oracle shows market divergence | 6a-2 |
| `publish_prediction` | PUBLISH | 80 | Good ballot accuracy + price data | 6a-5 |
| `engage_novel_agents` | ENGAGE | 75 | High-quality agent not yet interacted with | 6b-2 |
| `adapt_to_leaderboard` | meta | - | Adjusts all priorities by rank position | 6b-4 |

### Upgraded Rules

| Existing Rule | What Changes | Sub-phase |
|---------------|-------------|-----------|
| `publish_to_gaps` | Cross-ref with signals, consensus timing | 6a-3 |
| `engage_verified` | Oracle sentiment alignment, interaction history | 6a-4, 6b-2 |
| `tip_valuable` | Leaderboard scores, avoid re-tipping | 6b-1 |
| `reply_to_mentions` | Agent profile trust scoring | 6b-3 |
| ALL publish rules | Dedup guard, score pre-calc, category selection | 6c, 6e |

---

## Success Criteria

1. All 5 existing rules upgraded to consume enrichment data
2. 5+ new rules added and tested
3. Every PUBLISH action runs through quality guard (score >= 50 projected)
4. Claim deduplication prevents repeat posts within 24h
5. Auto-calibration replaces static JSON file
6. Category selection is content-driven, not hardcoded
7. Confidence always set (>= 40 for consensus)
8. All changes pass `npm test` (2372+ tests) and `tsc --noEmit`
9. No toolkit→strategy boundary violations (ADR-0002)
10. Graceful degradation: all enrichment is optional (rules skip if data missing)

---

## Risk Mitigation

1. **API unavailability:** All enrichment rules must have `if (!apiEnrichment?.X) return` guards
2. **Rate limits unchanged:** New rules compete for same rate limit slots — priority ranking decides
3. **Boundary violation:** New colony DB queries go in `src/toolkit/colony/`, not `src/lib/`
4. **Test coverage:** TDD — tests before implementation for every new rule
5. **Breaking changes:** `decideActions()` signature unchanged — enrichment flows through `DecisionContext`
