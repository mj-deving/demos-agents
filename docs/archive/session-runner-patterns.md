---
summary: "Battle-tested patterns extracted from legacy session-runner.ts (4528 lines) before retirement"
read_when: ["session runner", "legacy patterns", "v3 loop improvements", "resilience", "subprocess", "resume"]
---

# Session-Runner Pattern Extraction

> Extracted 2026-04-07 from cli/session-runner.ts before eventual retirement.
> V3 loop (cli/v3-loop.ts) is the active production loop.

## ADOPT — V3 loop should implement these

### 1. Two-tier subprocess kill (session-runner.ts:702-710)
SIGTERM → 2s grace → SIGKILL prevents zombie processes.
V3 loop uses simple timeouts without kill escalation.
**Where:** action-executor.ts subprocess calls.

### 2. Source prefetch cascade (session-runner.ts:2229-2290)
Tries up to 3 source candidates before giving up. Falls back gracefully on thin data.
Observes each fallback for diagnostics.
**Where:** publish-executor.ts before LLM generation.

### 3. Phase budget overage observation (session-runner.ts:625-635)
Logs inefficiency with percentage overage when phase exceeds budget.
Doesn't fail; warns with data for learning. Format: `{ phase, durationMs, budgetMs, overage }`.
**Where:** v3-loop.ts checkpoint logging (currently only logs elapsedMs).

### 4. Hard quality gates as explicit pre-publish checks (session-runner.ts:2325-2335)
- Text length >= 200 chars
- Predicted reactions >= threshold
- QUESTION category requires `?` character
**Where:** Formalize in publish-executor.ts as documented gates.

## PRESERVE — Knowledge for future work

### 5. Version-gated resume
Never resume v2 state on v3 loop. Hard check with `validateResumeVersion()`.
**When:** If V3 resume is added, enforce version guard.

### 6. Fresh-cache TTL for SENSE results
SENSE caches results for 5 min if restart fails mid-session.
Prevents duplicate API calls on resume. Constant: `SENSE_CACHE_MAX_AGE_MS`.

### 7. Two-stage hook dispatch (preflight → match)
beforePublishDraft generates candidates (preflight URLs).
afterPublishDraft ranks candidates against LLM draft (match).
Three fallback cases handled explicitly.
**When:** Evidence-based publish validation extensions.

### 8. Topic expansion map
Generic→specific mapping (ai→ai-infrastructure).
Falls back to original if expansion fails.
**When:** Integrate into strategy sense phase if source coverage is thin.

### 9. Agent index filtering
Queries author quality by matching agent names in feed.
Detects convergence (multiple agents on same topic).
**When:** V3 multi-agent coordination enhancement.

## DEAD — Tried and abandoned (negative knowledge)

### 10. Manual PUBLISH mode (removed)
Full/approve oversight allowed manual post entry via readline.
**Why removed:** Operator bottleneck; LLM generation is fast enough. Chain-only = autonomous.

### 11. 8-phase granularity (collapsed to 3)
v1: AUDIT, SCAN, ENGAGE, GATE, PUBLISH, VERIFY, REVIEW, HARDEN.
v3: SENSE, ACT, CONFIRM.
**Why removed:** AUDIT/SCAN/ENGAGE are all sensing; GATE/PUBLISH/VERIFY are all acting.
Fewer phases = simpler state management, fewer resume edge cases.

### 12. Multi-level oversight (removed)
v1 supported full (interactive), approve (auto-suggest), autonomous.
v3 is autonomous-only.
**Why removed:** Chain-only execution doesn't need human approval gates.

### 13. Config immutability invariant (preserved)
Session never auto-modifies AGENT.yaml. Hard rule. Critical invariant.
