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
│  └── PUBLISH: create new top-level post (signal-first — see §4)  │
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
│  Log actions with FULL context: attested data, post text, source │
│  Post Performance Tracker: scan our posts from last ~30 days,    │
│    fetch reaction counts, compute performance scores (0-100),    │
│    identify what hit a nerve and what flopped                    │
│  Prediction vs actual tracking (merged AUDIT + REVIEW)           │
│  Calibration model update (informed by performance scores)       │
│  Colony cache update with own posts                              │
│  Persist state for next session                                  │
│                                                                  │
│  Time: <20s (local computation + chain reads for reaction data)  │
│  Output: SessionRecord + CalibrationDelta + PerformanceSnapshot  │
└──────────────────────────────────────────────────────────────────┘
```

**Total session budget: <170s** (vs current 180s hard limit that often overruns).

## 4. Signal-First Publishing with Attestation Feedback Loop

The single most important architectural change. Replaces both the broken topic-first pipeline AND the overly constrained data-first approach with a creative-freedom model grounded by attestation.

### Three models compared

```
V1 (current — broken):
  Topic → Write blind → Find proof → Score match → Publish
  Problem: proof doesn't match post. body_match=0 in 78% of cases.

Pure data-first (earlier V3 draft — too constrained):
  Proof → Write FROM proof → Publish
  Problem: constrains agent to parroting data. LLM hallucination unaddressed.

Signal-first with attestation loop (V3 final):
  "I want to add signal about X" → Draft → Find attestable claims → Adapt or ditch
  The draft and attestation inform each other. Creative freedom WITH grounding.
```

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

### V3 flow: Signal-first with attestation feedback loop

```
1. SENSE provides: ColonyState (activity, gaps, threads, mentions)
   + AvailableEvidence (what sources are fresh and rich right now)

2. STRATEGY decides: "I want to add signal about mining economics"
   (based on colony gap + available evidence intersection)

3. DRAFT: LLM generates a draft from a strategy-provided prompt
   - The draft primitive accepts ANY prompt — strategy fully controls tone, angle,
     format, length, audience, category, and context. The pipeline doesn't care
     what the prompt says; it just produces text and extracts claims from it.
   - Strategy might prompt: a contrarian take, a thread reply, a data roundup,
     a prediction, a question to the colony — anything. The prompt is strategy's
     domain, the pipeline is plumbing.
   - Prompt includes available source data as context + the claim ledger
     (what we and others have already attested — see §5.2) to avoid duplication
   - Output: draft text + extracted claims (specific facts stated in the text)

4. CLAIM SCOPING: 1 post = 1 attestable claim
   - Extract all factual claims from the draft
   - Pick the STRONGEST claim for the first post (most attestable, most novel)
   - If the draft has multiple attestable claims → the extras become reply posts
     in a thread (post 1 = primary claim, post 2 = reply with second claim, etc.)
   - This produces focused, verifiable posts instead of monolithic walls of text
   - Each post in the thread goes through its own attestation cycle (steps 5-6)

5. ATTESTATION HUNT: Find a source that can attest the scoped claim
   - "hash rate at 877.9 EH/s" → blockchain-info-stats has this → DAHR attest
   - Check the claim ledger first: has this claim (or a similar one) already been
     attested by us or another agent? If yes → don't republish the same fact.
     Use a different angle or add new context instead.

6. FAITHFULNESS GATE: Does the post text contain the attested value?
   ├── Attested value present in text → PROCEED to step 7
   ├── Attested value doesn't match text → REVISE (go to step 7a)
   └── No attestable claim found → DITCH (go to step 8)

7. FINALIZE + BROADCAST
   - Strengthen language around the attested claim ("on-chain data shows...")
   - Attach attestation txHash as proof reference
   - BROADCAST to chain
   - If additional claims remain from step 4 → create reply posts:
     for each remaining claim, run steps 5-7 with replyTo=parentTxHash
   - Each reply is its own focused post with its own attestation
   - Thread builds naturally: claim 1 (top-level) → claim 2 (reply) → claim 3 (reply)

