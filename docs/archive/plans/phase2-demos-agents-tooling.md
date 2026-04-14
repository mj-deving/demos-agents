# Plan: Phase 2 — Demos-Agents Tooling

## Context

Phase 1 of `omniweb-agents` is complete: Sentinel agent definition, ported supercolony skill, base loop strategy, and 8 reference docs. The repo has structure but no automation — the strategy.yaml describes a 7-phase loop but none of the phases are executable as scripts. Phase 2 closes this gap with CLI tools that automate the automatable phases.

**Goal:** Build the minimum viable tooling to run one full Sentinel loop session end-to-end, with scripts handling the mechanical work and the operator handling the creative work (content generation, strategic decisions).

**Repo:** `~/projects/omniweb-agents/`
**Runtime:** Node.js + tsx (not Bun — SDK NAPI crash)
**SDK:** `@kynesyslabs/demosdk/websdk` (already in package.json)

### Current State (Phase 1 complete)
- `skills/supercolony/scripts/supercolony.ts` — 25+ command CLI tool (auth, post, feed, react, etc.)
- `skills/supercolony/scripts/react-to-posts.ts` — engagement automation (--max, --env, --address)
- `agents/sentinel/strategy.yaml` — 7-phase loop definition with room temperature questions, confidence gate, prediction tracking
- `strategies/base-loop.yaml` — universal framework (observe→act→verify→learn) with log schema
- Real session log data: `~/.isidore-session-log.jsonl` (13 entries, proven JSONL format)

### What Phase 2 Adds
6 CLI tools in `tools/` that map to strategy.yaml phases:

| Tool | Phase | Automation Level | Priority |
|------|-------|-----------------|----------|
| `room-temp.ts` | SCAN | Full — fetches feed data, outputs structured assessment | P0 |
| `audit.ts` | AUDIT | Full — fetches scores, compares predictions, updates log | P0 |
| `improvements.ts` | REVIEW + AUDIT | Full — CRUD for Pending Improvements lifecycle | P0 |
| `gate.ts` | GATE | Semi — automates 3 of 6 checklist items, prompts for rest | P1 |
| `session-review.ts` | REVIEW | Template — generates structured questions with session data | P1 |
| `validate.ts` | N/A | Full — validates AGENT.yaml against schema | P2 (defer) |

### What Phase 2 Does NOT Add
- ~~JSON schemas~~ — premature. Format needs to stabilize through use first (same reasoning as Phase 1 scope cuts)
- ~~react-to-posts.ts --strategy~~ — current heuristics work. Revisit after n>=20 sessions prove a need
- ~~publish wrapper~~ — publish is inherently creative (needs persona + strategy). isidore-publish.ts stays in DEMOS-Work as isidore-specific
- ~~session-runner.ts~~ — Phase 4 deliverable, not Phase 2

### Risks
- Tools may not compose well — each works standalone but loop orchestration is manual
- Session log format may need evolution — tools should read/write the proven JSONL format but not assume it's frozen
- Feed API may change — tools should handle SDK errors gracefully

---

## Tool Specifications

### 1. `tools/room-temp.ts` — Room Temperature Assessment

**Maps to:** strategy.yaml SCAN phase, `roomTemperature.questions` section

**What it does:** Fetches feed data and answers the 5 room temperature questions automatically.

**CLI:**
```bash
npx tsx tools/room-temp.ts [--env PATH] [--limit N] [--hours N] [--json] [--pretty]
```

**Flags:**
- `--env PATH` — path to .env (default: .env in cwd)
- `--limit N` — feed posts to fetch (default: 50)
- `--hours N` — time window for activity count (default: 6)
- `--json` — output structured JSON (for piping to other tools)
- `--pretty` — human-readable formatted output

**Output (JSON mode):**
```json
{
  "timestamp": "2026-03-09T10:00:00Z",
  "activity": { "count": 12, "level": "MODERATE", "posts_per_hour": 2.0 },
  "convergence": { "detected": true, "topic": "oil-prices", "agent_count": 4, "agents": ["bernays", "pulitzer", "moana"] },
  "gaps": { "found": true, "unattested_claims": 3, "topics": ["ai-regulation", "eth-staking"] },
  "heat": { "topic": "hormuz-crisis", "reactions": 47, "top_post_tx": "abc123" },
  "twitter_delta": null,
  "recommendation": "MODERATE activity. Convergence on oil-prices — synthesis opportunity. 3 unattested claims to fill."
}
```

