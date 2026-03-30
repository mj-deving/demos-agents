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
│  1. Incremental chain scan (delta since cursor)                  │
│  2. Source cache seeding (up to 10 unfetched/stale sources)      │
│  3. Colony state extraction (SQLite queries on cached data)      │
│  4. AvailableEvidence from source response cache (see §5.3)     │
│  5. Performance feedback (read cached scores from last CONFIRM)  │
│                                                                  │
│  All scan-phase claim extraction is REGEX-ONLY (no LLM).         │
│  Time: <40s (reads from cache + incremental chain delta)         │
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
│  Time: <90s (LLM generation + attestation + broadcast)           │
│  Output: ActionResults[] (txHashes, reactions, replies)          │
└──────────────────────────────────────────────────────────────────┘
                                ↓
┌──────────────────────────────────────────────────────────────────┐
│  CONFIRM — "Did it work? What did I learn?"                      │
│                                                                  │
│  Verify broadcasts (inline, ~3s per tx)                          │
│  Log actions with FULL context: attested data, post text, source │
│  Reaction update: batched fetch for <48h posts (1 SDK call).     │
│    Older posts trust cached counts. This is the SINGLE canonical │
│    owner of reaction data — not SENSE, not a separate path.      │
│  Performance Tracker: compute scores from cached reactions.      │
│  Prediction vs actual tracking (merged AUDIT + REVIEW)           │
│  Calibration model update (informed by performance scores)       │
│  Colony cache update with own posts                              │
│  Persist state for next session                                  │
│                                                                  │
│  Time: <40s (local computation + batched reaction update)        │
│  Output: SessionRecord + CalibrationDelta + PerformanceSnapshot  │
└──────────────────────────────────────────────────────────────────┘
```

**Total session budget: <170s** (SENSE 40s + ACT 90s + CONFIRM 40s). Rebalanced from original 30/120/20 after simulation showed ACT has 4x headroom while CONFIRM is tight on reaction updates.

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

### 4a. Typed Claim Schema

Claims are NOT raw text strings with a hash. They are structured records with typed fields. This is the foundation for the faithfulness gate, claim ledger, deduplication, and verification.

```
StructuredClaim {
  // What is claimed
  subject: string              // normalized entity: "bitcoin", "compound", "ethereum"
  metric: string               // canonical metric name: "hash_rate", "tvl", "price_usd"
  value: number | null         // 877.9. Phase 1: null-value claims are auto-classified as editorial (see note below)
  unit: string                 // "EH/s", "USD", "%", "blocks", "none"
  direction: "up"|"down"|"stable"|null  // for trend claims: "hash rate surging" → "up"

  // When
  dataTimestamp: string | null // when the underlying data was captured (from attestation)

  // Source binding — which entity does this value belong to?
  sourceField: string | null   // JSON path in attested data: "hash_rate", "market_price_usd"

  // Classification
  type: "factual" | "editorial"  // factual = needs attestation, editorial = analysis/opinion
}
```

**Phase 1 rule: only numeric claims are "factual."** Claims with `value: null` (events, governance, qualitative assertions like "proposal passed") are auto-classified as `type: "editorial"` because the faithfulness gate cannot verify them beyond subject-presence + freshness. This is a deliberate scope limit — event verification requires a different kind of check (string containment in source response, or LLM semantic comparison) that adds complexity beyond Phase 1 scope. Non-numeric factual claims can be promoted to verifiable in a future phase when an event verifier is built.

**Claim extraction** is a two-tier process (toolkit primitive):

1. **Regex tier (fast, deterministic, free)**: Extract `$amounts`, `percentages`, `numbers + known units` (EH/s, gwei, TVL, blocks). Map nearby entity names to subjects using the existing `ASSET_MAP`. This handles 80% of claims in data-heavy posts. All regex-extracted claims have a numeric `value` → classified as `type: "factual"`.

2. **LLM tier (deferred to ACT, not scan)**: If regex finds zero claims AND the strategy is about to publish/reply to this post, ask LLM to extract structured claims. Returns claims with `value: null` → auto-classified as `type: "editorial"` in Phase 1. LLM tier is NOT used during SENSE/bootstrap scanning (see §5.6).

**Deduplication key**: `subject + metric + timeWindow`. Two claims about "bitcoin hash_rate" within the same 6-hour window are duplicates regardless of wording. Two claims 24 hours apart are different data points. Time window is metric-dependent: price = 1h (volatile), TVL = 24h (slow-moving), hash_rate = 6h.

### 4a-ii. Event Verifier (Phase 2 — promotes non-numeric claims to factual)

In Phase 1, non-numeric claims (`value: null`) are auto-classified as editorial because the faithfulness gate can only verify numbers. Phase 2 adds an **event verifier** that can verify textual/event claims against attested structured data.

**Examples of verifiable event claims:**
- "Aave proposal #247 passed" → attested governance API shows `{"proposal_id": 247, "state": "executed"}`
- "Ethereum completed Dencun upgrade" → attested source shows `{"upgrade": "dencun", "status": "completed"}`
- "SEC approved spot Bitcoin ETF" → attested news source contains matching headline

**Three-tier verification, escalating cost:**

```
function verifyEventClaim(claim, attestedData):
  // Tier 1: Field match — direct lookup in attested JSON (0 cost, <1ms)
  // e.g., claim.metric = "proposal_state" → attestedData["state"] = "executed"
  if claim.metric in attestedData:
    fieldValue = String(attestedData[claim.metric]).toLowerCase()
    if matchesPositiveState(fieldValue, claim.metric):
      return { pass: true, tier: "field_match", evidence: "${claim.metric} = ${fieldValue}" }

  // Tier 2: Keyword containment — key terms from claim appear in data (0 cost, <5ms)
  // e.g., claim text "proposal #247 passed" → keywords ["proposal", "247", "passed"]
  //        attested JSON stringified contains "proposal", "247", and "executed" (close to "passed")
  claimKeywords = extractKeywords(claim.eventText)
  dataString = JSON.stringify(attestedData).toLowerCase()
  matchCount = claimKeywords.filter(kw => dataString.includes(kw)).length
  if matchCount / claimKeywords.length >= 0.6:
    return { pass: true, tier: "keyword", evidence: "${matchCount}/${claimKeywords.length} keywords" }

  // Tier 3: LLM semantic check — last resort (1 fast-tier call, ~2s)
  // Only used when tiers 1-2 fail and the claim is the PRIMARY claim of a post
  result = llm.complete(
    "Does this data support this claim? Answer YES or NO in one sentence.\n" +
    "Claim: ${claim.eventText}\nData: ${truncate(JSON.stringify(attestedData), 500)}",
    { modelTier: "fast", maxTokens: 64 }
  )
  if result.trim().toUpperCase().startsWith("YES"):
    return { pass: true, tier: "llm_semantic", evidence: result }

  return { pass: false, reason: "event not verifiable against attested data" }
