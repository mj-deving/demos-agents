---
summary: "Complete V3 loop lifecycle map — all capabilities, strategy rules, publish paths, source system, and known gaps."
read_when: ["v3 loop", "capabilities", "lifecycle", "what can the agent do", "publish paths", "strategy rules", "system overview"]
---

# V3 Loop Capability Map

> Visual lifecycle map of the agent's decision pipeline.
> Updated: 2026-04-08. Source of truth for what works, what's broken, and what's missing.

## Loop Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│  SESSION START (cli/session-runner.ts → cli/v3-loop.ts)         │
│  createAgentRuntime() → SDK + Auth + Toolkit + Colony DB        │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────── SENSE PHASE ─────────────────────────────────┐
│  cli/v3-loop-sense.ts — runSenseWork()                          │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Colony Sync   │  │ Chain Scan   │  │ Proof Ingestion      │   │
│  │ (API backfill)│  │ (scan-feed)  │  │ + Agent Profiles     │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         └─────── PARALLEL ─────────────────────┘                │
│                           │                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ API Enrichment (toolkit.intelligence.getSignals, oracle,  │   │
│  │ prices, leaderboard, bettingPool, agents)                 │   │
│  └──────────────────────────┬───────────────────────────────┘   │
│                              │                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Source Fetch Pipeline                                     │   │
│  │ ┌─────────────┐ ┌──────────────┐ ┌───────────────────┐  │   │
│  │ │ Health      │→│ URL Dedup    │→│ fetchSourcesParallel│  │   │
│  │ │ Filter ★    │ │ ★            │ │ + Rate Limit ★     │  │   │
│  │ └─────────────┘ └──────────────┘ │ + Lifecycle ★      │  │   │
│  │                                   └───────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ★ = Phase 12 additions                                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────── PLAN PHASE ──────────────────────────────────┐
│  cli/v3-strategy-bridge.ts → plan()                              │
│  src/toolkit/strategy/engine.ts → decideActions()                │
│                                                                  │
│  Evidence Index: computeAvailableEvidence() → buildEvidenceIndex()│
│  (80 entries from all source topics + domain tags)               │
│                                                                  │
│  ┌─── 10 Strategy Rules ──────────────────────────────────────┐ │
│  │                                                             │ │
│  │  CORE RULES (engine.ts):                                    │ │
│  │  ┌─────────────────────┬──────────┬─────────────────────┐  │ │
│  │  │ reply_to_mentions   │ REPLY    │ ✅ Working           │  │ │
│  │  │ engage_verified     │ ENGAGE   │ ✅ Working (7/sess)  │  │ │
│  │  │ reply_with_evidence │ REPLY    │ ✅ Working           │  │ │
│  │  │ publish_to_gaps     │ PUBLISH  │ ⚠️ 0/63 matches     │  │ │
│  │  │ tip_valuable        │ TIP      │ ✅ Working           │  │ │
│  │  └─────────────────────┴──────────┴─────────────────────┘  │ │
│  │                                                             │ │
│  │  ENRICHMENT RULES (engine-enrichment.ts):                   │ │
│  │  ┌─────────────────────┬──────────┬─────────────────────┐  │ │
│  │  │ engage_novel_agents │ ENGAGE   │ ✅ Working           │  │ │
│  │  │ publish_signal_     │ PUBLISH  │ ⚠️ Dedup blocks      │  │ │
│  │  │   aligned           │          │    (stale signals)   │  │ │
│  │  │ publish_on_         │ PUBLISH  │ ⚠️ "no source" for   │  │ │
│  │  │   divergence ★NEW   │          │    ARB/XRP           │  │ │
│  │  │ publish_prediction  │ PUBLISH  │ ❓ Untested          │  │ │
│  │  └─────────────────────┴──────────┴─────────────────────┘  │ │
│  │                                                             │ │
│  │  CONTRADICTION RULE (engine-contradiction.ts):              │ │
│  │  ┌─────────────────────┬──────────┬─────────────────────┐  │ │
│  │  │ disagree_            │ ENGAGE   │ ✅ Working           │  │ │
│  │  │   contradiction      │          │                      │  │ │
│  │  └─────────────────────┴──────────┴─────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Post-plan filters:                                              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ • Publish cap: max 2/session (maxPublishPerSession) ★   │    │
│  │ • Topic blacklist: match-gate rejections not retried ★   │    │
│  │ • Rate limit: postsPerDay=14, postsPerHour=5            │    │
│  │ • Leaderboard adjustment: rank-based priority boost      │    │
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────── ACT PHASE ───────────────────────────────────┐
│                                                                  │
│  LIGHT PATH (cli/action-executor.ts)                             │
│  ┌──────────────────────────────────────┐                       │
│  │ ENGAGE → reply to post via API       │ ~1s per action        │
│  │ TIP → API validate + chain transfer  │                       │
│  └──────────────────────────────────────┘                       │
│                                                                  │
│  HEAVY PATH (cli/publish-executor.ts)                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 1. Dedup gate (self + colony + semantic)                  │   │
│  │ 2. Preflight (source availability check)                  │   │
│  │ 3. Source fetch + evidence collection                     │   │
│  │ 4. LLM draft generation (~30-60s)                        │   │
│  │ 5. Match gate: regex claim extraction (no LLM) ★         │   │
│  │ 6. Faithfulness gate                                      │   │
│  │ 7. DAHR/TLSN attestation                                 │   │
│  │ 8. HIVE encode + sign + broadcast                        │   │
│  │ 9. Quality logging                                        │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────── CONFIRM PHASE ───────────────────────────────┐
│  Verify published posts appear in feed                           │
│  Compute performance scores (154 per session)                    │
│  Auto-calibrate thresholds for next session                      │
└─────────────────────────────────────────────────────────────────┘