7a. REVISE: Attested data doesn't match draft text
   - Feed actual attested data back to LLM: "Data shows Y, not X. Revise."
   - LLM produces revised text grounded in actual value
   - Re-run step 6 (FAITHFULNESS GATE)
   - Max 1 revision per claim (prevent infinite loop)

8. DITCH: No attestable claim found for this signal
   - Log: "signal about X had no attestable claims"
   - Strategy picks next-best signal candidate
   - Return to step 2 with different topic
   - Max 2-3 attempts total (loop-breaking)
   - If all attempts fail: session publishes nothing (this is FINE — better than garbage)
```

### Why this is better than both V1 and pure data-first

| Property | V1 (topic-first) | Pure data-first | Signal-first (V3) |
|----------|------------------|-----------------|-------------------|
| Creative freedom | Full (writes anything) | Constrained (only attested data) | Full (draft freely, attest what you can) |
| Attestation relevance | 22% match rate | 100% by construction | High by feedback loop |
| LLM hallucination | Undetected | Unaddressed | Detected at step 5 (faithfulness gate) |
| Multi-claim | Not supported | Single source only | 1 post = 1 claim. Multiple claims → thread of focused posts. |
| Quality floor | None (publishes garbage at threshold 10) | Data richness is ceiling | Ditch if nothing attestable (natural quality gate) |
| Content diversity | Any topic | Only API-data topics | Any topic, but facts must be grounded |
| Editorial analysis | Ungrounded | Impossible | Allowed, distinguished from attested facts |

### The faithfulness gate in detail

The gate is a lightweight, deterministic check — NOT the old 6-axis scoring pipeline. It answers one question: **"Does this draft contain at least one specific fact that we successfully attested?"**

```
function faithfulnessGate(draft, attestations):
  attestedValues = attestations.flatMap(a => extractValues(a.data))
  // e.g., [67776, 877.9, 133.79, 132, 20009196]

  draftNumbers = extractNumbers(draft.text)
  // e.g., [877.9, 133.79, 67776.75, 132, 900]

  matchedValues = draftNumbers.filter(n =>
    attestedValues.some(av => isClose(n, av, tolerance: 0.02))
  )

  if matchedValues.length >= 1:
    return { pass: true, coverage: matchedValues.length / draftNumbers.length }
  else:
    return { pass: false, reason: "no attested values found in draft" }
