---
summary: "API depth audit — full gap report from live API verification + docs cross-reference. 14+ endpoints with structural type mismatches. Next session kickoff doc."
read_when: ["api audit", "type correction", "api depth", "staleness", "type mismatch", "missing fields", "api surface"]
---

# API Depth Audit Report

> Generated 2026-04-13. Cross-referenced: live API responses, llms-full.txt, openapi.json, supercolony-skill-hosted.txt, types.ts, api-client.ts, supercolony-api-reference.md (live verification 2026-04-06).
> **Start here next session.** This is the actionable gap list.

## TL;DR

- **Type accuracy: ~50% BROKEN** — 14+ endpoints have structural mismatches between our TypeScript types and the actual API responses
- **4 deprecated methods** still in api-client.ts (ballot endpoints, 410 Gone)
- **6+ missing endpoints** (convergence, SSE streaming, new betting variants)
- **response-shapes.md is 30% useful** — too simplified, missing nested structures
- **Signal discovery was symptomatic** — we found 16 fields where we typed 5. This pattern repeats across oracle, stats, report, agents, betting

## API Surface Staleness: MODERATELY STALE

### Type Mismatches — 14+ Endpoints

| Endpoint | Our Type | Actual API | Impact | Priority |
|----------|----------|-----------|--------|----------|
| `/api/stats` | `{ totalPosts, totalAgents, totalReactions, uptime }` | `{ network: {...}, activity: {...}, quality: {...}, predictions: {...}, tips: {...}, consensus: {...}, content: {...}, computedAt }` | **Completely wrong** — 7 nested objects, we have 4 flat fields | P0 |
| `/api/report` | `{ id, title, content, timestamp }` | `{ id, title, summary, script: { segments[] }, audioUrl, signalCount, postCount, agentCount, sources, status, createdAt, publishedAt }` | Missing podcast/briefing structure | P0 |
| `/api/bets/pool` bets[] | `{ agent, price, timestamp }` | `{ bettor, predictedPrice, roundEnd, horizon }` | **Field names wrong** — code silently gets undefined | P0 |
| `/api/signals` | 5 fields | 16+ fields (text, keyInsight, crossRefs, divergence, tags, reactionSummary, shortTopic, consensusScore, evidenceQuality, sourcePosts, sourcePostData, representativeTxHashes, fromClusters, createdAt, updatedAt) | **FIXED in observe.ts this session** — but types.ts still incomplete | P1 |
| `AgentProfile` | Missing 6+ fields | `displayName, registeredAt, lastSeen, nameChangedAt, categoryBreakdown, web2Identities, xmIdentities, swarmOwner` | Agent profile data incomplete | P1 |
| `FeedPost` | Missing 3 fields | `reputationTier, reputationScore, blockNumber` | Missing reputation data | P1 |
| `/api/prices` | Bare `PriceData[]` | Wrapped `{ prices[], fetchedAt, stale }` | Toolkit unwraps — but type lies about wrapper shape | P2 |
| `/api/predictions` | Bare `Prediction[]` | Wrapped `{ predictions[], total, pendingExpired }` | Missing pagination metadata | P2 |
| `OracleResult.assets[]` | Partial | Missing: `sparkline[]` (48 points), `polymarket` (question/odds), `predictions` (bullish/bearish counts) | Missing nested sub-objects | P2 |
| `OracleResult` overall | Missing deprecated compat | `priceDivergences` (deprecated but still returned), `sentiment` (deprecated) | Backward compat fields undocumented | P3 |
| `/api/predictions/markets` | `market` (wrong field) | `marketId: string`, flat `outcomeYes/No: number` (not nested outcomes[]) | Wrong field names + structure | P2 |
| `/api/health` | Missing fields | `uptime: number`, `memory?: { heapUsed, rss }` (no `version` field) | Minor — health endpoint rarely used | P3 |
| `PriceData` | Missing fields | `symbol, high24h, low24h, marketCap, dahrResponseHash` | getPrices returns more than typed | P2 |
| `BallotState/Accuracy/etc.` | Still typed | **410 Gone** — these endpoints are dead | P0 — remove |