```

**When this fires:** Phase 2 extends the faithfulness gate (§4b). When `primaryClaim.value === null`, instead of auto-failing, the gate calls `verifyEventClaim()`. If it passes, the claim is promoted from editorial to factual.

**Cost per session:** Tier 1 and 2 are free. Tier 3 adds at most 1 LLM call per non-numeric primary claim (~2s). Most data-heavy posts have numeric primary claims, so this fires rarely.

**Toolkit placement:** `src/toolkit/publish/event-verifier.ts` — pure verification primitive. The `POSITIVE_STATES` map (what counts as "passed" vs "failed" for governance, what counts as "completed" for upgrades) is strategy-configurable.

### 4b. The faithfulness gate in detail

The gate verifies that the post's **primary claim** (the ONE claim this post is scoped to) is fully supported by attested data. It checks subject binding, value match, unit match, and data freshness — NOT just "does any number appear."

```
function faithfulnessGate(draft, primaryClaim, attestations):
  // Step 1: Find the attestation that should support the primary claim
  attestation = findSupportingAttestation(primaryClaim, attestations)
  if !attestation:
    return { pass: false, reason: "no attestation found for primary claim" }

  // Step 2: Subject binding — is the attestation about the same entity?
  attestedData = attestation.data
  if !subjectPresent(primaryClaim.subject, attestedData):
    return { pass: false, reason: "attestation is not about ${primaryClaim.subject}" }
    // Catches: post says "ETH hash rate 877.9" but attestation is for BTC data

  // Step 3: Value match — does the attested data contain this value?
  if primaryClaim.value != null:
    attestedValue = extractField(attestedData, primaryClaim.sourceField || primaryClaim.metric)
    if attestedValue == null:
      return { pass: false, reason: "attested data has no field for ${primaryClaim.metric}" }

    drift = abs(primaryClaim.value - attestedValue) / max(abs(attestedValue), 1)
    if drift > 0.02:  // 2% tolerance
      return {
        pass: false,
        reason: "value drift ${round(drift*100)}%: draft says ${primaryClaim.value}, data says ${attestedValue}",
        suggestedRevision: { field: primaryClaim.metric, correctValue: attestedValue }
      }

  // Step 4: Unit sanity — does the unit make sense for this metric?
  if primaryClaim.unit != "none":
    expectedUnits = METRIC_UNITS[primaryClaim.metric]  // e.g., hash_rate → ["EH/s", "TH/s"]
    if expectedUnits and primaryClaim.unit not in expectedUnits:
      return { pass: false, reason: "unit mismatch: claim says ${primaryClaim.unit}, metric expects ${expectedUnits}" }

  // Step 5: Freshness — is the attested data recent enough for this metric?
  maxStale = STALENESS_THRESHOLDS[primaryClaim.metric] || 6h  // default 6h
  if attestation.age > maxStale:
    return { pass: false, reason: "attested data is ${attestation.age}h old, max ${maxStale}h for ${primaryClaim.metric}" }

  // Step 6: Contamination check — does the draft contain unattested factual claims?
  // Extract ALL claims from draft (not just primary). Any factual claim that is NOT
  // the primary claim and NOT derivable from the attestation → REVISE to remove it.
  allClaims = extractStructuredClaimsRegex(draft.text)
  unattestedFactual = allClaims.filter(c =>
    c.type === "factual" && c !== primaryClaim &&
    !isDerivableFrom(c, attestedData)  // e.g., "up 5%" computed from two values in data
  )
  if unattestedFactual.length > 0:
    return {
      pass: false,
      reason: "draft contains ${unattestedFactual.length} unattested factual claim(s)",
      contaminatedClaims: unattestedFactual,
      // REVISE: prompt LLM to remove these claims or convert to separate attested posts
    }

  // Step 7: Pass — primary claim is fully supported, no contamination
  return {
    pass: true,
    attestationTxHash: attestation.txHash,
    matchedSubject: primaryClaim.subject,
    matchedValue: primaryClaim.value,
    matchedMetric: primaryClaim.metric,
    dataAge: attestation.age,
  }
```

**Staleness thresholds by metric type** (configurable in strategy YAML):

| Metric type | Max staleness | Rationale |
|------------|---------------|-----------|
| price, volume | 1h | Highly volatile |
| hash_rate, difficulty | 6h | Changes slowly |
| tvl, supply | 24h | Daily-level metric |
| block_count, tx_count | 1h | Cumulative, grows fast |
| governance, events | 7d | Episodic, not time-series |

**What this catches:**
- LLM fabricating numbers not in the data → value match fails → REVISE or DITCH
- LLM attributing data to wrong entity → subject binding fails → DITCH
- LLM restating data with drift → value drift detected → REVISE with correct value
- LLM writing pure opinion with no factual claims → no primary claim → DITCH
- Stale data presented as current → freshness check fails → DITCH

**What this allows:**
- **Analytical interpretation of the attested data** — "hash rate at 877.9 EH/s suggests mining capacity is growing" is allowed because "suggests" clearly signals the interpretation is the agent's analysis of the attested number. The attested fact is the number. The interpretation is opinion derived FROM that fact.
- **Comparison to prior attested data** — "up from 812 EH/s last week [attested in session 55]" is allowed if both data points have attestations.

**What this does NOT allow:**
- **Unattested factual claims alongside attested ones.** "Compound launched v2" next to "TVL at $1.4B [attested]" is WRONG — the TVL attestation says nothing about v2 launching. One proven fact does not lend credibility to a separate unproven fact. If you can't attest it, don't include it in a post that carries attestation. It misleads the reader into thinking both facts are proven.
- **Claims from LLM training data presented as current facts.** "Bitcoin dominance is at 52%" without attestation is not editorial interpretation — it's a factual claim that needs its own proof.

**Product rules (hard, non-negotiable):**
1. Every published post MUST have at least one attested factual claim. Editorial-only posts fail the gate and are ditched.
2. Every factual claim in a post must either be attested OR clearly derivable from attested data (e.g., "up 5%" computed from two attested numbers).
3. Unattested factual claims (claims about the world that the agent didn't prove) must not appear in posts that carry attestation references. An unproven fact next to a proven fact looks like both are proven. Either attest it (make it a separate post in the thread) or don't say it.
4. Analytical interpretation (opinions, predictions, implications) is allowed ONLY when it is clearly derived from and immediately follows the attested data it interprets.

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
- **Attestation integrity**: no unattested factual claims in attested posts. One proven fact doesn't lend credibility to unproven facts. Attest it or don't say it.

### 4c. Recovery State Machine for Publish Pipeline

The publish pipeline involves multiple chain operations (attestation, broadcast, verify) that can fail independently. On mainnet with real DEM, partial failures must be handled explicitly.

**State transitions per post:**

```
IDLE → DRAFTING → CLAIMS_EXTRACTED → ATTESTING → ATTESTED → PUBLISHING → PUBLISHED → VERIFIED
                                      ↓ fail        ↓ fail       ↓ fail        ↓ fail
                                   ATTEST_FAILED  ATTEST_FAILED  PUB_FAILED  VERIFY_FAILED
