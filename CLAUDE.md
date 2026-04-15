# omniweb-agents

OmniWeb toolkit for the Demos Network — the full stack, not just SuperColony. Consumer package: `omniweb-toolkit`. Handles real DEM tokens on mainnet.

**Architecture (ADR-0021):** `connect()` returns `OmniWeb` with 6 domains: `omni.colony` (SuperColony social), `omni.identity` (linking + lookup), `omni.escrow` (trustless tipping), `omni.storage` (on-chain databases), `omni.ipfs` (file storage), `omni.chain` (core ops). See `packages/omniweb-toolkit/src/colony.ts`.

**North star:** `supercolony-agent-starter` + `supercolony.ai/llms-full.txt`. Our toolkit layers typed primitives + guardrails on top of the official API. Don't duplicate what supercolony.ai provides — reference it, layer on it.

## Build & Run

- `npm test` — vitest, all changes must include tests
- `npx tsc --noEmit` — must pass with zero errors
- `npx tsx cli/session-runner.ts --agent sentinel --pretty` — run V3 loop
- Runtime: Node.js + tsx (Bun causes NAPI crash with demosdk)

### Package validation ladder

Run from repo root or with `--prefix packages/omniweb-toolkit`:

- `check:package` — structural self-audit + release-surface audit (deterministic, offline)
- `check:evals` — trajectory spec validation + example coverage + eval assertions
- `check:release` — `npm pack --dry-run` tarball contents: required files, forbidden files, export targets
- `check:live` — shell-curl smoke test (endpoints, discovery, categories)
- `check:live:detailed` — TypeScript probes: discovery drift, endpoint surface, categories, response shapes (14 endpoints)

## Documentation

**The package is the single source of truth.** Everything in `docs/` is downstream.

Every agent must read `AGENTS.md` immediately after reading this file. `CLAUDE.md` defines repo-wide architecture and constraints; `AGENTS.md` defines the execution workflow.

| Location | Authority | What |
|----------|-----------|------|
| `AGENTS.md` | **Workflow** | Required execution workflow: read order, beads usage, PR discipline, merge discipline, and multi-agent coordination. |
| `packages/omniweb-toolkit/` | **Primary** | SKILL.md (activation router), GUIDE.md (methodology), 11 references/, evals/, 11 scripts/, 4 playbooks/, 4 asset templates. Codex-authored. All API shapes, capabilities, categories, guardrails, scoring, attestation, discovery, interaction patterns live here. |
| `docs/decisions/` | **Unique** | 18 ADRs — repo-level architectural constraints. `Status: accepted` = active. |
| `docs/ROADMAP.md` | **Unique** | Phase 21: live strategy testing. Open work items and beads. |
| `docs/INDEX.md` | **Unique** | Project history (Phases 1-20). |
| `.ai/guides/` | **Supplementary** | 6 guides: CLI reference, SDK interaction, RPC, gotchas, templates, colony DB. |
| `docs/research/` | **Supplementary** | SDK research, `supercolony-discovery/` (llms-full.txt, openapi.json, A2A card). |
| `docs/primitives/` | **Redundant** | 15 files including README — fully superseded by package `references/`. Retire when convenient. |
| `docs/design-consumer-toolkit.md` | **Downstream** | Phase 20 design spec — largely delivered in the package. |
| `docs/rules/` | **Supplementary** | 7 project behavioral rules. |

**When in doubt, read the package first.** If `docs/` and the package disagree, the package wins.

## Principles

**API-first for reads, chain-first for writes** (ADR-0018). SuperColony reads prefer API (faster, enriched). Chain SDK is always-available fallback. Writes (publish, transfer, attest, escrow) stay on-chain. OmniWeb domains beyond colony (identity, escrow, storage, ipfs, chain) use SDK/RPC directly.

**Security-first.** Multi-source verification, no silent failures on payment paths, atomic rollback, security tests before implementation.

**SDK compliance.** Lookup: package references/ → `docs/research/` → SDK MCP → codebase. No `as any`. See `.ai/guides/sdk-interaction-guidelines.md`.

**Toolkit vs strategy.** Mechanism = `src/toolkit/`. Policy = `src/lib/`. Mixed = split. Enforced by `tests/architecture/boundary.test.ts`. See `docs/architecture-plumbing-vs-strategy.md`.

**Toolkit is infrastructure, not orchestration.** Consumer experience: `npm install omniweb-toolkit` → import → call primitives. No strategy engine or verification gates required.

## Conventions

- **TDD** — tests before implementation, committed together.
- **Fix ALL review findings** — Fabric, `/simplify`, Codex. Zero skips without user approval.
- **Session start** — read `CLAUDE.md`, then `AGENTS.md`, then package docs, then `bd ready`.
- **Coordination source** — reconstruct state from `main`, open GitHub PRs, beads, and repo docs. Do not depend on manual Codex-to-Claude handoff.
- **Agent workflow** — one bead = one branch = one PR. Use GitHub PRs as the merge unit and beads as the live task ledger.
- **Parallel agents** — use separate worktrees. If two tasks touch the same files heavily, serialize them instead of racing.
- **Beads hygiene** — beads content should be treated as public workflow metadata. Never store secrets, credentials, tokens, or private operational notes in beads.
- Commit messages: clear "why", prefixed by area. kebab-case files.
- Every session ends with commit + push.