**Implementation approach:**
1. Auth via supercolony.ts `auth` (reuse cached token)
2. Fetch feed (50 posts) via SDK
3. Count posts within `--hours` window → activity level
4. Group posts by topic/tags, detect 3+ agents on same topic → convergence
5. Scan for posts without attestation that make data claims → gaps
6. Sort posts by reaction count → heat
7. Twitter delta: skip unless bird CLI is available (optional enrichment)

**Dependencies:** demosdk, existing auth caching from supercolony.ts

---

### 2. `tools/audit.ts` — Session Audit

**Maps to:** strategy.yaml AUDIT phase

**What it does:** Reads session log, fetches current scores/reactions from API, compares predicted vs actual, updates log entries, calculates statistics.

**CLI:**
```bash
npx tsx tools/audit.ts [--log PATH] [--env PATH] [--update] [--pretty]
```

**Flags:**
- `--log PATH` — session log path (default: `~/.sentinel-session-log.jsonl`)
- `--env PATH` — path to .env (default: .env)
- `--update` — write actual scores/reactions back to log (default: dry-run)
- `--pretty` — human-readable output

**Output:**
```
AUDIT — Session Post Analysis
  Post c7049cd9 (ANALYSIS, DAHR): predicted 5rx → actual 8rx (Δ +3) | score 90
  Post 302f4042 (PREDICTION, DAHR): predicted 6rx → actual 12rx (Δ +6) | score 90
  ...

STATISTICS:
  Posts audited: 5
  Avg prediction error: -4.2 reactions (under-predict)
  Calibration offset: +4 (rolling avg)
  Score distribution: 100x2, 90x2, 80x1 (avg 92.0)
  Engagement tiers: T1 (5+): 4/5, T2 (15+): 1/5
```

**Implementation approach:**
1. Read JSONL session log
2. Filter entries missing `actual_reactions` or `actual_score`
3. For each unaudited entry, fetch post by txHash via feed search
4. Extract reaction count and score from API response
5. Calculate statistics: avg error, calibration offset, tier distribution
6. If `--update`: write updated entries back to JSONL

---

### 3. `tools/improvements.ts` — Pending Improvements CRUD

**Maps to:** strategy.yaml REVIEW phase + AGENT.yaml `selfImprovement` section

**What it does:** Manages the Pending Improvements lifecycle (proposed → approved → applied → verified).

**CLI:**
```bash
npx tsx tools/improvements.ts <command> [flags]

Commands:
  list                    List all improvements by status
  propose <desc>          Propose a new improvement
  approve <id>            Approve a proposed improvement
  apply <id>              Mark improvement as applied
  verify <id>             Verify an applied improvement with evidence
  reject <id> <reason>    Reject a proposed improvement
```

**Flags:**
- `--file PATH` — improvements file (default: `~/.sentinel-improvements.json`)
- `--status STATUS` — filter list by status (proposed/approved/applied/verified/rejected)
- `--evidence TEXT` — evidence for propose/verify
- `--target TEXT` — target file/system for propose
- `--source TEXT` — source question (Q1-Q4 from review) for propose
- `--pretty` — formatted output

**Data format (single JSON — `~/.sentinel-improvements.json`):**
```json
{
  "id": "IMP-7-1",
  "timestamp": "2026-03-09T10:00:00Z",
  "source": "Q1",
  "description": "Prioritize bird news over search in SCAN",
  "target": "strategy.yaml Phase 2",
  "status": "proposed",
  "evidence": ["Sessions 5+6: news found gaps, search noise"],
  "history": [
    { "action": "proposed", "timestamp": "2026-03-09T10:00:00Z" }
  ]
}
```

**ID format:** `IMP-{session}-{sequence}` (e.g., IMP-7-1 = session 7, improvement 1)

**Lifecycle rules (from AGENT.yaml):**
- `proposed`: requires evidence text + target
- `approved`: human-only action (oversight gate)
- `applied`: implementation done, awaiting verification
- `verified`: evidence confirms improvement works

---

### 4. `tools/gate.ts` — Confidence Gate Checker

**Maps to:** strategy.yaml GATE phase (6-item checklist)

**What it does:** Automates the checkable items in the confidence gate, prompts for manual items.

**CLI:**
```bash
npx tsx tools/gate.ts [--topic TEXT] [--env PATH] [--pretty]
```

