# Loop V3: First-Principles Redesign

> **Status:** Proposed — supersedes 8-phase V1 loop and cosmetic V2 repackaging.
> **Derived from:** First-principles decomposition session (2026-03-30).
> **Supersedes:** `roadmap-measurement-first.md` H1a/H1b (body_match fix is obsoleted by flow inversion).

## 1. First Principles

**Goal:** Publish LLM-generated quality posts with razor-sharp, 100% fitting attestation, informed by deep awareness of the colony, lightweight and fast.

Seven irreducible primitives — everything an autonomous agent MUST do:

| # | Primitive | Why irreducible |
|---|-----------|----------------|
| 1 | **Read the chain** | Can't respond to a conversation you haven't read |
| 2 | **Understand what you read** | Raw bytes need meaning: topics, patterns, gaps, threads, mentions |
| 3 | **Decide what to do** | Agency = choosing action from options |
| 4 | **Generate content** | Posts don't write themselves |
| 5 | **Prove the content** | Non-negotiable: every post MUST be attested (DAHR or TLSN). No unattested posts. |
| 6 | **Broadcast to chain** | Post must exist on HIVE |
| 7 | **Learn from outcomes** | Without feedback, no improvement |

Everything else is ceremony. The loop design must map 1:1 to these primitives with zero overhead.

## 2. Current State Audit

### What each V1 phase actually does

| Phase | Primitive | Real work | Genuine value | Verdict |
|-------|-----------|-----------|---------------|---------|
| AUDIT | #7 Learn | Reads session log, compares predicted vs actual reactions | YES, but wrong timing — learning should feed into decisions, not run first in isolation | **MERGE → CONFIRM** |
| SCAN | #1 Read | Fetches 54 posts from chain + 8 source APIs | PARTIAL — reads chain but only 54 posts. Source fetch is a separate concern. | **UPGRADE → SENSE** |
| ENGAGE | #3 Decide + #6 Broadcast | Reacts (agree/disagree) to 2 posts | YES, but it's an action type, not a phase. Fixed-count, not strategy-driven. | **MERGE → ACT** |
| GATE | #3 Decide | Picks topics, checks if sources exist | MOSTLY CEREMONIAL — "can I publish about X?" should fuse with decision-making | **ELIMINATE** |
| PUBLISH | #4+5+6 Generate+Prove+Broadcast | LLM draft → 6-axis scoring → attestation → HIVE post | YES but bloated — core work wrapped in scoring that fails 78% of the time | **REDESIGN → ACT.PUBLISH** |
| VERIFY | (none) | Checks if just-published post appears on chain | NEAR ZERO — you have the txHash. This is 3 lines of code, not a phase. | **INLINE** |
| REVIEW | #7 Learn | Analyzes 51 historical posts for patterns | DUPLICATE of AUDIT — both read history, propose improvements, neither acts on them | **MERGE → CONFIRM** |
| HARDEN | (none) | LLM classifies 10 findings as actionable/info | ZERO VALUE — Session 54: 10 findings, 0 actionable, 10 skipped. Every session. | **ELIMINATE** |

### What V2 changed (cosmetic)

V2 exists in `session-runner.ts` as `--loop-version 2`. It relabels phases:
- SENSE = runs `scan-feed.ts` (same as SCAN)
- ACT = runs engage → gate → publish as substages (same 3 phases)
- CONFIRM = runs verify (same as VERIFY)

V2 didn't redesign anything. It regrouped labels. The same tool scripts, the same scoring pipeline, the same 6-axis body_match=0 problem.

### The root cause of the quality problem

```
CURRENT FLOW (topic-first):
  Pick topic → Generate post → Find matching source → Score match → Attest → Publish
                                     ↑
                              body_match = 0 in 78% of cases
                              because post doesn't match source
```

The agent generates content about a topic, then scrambles to find a source that supports what it already wrote. The 6-axis scoring pipeline (title_match, body_match, topic_overlap, metrics_overlap, metadata_match) exists to answer: "does the source I found actually support the post I already wrote?" The answer is usually no.

This is backwards. You don't write a research paper and then go looking for citations. You read the research and then write about what you found.

## 3. Reconstructed Loop: SENSE → ACT → CONFIRM

### Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  SENSE — "What's happening?"                                     │
│                                                                  │
│  Colony scan (incremental, cached, thousands of posts)           │
│  Thread tracking, mention detection, reply chains                │
│  Pattern extraction: topics, activity, gaps, sentiment, trends   │
│  Source data freshness: what evidence is available RIGHT NOW?    │
│  Feedback integration: how did last session's actions perform?   │
│                                                                  │
│  Time: <30s (reads from cache + incremental chain delta)         │
│  Output: ColonyState + AvailableEvidence + PerformanceFeedback   │
└──────────────────────────────────────────────────────────────────┘
                                ↓
┌──────────────────────────────────────────────────────────────────┐
│  ACT — "What should I do, and do it."                            │
│                                                                  │
│  Strategy engine picks actions from ColonyState:                 │
│  ├── ENGAGE: react to posts (agree/disagree/tip)                │
│  ├── REPLY: respond to threads, mentions, discussions            │
│  │         (uses PUBLISH as primitive — same data-first flow,   │
│  │          but with replyTo=parentTxHash)                       │
│  └── PUBLISH: create new top-level post (data-first — see §4)   │
│                                                                  │
│  PUBLISH is the primitive. REPLY is PUBLISH with a target.       │
│  Both MUST be attested. No unattested content on chain.          │
│  All actions are strategy outputs, not sequential phases.        │
│  Strategy can produce 0 or N actions of any type per session.    │
│                                                                  │
│  Time: <120s (LLM generation + attestation + broadcast)          │
│  Output: ActionResults[] (txHashes, reactions, replies)          │
└──────────────────────────────────────────────────────────────────┘
                                ↓
┌──────────────────────────────────────────────────────────────────┐
│  CONFIRM — "Did it work? What did I learn?"                      │
│                                                                  │
│  Verify broadcasts (inline, ~3s per tx)                          │
│  Log actions to transcript with full metrics                     │
│  Prediction vs actual tracking (merged AUDIT + REVIEW)           │
│  Calibration model update                                        │
│  Colony cache update with own posts                              │
│  Persist state for next session                                  │
│                                                                  │
│  Time: <15s (local computation + 1-2 chain reads)                │
│  Output: SessionRecord + CalibrationDelta                        │
└──────────────────────────────────────────────────────────────────┘
```

**Total session budget: <165s** (vs current 180s hard limit that often overruns).

## 4. The Key Inversion: Data-First Publishing

The single most important architectural change. Eliminates the entire scoring pipeline.

### Current flow (topic-first — broken)

```
1. Pick topic ("defi")
2. Generate 627-char post about Compound Finance
3. Fetch source (defillama-tvl → 89 chars of JSON)
4. Score match: title_match=0, body_match=0, metrics=0, metadata=9 → composite 9
5. Threshold check: 9 < 10 → FAIL (or lower threshold further to pass garbage)
6. If pass: attest the source, publish
```

Post is generated blind. Source is found after. Matching fails because the post talks about things the source doesn't contain.

### V3 flow (data-first — correct by construction)

```
1. SENSE provides: AvailableEvidence = [
     { source: "blockchain-info-stats", data: {market_price: 67776, hash_rate: 877.9, ...}, fresh: true },
     { source: "defillama-tvl-compound", data: {tvl: 1400000000}, fresh: true },
     { source: "coingecko-btc", data: {price: 67776, vol: 28.1B, cap: 1.34T}, fresh: true },
   ]
2. SENSE provides: ColonyState.gaps = ["mining-economics", "defi-yields", ...]
3. Strategy picks: best intersection of (available evidence) ∩ (colony gaps)
   → "mining-economics" with blockchain-info-stats data
4. Attest the source data (DAHR) → on-chain proof exists BEFORE content generation
5. Generate content FROM the attested data:
   "Given this attested data: {market_price: 67776, hash_rate: 877.9, blocks: 132, difficulty: 133.79T},
    write an ANALYSIS post about bitcoin mining economics for SuperColony."
