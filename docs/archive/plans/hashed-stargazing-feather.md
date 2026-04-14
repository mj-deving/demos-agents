# Plan: Live Sessions Roadmap & Crawler Automation

## Context

Three SuperColony agents need to reach automated steady-state publishing. Sentinel (17 sessions, mature) needs live validation of 5 recent improvements. Pioneer (9 sessions) needs offset -10 validation. Crawler (1 session, 0 published posts — only reactions) has full infra but has never published. All infrastructure exists — the bottleneck is live data and scheduling automation.

**Key architectural decision:** Use `session-runner.ts --oversight autonomous` per agent (not `run-loop.ts`) for scheduled runs.

**Why not run-loop.ts:** It re-implements a thin audit→verify wrapper as subprocess calls, hardcodes `ANALYSIS` for every gated topic (wrong for pioneer's `QUESTION` mode), and bypasses both the extension system and REVIEW/HARDEN.

**Loop version decision (from Codex review):** session-runner.ts has two loop versions:
- **V1 (default):** Has REVIEW/HARDEN phases but no extension hooks (calibrate, signals, predictions, tips)
- **V2 (`--loop-version 2`):** Has extension hooks via `runBeforeSense`/`runAfterAct`/`runAfterConfirm` but no REVIEW/HARDEN

**Decision: Use V2** for Sprint 1-2 (extensions are more valuable for autonomous operation — calibration, signals, predictions, tipping all run automatically). REVIEW/HARDEN are interactive phases better suited for manual sessions. For Sprint 3+ scheduled runs, V2 is the right choice.

**Calibration offset source of truth (from Codex review):** In autonomous mode, session-runner reads `calibrationOffset` from the per-agent **improvements file** (`~/.{agent}-improvements.json`), NOT from `persona.yaml`. Adjustments must target the improvements file to take effect at runtime. `persona.yaml` is only used as the initial/fallback value.

---

## Sprint 1: Triple Validation (TODAY)

**Goal:** One successful live session from each agent.

### Step 1.1: Lower crawler gate threshold
- **File:** `agents/crawler/persona.yaml` line 38
- **Change:** `predictedReactionsThreshold: 15` → `predictedReactionsThreshold: 10`
- **Why:** Parity with sentinel's threshold and CLAUDE.md's documented standard of 10. Crawler's one logged post predicted 12, landed 9 — supports threshold of 10.
- **Note:** This threshold is enforced during autonomous publish, not as a separate gate-pass criterion. It won't solve source-preflight or no-topic issues by itself.
- **Commit:** `crawler: lower gate threshold 15->10 for cold-start`
- **Codex review** the commit

### Step 1.2: Run sentinel live
```bash
npx tsx tools/session-runner.ts --agent sentinel --oversight autonomous \
  --env ~/.config/demos/credentials --pretty
```
- **Validate:** OPINION suggestion in topic selection, reply discovery finds >=1 parent, >=1 post published score >=80

### Step 1.3: Run pioneer live
```bash
npx tsx tools/session-runner.ts --agent pioneer --oversight autonomous \
  --env ~/.config/demos/credentials --pretty
```
- **Validate:** Offset -10 applied (check `~/.pioneer-improvements.json` for `calibrationOffset`), gate passes >=1 topic

### Step 1.4: Run crawler live (first publish attempt)
```bash
npx tsx tools/session-runner.ts --agent crawler --oversight autonomous \
  --env ~/.config/demos/credentials --pretty
```
- **Validate:** >=1 attested post published, txHash in output, session report written

### Verification
- [ ] All 3 agents complete without crash
- [ ] Sentinel publishes >=1 post, score >=80
- [ ] Pioneer completes gate phase (even 0 posts = valuable data)
- [ ] Crawler publishes >=1 post
- [ ] Session reports exist: `~/.{agent}/sessions/session-*-report.md`

---

## Sprint 2: Fix & Re-run (TOMORROW)

**Goal:** Fix Sprint 1 issues, get clean runs from all 3.

### Step 2.1: Triage failures
```bash
npx tsx tools/session-report.ts --latest --agent sentinel
npx tsx tools/session-report.ts --latest --agent pioneer
npx tsx tools/session-report.ts --latest --agent crawler
```

**Expected issues:**
- Pioneer gate rejects everything → lower offset in **`~/.pioneer-improvements.json`** (the runtime source of truth), e.g. from -10 to -5. Also update `agents/pioneer/persona.yaml` to keep them in sync.
- Crawler source preflight fails → run `npx tsx tools/source-lifecycle.ts check --agent crawler --pretty`
- TLSN fallback to DAHR → verify publish-pipeline.ts handles this (TLSN broken server-side)

### Step 2.2: Run source lifecycle
```bash
npx tsx tools/source-lifecycle.ts check --pretty
npx tsx tools/source-lifecycle.ts apply --pretty   # if transitions recommended
```

### Step 2.3: Fix, test, commit
- TDD: write failing test → implement fix → `npm test` → commit
- **Codex review** each fix commit

### Step 2.4: Second clean run (all 3 agents, same commands as Sprint 1)

### Verification
- [ ] All 3 agents complete clean sessions (0 phase failures)
- [ ] All 3 agents publish >=1 post
- [ ] Source lifecycle shows no critical transitions
- [ ] All fixes have tests, Codex reviewed

---

## Sprint 2.5: LLM Reasoning Fallback for Topic Selection

**Goal:** When heuristic topic selection delivers 0 publishable topics, use LLM reasoning to find topics that bridge feed activity with available sources.

### Step 2.5.1: Add reasoning fallback in `extractTopicsFromScan`
- **File:** `tools/session-runner.ts` — `extractTopicsFromScan` function
- **Trigger:** After heuristic ranking + source-aware filter produces 0 topics
- **Logic:**
  1. Collect: feed hot topics (from scan), agent source inventory (from sourceView), agent focus topics (from persona)
  2. LLM prompt: "Given these hot topics in the feed, these available data sources, and this agent's focus areas — suggest 1-3 topics that (a) are active in the feed, (b) have matching attestable sources, (c) align with agent focus"
  3. Run sourcesPreflight on each LLM suggestion to validate
  4. Return validated suggestions as TopicSuggestion[]
- **Applies to:** Both pioneer and standard modes (all fallback paths: heat, gaps, reply, pioneer scoop)
- **Codex review finding addressed:** MEDIUM — source-aware filter only on topicIndex branch, not fallback paths

### Step 2.5.2: Tests
- Unit test: mock LLM returns valid topic → preflight passes → returned as suggestion
- Unit test: mock LLM returns invalid topic → preflight fails → filtered out
- Unit test: LLM unavailable → graceful fallback to empty (no crash)

### Step 2.5.3: Commit + Codex review

### Verification
- [ ] Pioneer session with reasoning fallback publishes when heuristics would have returned 0 topics
- [ ] Standard mode agents benefit from fallback when heat/gap topics have no sources
- [ ] LLM failure doesn't crash the session
- [ ] Tests pass

---

## Sprint 3: Add Scheduling (DAY 3)

**Goal:** Automated 6-hour cadence. Source lifecycle post-session. Failure alerting.

### Step 3.1: Create wrapper script
- **New file:** `scripts/scheduled-run.sh`
- Runs `session-runner.ts --oversight autonomous` (V2 — default) for sentinel, pioneer, crawler sequentially
- Runs `source-lifecycle.ts apply` after all sessions
- Logs to `~/.demos-agent-logs/{agent}-{timestamp}.log`
- Sends notification on failure via `curl http://localhost:8888/notify` (best-effort, must not determine job success)
- Exit code 1 if any agent failed
- **Stale lock detection (from Codex review):** Before each agent run, check for stale PID lockfiles (`~/.{agent}-session.lock`). If lock exists but PID is dead, remove the lock and use `--resume` to recover. session-runner enforces locks and will refuse to start if a live session exists.

### Step 3.2: Add crontab
```
# Set timezone explicitly (Codex review: cron uses host TZ, not UTC)
CRON_TZ=UTC
# Every 6 hours
0 0,6,12,18 * * * /home/mj/projects/omniweb-agents/scripts/scheduled-run.sh >> ~/.demos-agent-logs/cron.log 2>&1
```

### Step 3.3: Add log rotation script
- **New file:** `scripts/rotate-logs.sh`
- Removes logs older than 7 days
- Cron: `0 5 * * *`

### Step 3.4: Test manually
```bash
bash scripts/scheduled-run.sh
```

### Step 3.5: Commit + Codex review

### Verification
- [ ] Wrapper script runs all 3 agents + lifecycle
- [ ] Stale lock detection works (simulate by creating a lock with dead PID)
- [ ] Failure notification fires on error (best-effort)
- [ ] Logs written with timestamps
- [ ] `crontab -l` shows entries with CRON_TZ=UTC
- [ ] Manual trigger succeeds end-to-end

---

## Sprint 4: Tighten Feedback Loop (DAY 4-5)

**Goal:** Calibrate from real data. Consolidated reporting.

### Step 4.1: Calibrate hook timeouts
- Read observation logs for actual hook latencies
- Update `tools/lib/extensions.ts` HOOK_TIMEOUT_MS values (p95 + 50% headroom)

### Step 4.2: Update calibration offsets
```bash
# Correct jq path (from Codex review: audit.ts emits { results, stats })
npx tsx tools/audit.ts --agent sentinel --json | jq '.stats.calibration_offset'
npx tsx tools/audit.ts --agent pioneer --json | jq '.stats.calibration_offset'
npx tsx tools/audit.ts --agent crawler --json | jq '.stats.calibration_offset'
```
- Update `calibrationOffset` in each agent's **improvements file** (`~/.{agent}-improvements.json`) — this is the runtime source of truth
- Also update `calibration.offset` in `persona.yaml` to keep them in sync (fallback value)

### Step 4.3: Add consolidated cross-agent report
- **New file:** `tools/multi-agent-report.ts`
- Reads latest session reports + prediction stores for all 3 agents
- Outputs: posts published, avg scores, failure rates, calibration offsets, source health
- CLI: `npx tsx tools/multi-agent-report.ts --pretty`

### Step 4.4: Evaluate REVIEW/HARDEN for scheduled runs
- **Decision needed (from Codex review):** V2 loop skips REVIEW/HARDEN. Options:
  - A) Accept V2 without REVIEW — rely on manual periodic review sessions
  - B) Add a post-session extension hook that captures review-like observations (new `review` extension in EXTENSION_REGISTRY)
  - C) Run periodic V1 sessions manually for review/harden cycles
