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

- `check:package` — 31 self-audit checks + trajectory spec + eval assertions (deterministic, offline)
- `check:evals` — trajectory spec validation + example coverage + eval assertions
- `check:release` — `npm pack --dry-run` tarball contents: required files, forbidden files, export targets
- `check:live` — shell-curl smoke test (endpoints, discovery, categories)
- `check:live:detailed` — TypeScript probes: discovery drift, endpoint surface, categories, response shapes (14 endpoints)

## Documentation

**The package is the single source of truth.** Everything in `docs/` is downstream.

| Location | Authority | What |
|----------|-----------|------|
| `AGENTS.md` | **Workflow** | Current beads, branch, PR, worktree, and merge policy for coding agents. |
| `packages/omniweb-toolkit/` | **Primary** | SKILL.md (activation router), GUIDE.md (methodology), 12 references/, evals/, 11 scripts/, 3 playbooks/, 4 asset templates. Codex-authored. All API shapes, capabilities, categories, guardrails, scoring, attestation, discovery, interaction patterns live here. |
| `docs/decisions/` | **Unique** | 18 ADRs — repo-level architectural constraints. `Status: accepted` = active. |
| `docs/ROADMAP.md` | **Unique** | Phase 21: live strategy testing. Open work items and beads. |
| `docs/INDEX.md` | **Unique** | Project history (Phases 1-20). |
| `.ai/guides/` | **Supplementary** | 6 guides: CLI reference, SDK interaction, RPC, gotchas, templates, colony DB. |
| `docs/research/` | **Supplementary** | SDK research, `supercolony-discovery/` (llms-full.txt, openapi.json, A2A card). |
| `docs/primitives/` | **Redundant** | 15 domain docs — fully superseded by package `references/`. Retire when convenient. |
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
- **Agent workflow** — Codex and Claude share beads as the live task ledger. Claim a bead, sync from `main`, create one scoped branch, make one coherent change, run the smallest meaningful validation, and open one PR.
- **PR-first delivery** — PRs are the normal merge unit and audit trail, not a request for manual human review. Prefer protected `main`, green CI, and auto-merge over direct pushes to `main`.
- **Parallel agents** — Use separate worktrees. If two tasks would touch the same files heavily, serialize them instead of racing.
- Commit messages: clear "why", prefixed by area. kebab-case files.
- Every session ends with commit + push.
