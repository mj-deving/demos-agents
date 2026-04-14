# Plan: Phase 4 — Lean Autonomous Loop

## Context

Phase 4 of the [demos-hivemind-agent-system](demos-hivemind-agent-system.md) plan. The session-runner exists (`tools/session-runner.ts`, 1700 lines, 3 oversight modes) but is over-engineered for the autonomous case. First Principles analysis reveals: **the loop is a pipeline, not a conversation.** 6/8 phases need zero LLM. Only PUBLISH needs ~400 chars of text generation.

**Vision:** An external agent (OpenClaw on Sonnet, or even a cron job) says:
```
Every hour, run: npx tsx tools/run-loop.ts --schedule sentinel:1,crawler:2 --env PATH
```
And it just works. Zero exploration. Zero AI reasoning overhead. All intelligence baked into code heuristics.

**Phases implemented so far:**
- Phase 1: Foundation ✅
- Phase 2: Tooling ✅
- Phase 3: Projectors — DEFERRED (scope-cut)
- **Phase 4: Automation — THIS PLAN**
- Phase 5: Docs & Release — NOT STARTED

## First Principles Analysis

### What the LLM actually does per phase

| Phase | LLM needed? | What it actually does |
|-------|-------------|----------------------|
| AUDIT | No | Fetch scores, compare predicted vs actual — arithmetic |
| SCAN | No | Fetch feed, count topics, detect gaps — keyword matching |
| ENGAGE | No | Cast reactions — rule-based targeting |
| GATE | No | 6 boolean checks, threshold pass/fail |
| **PUBLISH** | **Yes (1 call)** | Generate 200-600 chars of post text from topic + attested data |
| VERIFY | No | Feed lookup by txHash |
| REVIEW | Marginal | Pattern matching on structured session data |
| HARDEN | Marginal | Classify findings into categories |

**The LLM's only irreducible job is writing ~400 characters of post text.** Everything else is deterministic heuristics.

### What's wrong with the current autonomous mode

1. **Session-runner is a state machine** — tracks phase transitions, persists state to disk, supports resume. Unnecessary for autonomous pipeline that runs start-to-finish.
2. **Model hardcoded** to `claude-sonnet-4-6` in llm-provider.ts — model choice should be runtime/environment config, never inside agent code.
3. **No multi-session orchestration** — can only run 1 agent per invocation. "1 sentinel + 2 crawlers" requires 3 separate commands.
4. **No standalone publish tool** — publishing is embedded in session-runner's autonomous flow. Can't test or invoke independently.
5. **Gate topic selection** requires either human input or LLM — should be deterministic from scan output.
6. **RPC 502 not retried** in publish pipeline — cascades to session failure.
7. **Display prefix** hardcoded `[sentinel]` regardless of agent.

### Design principle: Provider-Agnostic

No model decisions inside agent code or agent definitions. Model tiers (`fast`/`standard`/`premium`) defined in AGENT.yaml. Model mapping lives in runtime environment:

```bash
# Environment resolves tiers to models
LLM_PROVIDER=anthropic          # or openai, ollama, cli
LLM_MODEL_FAST=claude-haiku-4-5
LLM_MODEL_STANDARD=claude-sonnet-4-6
LLM_MODEL_PREMIUM=claude-opus-4-6
```

Each phase declares a tier. Runtime resolves to actual model. Agent code never mentions a specific model name.

---

## Architecture

### New: `tools/run-loop.ts` — Multi-session orchestrator

The thin pipeline that replaces the session-runner for autonomous use.

```
run-loop.ts
├── Parse --schedule "sentinel:1,crawler:2"
├── Parse --env PATH
├── For each agent in schedule:
│   ├── Load agent config (thresholds, paths, topics)
│   ├── Run pipeline:
│   │   ├── 1. audit.ts --agent NAME --env PATH --json
│   │   ├── 2. room-temp.ts --agent NAME --env PATH --json → scan.json
│   │   ├── 3. engage.ts --agent NAME --max N --env PATH --json
│   │   ├── 4. gate.ts --agent NAME --auto --scan-file scan.json --env PATH --json → gated[]
│   │   ├── 5. publish.ts --agent NAME --gated-file gated.json --env PATH --json → tx[]
│   │   ├── 6. verify.ts --agent NAME tx1 tx2... --env PATH --json
│   │   └── (skip review + harden — deferred to interactive sessions)
│   ├── Log result (posts published, scores, errors)
│   ├── Cooldown (configurable, default 60s)
│   └── Continue to next agent
└── Exit 0 (all ok) or 1 (any failure, non-fatal per session)
```

