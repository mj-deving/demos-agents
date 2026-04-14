# Plan: Phase 3 — Session Runner & Loop Automation

## Context

Phase 2 shipped 5 CLI tools (room-temp, audit, improvements, session-review, gate) that automate individual loop phases. But they're standalone — the operator runs them manually in sequence, pipes nothing between them, and tracks session state in their head. Phase 3 closes this gap with a session-runner that orchestrates the full 7-phase loop.

**Goal:** Build the minimum viable orchestrator to run one full Sentinel loop session from a single command, with automated phases running automatically and human-required phases prompting the operator.

**Repo:** `~/projects/omniweb-agents/`
**Runtime:** Node.js + tsx (not Bun — SDK NAPI crash)
**Depends on:** All Phase 2 tools (room-temp, audit, improvements, gate, session-review)

### Current State (Phase 2 complete)

| Phase | Tool | Automation | Gap |
|-------|------|-----------|-----|
| AUDIT | `tools/audit.ts` | Full | None |
| SCAN | `tools/room-temp.ts` | Full | None |
| ENGAGE | `skills/.../react-to-posts.ts` | Semi | Not in tools/, different CLI patterns, no --json output |
| GATE | `tools/gate.ts` | Partial (3/6 auto) | None |
| PUBLISH | None (isidore-publish.ts in DEMOS-Work) | Manual | No tools/ wrapper, intentionally excluded |
| VERIFY | None | Manual | No tool — just feed check + log confirm |
| REVIEW | `tools/session-review.ts` + `tools/improvements.ts` | Template | None |

### What Phase 3 Adds

3 new tools + 1 orchestrator:

| Tool | Phase | What it does | Priority |
|------|-------|-------------|----------|
| `engage.ts` | ENGAGE | Reactions with tools/ conventions (reactions-only) | P0 |
| `verify.ts` | VERIFY | Checks feed for post, reports log status | P0 |
| `session-runner.ts` | ALL | Orchestrates 7-phase loop with state tracking | P0 |
| `lib/state.ts` | N/A | Session state persistence (namespaced, lockfile) | P0 |
| `lib/subprocess.ts` | N/A | Spawn tools as subprocesses, capture JSON stdout | P0 |

### What Phase 3 Does NOT Add

- ~~publish.ts~~ — PUBLISH content is inherently creative. Requires persona + strategy + human judgment. isidore-publish.ts stays in DEMOS-Work as agent-specific. The runner prompts the operator to publish manually, then picks up at VERIFY.
- ~~Projectors~~ — AGENT.yaml → runtime format conversion. Deferred to Phase 4 when portability is needed.
- ~~Full autonomy~~ — Session-runner is semi-autonomous: automated phases run automatically, human phases prompt and wait.
- ~~react-to-posts.ts --strategy~~ — Current heuristics work. Phase 2 decision stands.

### Value Proposition

Why orchestrate instead of running tools manually?

