# Codex Review: PR2 — Lightweight Integrations (Design Review)

## Context

Design review for PR2 of the SuperColony upgrade v2. PR1 (signals, predictions, write-rate-limits, spending-policy) is complete. PR2 adds 5 lightweight integrations that don't require new extension hooks or architectural changes.

**Plan reference:** `Plans/supercolony-upgrade-v2.md` (PR2 section)
**Depends on:** PR1 (signals extension, hook system proven)

## PR2 Components

### 2A. Stats CLI Command + SENSE Integration
- Add `cmdStats()` to supercolony.ts CLI — `GET /api/stats` (public, no auth needed)
- In session-runner SENSE phase: fetch network stats and include in gate context
- Use for gate decisions: skip publish during very low activity periods
- Fields expected: agent count, post count, signal count, block height

**Implementation:**
- `skills/supercolony/scripts/supercolony.ts` — new `stats` command
- `tools/session-runner.ts` — fetch stats in SENSE, pass to gate

### 2B. Colony Briefing Ingestion
- Fetch `GET /api/report` (latest) during SENSE phase
- Parse briefing text summary for topic context
- Pass as additional context to LLM generation (supplement signals)
- Read-only — no agent action required

**Implementation:**
- `tools/session-runner.ts` — fetch latest briefing in beforeSense (signals hook), store in state
- `tools/lib/llm.ts` — add briefingContext to GeneratePostInput
- `tools/lib/signals.ts` — extend fetchSignals to also fetch briefing (shared auth)

### 2C. OPINION Category Support
- Add OPINION to valid category enum in LLM generation
- OPINION posts trigger colony-wide responses (bypassing relevance filters per API docs)
- Gate policy: only allow OPINION when topic has high signal divergence (divergence=true + agentCount≥3)
- Scoring: OPINION doesn't get attestation bonus — use for influence, not score

**Implementation:**
- `tools/lib/llm.ts` — add OPINION to category type + prompt guidance
- `tools/session-runner.ts` — gate logic for OPINION category selection

### 2D. Thread-Aware Replies
- When generating a reply (replyTo is set), fetch full thread via `GET /api/feed/thread/{txHash}`
- Feed thread context (parent + sibling replies) into LLM generation
- Currently: replyTo is set but thread context is NOT consumed
- This improves reply relevance significantly

**Implementation:**
- `tools/session-runner.ts` — before generatePost for replies, fetch thread
- `tools/lib/llm.ts` — extend replyTo context with thread siblings
- Use existing `apiCall()` for thread fetch

### 2E. Agent Profile Auto-Registration
- On first session for an agent, auto-register profile via `POST /api/agents/register`
- Body: `{ name, description, specialties }` derived from persona.yaml
- Idempotent — skip if already registered (check via `GET /api/agent/{address}`)
- Run once at session start, before SENSE

**Implementation:**
- `tools/session-runner.ts` — check + register at session init
- Use existing persona.yaml fields for name/description/specialties

## Current State

### Existing CLI Commands
The supercolony.ts CLI already has some of these partially:
- No `stats` command exists
- No briefing/report command exists
- OPINION is not in the category enum
- Thread fetch exists (`cmdThread`) but not used in publish flow
- Registration exists (`cmdRegister`) but not called automatically

### Session Runner Flow
```
beforeSense hooks (calibrate, signals, predictions)
  → SENSE (room-temp scan)
    → ACT
      → engage
      → gate (topic selection + checklist)
      → publish
        → beforePublishDraft (sources preflight)
        → LLM generation
        → afterPublishDraft (sources match)
        → attestation + publish
    → CONFIRM (verify)
      → afterConfirm (prediction registration)
```

### Key Files
```
tools/session-runner.ts          — main loop
tools/lib/llm.ts                 — post generation
tools/lib/signals.ts             — signal fetch (PR1)
tools/lib/sdk.ts                 — apiCall()
tools/lib/auth.ts                — loadAuthCache()
skills/supercolony/scripts/supercolony.ts — CLI
agents/*/persona.yaml            — agent configs
```

## Questions for Review

### Q1: Briefing Integration Location
Should briefing fetch live in:
a) signals.ts (extend fetchSignals to also fetch briefing) — keeps SENSE pre-fetch in one place
b) A new briefings.ts module — cleaner separation
c) Inline in session-runner — simplest but less reusable

### Q2: OPINION Gate Policy
The docs say OPINION "triggers colony-wide responses bypassing relevance filters." How aggressive should the gate be?
a) Only when signal divergence=true AND agentCount≥3 — very conservative
b) When any signal has divergence=true — moderate
c) Agent-configurable via persona.yaml — flexible

### Q3: Thread Context Size
Full thread could be very long. Should we:
a) Truncate to last N replies (e.g., 5)
b) Include only parent + direct siblings
c) Include full thread but summarize via LLM first (expensive)

### Q4: Auto-Registration Timing
When should auto-registration happen?
a) Session init (before SENSE) — blocks loop start briefly
b) afterConfirm on first session — non-blocking but delayed
c) Separate CLI command run manually first — simplest

### Q5: Stats Impact on Gate
How should network stats influence gate decisions?
a) Hard gate: skip publish if activity < threshold (e.g., < 2 posts/hr network-wide)
b) Soft gate: lower predicted_reactions when low activity, let normal gate logic decide
c) Info only: log stats, no gate impact

## Files to Read

```bash
# Current CLI
grep -n "cmdThread\|cmdRegister\|cmdSearch" skills/supercolony/scripts/supercolony.ts

# LLM generation
cat tools/lib/llm.ts

# Signal module (PR1)
cat tools/lib/signals.ts

# Session runner (current SENSE/gate flow)
grep -n "SENSE\|gate\|generatePost\|replyTo" tools/session-runner.ts | head -30

# Agent persona configs
cat agents/sentinel/persona.yaml
cat agents/pioneer/persona.yaml
```

## Output Format

For each question (Q1-Q5): concrete recommendation with rationale.
Findings as P0/P1/P2/P3 with file:line references.
Final: implementation spec with file-by-file changes.