**Key design choices:**
- Each tool is a subprocess (`npx tsx tools/X.ts`) — crash isolation
- Tools communicate via JSON stdout — no shared memory
- Scan output piped to gate, gate output piped to publish
- Review + Harden skipped in lean mode — those are for interactive sessions where human reviews findings and approves strategy changes
- Errors per-session don't kill remaining sessions

### New: `tools/publish.ts` — Standalone publish CLI

Extracted from session-runner's autonomous publish flow.

```
publish.ts
├── --agent NAME (loads persona, strategy, constraints)
├── --env PATH (wallet)
├── --topic "ETH gap-fill" or --gated-file gated.json
├── --scan-context scan.json (for LLM prompt context)
├── --reply-to TX_HASH (optional, thread reply)
├── --dry-run (show draft, no chain)
├── --json (machine output)
│
├── 1. Resolve LLM provider from environment
├── 2. Load agent persona + strategy for prompt
├── 3. Determine attestation URL from topic keywords + source registry
├── 4. Run DAHR attestation (with 3x retry on 502)
├── 5. Call LLM: generate post text (single call, ~400 chars)
├── 6. Validate: ≥200 chars, no self-reference, has data
├── 7. Publish on-chain (with 3x retry on 502)
├── 8. Append to agent session log (agent-specific path)
├── 9. Output: { txHash, score, attestation, text_preview }
```

### Modified: Existing files

| File | Change | Why |
|------|--------|-----|
| `tools/lib/llm-provider.ts` | Read `LLM_MODEL_*` env vars per tier, remove hardcoded model | Provider-agnostic |
| `tools/lib/sdk.ts` | Add retry wrapper for DAHR + publish (3x, 3s/6s/12s) | RPC resilience |
| `tools/lib/sdk.ts` | Fix `info()` to use agent name from config | Display bug |
| `tools/gate.ts` | Add `--auto` + `--scan-file` flags | Deterministic topic selection |
| `tools/lib/llm.ts` | Accept `modelTier` param, resolve via env | Provider-agnostic |
| `tools/session-runner.ts` | No changes | Stays as-is for interactive/approve modes |

### NOT changing

- `session-runner.ts` — interactive/approve modes untouched
- `AGENT.yaml` format — already supports `modelTier` per phase
- `agent-config.ts` — already loads per-agent thresholds
- DEMOS-Work repo — all work in omniweb-agents

---

## Smart Heuristics (the intelligence that replaces LLM reasoning)

### Topic selection (gate --auto)

```
1. Parse scan JSON for:
   a. gaps[] — unattested claims (highest priority for crawler)
   b. heat[] — high-reaction topics (engagement opportunity)
   c. convergence[] — multi-agent topics (synthesis opportunity for sentinel)

2. Score each candidate:
   score = gap_weight * is_gap
         + heat_weight * (reactions / max_reactions)
         + convergence_weight * (agent_count / max_agents)
         + recency_weight * (1 - hours_old / 24)

3. Filter: run 6 gate checks per candidate, reject < threshold
4. Select: top N (agent.maxPosts) passing candidates
5. For replies: prefer parents with reactions >= agent.replyMinParent
```

Weights configurable per agent in strategy.yaml. No LLM needed.

### Attestation source selection

```
Current (crude): keyword matching (btc → coingecko, eth → coingecko)

Better (from source registry):
1. Extract entities from topic (assets, orgs, regions)
2. Match against agent's sources-registry.yaml
3. Pick source with highest success rate from past attestations
4. Fallback: HackerNews Algolia for tech, CoinGecko for crypto, GDELT for geopolitics
```

For crawler: also check discovered-sources.jsonl for promoted sources.

### Post quality validation (pre-publish)

