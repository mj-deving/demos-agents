# CLAUDE.md — demos-agents

## What This Is

Agent toolkit for the Demos Network / SuperColony ecosystem. Agent definitions, CLI tools, skills, and the self-improving session loop. **Canonical repo for all active tooling** — DEMOS-Work is archive-only.

**Owner:** Marius | **GitHub:** [mj-deving/demos-agents](https://github.com/mj-deving/demos-agents) | **License:** Apache-2.0

## Tech Stack

- **Runtime:** Node.js + tsx (demosdk incompatible with Bun — NAPI crash)
- **SDK:** `@kynesyslabs/demosdk` v2.11.5 (import `/websdk` subpath directly; also has `/d402`, `/storage`, `/tlsnotary/service`)
- **Config:** YAML (persona, strategy, agent definitions)
- **LLM:** Provider-agnostic via `src/lib/llm/llm-provider.ts`. See `.ai/guides/gotchas-detail.md` for resolution order.
- **TypeScript:** 6.0.2 (target ES2025, strict, zero `tsc --noEmit` errors)
- **Testing:** vitest (`npm test`). 2237 tests across 171 suites. All code changes must include tests.
- **Credential path:** `~/.config/demos/credentials` (XDG, mode 600). See `.ai/guides/gotchas-detail.md` for per-agent and overrides.

## Project Structure

See `docs/project-structure.md` for the full tree. Key boundaries:
- **`src/toolkit/`** — Framework-agnostic toolkit (~80 files). Core: 10 tools, 6 guards, `DemosSession`, `FileStateStore`, SDK bridge, SSRF validator, Zod schemas. Expanded: `sources/` (catalog, fetch, health, rate-limit), `providers/` (declarative-engine, types, generic), `reactive/` (EventLoop\<TAction\>, watermark-store), `chain/` (tx-pipeline, asset-helpers), `math/` (baseline), `network/` (fetch-with-timeout, storage-client), `supercolony/` (scoring), `util/` (errors). Barrel: `src/toolkit/index.ts`. Sub-path exports: `@demos-agents/core/supercolony/scoring`. See `docs/architecture-plumbing-vs-strategy.md` for full classification.
- **`src/`** — Core types + business logic. `src/lib/` has 8 subdirs (auth/, llm/, attestation/, scoring/, sources/, network/, pipeline/, util/) + flat files. Many src/lib/ modules now delegate to toolkit via `@deprecated` re-export shims (see ADR-0002). `src/reactive/` (shims to toolkit/reactive/), `src/actions/` (executor, publish pipeline using ChainTxPipeline), `src/plugins/` (22 plugins).
- **`cli/`** — CLI entry points. Three loop modes: `session-runner.ts` with V3 default (3-phase strategy loop), `--legacy-loop` for V2, and `event-runner.ts` (long-lived, reactive). V3 modules: `v3-loop.ts` (orchestrator), `v3-strategy-bridge.ts` (sense/plan/perf), `publish-executor.ts` (PUBLISH/REPLY attestation pipeline), `action-executor.ts` (ENGAGE/TIP).
- **`platform/`** — SuperColony-specific barrel. **`connectors/`** — SDK isolation. **`config/`** — Source catalog + strategies.

## CLI Quick Reference

See `.ai/guides/cli-reference.md` for the full command list.
Key: `npx tsx cli/session-runner.ts --agent sentinel --pretty` (cron), `npx tsx cli/event-runner.ts --agent sentinel` (reactive).

## Architecture Principles (NON-NEGOTIABLE)

### On-Chain First
Every toolkit operation MUST interact with the blockchain via SDK/RPC — never depend on web APIs or DNS. The SuperColony web API is optional enrichment, never a primary dependency. If it can't be done on-chain, it doesn't belong in the toolkit yet. The node and SDK are ALWAYS the source of truth. When unsure about SDK capabilities, always look up documentation via the Demos MCP servers (`demosdk_references`).

### Security-First — Real Money
This toolkit handles real DEM tokens on mainnet. Every code change touching tokens, funds, or chain operations requires: multi-source verification for fund routing, no silent failures on payment paths, atomic reservations with rollback, and security tests BEFORE implementation. A single compromised RPC node must not be able to redirect funds.

### SDK Contract Compliance (MANDATORY)
**Every Demos node ships with a native MCP server. The SDK MCP (`demosdk_references`) is the authoritative source for all SDK interactions — consult it FIRST, not codebase comments or `.ai/guides/`.**

When designing, planning, or modifying ANY code that interacts with the Demos SDK:
1. **Query MCP first** (`search_docs`, `get_page`, `list_modules`) — not the codebase. Our guides may contain stale assumptions. MCP has the SDK source docs.
2. **Check if the SDK already provides what you're building.** The SDK is designed for agent use — don't reinvent capabilities it already offers.
3. **Verify parameter semantics via MCP**, not by guessing from parameter names. SDK naming can be deceptive (e.g., `getTransactions(start)` — `start` is a tx index, not a block number).

Key rules:
- Every write transaction MUST use `executeChainTx()` from `src/toolkit/chain/tx-pipeline.ts` — enforces store→confirm→broadcast. Never hand-roll the 3-step pattern.
- Never use `as any` on SDK calls.
- `RawTransaction` (from `getTransactions`) has `content: string` + `id: number` (global tx index). `Transaction` (from `getTransactionHistory`, `getTxByHash`) has `content: TransactionContent` (parsed object).
- `getTransactions(start)` — `start` is a **tx index** (1-based), NOT a block number. Use `id` field for pagination, not `blockNumber`.

### Code Placement (WHERE new code goes)
New code must go in the right directory. The classification rule from ADR-0002: a module is **toolkit** if it's a mechanism (how something works), **strategy** if it's a policy (what to do, with what weights). When mixed, split mechanism into toolkit and parameterize the policy.

| Code type | Where it goes | Examples |
|-----------|--------------|----------|
| Reusable chain/SDK primitives | `src/toolkit/` | Tools, guards, codec, state, chain ops |
| Type definitions used by toolkit | `src/toolkit/types.ts` | ToolResult, ScanPost, PublishDraft |
| Source pipeline infrastructure | `src/toolkit/sources/` | Catalog, fetch, health, rate-limit |
| Sentinel-specific strategy | `src/lib/` | Scoring heuristics, engage logic, predictions |
| CLI entry points (thin wrappers) | `cli/` | Session runner, event runner, scripts |
| CLI core logic (reusable algorithm) | `src/toolkit/` | Backfill pagination, query helpers |
| Lifecycle hooks | `src/plugins/` | Plugins that observe/modify session state |
| Agent definitions | `agents/{name}/` | AGENT.yaml, sources-registry |

**Enforced by:** `tests/architecture/boundary.test.ts` — runs on every `npm test`. Fails if toolkit imports from strategy code.

### Architecture Enforcement (THREE LAYERS — ADR-0014)
1. **Automated boundary test** (`tests/architecture/boundary.test.ts`) — Fails CI if `src/toolkit/` has runtime imports from `src/lib/`, `src/plugins/`, `src/actions/`, or `cli/`. Also validates deprecated shims only re-export from toolkit. Runs on every `npm test`.
2. **Code placement rule** (this section above) — Decision tree for where new code goes. Guides every session.
3. **ADR auto-discovery in /simplify** — When `/simplify` reviews code changes, it scans `docs/decisions/` for all ADRs with `Status: accepted` and checks the diff against their rules. New ADRs automatically join the review scope — no hardcoded references needed.

## Key Gotchas

### Network (CRITICAL)
- **`curl` CANNOT reach `supercolony.ai`** — NXDOMAIN since 2026-03-26. **NEVER use curl/WebFetch — use SDK or test suite.**
- **RPC nodes:** `demosnode.discus.sh` (primary), `node2.demos.sh` (backup).
- **Chain-first migration: COMPLETE.** Toolkit AND all CLI tools (audit, scan-feed, engage, gate, verify) are 100% chain-only. All 8 session phases work without API. `ensureAuth()` returns null when API is unreachable. No CLI tool requires API auth.
- **SDK bridge methods:** `verifyTransaction`, `getHivePosts`, `resolvePostAuthor`, `publishHiveReaction`, `getHivePostsByAuthor`, `getHiveReactionsByAuthor`, `getRepliesTo`.

### SDK & Publishing
- DAHR `startProxy()` is the COMPLETE operation — no `stopProxy()`.
- txHash is in CONFIRM response (`validity.response.data.transaction.hash`), NOT broadcast.
- **Feed API shape:** returns an **object** — extract posts with `parseFeedPosts()` from `tools/feed-parser.ts`. **Note:** Feed API is optional enrichment — toolkit should work chain-only.
- **`npx tsx -e` escapes `!` characters** — write inline scripts to a .ts file instead.

### Write Rate Limits
- **Self-imposed limits (chain has none):** 14 posts/day, 5 posts/hour. **Reactive:** 4/day, 2/hour.
- **Session timeout:** 180s hard kill. Phase budgets: 30s each, publish 120s.
- **Tipping:** 1-10 DEM, max 5 tips/post/agent, 1-min cooldown. `dryRun: true` default.

### More Gotchas
See `.ai/guides/gotchas-detail.md` for: credentials, scoring, quality gate, TLSN, source matching, LLM provider.

### Architecture Decision Records
Significant architectural decisions documented in `docs/decisions/` (14 ADRs, with gaps at 0003/0010/0011 — deleted, per ADR convention). **All ADRs with `Status: accepted` are active constraints** — check before proposing changes to established patterns. Key ADRs: ADR-0001 (chain-first), ADR-0002 (toolkit vs strategy boundary + composable primitives), ADR-0007 (security-first), ADR-0013 (planned gray-zone splits), ADR-0014 (architecture enforcement layers), ADR-0015 (V3 loop architecture), ADR-0017 (colony DB local mirror — no ORM, disposable cache, numbered migrations). When running `/simplify`, scan `docs/decisions/*.md` for accepted ADRs and verify the diff doesn't violate them. New ADRs automatically join this scope by convention — no manual wiring needed. See `.ai/guides/sdk-rpc-reference.md` for SDK chain query methods. See `docs/architecture-plumbing-vs-strategy.md` for the full plumbing/strategy classification.

## Conventions

- Commit messages: clear "why", prefixed by area. File naming: kebab-case.
- **TDD:** tests before implementation, both committed together.
- **Test quality enforcement:** vitest globalSetup + PostToolUse hook reject assertion-free tests.
- Every session ends with a commit + push.

### Review Findings Policy (NON-NEGOTIABLE)

**Fix ALL findings from every review** — Fabric, Codex, `/simplify`, or manual. Zero findings may be skipped, triaged as "won't fix", or deferred without explicit user approval. If a finding seems inapplicable, fix it anyway or ask the user first. "Domain doesn't need it" and "premature optimization" are not valid reasons to skip — the reviewer flagged it, so fix it.

### Development Workflow

See `.ai/guides/dev-workflow.md` for the full tiered pipeline (Surgical/Standard/Complex).
Key: TDD + npm test + `/simplify` + Fabric `summarize_git_diff` on every commit. Fabric `review_code` on Tier 2+.

## Relationship to Other Repos

| Repo | Purpose | Status |
|------|---------|--------|
| **demos-agents** (this) | All active tooling, agent definitions, skills | Active |
| [DEMOS-Work](https://github.com/mj-deving/DEMOS-Work) | Research, reports, archived scripts | Archive-only |
| [my-agent-skills](https://github.com/mj-deving/my-agent-skills) | Personal skill library (SuperColony v4.0) | Active |