- **Recommendation:** Option A for now (Sprint 3-4), evaluate Option B for Sprint 5+. `session-report.ts` is a viewer only — it cannot generate review findings.

### Step 4.5: Tests + Codex review

### Verification
- [ ] Hook timeouts reflect real latency data
- [ ] Calibration offsets updated in improvements files from >=3 sessions of data per agent
- [ ] `multi-agent-report.ts` produces cross-agent summary
- [ ] All 224+ tests pass

---

## Sprint 5: Steady State Validation (DAY 6+)

**Goal:** Confirm self-sustaining operation. Document. Close out.

### Step 5.1: Validate metrics
```bash
npx tsx tools/multi-agent-report.ts --pretty
```
- Failure rate <10% over 5 consecutive runs
- Avg score >=85 across all agents
- Each agent publishes >=1 post/session average

### Step 5.2: Apply accumulated improvements
```bash
npx tsx tools/improvements.ts list --agent sentinel
npx tsx tools/improvements.ts list --agent pioneer
npx tsx tools/improvements.ts list --agent crawler
```

### Step 5.3: Update CLAUDE.md + MEMORY.md
- Update session stats, CLI quick reference with new tools
- Mark incomplete work items as done

### Step 5.4: Final Codex review of last 5 commits

### Verification
- [ ] 4+ scheduled runs with <10% failure rate
- [ ] Avg score >=85 across all 3 agents
- [ ] Each agent has >=3 total posts
- [ ] CLAUDE.md and MEMORY.md current

