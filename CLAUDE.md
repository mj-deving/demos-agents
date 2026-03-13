# CLAUDE.md — demos-agents

## What This Is

Private agent toolkit for the Demos Network / SuperColony ecosystem. Contains agent definitions, CLI tools, skills, and the self-improving session loop. **This is the canonical repo for all active tooling** — DEMOS-Work is now archive-only (research/reports).

**Owner:** Marius
**GitHub:** [mj-deving/demos-agents](https://github.com/mj-deving/demos-agents) (private)
**Created:** 2026-03-07
**License:** Apache-2.0

## Tech Stack

- **Runtime:** Node.js + tsx (demosdk incompatible with Bun — NAPI crash)
- **SDK:** `@kynesyslabs/demosdk` v2.11.0 (import `/websdk` subpath directly)
- **Config:** YAML (persona, strategy, agent definitions)
- **LLM:** Provider-agnostic via `tools/lib/llm-provider.ts` (Claude CLI, OpenAI API, Codex CLI adapters)

## Conventions

- Commit messages: clear "why", prefixed by area when helpful
- Every session should end with a commit capturing the work done
- Code comments: thorough — document interfaces and logic
- File naming: kebab-case
- **Plan files:** `Plans/<descriptive-kebab-case-name>.md` (gitignored — reference copies from DEMOS-Work)
- **Zero-tolerance errors:** Every error encountered during the agent loop MUST be (1) fixed immediately, (2) saved to MEMORY.md as a learning, (3) proposed as an update to relevant files, and (4) Codex review requested on the fix
- **Credential path:** `~/.config/demos/credentials` (XDG, mode 600). Legacy `.env` fallback still works. Explicit `--env` flag always overrides.

## Project Structure

```
demos-agents/
├── CLAUDE.md                          # This file — project context
├── README.md                          # Public-facing docs
├── agents/
│   ├── sentinel/                      # General-purpose verification agent
│   │   ├── AGENT.yaml                 # Identity, capabilities, constraints
│   │   ├── persona.yaml               # Config: topics, engagement rules, gate thresholds
│   │   ├── persona.md                 # Voice, tone, post guidelines
│   │   ├── strategy.yaml              # Self-improving loop config
│   │   └── sources-registry.yaml      # 50+ data sources
│   ├── crawler/                       # Deep research agent (100+ sources)
│   │   ├── persona.yaml               # Config (higher engagement limits)
│   │   └── ...
│   └── pioneer/                       # Novel content originator (signal-gated)
│       ├── AGENT.yaml                 # Catalyst identity, thesis-question pattern
│       ├── persona.yaml               # Config: signal threshold, novelty check
│       ├── persona.md                 # Voice, framing guidelines
│       ├── strategy.yaml              # Signal-scored loop config
│       └── sources-registry.yaml      # 17 external sources
├── tools/
│   ├── session-runner.ts              # Full 8-phase loop orchestrator
│   ├── audit.ts                       # AUDIT phase — score/prediction calibration
│   ├── room-temp.ts                   # SCAN phase — market + feed analysis
│   ├── engage.ts                      # ENGAGE phase — reactions
│   ├── gate.ts                        # GATE phase — publish decision (6 criteria)
│   ├── verify.ts                      # VERIFY phase — post-publish confirmation
│   ├── session-report.ts              # Session history viewer
│   ├── session-review.ts              # REVIEW phase template
│   ├── improvements.ts                # Improvement tracker (CRUD lifecycle)
│   ├── improve.ts                     # On-demand observation processor (Phase 1)
│   ├── generate-profile.ts            # Agent profile generator
│   └── lib/
│       ├── sdk.ts                     # Wallet connection, API calls, 502 retry
│       ├── auth.ts                    # Challenge-response auth, token cache (namespaced)
│       ├── agent-config.ts            # Multi-agent config loader from persona.yaml
│       ├── extensions.ts              # Extension dispatcher — typed hook system for v2 loop
│       ├── llm.ts                     # LLM generation interface
│       ├── llm-provider.ts            # Provider-agnostic adapters (Claude/OpenAI/CLI)
│       ├── feed-filter.ts             # Quality filter + topic/agent index (pure utility)
│       ├── observe.ts                 # Observation logger (JSONL, append-only, zero-overhead)
│       ├── publish-pipeline.ts        # DAHR/TLSN attestation + HIVE publish
│       ├── tlsn-playwright-bridge.ts  # TLSN Playwright WASM bridge (production)
│       ├── tlsn-node-bridge.ts        # TLSN Node.js bridge (experimental)
│       ├── attestation-policy.ts      # Source selection + TLSN safety checks
│       ├── state.ts                   # Session state persistence
│       ├── subprocess.ts              # Tool subprocess runner
│       ├── log.ts                     # Session log (JSONL, append-only)
│       ├── review-findings.ts         # Codex review findings persistence
│       └── sources/
│           ├── index.ts               # Runtime barrel re-export
│           └── catalog.ts             # Source catalog — V2 records, index, agent views
├── skills/
│   └── supercolony/
│       ├── SKILL.md                   # Agent Skills standard skill definition
│       ├── scripts/
│       │   ├── supercolony.ts         # Full CLI (auth, post, feed, search, react, etc.)
│       │   └── react-to-posts.ts      # Standalone reaction script
│       └── references/                # API docs, playbook, procedures
├── strategies/
│   └── base-loop.yaml                 # Base OBSERVE → ACT → VERIFY → LEARN
├── Plans/                             # Gitignored — reference copies from DEMOS-Work
├── profiles/                          # Generated agent profiles
└── docs/                              # Architecture docs
```

## CLI Quick Reference

All tools accept `--agent NAME` (default: sentinel), `--env PATH`, `--pretty`, `--json`.

```bash
# Run full session loop
npx tsx tools/session-runner.ts --agent sentinel --pretty
# Flags: --oversight full|approve|autonomous, --resume, --skip-to PHASE, --dry-run

# Individual tools
npx tsx tools/audit.ts --agent sentinel --pretty
npx tsx tools/room-temp.ts --agent sentinel --pretty  # scan modes from persona.yaml
# Scan modes: --mode lightweight,since-last,topic-search,category-filtered,quality-indexed
# Extra flags: --topics LIST, --categories LIST, --since UNIX_MS
npx tsx tools/engage.ts --agent sentinel --max 5 --pretty
npx tsx tools/gate.ts --agent sentinel --topic "topic" --pretty
npx tsx tools/verify.ts --agent sentinel --pretty
npx tsx tools/session-report.ts --list --agent sentinel
npx tsx tools/improvements.ts list --agent sentinel

# Improve skill (on-demand observation processor)
npx tsx tools/improve.ts --agent sentinel --pretty
# Flags: --since N, --unresolved, --trace OBS_ID, --auto-apply, --dry-run

# SuperColony CLI
npx tsx skills/supercolony/scripts/supercolony.ts auth
npx tsx skills/supercolony/scripts/supercolony.ts post --cat ANALYSIS --text "..." --confidence 80
npx tsx skills/supercolony/scripts/supercolony.ts feed --limit 20 --pretty
npx tsx skills/supercolony/scripts/supercolony.ts leaderboard --limit 10 --pretty
```

## Key Gotchas

### Network & Connectivity (CRITICAL)

- **`curl` CANNOT reach `supercolony.ai`** — TLS handshake fails from VPN IP. Node.js `fetch()` and the SDK work fine. **NEVER use curl/WebFetch to test SuperColony — use the SDK or test suite.**
- **RPC nodes:** `demosnode.discus.sh` (primary), `node2.demos.sh` (backup). `rpc.demos.sh` has no DNS.
- **Faucet:** `faucetbackend.demos.sh` for programmatic DEM requests.

### SDK & Publishing

- DAHR `startProxy()` is the COMPLETE operation — no `stopProxy()`. Official spec is wrong.
- GitHub public API works for DAHR (no auth needed). Also: CoinGecko, DefiLlama, HackerNews, PyPI, arXiv, Wikipedia.
- txHash is in CONFIRM response (`validity.response.data.transaction.hash`), NOT broadcast response.
- SuperColony indexer stalls periodically — publish one post first, verify in feed, then batch.
- Feed pagination works. SSE streaming intermittent.
- **Feed API shape:** `apiCall("/api/feed?limit=50", token)` returns an **object** — extract posts with fallback chain. Data in `payload`: `payload.text`, `payload.tags`, `payload.assets`, `payload.sourceAttestations`. Timestamp is Unix ms number, NOT ISO string.
- **API field names:** `reactions.agree` (singular), NOT `reactions.agrees`.
- **On-chain reading:** `getTransactionHistory(address)` returns full HIVE posts (base64 → decode). Works per-address. `getBlocks()` does NOT return full TX payloads.
- **`npx tsx -e` escapes `!` characters** — write inline scripts to a .ts file instead.

### Credentials

- **Primary:** `~/.config/demos/credentials` (XDG, mode 600)
- **Legacy fallback:** `.env` file with `DEMOS_MNEMONIC="..."`
- **Override:** `--env PATH` flag on any tool (always takes priority)
- **Agent name validation:** `^[a-z0-9-]+$` — no path separators allowed
- **Auth cache:** `~/.supercolony-auth.json` (mode 600, namespaced by address)
- **isidore agent:** address `0x6a11...554b`, mnemonic in credentials file

### Scoring

- **Formula (verified n=34):** Base(20) + Attestation(40) + Confidence(10) + LongText(10) + EngagementT1(10, ≥5rx) + EngagementT2(10, ≥15rx) = max 100
- **Category is IRRELEVANT** — all categories score identically
- Score 80 = base + attestation. Score 90 = +5rx. Score 100 = +15rx.
- Reply threads outperform top-level: 13.4 vs 9.8rx. TLSN outperforms DAHR: 12.4 vs 9.0rx.
- **Optimal:** TLSN reply to high-engagement parent with contrarian framing → 100

### TLSN

- **Notary URL:** Demos node returns `ws://` — must convert to `http://` for `Prover.notarize()`. maxRecvData capped at 16384 (16KB).
- **HN Algolia TLSN:** always use `hitsPerPage=2` — responses with 5+ hits exceed 16KB and crash WASM prover.
- TLSN runs in Web Worker (Playwright bridge). `TLSNotaryService` runs in Node.js.
- **Notary ports (7047, 55001, 55002)** on node2.demos.sh are OPEN. Full pipeline: token → MPC-TLS (50-120s) → proof generation → storage. Cost: ~12 DEM per attestation.
- **Timeouts:** Playwright evaluate 180s, Node bridge notarize 180s, page default 180s. MPC-TLS empirically 50-120s, proof generation adds 30-60s more. Previous 120s timeout was too tight.
- **Timing breakdown (Node bridge):** WASM init 30s, session negotiate 30s, prover setup 45s, attested request 90s, transcript 30s, notarize/proof 180s, presentation 30s.
- **Proof sizes:** 8.7KB (simple API) to 34.1KB (large response). Storage fee: 1 + ceil(proofSizeKB) DEM.
- **TLSN vs DAHR performance:** TLSN avg 12.4rx (score 96), DAHR avg 9.0rx (score 90). TLSN outperforms by +38% reactions.

### LLM Provider

- Provider-agnostic via `llm-provider.ts` — single `complete(prompt, options)` method
- Adapters: Claude CLI (subprocess), OpenAI API, CLI command (`LLM_CLI_COMMAND`)
- Resolution: `LLM_PROVIDER` env → `LLM_CLI_COMMAND` env → auto-detect from API keys
- **PAI Inference Tool:** `bun Tools/Inference.ts fast|standard|smart` for direct AI calls

### Source Registry

- **Current:** 170+ sources across 3 agents (sentinel 50+, crawler 100+, pioneer 17), static YAML, O(n) scan
- **Dynamic discovery:** `source-discovery.ts` generates candidate URLs, fetches, scores content relevance (threshold 40/100), auto-persists to registry
- **Gate pre-check:** `runGateAutonomous()` verifies source availability (static + dynamic) before running gate checks
- **Content matching:** keyword overlap + title-level verification + data density scoring
- **Planned v2:** Global JSON catalog with inverted index, provider adapters, standalone testing CLI, post-generation content matching. See `Plans/source-registry-v2.md`
- **Provider adapters planned:** HN Algolia, CoinGecko, Binance, Kraken, DefiLlama, GitHub, arXiv, Wikipedia, World Bank, PubMed (Tier 1, no auth)

## Current State

- **Three agents:** sentinel (verification, 50+ sources) + crawler (deep research, 100+ sources) + pioneer (novel content, signal-gated, 17 sources)
- **45+ on-chain posts** across all agents. PQC identity bound (tx: `5bbdab08...`)
- **TLSN pipeline:** operational (Playwright bridge, 180s timeout). Attestation quality guard rejects non-2xx/auth errors.
- **Scan architecture:** multi-mode (lightweight, since-last, topic-search, category-filtered, quality-indexed). Quality floor 70, attestation-aware. Feed rate ~182 posts/hr.
- **Feed search limitation:** `/api/feed/search?text=` only searches post body text, not tags. Topic-search uses triple strategy: asset search + text search + broad feed tag matching.
- **Session counter:** `~/.sentinel-improvements.json` / `~/.pioneer-improvements.json` `nextSession` field
- **Observation logging:** `tools/lib/observe.ts` — append-only JSONL to `~/.{agent}/observations.jsonl`. Typed failure codes (EngageFailureCode, GateFailureCode, PublishFailureCode). Zero-overhead, sync append, silent-fail.
- **Publish preflight:** `preflight()` in `attestation-policy.ts` — checks source availability before LLM generation. Wired into both `runPublishAutonomous()` and `runGateAutonomous()`.
- **Phase budgets:** Warn-only phase deadlines in session-runner.ts. Defaults: audit 2m, scan 3m, engage/gate 5m, publish 15m, verify 2m, review/harden 2-3m. Configurable via `phaseBudgets` in strategy.yaml.

## Session Workflow

1. Read this file on session start
2. Do the work
3. Commit with a descriptive message
4. Push to GitHub

## Relationship to Other Repos

| Repo | Purpose | Status |
|------|---------|--------|
| **demos-agents** (this) | All active tooling, agent definitions, skills | Active |
| [DEMOS-Work](https://github.com/mj-deving/DEMOS-Work) | Research, reports, archived scripts | Archive-only |
| [my-agent-skills](https://github.com/mj-deving/my-agent-skills) | Personal skill library (SuperColony v4.0) | Active |
