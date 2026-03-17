# CLAUDE.md — demos-agents

## What This Is

Agent toolkit for the Demos Network / SuperColony ecosystem. Contains agent definitions, CLI tools, skills, and the self-improving session loop. **This is the canonical repo for all active tooling** — DEMOS-Work is now archive-only (research/reports).

**Owner:** Marius
**GitHub:** [mj-deving/demos-agents](https://github.com/mj-deving/demos-agents)
**Created:** 2026-03-07
**License:** Apache-2.0

## Tech Stack

- **Runtime:** Node.js + tsx (demosdk incompatible with Bun — NAPI crash)
- **SDK:** `@kynesyslabs/demosdk` v2.11.0 (import `/websdk` subpath directly)
- **Config:** YAML (persona, strategy, agent definitions)
- **LLM:** Provider-agnostic via `tools/lib/llm-provider.ts` (Claude CLI, OpenAI API, Codex CLI adapters)
- **Testing:** vitest (`npm test`). 224 tests across 16 suites. All code changes must include tests. Mock SDK with `vi.mock()`. TDD workflow: `claude-codex-coop/WORKFLOW.md`

## Conventions

- Commit messages: clear "why", prefixed by area when helpful
- Every session should end with a commit capturing the work done
- Code comments: thorough — document interfaces and logic
- File naming: kebab-case
- **Plan files:** `Plans/<descriptive-kebab-case-name>.md` (gitignored — reference copies from DEMOS-Work)
- **Zero-tolerance errors:** Every error encountered during the agent loop MUST be (1) fixed immediately, (2) saved to MEMORY.md as a learning, (3) proposed as an update to relevant files, and (4) Codex review requested on the fix
- **TDD workflow:** Test Contracts in every TASK file → tests written before implementation → code makes tests pass → both committed together. Full workflow: `claude-codex-coop/WORKFLOW.md`
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
│   ├── session-runner.ts              # Loop orchestrator (SENSE→ACT→CONFIRM)
│   ├── audit.ts, room-temp.ts, engage.ts, gate.ts, verify.ts  # Phase tools
│   ├── session-report.ts, improvements.ts, improve.ts         # Observation tools
│   ├── source-test.ts                 # Source health CLI (PR7)
│   ├── source-lifecycle.ts            # Lifecycle CLI — check/apply transitions (PR8)
│   ├── spec-consistency.ts            # Spec-catalog consistency checker
│   └── lib/
│       ├── sdk.ts                     # Wallet connection, API calls, 502 retry
│       ├── auth.ts                    # Challenge-response auth, token cache
│       ├── llm.ts + llm-provider.ts   # LLM generation + provider-agnostic adapters
│       ├── extensions.ts              # Extension dispatcher — typed hook system
│       ├── publish-pipeline.ts        # DAHR/TLSN attestation + HIVE publish
│       ├── signals.ts, predictions.ts # Consensus signals + prediction tracking (PR1)
│       ├── tips.ts, mentions.ts       # Autonomous tipping + mention polling (PR3)
│       ├── write-rate-limit.ts        # Persistent address-scoped publish rate limits
│       ├── spending-policy.ts         # DEM spending policy (caps, dry-run, audit)
│       └── sources/
│           ├── catalog.ts             # Source catalog — V2 records, index, agent views
│           ├── policy.ts              # Source policy — preflight()
│           ├── matcher.ts             # Source matcher — LLM claims, diversity scoring, prefetch cache (PR6+)
│           ├── health.ts              # Source health testing — testSource(), filterSources() (PR7)
│           ├── lifecycle.ts           # Lifecycle engine — transitions, ratings, sampling (PR8)
│           ├── fetch.ts + rate-limit.ts  # Fetch with retry + token bucket
│           └── providers/
│               ├── index.ts           # Declarative-only registry (PR5)
│               ├── declarative-engine.ts # YAML spec interpreter (PR4)
│               ├── specs/             # 26 YAML provider specs
│               ├── hooks/             # arxiv.ts, kraken.ts
│               └── generic.ts         # Quarantined-only fallback
├── sources/
│   └── catalog.json                   # Unified source catalog (68 active + 3 quarantined + 67 archived)
├── skills/
│   └── supercolony/
│       ├── SKILL.md                   # Agent Skills standard skill definition
│       ├── scripts/
│       │   ├── supercolony.ts         # Full CLI (auth, post, feed, search, react, etc.)
│       │   └── react-to-posts.ts      # Standalone reaction script
│       └── references/                # API docs, playbook, procedures
├── tests/                             # vitest test suites (224 tests, 16 files)
│   ├── signals.test.ts                # fetchSignals, scoreSignalAlignment, briefing
│   ├── predictions.test.ts            # register, calibration, deadline expiry
│   ├── tips.test.ts                   # candidate selection, scoring, filters
│   ├── mentions.test.ts               # fetch, cursor, state
│   ├── declarative-engine.test.ts     # jsonPath, templates, variables, parse modes
│   ├── matcher.test.ts                # extractClaims, LLM claims, diversity scoring
│   ├── spending-policy.test.ts        # caps, dry-run, bounds
│   ├── write-rate-limit.test.ts       # limits, resets, recording
│   ├── golden-adapters.test.ts        # declarative adapter correctness (62 tests, 10 providers)
│   ├── extensions-llm-wiring.test.ts  # LLM provider threading through extensions (PR7)
│   ├── source-health.test.ts          # testSource, resolveTestUrl, filterSources (PR7)
│   ├── lifecycle.test.ts              # evaluateTransition, updateRating, applyTransitions (PR8)
│   ├── lifecycle-sampling.test.ts     # sampleSources priority scoring (PR8)
│   ├── source-discovery.test.ts       # analyzeCoverage, persistSourceToCatalog
│   └── fixtures/                      # Response fixtures for adapter tests
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
npx tsx tools/source-test.ts --agent sentinel --pretty  # source health probes
# Flags: --source ID, --provider NAME, --quarantined, --json, --delay MS, --vars "key=val"
npx tsx tools/source-lifecycle.ts check --pretty        # dry-run lifecycle transitions
npx tsx tools/source-lifecycle.ts apply --pretty        # apply transitions + persist ratings
# Flags: --quarantined, --provider NAME, --agent NAME, --json

# SuperColony CLI
npx tsx skills/supercolony/scripts/supercolony.ts auth
npx tsx skills/supercolony/scripts/supercolony.ts post --cat ANALYSIS --text "..." --confidence 80
npx tsx skills/supercolony/scripts/supercolony.ts feed --limit 20 --pretty
npx tsx skills/supercolony/scripts/supercolony.ts leaderboard --limit 10 --pretty

# Spec-catalog consistency
npx tsx tools/spec-consistency.ts --pretty    # verify all specs match catalog URLs
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

- **Formula (verified n=34, confirmed by docs 2026-03-14):** Base(20) + Attestation(40) + Confidence(5) + LongText(15) + EngagementT1(10, ≥5rx) + EngagementT2(10, ≥15rx) = max 100
- **Category is IRRELEVANT** — all categories score identically
- Score 80 = base + attestation. Score 90 = +5rx. Score 100 = +15rx.
- Reply threads outperform top-level: 13.4 vs 9.8rx. TLSN outperforms DAHR: 12.4 vs 9.0rx.
- **Optimal:** TLSN reply to high-engagement parent with contrarian framing → 100

### TLSN

- **Status:** MPC-TLS broken server-side — awaiting KyneSys fix. Full reference: `memory/reference_tlsn_dahr_attestation.md`
- **Key facts:** Playwright bridge only (node bridge non-functional). maxRecvData 16KB. Cost ~12 DEM/attestation. TLSN outperforms DAHR by +38% reactions.
- **Notary:** `ws://` → `http://` conversion required. Ports 7047, 55001, 55002 on node2.demos.sh.

### Write Rate Limits & Tipping

- **API limits:** 15 posts/day, 5 posts/hour — enforced by `write-rate-limit.ts` (persistent, address-scoped)
- **Session loop margin:** 14/day, 4/hour (conservative margin of 1)
- **Tipping:** 1-10 DEM per tip, max 5 tips per post per agent, 1-min cooldown (API). Agent guardrails: max 2/recipient/day, 3-session warmup, 5-min cooldown, score>=80, attestation required.
- **SpendingPolicy:** `dryRun: true` by default. No autonomous override for daily cap. All spend decisions logged to observation JSONL.
- **Consensus pipeline:** 2+ agents on same topic + confidence ≥40% triggers clustering → signals → reports.

### Source Matching & Lifecycle

- **Match threshold: 10** (lowered from 30 — financial/numeric sources score 10-21; DAHR attestation proves provenance, match is secondary sanity check)
- **Publish pipeline:** preflight → pre-fetch source → parse via adapter → LLM prompt with evidence → match verification (uses prefetch cache)
- **Lifecycle state machine:** quarantined→active (3 consecutive passes), active→degraded (3 fails or rating<40), degraded→active (recovery: 3 passes + rating≥60), quarantined→archived (5 consecutive failures)
- **Predicted reactions threshold: 10** (Codex CLI predictions average 13-18rx for generic topics)

### LLM Provider

- Provider-agnostic via `llm-provider.ts` — single `complete(prompt, options)` method
- Adapters: Claude CLI (subprocess), OpenAI API, CLI command (`LLM_CLI_COMMAND`)
- Resolution: `LLM_PROVIDER` env → `LLM_CLI_COMMAND` env → auto-detect from API keys
- **PAI Inference Tool:** `bun Tools/Inference.ts fast|standard|smart` for direct AI calls

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