1. **State continuity** — tracks which phases completed, allows `--resume` if session interrupted
2. **Data piping** — room-temp output feeds gate decisions automatically
3. **Phase ordering** — enforces AUDIT → SCAN → ENGAGE → GATE → PUBLISH → VERIFY → REVIEW sequence
4. **Session identity** — auto-increments session counter from improvements.ts envelope
5. **Time tracking** — logs phase start/end for session duration analysis
6. **Guard rails** — prevents skipping AUDIT (the #1 cause of stale calibration)

---

## Tool Specifications

### 1. `tools/engage.ts` — Engagement Automation

**Maps to:** strategy.yaml ENGAGE phase

**What it does:** Wraps react-to-posts.ts logic with tools/ conventions. Reads feed, selects reaction targets using heuristics, casts reactions. Reports results in structured JSON. **Scoped to reactions only** — reply threads remain manual per Codex review (strategy.yaml also expects 1-2 replies, but automating reply content requires persona/strategy judgment).

**CLI:**
```bash
npx tsx tools/engage.ts [--max N] [--env PATH] [--pretty] [--json]
```

**Flags:**
- `--max N` — max reactions to cast (default: 5, range: 1-8)
- `--env PATH` — path to .env (default: .env in cwd)
- `--pretty` — human-readable output
- `--json` — compact JSON output

**Output (JSON mode):**
```json
{
  "timestamp": "2026-03-10T10:00:00Z",
  "reactions_cast": 5,
  "agrees": 4,
  "disagrees": 1,
  "targets": [
    {
      "txHash": "abc123",
      "author": "bernays",
      "reaction": "agree",
      "topic": "oil-prices",
      "score": 90
    }
  ],
  "skipped": 3,
  "errors": 0
}
```

**Implementation approach:**
1. Import from `tools/lib/` (auth, sdk) — no duplicated setup
2. Fetch feed (50 posts), filter out own posts
3. Sort by engagement potential: high-score authors first, diverse topics
4. Include ≥1 disagree (strategy.yaml requirement)
5. Cast reactions via SDK
6. Return structured result

**Key difference from react-to-posts.ts:**
- Uses `tools/lib/` shared code (auth.ts, sdk.ts) instead of inline setup
- Outputs structured JSON (--json/--pretty) instead of console.log
- Returns result object (composable) instead of void
- Enforces --max range validation (strict parseInt, 1-8)

---

### 2. `tools/verify.ts` — Post Verification

**Maps to:** strategy.yaml VERIFY phase

**What it does:** Takes one or more txHashes, checks if they appear in the SuperColony feed, confirms session log has matching entries.

**CLI:**
```bash
npx tsx tools/verify.ts <txHash...> [--log PATH] [--env PATH] [--pretty] [--json]
```

**Flags:**
- `<txHash...>` — one or more txHashes to verify (positional args)
- `--log PATH` — session log path (default: `~/.sentinel-session-log.jsonl`)
- `--env PATH` — path to .env (default: .env)
- `--pretty` — human-readable output
- `--json` — compact JSON output

**Output (JSON mode):**
```json
{
  "timestamp": "2026-03-10T10:30:00Z",
  "verified": [
    {
      "txHash": "abc123",
      "in_feed": true,
      "in_log": true,
      "feed_score": 80,
      "feed_reactions": 0,
      "status": "verified"
    }
  ],
  "failed": [],
  "summary": { "total": 1, "verified": 1, "failed": 0 }
}
```

**Implementation approach:**
1. For each txHash: search feed by txHash via API
2. Check session log for matching entry (informational, not gating — log may be appended by runner's PUBLISH step)
3. Report: in_feed = verified. Also report in_log status as informational.
4. Wait 15s before checking (indexer lag) — configurable with `--wait N`

---

### 3. `tools/lib/state.ts` — Session State Manager

**What it does:** Persists session-runner state between phases. Enables `--resume` after interruption.

**State directory:** `~/.sentinel/sessions/`
**State file:** `~/.sentinel/sessions/sentinel-<N>.json` (N = session number)
**Lock file:** `~/.sentinel/sessions/sentinel-<N>.lock` (PID-based, stale after 2h)

**Schema:**
```json
{
  "sessionNumber": 7,
  "agentName": "sentinel",
  "startedAt": "2026-03-10T10:00:00Z",
  "pid": 12345,
  "phases": {
    "audit": { "status": "completed", "startedAt": "...", "completedAt": "...", "result": {} },
    "scan": { "status": "completed", "startedAt": "...", "completedAt": "...", "result": {} },
    "engage": { "status": "in_progress", "startedAt": "..." },
    "gate": { "status": "pending" },
    "publish": { "status": "pending" },
    "verify": { "status": "pending" },
    "review": { "status": "pending" }
  },
  "posts": [],
  "engagements": []
}
```

**Functions:**
- `loadState()` — load current session state (or null if no active session)
- `saveState(state)` — write state file
- `startSession(sessionNumber)` — create fresh state
- `completePhase(phase, result)` — mark phase completed with result data
- `getNextPhase(state)` — return first pending phase
- `clearState()` — remove state file (session complete)

---

### 4. `tools/session-runner.ts` — Loop Orchestrator

**Maps to:** The full 7-phase loop (strategy.yaml)

**What it does:** Runs the Sentinel loop from start to finish. Automated phases execute and pipe results forward. Human phases pause and prompt. State persists between phases for resume capability.

**CLI:**
```bash
npx tsx tools/session-runner.ts [--env PATH] [--log PATH] [--resume] [--phase PHASE] [--dry-run] [--pretty]
```

**Flags:**
- `--env PATH` — path to .env (default: .env)
- `--log PATH` — session log path (default: `~/.sentinel-session-log.jsonl`)
- `--resume` — resume interrupted session from last completed phase
- `--skip-to PHASE` — resume from specific phase (requires `--force-skip-audit` if skipping AUDIT, per AGENT.yaml hard rule "never skip audit phase")
- `--force-skip-audit` — explicitly acknowledge skipping AUDIT phase (required with `--skip-to` for phases after AUDIT)
- `--dry-run` — show what would run without executing
- `--pretty` — human-readable output (default for interactive use)

**Phase execution model:**

```
PHASE       MODE         TOOL CALLED              HUMAN ACTION
──────────────────────────────────────────────────────────────────
AUDIT       automatic    audit.ts --update         None
SCAN        automatic    room-temp.ts              None
ENGAGE      automatic    engage.ts --max 5         None (review output)
GATE        interactive  gate.ts --topic T         Operator provides topic, confirms gate
PUBLISH     manual       (none)                    Operator publishes using isidore-publish.ts
VERIFY      automatic    verify.ts <txHashes>      None
REVIEW      interactive  session-review.ts         Operator answers questions, proposes improvements
```

**Execution flow:**

```
1. AUDIT (automatic)
   └── Run: audit.ts --update --log PATH --env PATH --pretty
   └── Display: prediction errors, calibration offset, score distribution
   └── Save result to state

2. SCAN (automatic)
   └── Run: room-temp.ts --env PATH --pretty
   └── Display: activity, convergence, gaps, heat, recommendation
   └── Save result to state

3. ENGAGE (automatic)
   └── Run: engage.ts --max 5 --env PATH --pretty
   └── Display: reactions cast, targets, disagrees included
   └── Save result to state

4. GATE (interactive, repeatable per post)
   └── Prompt: "Topic for post 1?"
   └── Prompt: "Category? (analysis/prediction)"
   └── Prompt: "Draft text (or 'skip' for length check later):"
   └── Prompt: "Confidence (60-100):"
   └── Run: gate.ts --topic T --category C --text "..." --confidence N --env PATH --pretty
   └── Display: 6-item checklist result (all auto-checks populated)
   └── Prompt: "Proceed to publish? (y/n/skip)"
   └── If y: move to PUBLISH. If n: re-run gate with different topic. If skip: go to REVIEW
   └── Save gate results to state

5. PUBLISH (manual with log capture)
   └── Display: "Publish your post now using isidore-publish.ts (or your agent's publish tool)"
   └── Display: gate results, room-temp context for reference
   └── Prompt: "Enter txHash of published post (or 'done' to proceed to verify):"
   └── Validate txHash format (hex string)
   └── Prompt: "Predicted reactions for this post?"
   └── Append minimal session log entry (txHash, category, predicted_reactions, timestamp)
   └── Repeat for up to 3 posts (strategy limit)
   └── Save txHashes to state

6. VERIFY (automatic)
   └── Wait 15s (indexer lag)
   └── Run: verify.ts <collected txHashes> --log PATH --env PATH --pretty
   └── Display: verification results
   └── Save result to state

7. REVIEW (interactive)
   └── Run: session-review.ts --log PATH --pretty
   └── Display: structured review template with session data
   └── Prompt: "Any improvements to propose? (describe or 'none'):"
   └── If improvement: run improvements.ts propose <desc> --evidence <E> --target <T>
   └── Save result to state
   └── Clear state file (session complete)
   └── Display: session summary (duration, posts, reactions, scores)
```

**Interactive I/O:**

The runner uses Node.js `readline` for interactive prompts. All prompts are simple text input — no TUI, no curses, no complexity.

```
═══ SENTINEL SESSION 8 ═══════════════════════

Phase 1/7: AUDIT
  Running audit.ts...
  ✓ 3 posts audited | avg error: +3.2 | calibration: +4

Phase 2/7: SCAN
  Running room-temp.ts...
  ✓ MODERATE activity (8 posts/6h) | convergence on oil-prices | 2 gaps found

Phase 3/7: ENGAGE
  Running engage.ts...
  ✓ 5 reactions cast (4 agree, 1 disagree) | 0 errors

Phase 4/7: GATE
  Topic for post 1: █
```

**Error handling:**
- Phase failure: display error, save state, exit 1. Resume picks up from failed phase.
- Auth failure: display "re-authenticate" message, exit 1.
- Network timeout: display timeout, save state, exit 1.
- User interrupt (Ctrl+C): save state, display resume instructions, exit 0.

---

## Tool Architecture Decisions

### Runner Calls Tools as Subprocesses (not imports)

The runner spawns each tool as a subprocess (`npx tsx tools/audit.ts --json`), NOT via function imports. This is a Codex-reviewed decision:

**Why subprocess over import:**
- Phase 2 tools are CLI-first: they parse `process.argv`, call `process.exit()`, and write to stdout/stderr. Refactoring for imports requires extracting pure core modules — avoidable coupling and risk for Phase 3 MVP.
- Auth is already cached to disk (`~/.supercolony-auth.json`) — no benefit from shared SDK connection.
- Each tool is proven standalone — subprocess preserves that boundary.
- If import-based composition is wanted later, extract `core/*` modules first, keep CLI wrappers thin.

**How it works:**
```typescript
// Runner spawns tool and captures JSON output
const result = await runTool("tools/audit.ts", ["--update", "--log", logPath, "--env", envPath, "--json"]);
const auditResult = JSON.parse(result.stdout);
```

Utility function `runTool()` in `lib/subprocess.ts`:
- Spawns `npx tsx <tool> <args>` as child process
- Captures stdout (JSON data) and stderr (info logs)
- Returns `{ stdout, stderr, exitCode }`
- Throws on non-zero exit with stderr as error message

### Where State Lives

```
~/.sentinel/sessions/sentinel-<N>.json  — active session state (cleared on completion)
~/.sentinel-session-log.jsonl           — append-only log (existing, unchanged)
~/.sentinel-improvements.json           — improvements CRUD (existing, unchanged)
```

State file is namespaced under `~/.sentinel/sessions/` (Codex finding: single global file is fragile). Includes a lockfile (`sentinel-<N>.lock` with PID) for stale-lock recovery. State file is ephemeral — only exists during an active session. Cleared after REVIEW completes.

### Interactive Prompts

Runner uses Node.js `readline/promises` (built-in, no dependencies). Prompts are simple question/answer — no menus, no cursor movement, no complexity.

Why not a TUI framework?
- Extra dependency for minimal benefit
- Prompts are infrequent (3-4 per session)
- Output is mostly tool results (already formatted)
- Keep it simple — the runner is glue code, not a product

---

## Implementation Order

**Session A (first implementation session):**
1. `tools/lib/subprocess.ts` — tool runner utility (spawn, capture stdout JSON, handle errors)
2. `tools/lib/state.ts` — session state management (namespaced, lockfile, PID)
3. `tools/verify.ts` — post verification tool (standalone + composable)
4. `tools/engage.ts` — engagement wrapper with tools/ conventions (reactions-only)

**Session B (second implementation session):**
5. `tools/session-runner.ts` — the orchestrator (subprocess-based, readline prompts)
6. End-to-end test: run one full session through the runner
7. Fix any integration issues discovered during testing

### What's NOT Phase 3 (deferred)

- ~~Projectors~~ — Phase 4 when portability needed
- ~~Full PUBLISH automation~~ — Content is creative, stays human-driven
- ~~react-to-posts.ts --strategy~~ — Current heuristics work
- ~~TUI/rich terminal UI~~ — readline is sufficient
- ~~Session scheduling/cron~~ — Manual invocation for now
- ~~Multi-agent support~~ — Sentinel only until proven

---

## Risks

1. **Subprocess JSON parsing** may fail on tool stderr contaminating stdout — mitigate by ensuring all tools use `info()` (stderr) for logs and stdout for data only (Phase 2 convention already established)
2. **readline interaction** is crude — but adequate for 5-6 prompts per session. Upgrade to TUI only if proven painful
3. **Session state file** adds complexity — but enables --resume which is essential for 30-45 min sessions that can be interrupted
4. **Session number ownership** — runner reads `nextSession` from improvements.json at start, writes back only on successful REVIEW completion. Prevents drift from improvements.ts running independently mid-session

---

## Verification Checklist

- [ ] `tools/engage.ts --max 3 --pretty` casts 3 reactions with ≥1 disagree and outputs structured result
- [ ] `tools/engage.ts --json` produces valid parseable JSON
- [ ] `tools/verify.ts <known-txHash> --pretty` shows verified status with feed score
- [ ] `tools/verify.ts <unknown-txHash> --pretty` shows failed status
- [ ] `tools/lib/state.ts` creates, updates, and clears session state correctly
- [ ] `tools/lib/state.ts` uses namespaced path `~/.sentinel/sessions/sentinel-<N>.json`
- [ ] `tools/lib/subprocess.ts` captures tool JSON stdout correctly
- [ ] `tools/session-runner.ts --dry-run` shows all 7 phases without executing
- [ ] `tools/session-runner.ts` runs AUDIT→SCAN→ENGAGE automatically then prompts at GATE
- [ ] `tools/session-runner.ts --resume` picks up from last completed phase
- [ ] `tools/session-runner.ts --skip-to scan --force-skip-audit` skips AUDIT with explicit flag
- [ ] `tools/session-runner.ts --skip-to scan` (without --force-skip-audit) errors with warning
- [ ] GATE prompts for topic, category, text, and confidence before running gate.ts
- [ ] PUBLISH step captures txHash + predicted_reactions and appends session log entry
- [ ] Ctrl+C during session saves state and shows resume instructions
- [ ] Session state file is cleared after successful REVIEW completion
- [ ] Session number read from improvements.json at start, written back on completion only
- [ ] Existing Phase 2 tools still work standalone (no changes to existing tools)
- [ ] All new tools use tools/lib/ shared code (no duplicated SDK init)
- [ ] No private data (wallets, mnemonics) in committed code
- [ ] package.json updated with new npm run scripts

---

## Codex Review (2026-03-09)

Codex CLI reviewed this plan against the omniweb-agents codebase. 3 HIGH, 4 MED, 2 LOW findings. All resolved below.

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | HIGH | Import-based runner requires refactoring Phase 2 tools (process.argv, process.exit in code paths) — larger than plan implies | **Fixed.** Switched to subprocess orchestration. Runner spawns tools via `npx tsx` and captures JSON stdout. No refactoring of existing tools needed. |
| 2 | HIGH | GATE composition underspecified — runner only prompts for topic but gate.ts needs text/category/confidence for full auto-checks | **Fixed.** Runner now prompts for topic, category, draft text, and confidence before running gate.ts with all flags. |
| 3 | HIGH | VERIFY "in log" check can fail by design if publish is manual/external — log appended by publish CLI but publish stays outside tools/ | **Fixed.** Runner's PUBLISH step captures txHash + predicted_reactions and appends session log entry directly. verify.ts treats log presence as informational, not gating. |
| 4 | MED | engage.ts covers reactions only; strategy ENGAGE also expects 1-2 reply threads | **Accepted.** Scoped engage.ts to reactions-only for Phase 3. Reply threads remain manual — automating reply content requires persona + strategy judgment. Documented in spec. |
| 5 | MED | `--phase` skip conflicts with AGENT.yaml hard rule "Never skip audit phase" | **Fixed.** Renamed to `--skip-to` and requires `--force-skip-audit` flag to skip AUDIT. Without it, errors with warning. |
| 6 | MED | Single global state file `~/.sentinel-session-state.json` is fragile for concurrent runs | **Fixed.** Namespaced to `~/.sentinel/sessions/sentinel-<N>.json` with PID-based lockfile and stale-lock recovery (2h timeout). |
| 7 | MED | Session number auto-increment from improvements file can drift/race | **Fixed.** Session number is runner-owned: read `nextSession` once at start, write back only on successful REVIEW completion. |
| 8 | LOW | "Shared SDK connection" benefit overstated — auth already cached to disk | **Accepted.** Subprocess approach eliminates this concern entirely. Each tool connects independently, auth cached. |
| 9 | LOW | 2 sessions likely underestimates integration/test effort | **Accepted.** Implementation order already front-loads the smaller tools (Session A: subprocess.ts, state.ts, verify.ts, engage.ts) and defers the orchestrator (Session B). If Session B needs splitting, defer end-to-end testing to Session C. |

### Codex Answers to Open Questions

1. **Import vs subprocess** — **Subprocess for Phase 3 MVP.** Import creates avoidable coupling. Migrate to imports only after extracting pure `core/*` modules from existing CLI tools.
2. **Session state file** — **Direction correct, design improved.** Namespaced under `~/.sentinel/sessions/` with lockfile/PID. Single global file was too brittle.
3. **engage.ts vs react-to-posts.ts** — **Worth building.** Consistency with tools/ conventions (`--json`, shared libs, predictable output). Keep thin — don't re-implement strategy logic.
4. **PUBLISH automation** — **Keep content manual. Add operational automation:** txHash capture, format validation, session log append, handoff to verify.
5. **Scope in 2 sessions** — **Feasible if subprocess-based.** No tool refactoring needed. If tight, defer end-to-end testing to Session C.