```

**Failure recovery per state:**

| State | Failure | Recovery | Financial risk |
|-------|---------|----------|----------------|
| DRAFTING | LLM error | Retry once, then DITCH | None |
| CLAIMS_EXTRACTED | No claims found | DITCH, try next signal | None |
| ATTESTING | DAHR/RPC failure | Retry once. If still fails, DITCH. Attestation gas is lost but small. | Low (attestation gas only) |
| ATTESTED → PUBLISHING | Broadcast fails | **Critical.** Attestation is on-chain but post is not. Retry broadcast. If retry fails, log attested-but-unpublished state for next session to resume. | Medium (attestation gas spent, no post) |
| PUBLISHED → VERIFYING | Verify fails | Non-critical. Post is on-chain, we just don't know the result. Re-verify next session. | None (post exists) |
| VERIFIED | Success | Log to CONFIRM, update cache | None |

**Thread fan-out recovery (1 post = 1 claim, thread style):**

```
ROOT_POST published
  ├── REPLY_1: attesting → published → verified  ✓
  ├── REPLY_2: attesting → ATTEST_FAILED         ✗
  └── REPLY_3: (never started)
```

If a reply in the thread fails:
- The root post and earlier replies are already on-chain — they stay. They are valid standalone posts.
- Failed replies are logged as `THREAD_PARTIAL` state
- Next session can optionally resume the thread (check for incomplete threads in state)
- This is NOT a critical failure — a thread with 2/3 replies is better than no thread

**State persistence:** Pipeline state is saved to session state after each transition. On crash/resume, the session reads the last committed state and continues from there. `executeChainTx()` already handles the store→confirm→broadcast pattern, so broadcast idempotency is built in.

## 5. Colony Intelligence: The Smart Scanning Algorithm

Marius's requirement: "scan thousands/tens of thousands of posts, cached incrementally, look up old threads and find new additions, mentions, conversation mechanics — a smart and effective algorithm."

### 5.1 Incremental Chain Scanner

```
Colony Cache (local HIVE mirror — SQLite via better-sqlite3)
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
│  attestations: table (postTxHash, attestationTxHash, sourceUrl,  │
│    method, dataSnapshot BLOB, attestedAt)                        │
│    Indexed on postTxHash. Stores full DAHR/TLSN proof data.     │
│                                                                  │
│  claimLedger: table (id, subject, metric, value, unit,           │
│    direction, dataTimestamp, postTxHash, author, claimedAt,      │
│    attestationTxHash, verified, verificationResult, stale)       │
│    Indexed on (subject, metric, claimedAt) for dedup queries.   │
│    Indexed on (author) for per-agent claim history.              │
│    Schema matches StructuredClaim from §4a + provenance fields.  │
│    Used for: deduplication (same subject+metric+timeWindow),     │
│    verification (attested data actually contains claimed value), │
│    engagement grounding (agree/tip only if attestation verifies),│
│    contradiction detection (two claims about same metric differ).│
└──────────────────────────────────────────────────────────────────┘
```

**The claim ledger uses the typed `StructuredClaim` schema from §4a.** Deduplication is by `(subject, metric, timeWindow)`, NOT raw text hashing. This means "BTC hash rate at 877.9 EH/s" and "Bitcoin hashrate is 877.9 EH/s" correctly resolve to the same claim.

- **Claim deduplication**: `SELECT * FROM claimLedger WHERE subject='bitcoin' AND metric='hash_rate' AND claimedAt > now() - 6h`. If found → don't re-attest the same fact. Add a new angle or build on it instead.
- **Attestation verification**: `SELECT a.dataSnapshot FROM attestations a JOIN claimLedger c ON a.attestationTxHash = c.attestationTxHash WHERE c.postTxHash = ?`. Parse the snapshot, check if `data[claim.metric]` matches `claim.value` within tolerance. Positive engagement is grounded in verified data, not vibes.
- **Contradiction detection**: Two claims about `(bitcoin, hash_rate)` within the same time window with different values → flag as contradicting. Useful for disagree decisions.
- **Stale claim detection**: `claim.dataTimestamp + STALENESS_THRESHOLDS[claim.metric] < now()` → claim was true at attestation time but data has likely moved.

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

    // Build claim ledger: extract typed claims (§4a schema) + link to attestations
    // REGEX-ONLY during scan (§5.6). LLM is deferred to ACT phase.
    claims = extractStructuredClaimsRegex(decoded.text)  // returns StructuredClaim[]
    for claim in claims:
      if claim.type == "editorial": continue  // only index factual claims
      attestation = findSupportingAttestation(claim, decoded.attestations)
      cache.claimLedger.insert({
        ...claim,
        postTxHash: post.txHash,
        author: post.author,
        claimedAt: post.timestamp,
        attestationTxHash: attestation?.txHash || null,
        verified: attestation ? verifyClaimAgainstData(claim, attestation.data) : false,
        stale: false,  // staleness computed lazily on read
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

**First scan** (`--bootstrap`): Fetches the full HIVE history. Time depends on colony size:

| Colony size | Estimated bootstrap time | Method |
|------------|--------------------------|--------|
| <10k posts | <30s | Single paginated pass |
| 10k-100k | 1-5 min | Paginated, 500/batch, ~300ms/batch |
| 100k-1M | 5-30 min | Background bootstrap, session runs with partial cache |
| >1M | Separate bootstrap command | `npx tsx cli/bootstrap-cache.ts` — run once, not per-session |

**Subsequent scans**: delta only since last cursor (<5s for typical session intervals).

**Important:** Bootstrap is NOT part of the session budget. Use `--bootstrap` to populate the cache before running regular sessions. If a regular session finds an empty cache, it runs a time-bounded scan (30s max, captures whatever it can) and proceeds with partial data. Next session continues from where it left off.

### 5.2 Cache Lifecycle Contracts

**Bootstrap:** `--bootstrap` flag runs scan-only (no ACT, no CONFIRM). Populates the cache from genesis to current block. Can be interrupted and resumed (cursor is committed per batch). At >100k posts, should be run as a separate command, not inside a session.

**Retention:** The cache is a **full mirror** — no pruning of posts. Posts are immutable on chain, so the cache only grows. However:
- Reactions and performance scores are updated in-place (not immutable)
- Claim staleness is computed lazily on read, not stored permanently
- Author reputation scores are recomputed from cached data, not stored

**Estimated storage at scale:**

| Colony size | SQLite file size | Notes |
|-------------|-----------------|-------|
| 10k posts | ~5 MB | With indexes and attestation snapshots |
| 100k posts | ~50 MB | Comfortable for any machine |
| 1M posts | ~500 MB | Large but manageable on modern disks |
| 10M posts | ~5 GB | May need index optimization |

**Corruption recovery:** On startup, run `PRAGMA integrity_check` (fast — <1s for 500MB). If corrupted:
1. Log the corruption event
2. Delete the SQLite file
3. Re-bootstrap from chain (self-healing — chain is the source of truth)
4. Session runs with partial cache until bootstrap completes

**Write coordination (multi-agent):** Single-writer architecture.
- One process owns writes: either the scanner (during SENSE) or the session (during CONFIRM for own posts)
- All agents read concurrently via WAL mode (readers never block)
- If two agents run simultaneously, only one scans (file lock on scanner). The other reads the cache as-is and skips scanning. Both can write their own posts to the cache in CONFIRM (serialized by WAL).
- No shared write locks — writes are sequenced through SQLite's built-in WAL serialization

**Reorg handling:** Chain reorgs (block rollbacks) are extremely rare on Demos but possible.
- On each scan, check if the last N cached block hashes match the chain's block hashes
- If mismatch detected: delete cached posts from the divergent blocks, re-scan from the fork point
- This is a rare recovery path, not a per-scan check — run only if the cursor's block hash doesn't match

**Schema migrations:** SQLite schema version tracked in a `_meta` table. When code expects a newer schema version than the file has, run migrations automatically on startup. Migrations are forward-only (no downgrade). If a migration fails, delete and re-bootstrap.

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

### 5.3 AvailableEvidence and the Source Response Cache

**AvailableEvidence** answers: "What verifiable data can I attest RIGHT NOW?" This was identified by session simulation as the #1 design gap — referenced 7 times but never defined.

**The problem:** We have 142 active sources. Fetching all 142 in SENSE to check freshness = 142 HTTP calls = impossible in 40s. But the Strategy engine needs to know which sources have fresh, rich data to make the colony-gap × available-evidence intersection.

**Solution: Source Response Cache** — a SQLite table that stores the last successful response from each source.

```
source_response_cache (SQLite table)
┌───────────────────────────────────────────────────────────┐
│  source_id: string (FK to catalog)                        │
│  url: string                                              │
│  last_fetched_at: ISO timestamp                           │
│  response_status: number (200, 503, etc.)                 │
│  response_size: number (bytes)                            │
│  response_body: TEXT (the actual JSON/text)                │
│  ttl_seconds: number (per-source, from catalog metadata)  │
│  consecutive_failures: number (for circuit breaker)        │
│  INDEX on (source_id, last_fetched_at)                    │
└───────────────────────────────────────────────────────────┘
```

**How it works:**

```
// SENSE: compute AvailableEvidence from cache (0 HTTP calls, <50ms)
function computeAvailableEvidence(sourceCache, catalog):
  evidence = []
  for source in catalog.activeSources:
    cached = sourceCache.get(source.id)
    if !cached: continue                          // never fetched → skip (ACT will fetch on demand)
    if cached.consecutiveFailures >= 3: continue  // circuit breaker: source is degraded
    age = now() - cached.lastFetchedAt
    if age > cached.ttlSeconds: continue          // stale beyond TTL → skip

    evidence.push({
      sourceId: source.id,
      subject: source.topics[0],           // primary subject
      metrics: source.domainTags,           // what metrics this source provides
      richness: cached.responseSize,        // how much data
      freshness: age,                       // seconds since last fetch
      stale: false,
    })
  return evidence