6. Broadcast post with attestation reference
```

**Match score = 100% by construction.** The post talks about data that's already been proved on-chain. There is no matching step. There is no scoring pipeline. The attestation IS the evidence, and the content IS about the evidence.

### What this eliminates

- `scoreEvidence()` — gone
- `scoreMetadataOnly()` — gone
- `extractClaims()` / `extractClaimsLLM()` / `extractClaimsAsync()` — gone
- `scoreBodyMatchLLM()` — gone (just built it, already obsolete)
- `calculateDiversityBonus()` — gone
- Match threshold (was 50, then 30, then 10) — gone
- The entire `MatchInput` / `MatchResult` / `MatchScoreAxes` type system — gone
- 6-axis scoring — gone
- `cli/gate.ts` — gone (gating is implicit: no available evidence = no publish)

### What this upgrades

- **LLM prompt quality**: instead of "write about defi," the prompt becomes "given this specific data [attested JSON], write about [topic]." The LLM has concrete facts to work with, not just a topic keyword.
- **Attestation relevance**: the attested URL is guaranteed to contain the data the post references, because the post was written FROM that data.
- **Quality floor**: if source data is thin (89 chars), the strategy either picks a richer source or skips publishing. No more 627-char posts from 89 chars of evidence.

## 5. Colony Intelligence: The Smart Scanning Algorithm

Marius's requirement: "scan thousands/tens of thousands of posts, cached incrementally, look up old threads and find new additions, mentions, conversation mechanics — a smart and effective algorithm."

### 5.1 Incremental Chain Scanner

```
Colony Cache (local storage: SQLite or JSONL + index)
┌─────────────────────────────────────────────────┐
│  cursor: last_block_number (e.g., 1980084)      │
│  posts: Map<txHash, DecodedPost>                 │
│  threads: Map<parentTxHash, Reply[]>             │
│  authors: Map<address, AuthorProfile>            │
│  topics: Map<tag, PostReference[]>               │
│  mentions: Map<address, Mention[]>               │
│  reactions: Map<txHash, ReactionCount>           │
└─────────────────────────────────────────────────┘
```

**Scan algorithm:**

```
function incrementalScan(cache, sdk):
  // 1. Get new posts since last cursor
  newPosts = sdk.getHivePosts(since: cache.cursor, limit: 500)

  // 2. Decode and index each post
  for post in newPosts:
    decoded = decodeHiveData(post.data)
    cache.posts.set(post.txHash, decoded)
    cache.cursor = max(cache.cursor, post.blockNumber)

    // Index by topic tags
    for tag in decoded.tags:
      cache.topics.get(tag).push(post.txHash)

    // Track threads: if this is a reply, link to parent
    if decoded.replyTo:
      cache.threads.get(decoded.replyTo).push(post)

    // Track author activity
    cache.authors.get(post.author).addPost(post)

    // Detect mentions (@address or @agent-name in text)
    for mention in extractMentions(decoded.text):
      cache.mentions.get(mention).push(post)

  // 3. Get reactions for recent posts (batch)
  recentHashes = cache.getPostsNewerThan(24h).map(p => p.txHash)
  reactions = sdk.getHiveReactions(recentHashes)
  for (hash, count) in reactions:
    cache.reactions.set(hash, count)

  // 4. Return delta for SENSE phase
  return {
    newPostCount: newPosts.length,
    totalCached: cache.posts.size,
    cursor: cache.cursor
  }
```

**First scan**: fetches everything available (paginated, may take 30-60s). Subsequent scans: fetch only the delta since last cursor (<5s for typical session intervals).

### 5.2 Colony State Extraction

After scanning, extract intelligence from the cache:

```
function extractColonyState(cache):
  return {
    // Activity analysis
    activity: {
      postsPerHour: computeRate(cache.posts, window: 24h),
      activeAuthors: countActiveAuthors(cache, window: 24h),
      trendingTopics: rankTopicsByRecency(cache.topics),
    },

    // Gap analysis — where can we add value?
    gaps: {
      underservedTopics: findTopicsWithLowActivity(cache),
      unansweredQuestions: findPostsWithNoReplies(cache),
      staleThreads: findThreadsWithNoRecentActivity(cache),
    },

    // Thread intelligence
    threads: {
      activeDiscussions: findThreadsWithRecentReplies(cache),
      mentionsOfUs: cache.mentions.get(OUR_ADDRESS),
      hotThreads: rankThreadsByEngagement(cache),
    },

    // Agent intelligence
    agents: {
      topContributors: rankAuthorsByEngagement(cache),
      ourPerformance: getAuthorStats(cache, OUR_ADDRESS),
      competitorAnalysis: compareAgentActivity(cache),
    },

    // Sentiment signals
    sentiment: {
      agreementRatio: computeGlobalAgreementRatio(cache),
      controversialTopics: findTopicsWithHighDisagreement(cache),
    },
  }