## Publish Path Status

| Path | Rule | How it works | Status | Blocker |
|------|------|-------------|--------|---------|
| **Gap-fill** | publish_to_gaps | Colony gaps + evidence index match | ⚠️ 0/63 matches | Evidence subjects don't overlap gap topic tokens despite fixes |
| **Signal-aligned** | publish_signal_aligned | Colony consensus signals + evidence | ⚠️ Dedup blocks | Same signals repeat; all published within 24h |
| **Divergence** | publish_on_divergence | Oracle price vs agent sentiment mismatch | ⚠️ No source | ARB/XRP sources missing from catalog |
| **Prediction** | publish_prediction | Betting pool opportunities | ❓ Untested | Never triggered in sessions 84-88 |
| **Reply** | reply_to_mentions, reply_with_evidence | Respond to mentions/discussions | ✅ Working | — |

## Source System

| Component | File | Status |
|-----------|------|--------|
| Catalog (225 sources) | toolkit/sources/catalog.ts | ✅ |
| Source fetch + retry | toolkit/sources/fetch.ts | ✅ |
| Health testing | toolkit/sources/health.ts | ✅ |
| Health filtering (SENSE) | toolkit/sources/lifecycle.ts → filterHealthySources | ✅ Phase 12 |
| Rate limiting (per-provider) | toolkit/sources/rate-limit.ts | ✅ Phase 12 |
| Lifecycle transitions | toolkit/sources/lifecycle.ts | ✅ Phase 12 (fire-and-forget) |
| Source matching (post-LLM) | toolkit/sources/matcher.ts | ✅ |
| Preflight check | toolkit/sources/policy.ts | ✅ |
| Topic vocabulary (3-layer) | toolkit/sources/topic-vocabulary.ts | ✅ |
| Prefetch cascade | toolkit/sources/prefetch-cascade.ts | ❌ Architecture mismatch |
| URL dedup | cli/v3-loop-sense.ts | ✅ Phase 12 |

## Toolkit API Primitives (15 domains)

| Domain | Methods | Used in SENSE | Used in ACT |
|--------|---------|--------------|-------------|
| feed | getRecent, search, getPost, getThread | ✅ | — |
| intelligence | getSignals, getReport | ✅ | — |
| scores | getLeaderboard | ✅ | — |
| agents | list, getProfile, getIdentities | ✅ | — |
| actions | tip, react, getReactions, getTipStats, placeBet | — | ✅ |
| oracle | get | ✅ | — |
| prices | get | ✅ | — |
| verification | verifyDahr, verifyTlsn | — | ✅ |
| predictions | query, resolve, markets | ✅ | — |
| ballot | getPool | ✅ | — |
| webhooks | list, create, delete | — | — |
| identity | lookup | — | ✅ |
| balance | get, requestFaucet, ensureMinimum | — | — |
| health | check | — | — |
| stats | get | — | — |

## Known Gaps (from backlog + sessions 84-88)

| Gap | Impact | Fix complexity | Codex-delegatable? |
|-----|--------|---------------|-------------------|
| publish_to_gaps evidence mismatch | 0 gap-based publishes ever | Medium — evidence index subjects vs gap topic vocabulary | Yes |
| Signal stagnation → dedup | 0 signal-aligned publishes after first cycle | Medium — topic angle rotation | No (strategy design) |
| ARB/XRP/SOL sources missing | Divergence publishes fail preflight | Low — add catalog entries | Yes |
| publish_prediction never triggers | Unknown capability gap | Low — check rule config + test | Yes |
| Lifecycle persistence fire-and-forget | Ratings reset each session | Medium — needs source registry DB | Partially |
| Legacy signals.ts broken API shape | Noise in logs | Done — deprecated |
| publish_to_gaps threshold=95 vs richness=responseSize | Richness is byte count, not 0-100 | **Critical** — see below |

## CRITICAL: Richness Mismatch

In `available-evidence.ts` line 36: `richness: cached.responseSize` — richness is the **response byte count** (e.g., 256, 1024, 5000). But in `engine.ts` the filter is `item.richness > adjustedRichnessThreshold` where threshold is capped at 95. A 96-byte response passes but a topic with rich 5000-byte evidence also passes. This means richness filtering is effectively disabled since almost all responses are >95 bytes. The threshold was designed for a 0-100 scale but receives byte counts.

This may actually HELP publish_to_gaps work — the threshold doesn't block. But the "0/63 no evidence" means the evidence index has no entries whose subjects match gap topic tokens at all.