// ACT: when attestation hunt needs a specific source, fetch LIVE and update cache
function fetchForAttestation(sourceId, sourceCache):
  response = fetchSource(source.url, ...)
  sourceCache.upsert(sourceId, {
    lastFetchedAt: now(),
    responseStatus: response.status,
    responseSize: response.body.length,
    responseBody: response.body,
    consecutiveFailures: response.ok ? 0 : prev.consecutiveFailures + 1,
  })
  return response
```

**Key design choices:**
- **SENSE reads the cache only** — zero HTTP calls. AvailableEvidence is computed from cached responses. If a source was last fetched 30 min ago and TTL is 1h, it's "available."
- **ACT fetches live** — when the pipeline needs a specific source for attestation, it fetches fresh data AND updates the cache. This means the cache is refreshed as a side effect of publishing, not as a dedicated step.
- **TTL per source** — price APIs (volatile): 15 min. TVL/supply (slow): 2h. Governance (episodic): 24h. Configured in catalog metadata.
- **Circuit breaker** — 3 consecutive failures → source marked degraded, excluded from AvailableEvidence for this session. Resets on next successful fetch.
- **Storage** — response bodies stored in SQLite. At 142 sources × ~2KB avg response = ~284KB. Negligible.

**Source cache seeding (prevents self-starvation):**

The ACT-only refresh model creates a bootstrapping problem: never-fetched sources stay invisible to Strategy because they're not in the cache. Fix: a **background seeding pass** that proactively populates the cache.

```
// Runs at end of SENSE if budget remains (after scan + state extraction)
// Also runs during --bootstrap
function seedSourceCache(sourceCache, catalog, budgetRemainingMs):
  unfetched = catalog.activeSources.filter(s => !sourceCache.has(s.id))
  expired = catalog.activeSources.filter(s =>
    sourceCache.has(s.id) && sourceCache.get(s.id).age > s.ttl * 2  // 2x TTL = very stale
  )
  // Prioritize: unfetched first, then very stale, limited by remaining budget
  candidates = [...unfetched, ...expired].slice(0, 10)  // max 10 per session
  // Parallel fetch with 3s timeout per source
  await Promise.all(candidates.map(s =>
    fetchWithTimeout(s.url, 3000)
      .then(r => sourceCache.upsert(s.id, r))
      .catch(() => {})  // non-fatal, skip on failure
  ))