```

### 5.3 Thread Tracking and Conversation Mechanics

The colony cache tracks conversation structure:

- **Reply chains**: `post A → reply B → reply C` stored as linked list via `replyTo` field
- **Thread depth**: how deep does the conversation go?
- **Thread velocity**: how fast are replies arriving?
- **Mention detection**: regex scan for `@address` patterns or known agent names in post text
- **Cross-thread references**: posts that mention or quote other posts
- **Our mentions**: any post mentioning our address or agent name → priority for reply
- **Unanswered questions**: posts with question marks and zero replies → opportunity

This enables strategy decisions like:
- "Agent X mentioned us in a thread about DeFi yields → reply with our data"
- "Hot thread about Bitcoin mining with 8 replies → join with our attested mining data"
- "No one has posted about macro indicators in 6 hours → publish an analysis"

## 6. Strategy Engine

The strategy engine replaces the fixed ENGAGE → GATE → PUBLISH sequence with a decision function.

```
function decideActions(colonyState, availableEvidence, calibration):
  actions = []

  // Rule 1: Reply to mentions (highest priority)
  // REPLY uses PUBLISH as primitive — same data-first pipeline,
  // but targets an existing post/thread instead of creating a new top-level post.
  // A reply is: attest source → generate content → broadcast with replyTo=parentTxHash
  for mention in colonyState.threads.mentionsOfUs:
    if mention.isNew and not mention.replied:
      actions.push({ type: "REPLY", target: mention, priority: 100 })

  // Rule 2: Engage with quality posts
  for post in colonyState.recentPosts:
    if post.score > threshold and not post.reactedByUs:
      actions.push({ type: "ENGAGE", target: post, reaction: evaluatePost(post), priority: 60 })

  // Rule 3: Join active discussions we have data for
  for thread in colonyState.threads.activeDiscussions:
    evidence = findMatchingEvidence(thread.topic, availableEvidence)
    if evidence and not thread.repliedByUs:
      actions.push({ type: "REPLY", target: thread, evidence, priority: 80 })

  // Rule 4: Publish to fill gaps (data-first)
  for gap in colonyState.gaps.underservedTopics:
    evidence = findBestEvidence(gap, availableEvidence)
    if evidence and evidence.freshness < 1h and evidence.richness > MIN_RICHNESS:
      actions.push({ type: "PUBLISH", topic: gap, evidence, priority: 50 })

  // Rule 5: Tip valuable contributions
  for post in colonyState.topPerformers:
    if post.score > TIP_THRESHOLD and not post.tippedByUs:
      actions.push({ type: "TIP", target: post, amount: computeTipAmount(post), priority: 30 })

  // Sort by priority, apply rate limits, return
  return applyRateLimits(actions.sortBy(a => -a.priority))
