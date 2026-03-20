# CLAUDE.md — demos-agents

## What This Is

Agent toolkit for the Demos Network / SuperColony ecosystem. Agent definitions, CLI tools, skills, and the self-improving session loop. **Canonical repo for all active tooling** — DEMOS-Work is archive-only.

**Owner:** Marius | **GitHub:** [mj-deving/demos-agents](https://github.com/mj-deving/demos-agents) | **License:** Apache-2.0

## Tech Stack

- **Runtime:** Node.js + tsx (demosdk incompatible with Bun — NAPI crash)
- **SDK:** `@kynesyslabs/demosdk` v2.11.4 (import `/websdk` subpath directly)
- **Config:** YAML (persona, strategy, agent definitions)
- **LLM:** Provider-agnostic via `src/lib/llm-provider.ts` (Claude CLI, OpenAI API, OpenAI-compatible, any CLI)
- **Testing:** vitest (`npm test`). 1050 tests across 73 suites. All code changes must include tests.
- **Credential path:** `~/.config/demos/credentials` (XDG, mode 600). Legacy `.env` fallback. `--env` flag overrides.

## Project Structure

See `docs/project-structure.md` for the full tree. Key boundaries:
- **`src/`** — Core types + business logic. `src/types.ts` (FrameworkPlugin, Action, EventPlugin, DataProvider, Evaluator), `src/lib/` (shared utilities), `src/reactive/` (event loop, sources, handlers, watermarks), `src/actions/` (executor, LLM, publish pipeline), `src/plugins/` (plugin factories).
- **`cli/`** — CLI entry points (audit, gate, engage, publish, session-runner, event-runner, etc.)
- **`platform/`** — SuperColony-specific barrel exports.
- **`connectors/`** — SDK isolation (@kynesyslabs/demosdk bridge).
- **`config/`** — Source catalog (`config/sources/catalog.json`) and strategies (`config/strategies/base-loop.yaml`).
- **Two loop modes:** `cli/session-runner.ts` (cron, 8-phase) and `cli/event-runner.ts` (long-lived, reactive).
- **Pipeline docs:** `docs/loop-heuristics.md` — single source of truth for scan→gate→publish, agent differentiation, constitutional rules, source discovery.

## CLI Quick Reference

All tools accept `--agent NAME` (default: sentinel), `--env PATH`, `--pretty`, `--json`.

```bash
# Session loop (cron)
npx tsx cli/session-runner.ts --agent sentinel --pretty
# Flags: --oversight full|approve|autonomous, --resume, --skip-to PHASE, --dry-run

# Event loop (long-lived, reactive)
npx tsx cli/event-runner.ts --agent sentinel [--dry-run] [--pretty]

# Individual tools
npx tsx cli/audit.ts --agent sentinel --pretty
npx tsx cli/scan-feed.ts --agent sentinel --pretty
npx tsx cli/engage.ts --agent sentinel --max 5 --pretty
npx tsx cli/gate.ts --agent sentinel --topic "topic" --pretty
npx tsx cli/verify.ts --agent sentinel --pretty
npx tsx cli/improvements.ts list --agent sentinel
npx tsx cli/improvements.ts cleanup --agent sentinel --pretty  # age-out stale items

# SuperColony CLI
npx tsx skills/supercolony/scripts/supercolony.ts auth
npx tsx skills/supercolony/scripts/supercolony.ts post --cat ANALYSIS --text "..." --confidence 80
npx tsx skills/supercolony/scripts/supercolony.ts feed --limit 20 --pretty

# Identity management
npx tsx cli/identity.ts proof --agent sentinel        # generate Web2 proof payload
npx tsx cli/identity.ts add-twitter --agent sentinel --url <tweet-url>
npx tsx cli/identity.ts list --agent sentinel          # list linked identities

# Feed mining (source discovery from other agents' attestations)
npx tsx cli/feed-mine.ts --agent sentinel --pretty --limit 10000
npx tsx cli/feed-mine.ts --agent sentinel --dry-run --start-offset 10000

# Scheduled runs
bash scripts/scheduled-run.sh                 # all 3 agents + lifecycle
bash scripts/scheduled-run.sh --dry-run       # show what would run
```

## Key Gotchas

### Network & Connectivity (CRITICAL)

- **`curl` CANNOT reach `supercolony.ai`** — TLS handshake fails from VPN IP. **NEVER use curl/WebFetch — use SDK or test suite.**
- **RPC nodes:** `demosnode.discus.sh` (primary), `node2.demos.sh` (backup).

### SDK & Publishing

- DAHR `startProxy()` is the COMPLETE operation — no `stopProxy()`.
- txHash is in CONFIRM response (`validity.response.data.transaction.hash`), NOT broadcast.
- **Feed API shape:** `apiCall("/api/feed?limit=50", token)` returns an **object** — extract posts with fallback chain. `payload.text`, `payload.tags`. Timestamp is Unix ms, NOT ISO string.
- **API field names:** `reactions.agree` (singular), NOT `reactions.agrees`.
- **`npx tsx -e` escapes `!` characters** — write inline scripts to a .ts file instead.

### Credentials

- **Primary:** `~/.config/demos/credentials` (XDG, mode 600)
- **Per-agent:** `~/.config/demos/credentials-{agent}` (checked first, falls back to shared)
- **Config overrides:** `RPC_URL`, `SUPERCOLONY_API`, `DEMOS_ALGORITHM` (falcon|ml-dsa|ed25519), `DEMOS_DUAL_SIGN` (true|false)
- **Auth cache:** `~/.supercolony-auth.json` (mode 600, namespaced by address)

### Scoring

- **Formula:** `src/lib/scoring.ts` with `calculateExpectedScore()` + 16 tests.
- **Category is IRRELEVANT** — all categories score identically.
- Reply threads outperform top-level: 13.4 vs 9.8rx. TLSN outperforms DAHR: 12.4 vs 9.0rx.

### TLSN

- **Status:** MPC-TLS reported working (last tested 2026-03-20 per prior session). Config: `tlsn_preferred` (TLSN first, DAHR fallback).
- **Policy:** TLSN is the gold standard (cryptographic MPC-TLS proof, tamper-proof). Use for sensitive data. DAHR is fast but not cryptographically tamper-proof. `highSensitivityRequireTlsn: true` forces TLSN for sensitive topics (no DAHR fallback). On testnet there's no cost difference, so TLSN-first is the right default. On mainnet, TLSN costs more — `tlsn_preferred` with DAHR fallback is pragmatic.
- Playwright bridge only. maxRecvData 16KB. Cost ~12 DEM/attestation (testnet: free).

### Write Rate Limits & Budget

- **API limits:** 15 posts/day, 5 posts/hour — enforced by `write-rate-limit.ts` (persistent, address-scoped)
- **Cron budget:** 14/day, 4/hour (conservative margin of 1)
- **Reactive budget:** 4/day, 2/hour (separate from cron, event-runner checks before publish/reply)
- **Tipping:** 1-10 DEM per tip, max 5 tips/post/agent, 1-min cooldown. `dryRun: true` default.

### Source Matching & Lifecycle

- **Match threshold: 10** (configurable via `MatchInput.matchThreshold`)
- **Lifecycle:** quarantined→active (3 passes), active→degraded (3 fails or rating<40), degraded→active (3 passes + rating≥60)

### LLM Provider

- Provider-agnostic via `llm-provider.ts` — single `complete(prompt, options)` method
- Resolution: `LLM_PROVIDER` env → `LLM_CLI_COMMAND` env → API keys → CLI autodetect (claude→gemini→ollama→codex)
- `LLM_PROVIDER=openai-compatible` + `OPENAI_BASE_URL` for Gemini/Groq/Mistral/etc.

## Conventions

- Commit messages: clear "why", prefixed by area when helpful
- File naming: kebab-case
- TDD workflow: tests before implementation, both committed together
- Every session ends with a commit + push

## Relationship to Other Repos

| Repo | Purpose | Status |
|------|---------|--------|
| **demos-agents** (this) | All active tooling, agent definitions, skills | Active |
| [DEMOS-Work](https://github.com/mj-deving/DEMOS-Work) | Research, reports, archived scripts | Archive-only |
| [my-agent-skills](https://github.com/mj-deving/my-agent-skills) | Personal skill library (SuperColony v4.0) | Active |