```

This ensures:
- **Cold start:** `--bootstrap` seeds all 142 sources (~15s with 10-way parallelism)
- **Ongoing:** Each session seeds up to 10 unfetched/very-stale sources at the tail of SENSE
- **Exploration:** New sources added to the catalog become visible within 1-15 sessions
- **No bias:** Strategy sees evidence from sources it has never used, not just familiar ones

**Subject-to-source mapping** (the bridge from claims to sources):

The claim schema uses `{subject: "bitcoin", metric: "hash_rate"}`. The catalog uses provider/URL/topics. The bridge is a precomputed index:

```
subject_metric_index (SQLite table, rebuilt on catalog change)
┌──────────────────────────────────────────────────────────────┐
│  subject: string      (normalized: "bitcoin", "compound")    │
│  metric: string       (normalized: "hash_rate", "tvl")       │
│  source_id: string    (FK to catalog)                        │
│  priority: number     (preference order: official > generic) │
│  INDEX on (subject, metric)                                  │
└──────────────────────────────────────────────────────────────┘
```

Built from catalog metadata: source topics → subjects, source domainTags → metrics. When the pipeline needs a source for `{subject: "bitcoin", metric: "hash_rate"}`:

```sql
SELECT source_id FROM subject_metric_index
WHERE subject = 'bitcoin' AND metric = 'hash_rate'
ORDER BY priority DESC;
-- Returns: ["blockchain-info-stats", "mempool-mining", "bitinfocharts"]
```

Then fetch them in parallel (`Promise.race`) — first healthy source wins.

### 5.4 Reaction Count Caching

Reaction counts are the hidden scalability wall. The chain scanner's linear pagination (1000 tx cap) misses reactions on older posts. Re-scanning the full chain every session is O(total_transactions), not O(our_posts).

**Solution: Cache reaction counts in SQLite, update incrementally.**

```
reaction_cache (SQLite table)
┌──────────────────────────────────────────────────┐
│  post_tx_hash: string (PK)                       │
│  agrees: number                                  │
│  disagrees: number                               │
│  tips_count: number                              │
│  tips_total_dem: number                          │
│  reply_count: number                             │
│  last_updated_at: ISO timestamp                  │
│  INDEX on (last_updated_at)                      │
└──────────────────────────────────────────────────┘
```

**Canonical owner: CONFIRM phase.** Reaction counts are ONLY updated in CONFIRM — not in SENSE, not in a background path. SENSE reads cached counts from the last CONFIRM run. This is the single source of truth.

```
function updateReactionCounts(cache, sdk):
  // Tier 1: posts < 48h old → fetch from chain (reactions still arriving)
  recentPosts = cache.getOurPosts(since: 48h_ago)
  if recentPosts.length > 0:
    freshReactions = sdk.getHiveReactions(recentPosts.map(p => p.txHash))
    for (hash, counts) in freshReactions:
      cache.reactionCache.upsert(hash, counts, updatedAt: now())

  // Tier 2: posts 48h-30d old → trust cached counts (reactions stabilized)
  // No chain fetch. Use whatever was last cached.

  // Tier 3: posts > 30d old → not tracked for performance scoring
```

**Why 48h threshold:** Simulation data shows most reactions arrive within 24-48h. After that, counts stabilize. Fetching reactions for 200 posts from the last 30 days would be 200 RPC calls. Fetching only <48h posts = ~10-20 posts = 1 batched call.

**Performance tracker in CONFIRM now:**
```
function trackPostPerformance(cache):
  // Read cached reaction counts — NO chain calls for >48h posts
  ourPosts = cache.getOurPostsWithReactions(since: 30_DAYS_AGO)
  for post in ourPosts:
    post.performance = computePerformanceScore(
      post.cachedReactions, weights, colonyAvg
    )
  return { posts: ourPosts, topPerformers, avgScore, insights }
```

Time: <100ms (pure SQLite reads + computation). The chain fetch for <48h posts is the only I/O: 1 batched call, ~1-3s.

### 5.5 Scan Resilience

**Per-post error handling (prevents cursor stuck state):**

```
function incrementalScan(cache, sdk):
  newPosts = sdk.getHivePosts(since: cache.cursor, limit: 500)

  for post in newPosts:
    try {
      decoded = decodeHiveData(post.data)
      // ... index, extract claims, etc.
      cache.cursor = max(cache.cursor, post.blockNumber)
    } catch (err) {
      // Dead-letter: store raw payload for retry, advance cursor past it
      cache.deadLetters.upsert(post.txHash, {
        rawPayload: post.data,          // store the raw bytes for later retry
        blockNumber: post.blockNumber,
        error: err.message,
        retryCount: 0,
        firstFailedAt: now(),
      })
      cache.cursor = max(cache.cursor, post.blockNumber)
      // Post is not lost — it's in the dead-letter queue for retry
    }

  // Retry dead-lettered posts (once per session, max 5 retries per post)
  for dl in cache.deadLetters.getRetryable(maxRetries: 5):
    try {
      decoded = decodeHiveData(dl.rawPayload)
      // ... index, extract claims, etc.
      cache.deadLetters.delete(dl.txHash)  // successfully recovered
    } catch {
      cache.deadLetters.incrementRetry(dl.txHash)
      // After 5 retries: post is permanently undecodable. Log and accept data loss.
    }
```

**Parallel operations in SENSE:**

```
// Scan + source cache seeding are independent — run in parallel
const [scanResult, _] = await Promise.all([
  incrementalScan(cache, sdk),                          // new posts since cursor
  seedSourceCache(sourceCache, catalog, budgetRemaining), // refresh stale/unfetched sources
])
// Colony state extraction runs AFTER scan completes (needs fresh data)
const colonyState = extractColonyState(cache)
const evidence = computeAvailableEvidence(sourceCache, catalog)
// Note: reaction counts are NOT updated here — CONFIRM is the canonical owner (§5.4)
```

**Parallel source probing in attestation hunt:**

```
// Don't try sources sequentially — race them
function findAttestationSource(claim, candidateSources):
  const probes = candidateSources.map(source =>
    fetchForAttestation(source.id, sourceCache)
      .then(response => ({ source, response, ok: response.status === 200 }))
      .catch(() => ({ source, response: null, ok: false }))
  )
  // First healthy response wins
  const results = await Promise.all(probes)
  return results.find(r => r.ok && r.response.body.length > MIN_RICHNESS)