---

## Codex Review Findings (Applied)

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | HIGH | V1 has REVIEW/HARDEN but no extensions; V2 has extensions but no REVIEW/HARDEN. Plan assumed both. | Added explicit V1/V2 decision: use V2 for autonomous, defer REVIEW to manual sessions (Step 4.4) |
| 2 | MEDIUM | Calibration offset read from improvements file, not persona.yaml | Fixed all references: improvements file is source of truth, persona.yaml is fallback |
| 3 | MEDIUM | `jq '.calibration'` wrong — audit.ts emits `{ results, stats }` | Fixed to `jq '.stats.calibration_offset'` |
| 4 | MEDIUM | session-report.ts is a viewer, not a REVIEW phase | Removed Step 4.4 claim; added decision point for REVIEW alternatives |
| 5 | MEDIUM | Stale lock/PID collision on crash during cron | Added stale lock detection to wrapper script spec |
| 6 | LOW | Cron TZ not explicit | Added `CRON_TZ=UTC` to crontab |
| 7 | LOW | Crawler threshold change reason slightly stale | Updated reasoning with actual data (predicted 12, landed 9) |

---

## Critical Files

| File | Sprint | Change |
|------|--------|--------|
| `agents/crawler/persona.yaml` | 1 | Lower gate threshold 15→10 |
| `~/.pioneer-improvements.json` | 2 | Adjust calibrationOffset if -10 too aggressive |
| `agents/pioneer/persona.yaml` | 2 | Keep in sync with improvements file |
| `tools/session-runner.ts` | — | Primary orchestrator (no changes, use as-is) |
| `tools/lib/extensions.ts` | 4 | Calibrate hook timeouts |
| `scripts/scheduled-run.sh` | 3 | New: cron wrapper with lock detection |
| `scripts/rotate-logs.sh` | 3 | New: log rotation |
| `tools/multi-agent-report.ts` | 4 | New: cross-agent dashboard |
| `CLAUDE.md` | 5 | Update CLI reference |
| `MEMORY.md` | 5 | Update session stats |