### Deprecated Code Still Present

| Dead Code | Location | Status | Replacement |
|-----------|----------|--------|-------------|
| `getBallot()` | api-client.ts:243 | 410 Gone | `/api/bets/pool` (already implemented separately) |
| `getBallotAccuracy()` | api-client.ts:247 | 410 Gone | removed |
| `getBallotLeaderboard()` | api-client.ts:251 | 410 Gone | removed |
| `getBallotPerformance()` | api-client.ts:380 | 410 Gone | removed |

### Missing Endpoints (Not Implemented)

| Endpoint | What it does | Priority |
|----------|-------------|----------|
| `GET /api/convergence` | Convergence signals — new intelligence source | High |
| `GET /api/feed/stream` (SSE) | Real-time feed events (params: categories, assets) | High — enables reactive agents |
| `GET /api/bets/higher-lower/pool` | Higher/Lower betting API (distinct from price bets) | Medium |
| `GET /api/bets/binary/pools` | Polymarket integration betting | Medium |
| `GET /api/bets/graduation/markets` | Token graduation betting (PumpFun→Raydium) | Low |
| `POST /api/user/agents/challenge` | Agent linking step 1 (3-step challenge-response) | Low |
| `POST /api/user/agents/claim` | Agent linking step 2 | Low |
| `POST /api/user/agents/approve` | Agent linking step 3 | Low |

### Documentation Gaps

| Doc | Issue | Fix |
|-----|-------|-----|
| `references/response-shapes.md` | **30% useful** — too simplified, missing all nested structures | Rewrite from live api-depth-audit output |
| `SKILL.md` | Signal fields listed as summary table (5 columns) but actual has 16+ fields | Already fixed in observe.ts; update SKILL.md table |
| `openapi.json` (local copy) | Shows 7 categories, API has 10 (OPINION, FEED, VOTE missing) | Fetch fresh from supercolony.ai |
| `llms-full.txt` (local copy) | May be stale — doesn't list oracle or prices endpoints | Fetch fresh from supercolony.ai |
| `supercolony-mcp` | Not installed — official MCP server with 11 tools | Install and cross-reference |

## Live Data Observations (Colony State Apr 11-12)

These findings inform what the agent needs access to:

### Signals (26 active)
- All have consensus=true (colony is in agreement mode)
- 16 fields per signal including: `text` (rich synthesis paragraph), `keyInsight` (editorial one-liner), `crossReferences` (Polymarket links, persistence info), `divergence` (per-signal contrarian view), `tags`, `reactionSummary`
- Top 3 by confidence: WTI Hormuz Risk (82), DXY Tightening (78), Iran Israel Conflict (78)
- Direction distribution: 18 mixed, 3 alert, 3 bullish, 2 bearish

### Oracle (10 assets tracked)
- 0 divergences (colony and market agree)
- Sentiment scores range: SAND bullish +42, ARB bearish -18, most near 0
- RNDR is the only DAHR-attested price (from Binance)
- Oracle price source: CoinGecko for most, Binance for IMX/RNDR

### Feed (signal feeds)
- 76% PumpFun token graduations (unattested noise, duplicated pairs)
- 24% DAHR-attested news from 7 sources: Bitcoinist, Blockonomi, CoinDesk, CoinTelegraph, CryptoPotato, DailyHodl, The Block
- Attestation URLs are RSS endpoints (e.g., `cointelegraph.com/rss`)
- Docs claim 110+ feeds — only 7 news sources observed live

### Predictions
- 5,466 pending — most have epoch-era deadlines (1970-01-21), will never resolve
- One agent (`0xdebf16...`) dominates with Starlink-related spam
- Almost all have confidence: 50 (default)

### Forecast Scoring
- Returns composite: 50 for EVERYONE (our agent, murrow, hamilton, gutenberg)
- Not differentiating — either broken or insufficient data
- bayesianScore (from leaderboard) is the real metric: our agent = 82.2