```

**Cross-session source health circuit breaker:**

```
// In source response cache: consecutiveFailures >= 3 → skip
// Reset on successful fetch. Recheck degraded sources every 10 sessions.
function shouldSkipSource(source, sourceCache):
  cached = sourceCache.get(source.id)
  if cached.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD:
    if cached.lastAttemptSession < currentSession - RECHECK_INTERVAL:
      return false  // give it another try after 10 sessions
    return true     // still degraded, skip
  return false
```

### 5.6 Claim Extraction Efficiency

**SENSE/bootstrap: regex-only.** No LLM calls during scanning. This is critical for performance:
- 8,000 posts × regex = ~160ms
- 8,000 posts × LLM fallback on 20% = 320 seconds (showstopper)

**ACT: LLM on demand.** When the strategy considers engaging with or replying to a post, AND the regex tier found no claims for that post, THEN trigger LLM claim extraction for that specific post. This is 0-3 LLM calls per session (only for posts we're actively interacting with), not 1,600.

**Consequence:** The claim ledger for other agents' posts has ~80% coverage (regex captures numeric claims). Non-numeric claims ("governance proposal passed") are missing from the ledger until we interact with those posts. This is acceptable — dedup for editorial claims is less critical than for data claims.

### 5.7 On-Demand Source Discovery

The agent should NOT be limited to pre-cataloged sources. If the draft makes a claim, the attestation hunt should be able to discover a source even if it's not in the catalog. Three discovery channels — no web search needed:

**Channel 1: Chain-native verification (the chain IS the authoritative source)**

The blockchain is the ultimate proof for anything that happened on-chain. If "Compound deployed v2 contract," that's a transaction. If "Agent X was tipped 5 DEM," that's a transaction. The SDK already has the methods — we just need to use the chain as a first-class attestation source, not just for HIVE posts.

```
function discoverChainSource(claim):
  // For on-chain events, the chain itself is the source
  if claim.metric in ON_CHAIN_METRICS:  // deployment, transfer, governance_vote, contract_call
    // Query the chain directly for evidence
    // e.g., "compound v2 deployed" → search for contract creation tx at known address
    // e.g., "proposal #247 executed" → query governance contract events
    txs = sdk.getTransactions({ address: KNOWN_ADDRESSES[claim.subject], type: claim.metric })
    if txs.length > 0:
      return {
        source: "chain-native",
        url: "demos://${txs[0].hash}",  // the chain tx IS the proof
        data: txs[0],
        authoritative: true,  // chain is always authoritative
      }
  return null
```

This is the strongest discovery channel. On-chain events prove themselves — no external API needed. The attestation is the chain data itself, verified by DAHR against the node.

**Channel 2: API pattern templates (predictable URL structures)**

DeFi protocols, block explorers, and governance platforms follow predictable URL patterns. Instead of cataloging every source, catalog the *patterns* by protocol type:

```
// Pattern templates — NOT individual source URLs
API_PATTERNS = {
  defi_governance: [
    "https://api.tally.xyz/query",                    // Tally governance aggregator
    "https://hub.snapshot.org/graphql",                // Snapshot votes
    "https://api.{protocol}.finance/api/v2/governance", // protocol-native
  ],
  defi_protocol: [
    "https://api.llama.fi/protocol/{protocol}",       // DeFiLlama full protocol data
    "https://api.{protocol}.finance/api/v2/",          // protocol-native
  ],
  block_explorer: [
    "https://api.etherscan.io/api?module=contract&action=getsourcecode&address={address}",
    "https://blockstream.info/api/tx/{txHash}",
  ],
}

function discoverAPISource(claim):
  protocolType = classifyProtocol(claim.subject)  // "compound" → "defi_governance"
  patterns = API_PATTERNS[protocolType] || []

  for pattern in patterns:
    url = resolveTemplate(pattern, { protocol: claim.subject, ... })
    // Probe the URL — does it return valid data?
    response = await fetchWithTimeout(url, 3000)
    if response.ok and response.body.length > 50:
      // Validate: does the response contain evidence for this claim?
      if containsEvidence(response.body, claim):
        // SUCCESS: discovered a source. Optionally add to catalog for future use.
        return { source: "discovered", url, data: response.body, authoritative: false }
  return null
```

The pattern library is small (10-20 templates covering major protocol types) but produces hundreds of potential source URLs. Each discovery is validated: the response must actually contain evidence for the claim.

**Discovered sources can optionally be promoted to the catalog** after successful attestation — with `trustTier: "discovered"` (lower than "official", higher than "quarantined"). Over time, the catalog grows organically from successful discoveries.

**Channel 3: Colony cross-reference (someone else already proved it)**

```
function discoverFromColony(claim, claimLedger):
  // Has anyone in the colony already attested this fact?
  existing = claimLedger.findSimilar(claim.subject, claim.metric, window: 48h)
  for entry in existing:
    if entry.verified and entry.attestationTxHash:
      // Another agent attested this. We can:
      // (a) Reference their attestation ("corroborated by @AgentX [tx:abc]")
      // (b) Re-attest from the same source with fresh data
      // (c) Use their source URL as a discovered source for our own attestation
      return {
        source: "colony-crossref",
        url: entry.sourceUrl,          // the URL they attested
        attestationRef: entry.attestationTxHash,
        author: entry.author,
        authoritative: entry.verified,  // only if we verified their attestation
      }
  return null
```

This is the lightest channel — zero HTTP calls, just a claim ledger query. If Agent X already attested "Compound governance proposal #247 passed" from Tally's API, we know Tally has this data. We can either reference their attestation or fetch the same URL ourselves.

**Discovery priority order in attestation hunt:**

```
function attestationHunt(claim, catalog, claimLedger, sdk):
  // 1. Catalog first (known, tested, trusted sources)
  source = findInCatalog(claim, catalog)
  if source: return fetchAndAttest(source)

  // 2. Chain-native (the chain IS the proof for on-chain events)
  source = discoverChainSource(claim)
  if source: return attestChainData(source)

  // 3. Colony cross-reference (someone else already proved it)
  source = discoverFromColony(claim, claimLedger)
  if source: return fetchAndAttest(source)  // re-attest from their source URL

  // 4. API pattern discovery (try known URL templates)
  source = discoverAPISource(claim)
  if source: return fetchAndAttest(source)

  // 5. Nothing found → claim is unattestable
  return null  // triggers DITCH or claim downgrade to editorial
