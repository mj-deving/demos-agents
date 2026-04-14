# Codex Review: PR1 — Signals + Predictions + SpendingPolicy (Implementation Review)

## Context

Implementation review for PR1 of the SuperColony upgrade v2. Design review was completed previously (`REVIEW-pr1-signals-predictions.md`). This covers the actual code against that design spec.

**Commit:** 4db6d39
**Files changed:** 11 (4 new, 7 modified)

## What Was Implemented

### New Files (4)
- `tools/lib/signals.ts` — SignalSnapshot types, fetchSignals(), scoreSignalAlignment()
- `tools/lib/predictions.ts` — TrackedPrediction types, PredictionStore (versioned JSON), registerPrediction(), resolvePendingPredictions(), getCalibrationAdjustment()
- `tools/lib/write-rate-limit.ts` — WriteRateLedger (persistent, address-scoped), canPublish(), recordPublish()
- `tools/lib/spending-policy.ts` — SpendingPolicyConfig, SpendingLedger, canSpend(), recordSpend()

### Modified Files (7)
- `tools/lib/state.ts` — KNOWN_EXTENSIONS += signals/predictions, PublishedPostRecord type, V2SessionState extended
- `tools/lib/extensions.ts` — afterConfirm hook + AfterConfirmContext + runAfterConfirm dispatcher + signals/predictions registry entries
- `tools/lib/llm.ts` — GeneratePostInput.signalContext, prompt includes colony consensus
- `tools/session-runner.ts` — hook registrations (signals beforeSense, predictions beforeSense + afterConfirm), write-rate check before publish, PublishedPostRecord building, signal context to LLM
- `agents/sentinel/persona.yaml` — signals + predictions in loop.extensions
- `agents/pioneer/persona.yaml` — signals + predictions in loop.extensions
- `agents/crawler/persona.yaml` — signals + predictions in loop.extensions

## Design Review Findings Addressed

| # | Severity | Finding | How Addressed |
|---|----------|---------|---------------|
| P0 | Critical | Write-rate enforcement cannot live in session state | Persistent address-scoped ledger in write-rate-limit.ts, loaded/saved per publish |
| P1 | High | Extensions load from persona.yaml not strategy.yaml | All 3 persona.yaml files updated (not strategy.yaml) |
| P1 | High | afterConfirm has no durable post context | PublishedPostRecord type in state.ts, built during publish, persisted in V2SessionState.publishedPosts |
| P1 | High | No POST /api/predictions registration endpoint confirmed | Local store is canonical; API resolution via POST /api/predictions/{tx}/resolve |
| P2 | Medium | Signal usage in candidate ranking not just prompt | scoreSignalAlignment() returns modifier; signal context also passed to LLM |
| P2 | Medium | SpendingPolicy and write-rate should share scoping | Both use address-scoped ledgers |
| P3 | Low | Signal snapshots need TTL/staleness | fetchedAt timestamp in SignalSnapshot |
| P3 | Low | Emit observations for decisions | observe() called in all modules |

## What To Review

### Q1: Signals Module Correctness
- Does fetchSignals() handle API errors gracefully?
- Does scoreSignalAlignment() produce reasonable modifiers for each agent mode?
- Is the signal snapshot persisted correctly in V2SessionState?
- Is the topic matching in session-runner.ts (line ~1619) robust enough?

### Q2: Predictions Module Correctness
- Is the prediction store format (versioned JSON, keyed by txHash) sound?
- Is registerPrediction() truly idempotent on resume?
- Does extractPredictionStructure() handle edge cases in post text?
- Is getCalibrationAdjustment() formula reasonable?
- Does resolvePendingPredictions() handle missing token/API errors?

### Q3: Write Rate Limit Correctness
- Is the persistent ledger actually address-scoped (not agent-scoped)?
- Do daily/hourly window resets work correctly across timezones?
- Is the margin (14/4 vs 15/5) appropriate?
- What happens if the ledger file is corrupted?

### Q4: Session Runner Integration
- Is the hook registration order correct (calibrate → signals → predictions → sources → observe)?
- Does the write-rate check happen before any work (LLM call, attestation)?
- Is PublishedPostRecord populated with all needed fields?
- Does the afterConfirm call handle errors non-fatally?
- Is the signal topic matching (includes-based) too loose or too strict?

### Q5: Extension System
- Is afterConfirm the right hook point vs alternatives?
- Does runAfterConfirm correctly run all hooks sequentially without short-circuit?
- Is the AfterConfirmContext shape sufficient?

## Files to Read

```bash
# New modules
cat tools/lib/signals.ts
cat tools/lib/predictions.ts
cat tools/lib/write-rate-limit.ts
cat tools/lib/spending-policy.ts

# Modified files
git diff HEAD~1 -- tools/lib/state.ts
git diff HEAD~1 -- tools/lib/extensions.ts
git diff HEAD~1 -- tools/lib/llm.ts
git diff HEAD~1 -- tools/session-runner.ts

# Config changes
git diff HEAD~1 -- agents/sentinel/persona.yaml agents/pioneer/persona.yaml agents/crawler/persona.yaml

# Design review for reference
cat claude-codex-coop/REVIEW-pr1-signals-predictions.md
```

## Output Format

For each question (Q1-Q5): findings with file:line references and severity.
Overall assessment: implementation match to design, breaking changes, confidence for live session.
