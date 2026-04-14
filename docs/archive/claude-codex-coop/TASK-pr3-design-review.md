# Codex Review: PR3 — Economic Features (Design Review)

## Context

Design review for PR3 of the SuperColony upgrade v2. PR1 (signals, predictions, write-rate-limits, spending-policy) and PR2 (briefings, auto-registration) are complete. PR3 adds autonomous tipping and webhook-driven reactions.

**Plan reference:** `Plans/supercolony-upgrade-v2.md` (PR3 section)
**Hard dependency:** SpendingPolicy module from PR1 (`tools/lib/spending-policy.ts`)

## PR3 Components

### 3A. Autonomous Tipping
**Goal:** Agents tip high-quality posts from other agents to build reciprocity and engagement.

**Design:**
- New extension or inline in afterConfirm hook
- During SENSE or afterConfirm: scan recent feed for tip-worthy posts
- Criteria for tipping:
  - Post from a different agent (never tip self)
  - Post has DAHR attestation (quality signal)
  - Post topic aligns with agent's analysis
  - Post has high reaction count (community validates quality)
  - Agent hasn't tipped this post before
- Execute tip via existing 2-step flow: `POST /api/tip` (validate) → `demos.transfer()` (on-chain)
- All tips governed by SpendingPolicy: per-agent daily cap, per-tip limits, cooldowns, dry-run default
- Log every tip decision (allow/deny/dryRun) to observation JSONL

**API details (from docs):**
```
POST /api/tip
Body: { postTxHash: string, amount: number }
Response: { recipient: string, ... }
Anti-spam: new agents (<7 days/<5 posts) max 3 tips/day; max 5 tips per post per agent; 1-min cooldown
```

**Tip amount strategy:**
- Base tip: 1 DEM (minimum)
- High-quality bonus: +1-2 DEM for posts with attestation + high reactions
- Max tip: 5 DEM (conservative, well under API max of 10)
- Per-session budget: 5 DEM (from SpendingPolicy)
- Per-day budget: 10 DEM (from SpendingPolicy)

### 3B. Webhook-Driven Reactions
**Goal:** Respond to mentions and replies in near-real-time.

**Design challenge:** Our agents are session-based (run, complete, exit), not persistent daemons. Webhooks push events to a URL — we need a receiver.

**Options:**
a) **Poll-based (no webhooks)** — check feed for mentions/replies during SENSE, react to them. No infrastructure needed. Loses real-time but works with session model.
b) **Webhook + local server** — run a tiny HTTP server on localhost, register webhook, process events during session. Complex, fragile.
c) **Webhook + Cloudflare Worker** — push events to a queue, session drains queue on start. Persistent but adds infra.
d) **Defer entirely** — webhook reactions are low-value compared to tipping. Skip for now.

**Recommendation from plan:** Option (a) poll-based for PR3. True webhook-driven reactions require persistent runtime (future).

**Poll-based reaction flow:**
- During SENSE: fetch recent feed, filter for posts mentioning this agent
- For each mention: fetch thread context, evaluate whether to agree/disagree
- During ACT/engage: react to mentions alongside normal engagement
- Already partially supported by `tools/engage.ts` and `react-to-posts.ts`

## Current State

### SpendingPolicy (from PR1)
```typescript
// tools/lib/spending-policy.ts
canSpend(amount, recipient, config, ledger): SpendDecision
recordSpend(tx, ledger): SpendingLedger
loadSpendingLedger(address, agent): SpendingLedger
saveSpendingLedger(ledger, agent): void
defaultSpendingPolicy(): SpendingPolicyConfig  // dryRun: true
```

### Existing Tip CLI
```typescript
// skills/supercolony/scripts/supercolony.ts
cmdTip(flags)     // validates via /api/tip, then demos.transfer()
cmdTipStats(flags) // reads /api/tip/{txHash}
```

### Existing Engage Tool
```typescript
// tools/engage.ts — runs during ACT/engage substage
// tools/lib/feed-filter.ts — quality filter for engagement targets
// skills/supercolony/scripts/react-to-posts.ts — standalone batch reaction
```

### Extension Hooks Available
```typescript
beforeSense     // scan for mention/tip opportunities
afterConfirm    // register tips after publish confirmation
// Could add: afterEngage (for post-engagement tipping)
```

## Questions for Review

### Q1: Tipping Extension Design
Should autonomous tipping be:
a) A new extension (`tips`) with its own hook registration
b) Part of the existing `predictions` afterConfirm hook (since both run post-publish)
c) Inline in session-runner during ACT/engage substage
d) A standalone post-session tool (like improve.ts)

### Q2: Tip Target Selection
How should the agent select posts to tip?
a) Score-based: compute tip-worthiness score from attestation + reactions + topic alignment
b) Reciprocity-based: prefer agents who have tipped us before
c) Signal-aligned: tip posts that support the consensus signal direction
d) Random sampling from high-quality posts (avoid predictable patterns)

### Q3: Dry-Run Graduation
SpendingPolicy defaults to dryRun: true. When should it graduate to live tipping?
a) After N sessions where dry-run tips would have succeeded (e.g., 5 sessions)
b) Manual flag: `--enable-tipping` on session-runner
c) Config in persona.yaml: `tipping.enabled: true`
d) Never auto-graduate — always require explicit opt-in

### Q4: Mention Detection Scope
For poll-based mention reactions, how far back should we scan?
a) Since last session (use session timestamp)
b) Last 24 hours
c) Last 50 posts mentioning this agent's address
d) Since last processed mention (tracked in state)

### Q5: Risk Mitigation
What additional guardrails beyond SpendingPolicy are needed?
a) Tip recipient diversity: max 2 tips to same agent per day
b) Tip timing: no tips in first 3 sessions (learn the network first)
c) Tip cooldown: minimum 5 minutes between tips
d) All of the above

## Files to Read

```bash
# SpendingPolicy (PR1)
cat tools/lib/spending-policy.ts

# Existing tip implementation
grep -n "cmdTip\|transfer\|HIVE_TIP" skills/supercolony/scripts/supercolony.ts

# Engage tool
cat tools/engage.ts | head -50
cat tools/lib/feed-filter.ts | head -50

# Session runner hook registration
grep -n "registerHook\|afterConfirm\|loopExtensions" tools/session-runner.ts | head -20

# Agent engagement config
grep -n "engagement\|tip\|react" agents/sentinel/persona.yaml agents/pioneer/persona.yaml
```

## Output Format

For each question (Q1-Q5): concrete recommendation with rationale.
Findings as P0/P1/P2/P3. Final implementation spec.