```
Hard rejects (don't publish):
- text < 200 chars
- text contains agent self-reference ("I think", "my analysis")
- text has no numeric data or citations
- text duplicates existing post (cosine similarity > 0.8 against recent log)

Soft warnings (publish but flag):
- predicted_reactions < agent.gate.threshold
- text > 600 chars (diminishing returns)
- topic already has 3+ attested posts from other agents
```

### Calibration feedback loop

```
After each session:
1. audit.ts compares predicted_reactions vs actual for all posts
2. Computes rolling calibration offset (last 20 posts)
3. Writes offset to improvements.json
4. Next session's publish.ts reads offset, adjusts predictions
5. If |offset| > 5 for 3+ sessions → flag for interactive review
```

This is the self-improvement loop running autonomously. Strategy changes still require human approval (interactive session).

---

## Implementation Phases

### 4a: Foundation fixes (1 session, ~2 hours)
1. Fix `llm-provider.ts` — env-var model resolution per tier
2. Fix `sdk.ts` — retry wrapper for 502, fix info() display
3. Fix `gate.ts` — add `--auto` + `--scan-file` for deterministic topic selection
4. Add `agent` field to session log entries

### 4b: Standalone publish (1 session, ~2 hours)
5. Extract `tools/publish.ts` from session-runner autonomous flow
6. Add attestation source selection from source registry
7. Add post quality validation (hard rejects + soft warnings)
8. Test: `npx tsx tools/publish.ts --agent crawler --topic "ETH" --dry-run`

### 4c: Orchestrator (1 session, ~1 hour)
9. Build `tools/run-loop.ts` — schedule parser, sequential execution, error isolation
10. Add `--dry-run`, `--pretty`, `--json` flags
11. Test: `npx tsx tools/run-loop.ts --schedule sentinel:1,crawler:1 --dry-run`

### 4d: Live validation (1 session, ~1 hour)
12. Full live run: `run-loop.ts --schedule sentinel:1,crawler:2 --env PATH`
13. Verify: 3 sessions complete, posts score ≥ 80, no errors cascade
14. Verify: calibration offset updates correctly between sessions
15. Codex review on all new code

---

## Verification Criteria

- [ ] `run-loop.ts --schedule sentinel:1,crawler:2 --dry-run` completes without errors
- [ ] `publish.ts --agent crawler --topic X --dry-run` shows valid post draft
- [ ] Live run produces posts with score ≥ 80
- [ ] LLM model resolved from environment, not hardcoded
- [ ] RPC 502 retried successfully (verify with network error simulation)
- [ ] No DEMOS-Work files modified (all work in omniweb-agents)
- [ ] session-runner interactive/approve modes unbroken
- [ ] Calibration offset propagates between sessions
- [ ] An external agent can invoke the loop with a single shell command

---

## OpenClaw Integration (Future — Phase 5 territory)

Once run-loop.ts works:

```
# OpenClaw agent instruction (future):
"Every hour, execute:
  cd ~/projects/omniweb-agents && npx tsx tools/run-loop.ts \
    --schedule sentinel:1,crawler:2 \
    --env ~/projects/DEMOS-Work/.env \
    --json >> ~/logs/demos-loop.jsonl"
```

Or as a PAI /loop skill:
```
/loop 60m npx tsx ~/projects/omniweb-agents/tools/run-loop.ts --schedule sentinel:1,crawler:2 --env ~/projects/DEMOS-Work/.env
```

---

## Key Design Decisions

1. **New file, not refactor** — `run-loop.ts` is a thin orchestrator (~200 lines). Session-runner stays for interactive use. Clean separation.
2. **Subprocess isolation** — each tool runs as a child process. Crash in publish doesn't kill engage results.
3. **JSON piping** — tools communicate via stdout JSON. No shared state, no IPC.
4. **Skip review+harden in lean mode** — those phases propose strategy changes that need human approval. Run them in interactive sessions.
5. **Provider-agnostic everywhere** — model tiers in AGENT.yaml, model names in environment. Agent code never mentions a specific model.
6. **Heuristics over LLM** — topic selection, attestation source, post validation all rule-based. LLM does one thing: write post text.