**The 6 gate items (from strategy.yaml):**
1. **Topic activity ≥3 posts** — AUTOMATABLE (search feed for topic)
2. **Unique data** — MANUAL (operator confirms uniqueness)
3. **Agent reference** — MANUAL (operator confirms which agent to cite)
4. **ANALYSIS or PREDICTION category** — AUTOMATABLE (prompt for category selection)
5. **>200 chars + confidence set** — AUTOMATABLE (check prepared text length)
6. **Not duplicate** — AUTOMATABLE (search own posts for same topic)

**Output:**
```
GATE — Confidence Checklist for "oil-crypto-decoupling"
  ✅ 1. Topic activity: 7 posts found (threshold: 3)
  ❓ 2. Unique data: [MANUAL — do you have data no one else has attested?]
  ❓ 3. Agent reference: [MANUAL — which agent(s) will you cite?]
  ✅ 4. Category: ANALYSIS (eligible for engagement bonus)
  ⚠️  5. Text length: not yet provided (use --text to check)
  ✅ 6. Not duplicate: no matching posts found in your history

  RESULT: 3/6 auto-pass, 2 manual checks needed, 1 warning
```

---

### 5. `tools/session-review.ts` — Structured Review Template

**Maps to:** strategy.yaml REVIEW phase (4 questions)

**What it does:** Generates a pre-filled review template using session data. The operator answers the questions; the output feeds into `improvements.ts propose`.

**CLI:**
```bash
npx tsx tools/session-review.ts [--log PATH] [--session N] [--pretty]
```

**Output:**
```
REVIEW — Session 7 Structured Review

Session Stats:
  Posts: 3 (2 ANALYSIS, 1 PREDICTION)
  Attestations: 2 TLSN, 1 DAHR
  Reactions cast: 5 agree, 1 disagree
  Avg predicted reactions: 7.0
  Avg actual reactions: 11.3 (Δ +4.3)

Q1: What failed or underperformed this session?
  [Posts with actual < predicted, or score < 90:]
  - Post abc123: predicted 8rx, got 3rx (ANALYSIS, DAHR) — investigate why

Q2: What improvement would prevent the failure?
  [Suggest based on Q1 data]

Q3: What unexpected insight emerged?
  [Highlight: any post with actual >> predicted]
  - Post def456: predicted 5rx, got 18rx — TLSN reply to hot thread

Q4: What knowledge is stale or needs updating?
  [Check: predictions past deadline, calibration drift]
  - Brent crude prediction (302f4042): deadline 2026-03-10, needs resolution
```

---

## Tool Architecture Decisions

### Shared Code
All tools import from `tools/lib/`:
- `auth.ts` — shared auth (reuse supercolony.ts token caching from `~/.supercolony-auth.json`)
- `sdk.ts` — SDK initialization (connect wallet, create Demos instance)
- `log.ts` — session log read/write (JSONL parse/append)

This avoids duplicating SDK setup and auth in every tool. Each tool is a standalone CLI entry point that imports shared utilities.

### Where Tools Live
```
omniweb-agents/
├── tools/
│   ├── room-temp.ts
│   ├── audit.ts
│   ├── improvements.ts
│   ├── gate.ts
│   ├── session-review.ts
│   └── lib/
│       ├── auth.ts
│       ├── sdk.ts
│       └── log.ts
```

NOT in `skills/supercolony/scripts/` — tools are agent-level orchestration, not skill-level operations. The skill provides primitive operations (post, feed, react); tools compose them into loop phases.

### Data File Locations
All runtime data stays local (gitignored), not in the repo:
- Session log: `~/.sentinel-session-log.jsonl` (or `--log` flag override; use `--log ~/.isidore-session-log.jsonl` for backward compat)
- Improvements: `~/.sentinel-improvements.json` (single JSON, or `--file` flag override)
- Auth cache: `~/.supercolony-auth.json` (existing)

### Error Handling
Every tool follows the same pattern:
1. Try operation
2. On SDK/network error: print error message, exit 1
3. On auth error: print "Run `npx tsx scripts/supercolony.ts auth` first", exit 1
4. On missing data: print what's missing, suggest fix, exit 1

No retries, no fallbacks, no complexity. If it fails, fix the cause and re-run.

---

## Implementation Order

**Session A (first implementation session):**
0. Root `package.json` + `tsconfig.json` (prerequisite — missing from Phase 1)
1. `tools/lib/` shared utilities (auth.ts, sdk.ts, log.ts, cli.ts) — foundation for all tools
2. `tools/room-temp.ts` — read-only, validates SDK/auth pipeline end-to-end
3. `tools/audit.ts` — first writer, validates log read/write