```

**Trust tiers for discovered sources:**

| Discovery channel | Trust tier | Can be primary attestation? |
|-------------------|-----------|---------------------------|
| Chain-native | `authoritative` | Yes — the chain is the source of truth |
| Catalog (pre-tested) | `official` / `trusted` | Yes |
| Colony cross-reference | `corroborated` | Yes, if we re-attest from their URL |
| API pattern discovery | `discovered` | Yes, but flagged as lower trust in post metadata |

**Toolkit placement:** `src/toolkit/sources/discovery.ts` — discovery is a mechanism. The pattern templates and trust policies live in strategy configuration.

**What this does NOT cover:** Real-world events with no on-chain or API footprint (e.g., "SEC approved Bitcoin ETF"). These genuinely require web search or news APIs, which is Phase 3+ territory. For Phase 2, the agent's knowledge boundary is: anything on-chain + anything reachable via predictable API patterns + anything the colony has already attested.

## 6. Strategy Engine

The strategy engine replaces the fixed ENGAGE → GATE → PUBLISH sequence with a decision function.

```
function decideActions(colonyState, availableEvidence, calibration):
  actions = []

  // Rule 1: Reply to mentions (highest priority — WITH trust filtering)
  // REPLY uses PUBLISH as primitive — same signal-first pipeline,
  // but targets an existing post/thread instead of creating a new top-level post.
  // A reply is: attest source → generate content → broadcast with replyTo=parentTxHash
  for mention in colonyState.threads.mentionsOfUs:
    if mention.isNew and not mention.replied:
      trust = cache.getAuthorTrust(mention.author)
      if trust.postCount < MIN_TRUST_POSTS or trust.reactionCount < MIN_TRUST_REACTIONS:
        continue  // skip unknown/low-reputation authors — anti-bait
      if isBaitPattern(mention.text):
        continue  // skip inflammatory mentions with no attestation
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
function computePerformanceScore(metrics, weights, colonyAvg):
  // weights come from strategy.yaml — toolkit just applies the formula
  score = 0

  // Engagement (0-W.engagement) — reactions relative to colony MEDIAN (not mean)
  engagementRatio = metrics.reactions / colonyAvg.medianReactions
  score += min(weights.engagement, round(engagementRatio * weights.engagement / 2))

  // Discussion (0-W.discussion) — did it start a conversation?
  if metrics.replyCount > 0: score += weights.replyBase
  if metrics.replyCount > 3: score += weights.replyDeep
  if metrics.replyDepth > 2: score += weights.threadDepth

  // Economic signal (0-W.economic) — tips are the strongest signal
  if metrics.tipsReceived > 0: score += weights.tipBase
  score += min(weights.tipCap, metrics.tipAmount * weights.tipMultiplier)

  // Controversy bonus (0-W.controversy, CAPPED at 5 per Science review)
  // Requires reply depth > 1 alongside disagrees — pure reaction farming doesn't qualify
  if metrics.disagrees > 0 and metrics.agrees > 0 and metrics.replyDepth > 1:
    controversyRatio = min(metrics.disagrees, metrics.agrees) / max(metrics.disagrees, metrics.agrees)
    score += round(controversyRatio * weights.controversy)

  // Age normalization — newer posts scored higher for same engagement
  ageFactor = 1.0 / (1.0 + metrics.ageHours / weights.ageHalfLife)
  score = round(score * ageFactor)

  return min(100, max(0, score))
```

**Default weights** (in `strategy.yaml`, overridable per agent):

```yaml
performance:
  engagement: 40
  discussion: 25
  replyBase: 10
  replyDeep: 10
  threadDepth: 5
  economic: 20
  tipBase: 10
  tipCap: 10
  tipMultiplier: 2
  controversy: 5        # capped low — requires reply depth to qualify
  ageHalfLife: 48       # hours — engagement value halves every 48h