```

Actions are not fixed categories that run in sequence. They are **strategy outputs** ranked by priority. A session might produce 3 engagements, 1 reply, and 0 publishes. Or 0 engagements and 2 publishes. The strategy decides, not the phase structure.

## 7. What's Preserved

Not everything in the current loop is wrong. These must carry forward:

| What | Why | Where in V3 |
|------|-----|-------------|
| TDD discipline (2053 tests) | Non-negotiable quality bar | All new code gets tests first |
| Chain-only principle | Proven correct by API death. No DNS dependency. | All V3 ops use SDK/RPC only |
| Security-first (ADR-0007) | Real money on mainnet | `executeChainTx()` mandatory for all writes |
| Transcript logging | H0 baseline data was invaluable | CONFIRM phase logs all actions to JSONL |
| Rate limiting (self-imposed) | Chain has no limits but we don't want to spam | Strategy engine applies limits |
| Observation system | Captures insights, errors, patterns | Retained, simplified |
| Session state + resume | Crash recovery | SENSE/ACT/CONFIRM each persist state |
| Source catalog (229 sources) | Curated data source registry | Used by AvailableEvidence in SENSE |
| DAHR attestation pipeline | Works, proven, `executeChainTx()` enforced | Used in ACT.PUBLISH step 4 |
| Extension/plugin hooks | Allows agent-specific behavior | Simplified: beforeSense, afterAct, afterConfirm |

## 8. What's Eliminated (with justification)

| Eliminated | Justification |
|-----------|---------------|
| **GATE phase** | Gating is implicit in V3: no available evidence = no publish. Strategy engine handles topic selection. |
| **VERIFY as a phase** | Inlined after broadcast. `verifyTransaction(txHash)` is 3 lines, not a 30s phase with subprocess. |
| **HARDEN phase** | Zero demonstrated value. Session 54: 10 findings, 0 actionable. Multiple sessions of pure overhead. |
| **AUDIT as separate from REVIEW** | Both read the same session log. Both propose improvements. Neither acts on them. Merged into CONFIRM. |
| **6-axis scoring pipeline** | Eliminated by flow inversion. When you generate FROM attested data, matching is tautological. |
| **Match threshold** | No matching step = no threshold. |
| **`extractClaims()` regex pipeline** | Produced bag-of-words tokens that never matched structured JSON. Irrelevant in data-first flow. |
| **`extractClaimsLLM()` / `scoreBodyMatchLLM()`** | Built to fix regex matching. Obsoleted by eliminating the problem entirely. |
| **Gate tool scripts** (`cli/gate.ts`) | Strategy engine subsumes gating logic. |
| **Separate subprocess per phase** | 8 tmux sessions per loop run. V3 inlines most work. |

## 9. Migration Path

### Phase 1: Colony Cache (foundation)
Build the incremental scanner and colony cache. This is the foundation — everything else depends on colony awareness.
- New: `src/toolkit/colony/scanner.ts`, `src/toolkit/colony/cache.ts`, `src/toolkit/colony/state.ts`
- Uses existing: `getHivePosts()`, `getRepliesTo()`, `getHiveReactionsByAuthor()`, `decodeHiveData()`
- Test: scan full chain history, build cache, verify thread linking

### Phase 2: Data-First Publish
Invert the publish flow. Fetch + attest source → generate FROM data → broadcast.
- Modify: `cli/session-runner.ts` (V3 loop path)
- New: `src/toolkit/publish/data-first-pipeline.ts`
- Delete: `scoreEvidence()`, `scoreMetadataOnly()`, `extractClaims()`, match threshold logic
- Test: publish with data-first flow, verify attestation references match post content

### Phase 3: Strategy Engine
Replace fixed engage → gate → publish sequence with strategy-driven action selection.
- New: `src/toolkit/strategy/engine.ts`, `src/toolkit/strategy/actions.ts`
- Modify: session-runner V3 loop to call strategy engine instead of sequential phases
- Test: strategy produces correct action mix given various colony states

### Phase 4: Cleanup
Remove eliminated phases and dead code.
- Delete: `cli/gate.ts`, harden logic, separate audit/review
- Simplify: extension hooks (beforeSense, afterAct, afterConfirm only)
- Update: CLAUDE.md, docs, memory

### What breaks
- Plugins hooking into `afterGate`, `beforePublish` with the old signature
- Existing V1/V2 loop flags — V3 becomes the only loop
- Session report format changes (3 phases not 8)
- Transcript schema adds new event types (colony scan, strategy decision)

## 10. Design Decisions (Resolved)

1. **Colony cache storage: SQLite.** Queryable, indexed, handles thousands of posts. `better-sqlite3` is sync, fast, no async overhead. Worth the single dependency for colony-scale data.
2. **Cold start: just scan it.** First session takes 1-3 min (paginated SDK calls). Subsequent sessions are instant (<5s delta). Simple, self-healing, no snapshot maintenance.
3. **Strategy engine: YAML-configured from day one.** Rules in `agents/{name}/strategy.yaml`. Ready for multi-agent, aligns with existing agent-definition pattern.
4. **Multi-agent cache: shared.** One cache per chain, agents read from it. Colony state is objective — everyone sees the same posts. File locking or read-only access pattern for concurrent agents.

### Still Open

5. **Reply generation**: Writing replies needs different LLM prompts than top-level publishing. How much prompt engineering is needed? (Decide during Phase 2 implementation.)

---

**This document is the authoritative design for Loop V3.** It supersedes the 8-phase V1 architecture, the cosmetic V2 relabeling, and the measurement-first roadmap's H1a/H1b items (which were patching a fundamentally inverted flow).
