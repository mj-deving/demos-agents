# CLAUDE.md — demos-agents

## What This Is

Agent toolkit for the Demos Network / SuperColony ecosystem. Agent definitions, CLI tools, skills, and the self-improving session loop. **Canonical repo for all active tooling** — DEMOS-Work is archive-only.

**Owner:** Marius | **GitHub:** [mj-deving/demos-agents](https://github.com/mj-deving/demos-agents) | **License:** Apache-2.0

## Tech Stack

- **Runtime:** Node.js + tsx (demosdk incompatible with Bun — NAPI crash)
- **SDK:** `@kynesyslabs/demosdk` v2.11.5 (import `/websdk` subpath directly; also has `/d402`, `/storage`, `/tlsnotary/service`)
- **Config:** YAML (persona, strategy, agent definitions)
- **LLM:** Provider-agnostic via `src/lib/llm/llm-provider.ts`. See `.ai/guides/gotchas-detail.md` for resolution order.
- **Testing:** vitest (`npm test`). 1899 tests across 128 suites. All code changes must include tests.
- **Credential path:** `~/.config/demos/credentials` (XDG, mode 600). See `.ai/guides/gotchas-detail.md` for per-agent and overrides.

## Project Structure

See `docs/project-structure.md` for the full tree. Key boundaries:
- **`src/toolkit/`** — Framework-agnostic toolkit. 10 tools, 6 guards, typed contracts, `DemosSession`, `FileStateStore`, SDK bridge, SSRF validator, Zod schemas. Barrel: `src/toolkit/index.ts`.
- **`src/`** — Core types + business logic. `src/lib/` restructured into 8 subdirs (auth/, llm/, attestation/, scoring/, sources/, network/, pipeline/, util/) + 14 flat files. `src/reactive/` (event loop), `src/actions/` (executor, publish pipeline), `src/plugins/`.
- **`cli/`** — CLI entry points. Two loop modes: `session-runner.ts` (cron, 8-phase) and `event-runner.ts` (long-lived, reactive).
- **`platform/`** — SuperColony-specific barrel. **`connectors/`** — SDK isolation. **`config/`** — Source catalog + strategies.

## CLI Quick Reference

See `.ai/guides/cli-reference.md` for the full command list.
Key: `npx tsx cli/session-runner.ts --agent sentinel --pretty` (cron), `npx tsx cli/event-runner.ts --agent sentinel` (reactive).

## Key Gotchas

### Network (CRITICAL)
- **`curl` CANNOT reach `supercolony.ai`** — NXDOMAIN since 2026-03-26. **NEVER use curl/WebFetch — use SDK or test suite.**
- **RPC nodes:** `demosnode.discus.sh` (primary), `node2.demos.sh` (backup).
- **Chain-first principle:** No toolkit primitive should depend on web API/DNS. All interactions through blockchain nodes + SDK. See `Plans/chain-first-toolkit-migration.md`.

### SDK & Publishing
- DAHR `startProxy()` is the COMPLETE operation — no `stopProxy()`.
- txHash is in CONFIRM response (`validity.response.data.transaction.hash`), NOT broadcast.
- **Feed API shape:** returns an **object** — extract posts with `parseFeedPosts()` from `tools/feed-parser.ts`. **Note:** Feed API is optional enrichment — toolkit should work chain-only.
- **`npx tsx -e` escapes `!` characters** — write inline scripts to a .ts file instead.

### Write Rate Limits
- **API limits:** 15 posts/day, 5 posts/hour. **Cron budget:** 14/day, 4/hour. **Reactive:** 4/day, 2/hour.
- **Session timeout:** 180s hard kill. Phase budgets: 30s each, publish 120s.
- **Tipping:** 1-10 DEM, max 5 tips/post/agent, 1-min cooldown. `dryRun: true` default.

### More Gotchas
See `.ai/guides/gotchas-detail.md` for: credentials, scoring, quality gate, TLSN, source matching, LLM provider.

## Conventions

- Commit messages: clear "why", prefixed by area. File naming: kebab-case.
- **TDD:** tests before implementation, both committed together.
- **Test quality enforcement:** vitest globalSetup + PostToolUse hook reject assertion-free tests.
- Every session ends with a commit + push.

### Development Workflow

See `.ai/guides/dev-workflow.md` for the full tiered pipeline (Surgical/Standard/Complex).
Key: TDD + npm test + `/simplify` + Fabric `summarize_git_diff` on every commit. Fabric `review_code` on Tier 2+.

## Relationship to Other Repos

| Repo | Purpose | Status |
|------|---------|--------|
| **demos-agents** (this) | All active tooling, agent definitions, skills | Active |
| [DEMOS-Work](https://github.com/mj-deving/DEMOS-Work) | Research, reports, archived scripts | Archive-only |
| [my-agent-skills](https://github.com/mj-deving/my-agent-skills) | Personal skill library (SuperColony v4.0) | Active |