**Session B (second implementation session):**
4. `tools/improvements.ts` — single JSON storage, CRUD lifecycle
5. `tools/session-review.ts` — template output, depends on audit + improvements data
6. `tools/gate.ts` — automated checks only, no interactivity, lowest standalone value

**Deferred (not Phase 2):**
- `validate.ts` — AGENT.yaml schema validation. Defer until format stabilizes.
- JSON schemas — premature standardization. Defer.
- `react-to-posts.ts --strategy` — current heuristics work. Revisit after more data.
- `session-runner.ts` — Phase 4 (full automation).

---

## Verification Checklist

- [ ] `tools/audit.ts --log ~/.sentinel-session-log.jsonl --pretty` shows correct prediction errors for known posts
- [ ] `tools/room-temp.ts --pretty` outputs all 5 room temperature answers with real feed data
- [ ] `tools/room-temp.ts --json` produces valid parseable JSON
- [ ] `tools/improvements.ts propose "test" --evidence "test" --target "test"` creates entry
- [ ] `tools/improvements.ts list` shows the created entry
- [ ] `tools/improvements.ts approve IMP-X-1` transitions status
- [ ] `tools/gate.ts --topic "bitcoin"` returns topic activity count from real feed
- [ ] `tools/session-review.ts --log ~/.sentinel-session-log.jsonl` generates review with real stats
- [ ] All tools exit 1 with clear error message on auth failure
- [ ] Root package.json exists with tsx and demosdk dependencies
- [ ] All tools work with `--env PATH` override
- [ ] No private data (wallets, mnemonics) in committed code
- [ ] `tools/lib/` shared utilities imported by all 5 tools without circular deps

---

## Codex Review (2026-03-09)

Codex CLI v0.110.0 reviewed this plan. 3 HIGH, 3 MEDIUM, 1 LOW findings. All resolved below.

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | HIGH | No root package.json — `npx tsx tools/*.ts` will fail without deps | **Fixed.** Add root `package.json` with tsx + demosdk as Step 0 of Session A |
| 2 | HIGH | improvements.ts JSONL conflicts with lifecycle mutations (approve/verify = read-modify-write) | **Fixed.** Switch to single JSON file (`~/.sentinel-improvements.json`). JSONL stays for session log only |
| 3 | HIGH | Naming drift — plan mixes `isidore` and `sentinel` paths in defaults and verification | **Fixed.** All defaults use `sentinel` namespace. `--log` flag allows override to isidore for backward compat |
| 4 | MED | tools/lib auth.ts could drift from supercolony.ts auth logic | **Accepted.** lib/auth.ts reads cached `~/.supercolony-auth.json` (just JSON I/O). SDK init in lib/sdk.ts is a factory function, not singleton. No import coupling to supercolony.ts |
| 5 | MED | gate.ts weak ROI as standalone — easy to skip | **Accepted.** Scope gate.ts to automated checks only, no interactivity. Outputs `--json` for pipeline use. Marginal standalone, but prevents the most common failures (duplicate posts, low-activity topics) |
| 6 | MED | Missing rotation/archive behavior — base-loop mandates it, tools don't define it | **Fixed.** audit.ts handles rotation: when log exceeds 50 entries, archive oldest to `~/.sentinel-session-log.archive.jsonl` before writing |
| 7 | LOW | room-temp gap detection "unattested claims" is vague | **Fixed.** Define as: post contains numeric value/percentage AND has no attestation. Simple heuristic, extensible later |

### Codex Answers to Open Questions

1. **tools/ vs skills/scripts/ boundary** — **Correct.** Primitives vs workflows. Keep the split.
2. **JSONL vs JSON for improvements** — **Single JSON.** Lifecycle mutations are read-modify-write on small data (<100 entries). JSONL's append-only benefit doesn't apply.
3. **gate.ts standalone worth?** — **Yes, but scoped down.** Automated checks only, no prompts. Outputs `--json` for composition. Prevents most common publishing mistakes.
4. **session-review.ts interactive vs template?** — **Template-only.** Non-interactive output is composable, pipeable, and feeds into `improvements.ts propose`.
5. **Shared lib/ vs standalone?** — **Shared lib/ correct.** Factory pattern for sdk.ts (no singletons). auth.ts and log.ts are pure I/O.

### Codex-Adjusted Implementation Order

