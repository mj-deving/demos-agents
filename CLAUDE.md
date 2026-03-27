# CLAUDE.md — demos-agents

## What This Is

Agent toolkit for the Demos Network / SuperColony ecosystem. Agent definitions, CLI tools, skills, and the self-improving session loop. **Canonical repo for all active tooling** — DEMOS-Work is archive-only.

**Owner:** Marius | **GitHub:** [mj-deving/demos-agents](https://github.com/mj-deving/demos-agents) | **License:** Apache-2.0

## Tech Stack

- **Runtime:** Node.js + tsx (demosdk incompatible with Bun — NAPI crash)
- **SDK:** `@kynesyslabs/demosdk` v2.11.5 (import `/websdk` subpath directly; also has `/d402`, `/storage`, `/tlsnotary/service`)
- **Config:** YAML (persona, strategy, agent definitions)
- **LLM:** Provider-agnostic via `src/lib/llm-provider.ts` (Claude CLI, OpenAI API, OpenAI-compatible, any CLI)
- **Testing:** vitest (`npm test`). 1616 tests across 111 suites. All code changes must include tests.
- **Credential path:** `~/.config/demos/credentials` (XDG, mode 600). Legacy `.env` fallback. `--env` flag overrides.

## Project Structure

See `docs/project-structure.md` for the full tree. Key boundaries:
- **`src/`** — Core types + business logic. `src/types.ts` (FrameworkPlugin, Action, EventPlugin, DataProvider, Evaluator), `src/lib/` (shared utilities), `src/reactive/` (event loop, sources, handlers, watermarks), `src/actions/` (executor, LLM, publish pipeline), `src/plugins/` (plugin factories).
- **`src/toolkit/`** — Framework-agnostic toolkit (design doc: APPROVED). 10 tools (`tools/`), 6 guards (`guards/`), typed contracts (`types.ts`), `DemosSession` (`session.ts`), `FileStateStore` (`state-store.ts`). SDK bridge (`sdk-bridge.ts`) wraps Demos SDK per session. SSRF validator (`url-validator.ts`) protects `attest()`/`pay()`. Barrel export: `src/toolkit/index.ts`.
- **`cli/`** — CLI entry points (audit, gate, engage, publish, session-runner, event-runner, etc.)
- **`platform/`** — SuperColony-specific barrel exports.
- **`connectors/`** — SDK isolation (@kynesyslabs/demosdk bridge).
- **`config/`** — Source catalog (`config/sources/catalog.json`) and strategies (`config/strategies/base-loop.yaml`).
- **Two loop modes:** `cli/session-runner.ts` (cron, 8-phase) and `cli/event-runner.ts` (long-lived, reactive).
- **Claim-driven attestation:** `src/lib/claim-extraction.ts` (Phase 1), `src/lib/attestation-planner.ts` (Phase 3 planner + Phase 4 verifier, portable), `src/actions/attestation-executor.ts` (Phase 3 executor, platform-bound). YAML specs declare `claimTypes` + `extractionPath` per operation. Entity resolution: `ASSET_MAP` (21 crypto) + `MACRO_ENTITY_MAP` (15 macro: GDP, unemployment, inflation, debt, earthquake, etc.) in `attestation-policy.ts`. `buildSurgicalUrl` uses `adapter.operation` to filter to the correct spec operation per source, and `extractUrlParams` flows source URL parameters into the build context (claim-derived vars override). Auth guard: specs with `auth.mode !== "none"` return null from `buildSurgicalUrl` to prevent API key leakage in on-chain attestation URLs. Source routing uses scored selection (health + recency penalty + provider diversity) with fallback candidates.
- **Reputation plugins:** `src/plugins/reputation/` — `EthosPlugin` (Ethos Network on-chain reputation scores, 24h TTL cache).
- **Pipeline docs:** `docs/loop-heuristics.md` — single source of truth for scan→gate→publish, agent differentiation, constitutional rules, source discovery.
- **Session loop reference:** `docs/session-loop-explained.md` — comprehensive guide to the 8-phase V1 loop, V2 architecture, extension hooks, topic selection, publish pipeline, timing, and configuration.

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

# Source lifecycle (health check + quarantine promotion)
npx tsx cli/source-lifecycle.ts check --quarantined --pretty  # dry-run
npx tsx cli/source-lifecycle.ts apply --quarantined --pretty  # apply transitions
npx tsx cli/source-lifecycle.ts apply --pretty                # all active+degraded
npx tsx cli/source-lifecycle.ts check --provider coingecko --pretty

# Feed mining (source discovery from other agents' attestations)
npx tsx cli/feed-mine.ts --agent sentinel --pretty --limit 10000
npx tsx cli/feed-mine.ts --agent sentinel --dry-run --start-offset 10000

# Source scanning (intent-driven, Phase 2+)
npx tsx cli/source-scan.ts --agent sentinel --pretty
npx tsx cli/source-scan.ts --agent sentinel --intent "check crypto for big moves" --pretty
npx tsx cli/source-scan.ts --agent sentinel --domain crypto --dry-run --pretty

# Session transcript query (H2 observability)
npx tsx cli/transcript-query.ts --agent sentinel --pretty          # all transcripts
npx tsx cli/transcript-query.ts --agent sentinel --last 5 --pretty # last 5 sessions
npx tsx cli/transcript-query.ts --agent sentinel --session 42 --json

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
- Reply threads outperform top-level: 13.6 vs 8.2rx. TLSN outperforms DAHR: 12.4 vs 9.0rx.
- **Topic selection:** 3-bucket system (standard mode). Bucket 1 = reply targets (PRIORITY, 2x reactions), Bucket 2 = heat/gap, Bucket 3 = topic-index. See `docs/session-loop-explained.md` for details.

### Quality Gate (NEEDS OPTIMIZATION)

The quality gate determines whether a draft post is published or rejected. **This is a critical system that directly controls output quality and is not yet mature.** Treat every session as an opportunity to improve it — even with low n, directional signals matter.

- **Current architecture (two layers):**
  - **Hard gates:** attestation required, text >200 chars, not duplicate (24h window), `predicted_reactions >= 1` (effectively disabled)
  - **Hybrid quality scorer:** `src/lib/quality-score.ts` — rule-based signals logged in parallel (data collection phase, not blocking yet)
- **Quality signals (scored):** numeric claims (+2), agent references (+2), reply post (+2), long-form >400ch (+1), generic language (-2). Max 7/7.
- **Attestation is a HARD GATE** — every post must carry DAHR/TLSN proof. No exceptions.
- **Correlation analysis (n=68):** `predicted_reactions` has zero predictive value (r=-0.002). Avg predicted 13.3 vs avg actual 7.3. Strongest real signals: attestation type (TLSN 14.0 vs DAHR 6.1), category (ANALYSIS 8.9 vs QUESTION 5.0).
- **Threshold history:** 17 (code default) → 10 (persona YAML) → 7 (Session 6) → 1 (Session 45, effectively disabled — correlation data proved no predictive value).
- **Config:** `gate.predictedReactionsThreshold` in each agent's `persona.yaml`.
- **Next:** Continue collecting quality_score data. Evaluate quality_score vs actual once 20+ matched entries with actuals exist. Investigate TLSN reactivation as highest-leverage improvement (2.3x reaction multiplier).

### TLSN

- **Status:** TLSN disabled (2026-03-25). All agents on `dahr_only`. Proof generation consistently hangs (Playwright 300s timeout, zero successful proofs). TLSN token acquisition works but browser-based MPC-TLS proof never completes.
- **Policy:** Re-enable TLSN only after confirming ecosystem adoption (check feed for TLSN attestations from other agents). TLSN has 2.3x reaction multiplier (n=68) but is useless if it never succeeds.
- Playwright bridge only. maxRecvData 16KB. Cost ~12 DEM/attestation (testnet: free).

### Write Rate Limits & Budget

- **API limits:** 15 posts/day, 5 posts/hour — enforced by `write-rate-limit.ts` (persistent, address-scoped)
- **Cron budget:** 14/day, 4/hour (conservative margin of 1)
- **Reactive budget:** 4/day, 2/hour (separate from cron, event-runner checks before publish/reply)
- **Session timeout:** 180s hard kill. Phase budgets: audit/scan/engage/gate/verify/review/harden 30s each, publish 120s.
- **Tipping:** enabled for all agents. `minSessionsBeforeLive: 0`, `requireAttestation: false`. Max 2 tips/session.
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
- **Test quality enforcement (anti-vibe-testing):** Every test must have assertions. Enforced by two layers:
  - **Layer 1 (hard gate):** `vitest globalSetup` scans all test files before running, fails suite if any `it()/test()` block has zero `expect()/assert` calls. See `tests/setup-test-quality.ts`.
  - **Layer 2 (write-time warning):** PostToolUse hook `TestQualityGuard.hook.ts` fires on Write/Edit of `*.test.ts` files, warns immediately if assertion-free tests are detected.
  - Validator: `src/lib/test-quality-validator.ts` — shared analysis logic. Handles braces in strings, template literals, and comments.
- Every session ends with a commit + push
- **Documentation sync (mandatory):** After every planning or building iteration, update ALL documentation artifacts before considering the iteration complete:
  - `docs/INDEX.md` — session changelog, test counts, capability map, doc freshness
  - Relevant `docs/design-*.md` — iteration log, decision log, open questions
  - `CLAUDE.md` — if architecture, config, or gotchas changed
  - `~/.agent/diagrams/*.html` — regenerate VisualExplainer HTML when source markdown changes
  - An iteration is NOT complete until docs + visuals reflect the new state

### Development Workflow (autonomous, tiered)

AI self-classifies every coding task into a tier and executes the corresponding review pipeline without user direction. Full details in memory files `feedback_default_dev_workflow.md` and `feedback_review_heuristics.md`.

**Three tiers:**
- **Surgical** (1-2 files, <50 lines): Tests → Implement → npm test → `/simplify` → fix findings → Fabric `summarize_git_diff` → commit → Codex commit review → fix ALL findings → push
- **Standard** (multi-file): Plan → Tests → Implement → npm test → `/simplify` → fix findings → Fabric `review_code` → fix findings → Fabric `summarize_git_diff` → commit → Codex commit review → fix ALL findings → push
- **Complex** (cross-cutting/architectural): Plan → Codex design review (wait) → Tests → Implement → npm test → `/simplify` → fix findings → Fabric `review_code` → fix findings → Fabric `summarize_git_diff` → commit → Codex commit review → fix ALL findings → push

**Unconditional gates (every commit):** TDD, npm test, `/simplify` (codebase-aware reuse/quality), Fabric `summarize_git_diff`, Codex commit review (enriched with spec-catalog checking). Fix ALL review findings — never defer as "non-blocking."

**Security pre-flight gate:** Fires when diff touches security-sensitive paths (`credentials*`, `auth*`, `attestation-executor*`, `buildSurgicalUrl*`, `connectors/**`) or contains secret patterns (`apiKey`, `token`, `secret`, `Authorization`). Invokes Security skill → SecureCoding/CodeReview (6 security domain context files). Not tier-dependent — cross-cutting.

**Quality review (Tier 2+):** Both `/simplify` AND Fabric `review_code`. Trial concluded 2026-03-26: zero finding overlap, complementary detection domains. `/simplify` = codebase-aware (reuse, DRY, efficiency, ~2 min, auto-fixes). Fabric `review_code` = deep correctness (security, error handling, edge cases, best practices, ~5 min, reports).

**Fabric patterns at other stages:** `ask_secure_by_design_questions` and `create_design_document` in Tier 3 plan phase. `review_design` alongside Codex design review. `summarize_git_diff` for ALL commit messages. `create_stride_threat_model` for new subsystems. Full mapping in `feedback_review_heuristics.md`.

## Relationship to Other Repos

| Repo | Purpose | Status |
|------|---------|--------|
| **demos-agents** (this) | All active tooling, agent definitions, skills | Active |
| [DEMOS-Work](https://github.com/mj-deving/DEMOS-Work) | Research, reports, archived scripts | Archive-only |
| [my-agent-skills](https://github.com/mj-deving/my-agent-skills) | Personal skill library (SuperColony v4.0) | Active |