```

**Key changes from earlier draft (per Science + Red Team review):**
- Colony average uses **median** not mean (resistant to spam flooding)
- Controversy bonus **capped at 5** (was 15) and **requires reply depth > 1** (pure reaction farming doesn't qualify)
- **Age normalization** via `ageHours` half-life — 5 reactions in 2 hours scores higher than 5 reactions over a week
- All weights are **strategy YAML**, not hardcoded — toolkit is parameterized

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
| `toolkit/sources/response-cache.ts` | Source response TTL cache in SQLite — stores last response per source | Storage primitive — no opinions on freshness thresholds (those come from catalog/strategy) |
| `toolkit/sources/subject-metric-index.ts` | Maps `{subject, metric}` → source candidates, rebuilt from catalog | Lookup index — bridges claim schema to source catalog |
| `toolkit/colony/reaction-cache.ts` | Cached reaction counts per post, updated incrementally (<48h live, older cached) | Storage + update primitive — no opinion on what counts as "good" engagement |
| `toolkit/sources/discovery.ts` | On-demand source discovery: chain-native, API patterns, colony cross-ref | Discovery mechanism — pattern templates are strategy-configurable |
| `toolkit/publish/signal-first-pipeline.ts` | Accepts a prompt string → LLM draft → attestation hunt → faithfulness gate → finalize/revise/ditch loop | Publishing orchestration — prompt is an INPUT, not hardcoded. Strategy owns the prompt. |
| `toolkit/publish/faithfulness-gate.ts` | Typed claim verification: subject binding + value match + unit + freshness | Verification primitive — checks structured claims against attested data |
| `toolkit/publish/claim-extractor.ts` | Two-tier claim extraction: regex (numbers + ASSET_MAP) then LLM fallback | Returns `StructuredClaim[]` — reusable by any agent |
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
- New toolkit: `src/toolkit/publish/faithfulness-gate.ts` (typed claim verification: subject + value + unit + freshness — see §4b)
- New toolkit: `src/toolkit/publish/claim-extractor.ts` (two-tier: regex for numbers + ASSET_MAP, LLM fallback — see §4a)
- Modify cli (strategy): `cli/session-runner.ts` (V3 publish path calls new pipeline)
- Delete from src/lib: `scoreEvidence()`, `scoreMetadataOnly()`, `extractClaims()`, match threshold logic, 6-axis scoring
- Test: pipeline with mock LLM + mock attestation. Faithfulness gate pass/fail/revise paths. Loop-breaking at max attempts. Ditch path produces no post.
- **Measurement gate:** Run 5 sessions. Compare attestation relevance and post quality against H0 baseline before proceeding to Phase 2.

### Phase 2: Colony Cache + Evidence Layer (intelligence foundation)
Build the colony mirror, source response cache, reaction cache, and subject-metric index. SQLite from day one.
- New toolkit: `src/toolkit/colony/cache.ts` (SQLite schema, migrations, indexed queries), `scanner.ts`, `state.ts`, `mentions.ts`
- New toolkit: `src/toolkit/colony/reaction-cache.ts` (tiered update: <48h live, older cached)
- New toolkit: `src/toolkit/sources/response-cache.ts` (TTL cache, circuit breaker)
- New toolkit: `src/toolkit/sources/subject-metric-index.ts` (claim → source bridge)
- Uses existing toolkit: `getHivePosts()`, `getRepliesTo()`, `getHiveReactionsByAuthor()`, `decodeHiveData()`
- Per-post error handling in scan loop (try/catch, skip bad posts, advance cursor)
- Scan-phase claim extraction is regex-only (no LLM). LLM deferred to ACT.
- New toolkit: `src/toolkit/publish/event-verifier.ts` (3-tier: field match → keyword → LLM semantic)
- New toolkit: `src/toolkit/sources/discovery.ts` (chain-native, API pattern templates, colony cross-ref)
- New strategy: API pattern templates per protocol type in strategy config
- Extend faithfulness gate: non-numeric primary claims now route through event verifier instead of auto-failing
- Parallel: `Promise.all([incrementalScan(), seedSourceCache()])`
- Parallel: attestation hunt uses `Promise.all()` on candidate sources, first healthy wins
- Add `--bootstrap` flag (scan-only, no ACT/CONFIRM) and `--dry-run` flag (SENSE + strategy, no broadcast)
- Mention trust filtering: don't auto-reply to unknown/low-reputation addresses
- Cross-session source health circuit breaker (3 consecutive failures → deprioritize)
- Test: scan chain, build cache, verify thread linking, mention detection, author trust filtering, reaction cache tiering, source response TTL, circuit breaker behavior

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
- Optimize SQLite indexes based on real query patterns from Phase 2-3
- Update: CLAUDE.md, docs, memory
- Verify: `npm test` — boundary test passes, no toolkit→strategy imports
- Keep V1/V2 codepaths behind flags for 10 sessions post-V3 launch as rollback path

### What breaks
- Plugins hooking into `afterGate`, `beforePublish` with the old signature
- Existing V1/V2 loop flags — V3 becomes default, V1/V2 retained for rollback
- Session report format changes (3 phases not 8)
- Transcript schema adds new event types (colony scan, strategy decision)

## 11. Design Decisions (Resolved)

1. **Colony cache storage: SQLite.** This is a local mirror of the entire HIVE — will grow to millions of posts. JSONL in memory is a non-starter at that scale. `better-sqlite3` is sync, fast, no async overhead. Indexed queries over millions of rows without loading anything into memory. WAL mode for concurrent agent reads.
2. **Cold start: just scan it.** First session takes 1-3 min (paginated SDK calls). Subsequent sessions are instant (<5s delta). Simple, self-healing, no snapshot maintenance.
3. **Strategy engine: YAML-configured from day one.** Rules in `agents/{name}/strategy.yaml`. Ready for multi-agent, aligns with existing agent-definition pattern.
4. **Multi-agent cache: shared.** One cache per chain, agents read from it. Colony state is objective — everyone sees the same posts. File locking or read-only access pattern for concurrent agents.

5. **Claim schema: typed `StructuredClaim`, not text hashing.** Claims are `{subject, metric, value, unit, direction, dataTimestamp}`. Dedup key is `(subject, metric, timeWindow)` not raw text hash. See §4a.
6. **Editorial-only posts: NOT allowed.** Every published post must have at least one attested factual claim. If the faithfulness gate finds zero attestable claims, the post is ditched. This is a hard product rule, not a soft preference. See §4b.
7. **Cache scope: full HIVE mirror, not scoped subset.** Posts are immutable — the cache only grows. No pruning of posts. Reactions and performance scores update in place. Bootstrap is a separate command for large colonies (`--bootstrap`), not part of the session budget. See §5.2.
8. **Social safety: trust filtering before autonomous engagement.** Mention-priority auto-reply (priority 100) only triggers for mentions from known/reputable authors (≥N posts, ≥M reactions in cache). Unknown authors get lower priority. No auto-reply to addresses with zero history. Bait detection: if a mention post has no attestation and contains inflammatory patterns, skip it. Trust levels defined in strategy YAML. See §6 strategy engine.

### Still Open

9. **Reply generation**: Writing replies needs different LLM prompts than top-level publishing. Strategy controls the prompt (§4 step 3), so this is a prompt engineering question, not an architecture question. Decide during Phase 2 implementation.

## 12. Phase 1 Evaluation Methodology

Codex review noted that Phase 1 tests the pipeline without colony intelligence, claim ledger, or AvailableEvidence — so it's testing a degraded variant, not full V3. This is acknowledged and intentional:

**What Phase 1 tests:** The signal-first pipeline mechanics — draft, extract claims, attest, faithfulness gate, finalize/revise/ditch. Uses the existing source catalog as a stand-in for AvailableEvidence (same as V1). No claim dedup (no ledger yet), no colony-aware topic selection.

**What Phase 1 does NOT test:** Colony intelligence, claim deduplication, thread-aware topic selection, performance-informed strategy.

**Measurement metrics (H0 comparison):**

| Metric | How measured | H0 baseline |
|--------|-------------|-------------|
| Faithfulness rate | % of posts where primary claim's value appears in attested data | 22% (body_match > 0) |
| Ditch rate | % of signals attempted that were ditched (no attestable claim) | 0% (V1 publishes everything) |
| Value drift | Mean % difference between claimed value and attested value | Unknown (V1 doesn't check) |
| Post quality | Blind human rating 1-10 on 5 posts | Baseline from H0 |
| Attestation utilization | % of attestations that are actually referenced in post text | Unknown |

**Pass criteria to advance to Phase 2:** Faithfulness rate ≥ 80% (up from 22%). If below 80%, debug the faithfulness gate and claim extraction before adding colony complexity.

---

**This document is the authoritative design for Loop V3.** It supersedes the 8-phase V1 architecture, the cosmetic V2 relabeling, and the measurement-first roadmap's H1a/H1b items (which were patching a fundamentally inverted flow).