### Betting Pools
- BTC and ETH active, thin (1-3 bets per pool, all 5 DEM each)
- BTC/4h bettors cluster at $73,620-$73,625 (bullish vs $72,696 current)
- ETH/4h strongly bullish: $2,315 vs $2,232 current (+3.7% implied)
- SOL/30m and ETH/30m: empty pools

## Recommended Fix Sequence

### Wave 1: Remove + Rename (safe, no API calls needed)
1. Delete 4 deprecated ballot methods from `api-client.ts`
2. Fix `BettingPool.bets[]` field names: `agent→bettor`, `price→predictedPrice`, `timestamp→roundEnd`
3. Add missing `AgentProfile` fields to `types.ts`: `displayName`, `registeredAt`, `categoryBreakdown`, `web2Identities`, `xmIdentities`, `swarmOwner`
4. Add missing `FeedPost` fields: `reputationTier`, `reputationScore`, `blockNumber`

### Wave 2: Type Rewrites (need live API reference)
5. Rewrite `NetworkStats` type (`/api/stats`) — completely wrong structure
6. Rewrite `ReportResponse` type (`/api/report`) — missing podcast/script/segments
7. Fix `PredictionMarket` type — wrong field names and structure
8. Add wrapper types for `/api/prices` and `/api/predictions` (toolkit unwraps, but types should document the wrapper)
9. Expand `OracleResult.assets[]` with sparkline, polymarket, predictions sub-objects
10. Expand `SignalData` type to cover all 16 fields (observe.ts already extracts them)

### Wave 3: New Endpoints
11. Add `GET /api/convergence` method + types
12. Add SSE `GET /api/feed/stream` method
13. Add new betting endpoints (higher-lower pool, binary pools, graduation markets)

### Wave 4: Documentation
14. Rewrite `references/response-shapes.md` from live api-depth-audit data
15. Fetch fresh `llms-full.txt` and `openapi.json` from supercolony.ai
16. Install `supercolony-mcp` and cross-reference its 11 tools
17. Run `scripts/api-depth-audit.ts` successfully (ECONNRESET last time — retry with rate limiting)

### Wave 5: Automation
18. Add api-depth-audit as a periodic check (diff live responses against types.ts)
19. Add field-addition detection to openapi-drift test (currently only catches removals)

## Tools Available

| Script | Purpose | Status |
|--------|---------|--------|
| `scripts/api-depth-audit.ts` | Fetch all endpoints, extract field shapes recursively | Created, needs successful run (ECONNRESET) |
| `scripts/primitives-audit.ts` | Test all read primitives with parameter variants | Working — 45 tests, 42 pass |
| `scripts/smoke-test-omniweb.ts` | Quick 11-endpoint read validation | Working — 11/11 PASS |
| `scripts/publish-test.ts` | Source-matched attestation acid test | Working — txHash 997bc43b |
| `tests/openapi-drift.test.ts` | Schema superset check against openapi.json | Existing CI gate |
| `packages/omniweb-toolkit/evals/run-evals.ts` | Eval consistency validator | Working — 25/25 PASS |

## Source Files to Modify

| File | Lines | What needs to change |
|------|-------|---------------------|
| `src/toolkit/supercolony/types.ts` | 458 | Fix 14+ interface definitions |
| `src/toolkit/supercolony/api-client.ts` | 501 | Remove ballot methods, add convergence/SSE |
| `src/toolkit/supercolony/api-schemas.ts` | 127 | Update Zod schemas to match fixed types |
| `packages/omniweb-toolkit/references/response-shapes.md` | 108 | Full rewrite from live data |
| `packages/omniweb-toolkit/SKILL.md` | 502 | Update response shapes summary table |
| `tests/openapi-drift.test.ts` | varies | Add field-addition detection |
| `tests/behavioral/api-surface.test.ts` | varies | Update ExactKeys unions after type changes |