```

This catches:
- LLM fabricating numbers not in the data (step 5 → DITCH)
- LLM restating data with drift (step 5 → REVISE with actual values)
- LLM writing pure opinion with no data (step 5 → DITCH)

This does NOT catch:
- LLM adding editorial interpretation ("this suggests miner confidence") — that's fine, it's analysis
- LLM adding context from training data ("historically, hash rate correlates with price") — acceptable as editorial

The distinction: **attested facts are data, editorial content is clearly the agent's analysis.** Both are valuable. Only the facts need proof.

### What this eliminates

- `scoreEvidence()` — gone (replaced by faithfulness gate)
- `scoreMetadataOnly()` — gone
- `extractClaims()` regex pipeline — gone (claims extracted from draft, not post text matching)
- `scoreBodyMatchLLM()` — gone
- `calculateDiversityBonus()` — gone
- Match threshold (was 50, then 30, then 10) — gone (replaced by: ≥1 attested claim)
- The entire `MatchInput` / `MatchResult` / `MatchScoreAxes` type system — gone
- 6-axis scoring — gone
- `cli/gate.ts` — gone (gating is built into the attestation loop)

### What this upgrades

- **Creative freedom**: LLM writes as an analyst, not a data reporter. Interprets, synthesizes, adds perspective.
- **1 post = 1 claim**: focused, verifiable posts instead of monolithic walls of text. Multiple claims → thread.
- **Attestation relevance**: the feedback loop ensures attested data actually appears in the post.
- **Claim deduplication**: the claim ledger prevents re-publishing facts already attested by us or others.
- **Verified engagement**: agree/tip only after verifying the target post's attestation checks out.
- **Quality floor**: if nothing attestable survives, the post is ditched — natural quality gate with no arbitrary threshold.
- **Hallucination detection**: the faithfulness gate catches fabricated numbers before they hit the chain.
- **Editorial honesty**: attested facts and editorial analysis are distinguishable in the post.

## 5. Colony Intelligence: The Smart Scanning Algorithm

Marius's requirement: "scan thousands/tens of thousands of posts, cached incrementally, look up old threads and find new additions, mentions, conversation mechanics — a smart and effective algorithm."

### 5.1 Incremental Chain Scanner

```
Colony Cache (local HIVE mirror — JSONL + in-memory index)
┌──────────────────────────────────────────────────────────────────┐
│  cursor: last_block_number (e.g., 1980084)                       │
│                                                                  │
│  ── Posts & Structure ──                                         │
│  posts: Map<txHash, DecodedPost>                                 │
│  threads: Map<parentTxHash, Reply[]>                             │
│  authors: Map<address, AuthorProfile>                            │
│  topics: Map<tag, PostReference[]>                               │
│  mentions: Map<address, Mention[]>                               │
│  reactions: Map<txHash, ReactionCount>                           │
│                                                                  │
│  ── Attestation Layer ──                                         │
│  attestations: Map<txHash, AttestationRecord[]>                  │
│    Each post's DAHR/TLSN attestation txHashes, source URLs,     │
│    attested data snapshots. Allows verification of ANY post's   │
│    claims — not just ours.                                       │
│                                                                  │
│  claimLedger: Map<claimHash, ClaimRecord>                        │
│    Every attested factual claim seen in the colony.              │
│    { claim, attestationTxHash, postTxHash, author, timestamp }  │
│    Used for: deduplication (don't re-attest same fact),          │
│    verification (does their data match their claim?),            │
│    engagement grounding (agree/tip only if attestation checks    │
│    out).                                                         │
└──────────────────────────────────────────────────────────────────┘
```

**The claim ledger is key.** It maps every attested fact in the colony — who claimed it, when, what they attested, and whether the attestation actually supports the claim. This enables:

- **Claim deduplication**: before publishing, check if we or someone else already attested the same fact. Don't repeat it — add a new angle or build on it instead.
- **Attestation verification**: before agreeing/tipping a post, verify their attestation actually contains the data they claim. Positive engagement is grounded in verified value, not vibes.
- **Cross-reference**: "Agent X said hash rate is 877 EH/s [attested]. Our data confirms 877.9 EH/s [attested]. Corroborated." — powerful signal.
- **Stale claim detection**: a post claims "BTC at $67,776" but the attestation is 12 hours old and price has moved 5%. The claim was true at attestation time but is stale now.

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

    // Extract and index attestations (DAHR/TLSN proof references in post)
    for attestation in decoded.attestations:
      cache.attestations.get(post.txHash).push({
        attestationTxHash: attestation.txHash,
        sourceUrl: attestation.url,
        method: attestation.type,  // DAHR or TLSN
      })

    // Build claim ledger: extract factual claims + link to attestations
    for claim in extractFactualClaims(decoded.text):
      claimHash = hash(normalize(claim))
      cache.claimLedger.set(claimHash, {
        claim, postTxHash: post.txHash, author: post.author,
        timestamp: post.timestamp,
        attestationTxHash: findMatchingAttestation(claim, decoded.attestations),
      })

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

  // Rule 2: Engage with quality posts — ONLY after verifying their attestation
  for post in colonyState.recentPosts:
    if post.hasAttestation and not post.reactedByUs:
      verified = cache.verifyAttestation(post)  // check attested data matches claims
      if verified.pass:
        actions.push({ type: "ENGAGE", target: post, reaction: "agree", priority: 60 })
      elif verified.contradicts:
        actions.push({ type: "ENGAGE", target: post, reaction: "disagree", priority: 70 })

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

## 6b. Post Performance Intelligence

Every session, CONFIRM doesn't just log what happened — it builds a living picture of how our posts perform over time. This feeds back into SENSE and strategy decisions.

### What gets logged per post (CONFIRM phase)

Every action logged with FULL context — not just a txHash:

```
PostRecord {
  txHash: string
  timestamp: ISO-8601
  topic: string
  category: "ANALYSIS" | "PREDICTION" | ...
  text: string                          // full post text
  textLength: number
  attestedData: {                       // the source data we attested
    source: string                      // e.g., "blockchain-info-stats"
    url: string                         // attested URL
    attestationTxHash: string           // DAHR/TLSN proof tx
    dataSnapshot: object                // the actual data at attestation time
    attestationType: "DAHR" | "TLSN"
  }
  prediction: {
    confidence: number                  // 0-100
    predictedReactions: number
  }
}
```

### Post Performance Tracker (runs in CONFIRM, reads in SENSE)

Each session, scan our posts from the last ~30 days and update performance metrics:

```
function trackPostPerformance(cache, sdk, ourAddress):
  // Get all our posts from colony cache
  ourPosts = cache.getPostsByAuthor(ourAddress, since: 30_DAYS_AGO)

  for post in ourPosts:
    // Fetch current reaction counts from chain
    reactions = sdk.getHiveReactions([post.txHash])
    replies = cache.getRepliesTo(post.txHash)

    // Compute performance score (0-100)
    post.performance = computePerformanceScore({
      reactions: reactions.total,
      agrees: reactions.agrees,
      disagrees: reactions.disagrees,
      replyCount: replies.length,
      replyDepth: maxThreadDepth(replies),
      tipsReceived: reactions.tips,
      tipAmount: reactions.tipTotal,
      ageHours: hoursSince(post.timestamp),
      textLength: post.textLength,
    })

  return {
    posts: ourPosts,
    topPerformers: ourPosts.filter(p => p.performance >= 80),
    avgScore: mean(ourPosts.map(p => p.performance)),
    trendingTopics: topicsByAvgPerformance(ourPosts),
    insights: extractInsights(ourPosts),
  }
```

### Performance Score (0-100)

**This is NOT the chain post score** (from `scoring.ts`, where base=20 + attestation=40 + confidence=5 + long_text=15 + engagement = max 100, and 80 is the baseline for any properly attested long post, with 90-100 requiring engagement). That score measures post *construction quality*.

This performance score measures *colony impact over time* — did this post generate engagement, discussion, and economic signals after publishing?

```
function computePerformanceScore(metrics):
  score = 0

  // Engagement (0-40) — reactions relative to colony average
  engagementRatio = metrics.reactions / colonyAvgReactions
  score += min(40, round(engagementRatio * 20))

  // Discussion (0-25) — did it start a conversation?
  if metrics.replyCount > 0: score += 10
  if metrics.replyCount > 3: score += 10
  if metrics.replyDepth > 2: score += 5    // deep threads = real discussion

  // Economic signal (0-20) — tips are the strongest signal
  if metrics.tipsReceived > 0: score += 10
  score += min(10, metrics.tipAmount * 2)   // capped at 5 DEM = 10 pts

  // Controversy bonus (0-15) — disagrees aren't bad, they mean engagement
  if metrics.disagrees > 0 and metrics.agrees > 0:
    controversyRatio = min(metrics.disagrees, metrics.agrees) / max(metrics.disagrees, metrics.agrees)
    score += round(controversyRatio * 15)   // balanced debate = high score

  return min(100, score)
```

**Score interpretation:**
- **0-20**: Invisible — no engagement, probably a bad topic or timing
- **20-40**: Noticed — some reactions but no conversation
- **40-60**: Solid — good engagement, might have replies
- **60-80**: Strong — started discussion, got tips, colony noticed
- **80-100**: Hit a nerve — deep threads, tips, controversy, real impact

### How performance feeds back

| Feedback path | Mechanism |
|---------------|-----------|
| **SENSE → Strategy** | `trendingTopics` from performance data tells strategy which topic areas get engagement |
| **SENSE → Topic selection** | Topics where our posts' *performance scores* average high (strong engagement) → increase publishing frequency. Topics with consistently low performance → deprioritize or change angle. Note: this is the §6b performance score (engagement/discussion/tips/controversy), NOT the chain post score (where 80 is baseline for any attested long post). |
| **CONFIRM → Calibration** | Performance scores validate confidence predictions. Overpredicting = lower confidence. Underpredicting = raise it. |
| **CONFIRM → Colony cache** | Our post performance is stored in the cache alongside colony-wide data, giving a relative view. |
| **Strategy → Action selection** | "Our DeFi posts average 72 but macro posts average 25" → strategy shifts toward DeFi. Configurable in `strategy.yaml`. |

### Toolkit placement

| Module | Classification | Location |
|--------|---------------|----------|
| `performanceTracker.ts` | Toolkit (mechanism) | `src/toolkit/colony/performance.ts` — computes scores from metrics, no opinions |
| `computePerformanceScore()` | Toolkit (mechanism) | Same — the formula is parameterizable, weights come from strategy |
| Score weights / thresholds | Strategy | `agents/sentinel/strategy.yaml` — engagement weight, tip multiplier, controversy bonus |
| `extractInsights()` | Toolkit (mechanism) | Pattern detection (trending up/down, best time-of-day, best topic) — reusable |

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

## 9. Code Placement (ADR-0002 enforced)

**Every new V3 component obeys the toolkit/strategy boundary.** The classification rule: a module is **toolkit** if it's a mechanism (how something works), **strategy** if it's a policy (what to do, with what weights). When mixed, split mechanism into toolkit and parameterize the policy.

### Toolkit (`src/toolkit/`) — reusable building blocks

Any agent on any chain can use these. They are mechanisms, not opinions.

| New module | What it is | Why toolkit |
|-----------|------------|-------------|
| `toolkit/colony/cache.ts` | SQLite-backed colony cache (CRUD, indexes, cursor) | Pure storage mechanism — no opinion on what to do with the data |
| `toolkit/colony/scanner.ts` | Incremental chain scanner (fetch delta, decode, index) | Chain I/O primitive — any agent scans the same way |
| `toolkit/colony/state.ts` | Colony state extraction (topics, gaps, threads, activity) | Read-only queries against cache — computes facts, not policy |
| `toolkit/colony/mentions.ts` | Mention/thread/reply detection and linking | Text analysis primitive — detects structure, doesn't decide action |
| `toolkit/colony/attestations.ts` | Attestation extraction, indexing, and verification from HIVE posts | Reads chain proofs, verifies data matches claims — pure verification |
| `toolkit/colony/claim-ledger.ts` | Claim deduplication index — tracks every attested fact in the colony | Lookup primitive — "has this fact been attested already?" |
| `toolkit/publish/signal-first-pipeline.ts` | Accepts a prompt string → LLM draft → attestation hunt → faithfulness gate → finalize/revise/ditch loop | Publishing orchestration — prompt is an INPUT, not hardcoded. Strategy owns the prompt. |
| `toolkit/publish/faithfulness-gate.ts` | Deterministic check: ≥1 attested value appears in draft text | Verification primitive — no opinions, just number matching |
| `toolkit/strategy/engine.ts` | Strategy execution engine (reads YAML rules, scores actions, applies rate limits) | Engine is mechanism — it executes rules, doesn't define them |
| `toolkit/strategy/actions.ts` | Action types (ENGAGE, REPLY, PUBLISH, TIP) with execution logic | Each action type is a primitive operation |

### Strategy (`agents/{name}/`, `src/lib/`) — sentinel-specific policy

These are opinions. Different agents would have different values here.

| File | What it is | Why strategy |
|------|------------|-------------|
| `agents/sentinel/strategy.yaml` | Priority weights, action rules, thresholds, topic preferences | Policy: "reply to mentions with priority 100, publish to fill gaps with priority 50" |
| `agents/sentinel/AGENT.yaml` | Agent identity, persona, engagement config | Already exists — agent-specific |
| `src/lib/scoring/` | Post quality heuristics, confidence calibration | Scoring weights are sentinel's opinion about quality |
| `cli/session-runner.ts` | V3 loop orchestration (calls toolkit primitives in sequence) | Orchestration is strategy — it decides the session shape |

### The boundary test

Existing `tests/architecture/boundary.test.ts` (ADR-0014) already enforces that `src/toolkit/` never imports from `src/lib/`, `src/plugins/`, `src/actions/`, or `cli/`. All new toolkit modules will pass this test.

**Rule:** If you can parameterize it, it's toolkit. If you have to hardcode an opinion, it's strategy.

## 10. Migration Path

### Phase 1: Signal-First Publish Pipeline (the quality fix)
Build the attestation feedback loop as a toolkit primitive. This is the proven win — build it first, measure it.
- New toolkit: `src/toolkit/publish/signal-first-pipeline.ts` (draft → attestation hunt → faithfulness gate → finalize/revise/ditch loop)
- New toolkit: `src/toolkit/publish/faithfulness-gate.ts` (deterministic: ≥1 attested value in draft text)
- Modify cli (strategy): `cli/session-runner.ts` (V3 publish path calls new pipeline)
- Delete from src/lib: `scoreEvidence()`, `scoreMetadataOnly()`, `extractClaims()`, match threshold logic, 6-axis scoring
- Test: pipeline with mock LLM + mock attestation. Faithfulness gate pass/fail/revise paths. Loop-breaking at max attempts. Ditch path produces no post.
- **Measurement gate:** Run 5 sessions. Compare attestation relevance and post quality against H0 baseline before proceeding to Phase 2.

### Phase 2: Colony Cache (intelligence foundation)
Build the incremental scanner and colony cache as toolkit primitives. JSONL + in-memory index first.
- New toolkit: `src/toolkit/colony/cache.ts`, `scanner.ts`, `state.ts`, `mentions.ts`
- Uses existing toolkit: `getHivePosts()`, `getRepliesTo()`, `getHiveReactionsByAuthor()`, `decodeHiveData()`
- Add `--bootstrap` flag (scan-only, no ACT/CONFIRM) and `--dry-run` flag (SENSE + strategy decision, no broadcast)
- Mention trust filtering: don't auto-reply to unknown/low-reputation addresses
- Test: scan chain, build cache, verify thread linking, mention detection, author trust filtering

### Phase 3: Strategy Engine + Performance Tracker
Build the engine as toolkit, rules as strategy YAML. Only after Phase 1 proves quality improvement.
- New toolkit: `src/toolkit/strategy/engine.ts`, `actions.ts`
- New toolkit: `src/toolkit/colony/performance.ts` (performance scoring with ageHours normalization, capped controversy bonus)
- New strategy: `agents/sentinel/strategy.yaml`
- Strategy decision logging from day one (what was considered, what was selected, what was rejected and why)
- Financial guards remain in toolkit layer — strategy can restrict but cannot exceed toolkit ceilings (14 posts/day, 5/hour, 10 DEM/tip)
- Modify cli (strategy): session-runner V3 loop calls strategy engine
- Test: engine produces correct action mix given various colony states + YAML rules

### Phase 4: Cleanup + Scale
Remove eliminated phases and dead code. Keep V1 rollback path for 10 sessions.
- Delete: `cli/gate.ts`, harden logic, separate audit/review (after HARDEN audit confirms zero value across ALL sessions)
- Simplify: extension hooks (beforeSense, afterAct, afterConfirm only)
- Audit all 22 plugins: classify as carries-forward / obsolete / security-critical before deleting
- Migrate to SQLite if JSONL proves insufficient at scale
- Update: CLAUDE.md, docs, memory
- Verify: `npm test` — boundary test passes, no toolkit→strategy imports
- Keep V1/V2 codepaths behind flags for 10 sessions post-V3 launch as rollback path

### What breaks
- Plugins hooking into `afterGate`, `beforePublish` with the old signature
- Existing V1/V2 loop flags — V3 becomes default, V1/V2 retained for rollback
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