1. Root package.json + tsconfig.json (prerequisite)
2. tools/lib/ (auth.ts, sdk.ts, log.ts, cli.ts)
3. tools/room-temp.ts (read-only, validates SDK/auth pipeline first)
4. tools/audit.ts (first writer, validates log.ts)
5. tools/improvements.ts (single JSON, depends on choosing storage model)
6. tools/session-review.ts (depends on audit + improvements data)
7. tools/gate.ts (lowest standalone value, most useful after review+improvements work)

---

## Codex Review — Session B (2026-03-09)

Codex CLI reviewed Session B specs against all Session A code. 11 findings, 5 decisions resolved.

### Findings

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | HIGH | `session-review.ts` expects fields not in `SessionLogEntry` (reactions cast, prediction deadlines) | **Resolved.** Scope to existing fields only. Derive stats from what's in the log. Extend schema later when proven needed. |
| 2 | HIGH | `--session N` flag underspecified — no session_id in log entries | **Resolved.** Auto-session: auto-increment counter stored in improvements file envelope. No manual `--session` flag. Sessions identified by `{ number, date }`. Future: 2h tact agentic loop. |
| 3 | HIGH | `improvements.ts` storage schema shows bare object, needs envelope | **Resolved.** Envelope: `{ version: 1, nextSession: N, nextSequence: {}, items: [...] }`. Session counter lives here. |
| 4 | HIGH | `gate.ts` mixes interactive and non-interactive; missing `--text`, `--category`, `--confidence` flags | **Resolved.** Add all 3 flags. Manual items (unique data, agent ref) marked as `MANUAL` in output — no interactive prompts. |
| 5 | MED | Output mode conventions drift across tools | **Resolved.** Standardize: default=JSON (indented), `--pretty`=human-readable, `--json`=compact single-line. All 5 tools. |
| 6 | MED | Error message references wrong auth script path | **Resolved.** Fix to `skills/supercolony/scripts/supercolony.ts auth` or just "re-authenticate". |
| 7 | MED | `improvements.ts` lifecycle missing transition matrix | **Resolved.** Hard errors on invalid transitions. Valid: proposed→approved, proposed→rejected, approved→applied, applied→verified, applied→rejected. No other transitions. |
| 8 | MED | ID generation `IMP-{session}-{sequence}` collision-prone | **Resolved.** `nextSequence` map in envelope keyed by session number. Auto-increment per session. |
| 9 | MED | `gate.ts` duplicate-check semantics vague | **Resolved.** Check author's last 50 posts. Match = any overlap in normalized tags or assets with `--topic`. |
| 10 | LOW | gate.ts says "eligible for engagement bonus" but scoring says category irrelevant | **Resolved.** Reword to "strategic policy compliance". |
| 11 | LOW | Import/runtime conventions not explicit | **Resolved.** Follow Session A patterns: ESM `.js` suffix imports, `main().catch()` pattern, stderr for info logs, stdout for data output. |

### Design Decisions (Marius, 2026-03-09)

1. **Schema scope:** Existing `SessionLogEntry` fields only. No schema extension for Session B.
2. **State machine:** Hard errors on invalid transitions. Exit 1 with clear message.
3. **Gate manual items:** Marked as `MANUAL` in output. No interactive prompts, no required flags for manual items.
4. **Session identity:** Auto-managed counter in improvements envelope. Number + date. Goal: fully agentic 2h-tact loop with zero human session management.
5. **Output mode:** Standardized across all tools. JSON default, `--pretty` human-readable, `--json` compact.

### Refined Improvements Schema

```json
{
  "version": 1,
  "nextSession": 8,
  "nextSequence": { "7": 4, "8": 1 },
  "items": [
    {
      "id": "IMP-7-1",
      "session": 7,
      "timestamp": "2026-03-09T10:00:00Z",
      "source": "Q1",
      "description": "Prioritize bird news over search in SCAN",
      "target": "strategy.yaml Phase 2",
      "status": "proposed",
      "evidence": ["Sessions 5+6: news found gaps, search noise"],
      "history": [
        { "action": "proposed", "timestamp": "2026-03-09T10:00:00Z" }
      ]
    }
  ]
}
```

### Refined Gate Flags

```bash
npx tsx tools/gate.ts --topic TEXT [--text TEXT] [--category TEXT] [--confidence N] [--env PATH] [--pretty] [--json]
```

### Valid Improvement Transitions

```
proposed → approved    (human approval)
proposed → rejected    (with reason)
approved → applied     (implementation done)
applied  → verified    (evidence provided)
applied  → rejected    (didn't work, with reason)
```

All other transitions → hard error, exit 1.
