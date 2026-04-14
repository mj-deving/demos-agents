# omniweb-agents

OmniWeb toolkit for the Demos Network — the full stack, not just SuperColony. Consumer package: `omniweb-toolkit`. Handles real DEM tokens on mainnet.

**Architecture (ADR-0021):** `connect()` returns `OmniWeb` with 6 domains: `omni.colony` (SuperColony social), `omni.identity` (linking + lookup), `omni.escrow` (trustless tipping), `omni.storage` (on-chain databases), `omni.ipfs` (file storage), `omni.chain` (core ops). See `packages/supercolony-toolkit/src/colony.ts`.

**North star:** `supercolony-agent-starter` + `supercolony.ai/llms-full.txt`. Our toolkit layers typed primitives + guardrails on top of the official API. Don't duplicate what supercolony.ai provides — reference it, layer on it.

## Build & Run

- `npm test` — vitest, all changes must include tests
- `npx tsc --noEmit` — must pass with zero errors
- `npx tsx cli/session-runner.ts --agent sentinel --pretty` — run V3 loop
- Runtime: Node.js + tsx (Bun causes NAPI crash with demosdk)

## Documentation

All docs have `read_when` frontmatter — auto-indexed at session start. **Read the relevant doc before working in any area.**

| Location | What |
|----------|------|
| `docs/research/` | **Authoritative** SDK + API references. `supercolony-discovery/` has llms-full.txt, openapi.json, A2A card. |
| `docs/design-consumer-toolkit.md` | **Active design spec** — consumer toolkit architecture, Phase 20 plan |
| `docs/decisions/` | 18 ADRs — `Status: accepted` = **active constraints** (ADR-0021 = OmniWeb domain architecture) |
| `docs/primitives/` | 14 domain docs + README index with live API response examples |
| `docs/rules/` | Behavioral rules (7 project, 8 global at `~/.claude/PAI/RULES/`) |
| `.ai/guides/` | 6 guides: CLI reference, SDK interaction (15 rules), RPC reference, gotchas, agent templates, colony DB |
| `docs/` | INDEX (history), ROADMAP (open work), architecture, structure |

## Principles

**API-first for reads, chain-first for writes** (ADR-0018). SuperColony reads prefer API (faster, enriched). Chain SDK is always-available fallback. Writes (publish, transfer, attest, escrow) stay on-chain. OmniWeb domains beyond colony (identity, escrow, storage, ipfs, chain) use SDK/RPC directly.

**Security-first.** Multi-source verification, no silent failures on payment paths, atomic rollback, security tests before implementation.

**SDK compliance.** Lookup: `docs/research/` → SDK MCP → codebase. Every write uses `executeChainTx()` (store→confirm→broadcast). No `as any`. See `.ai/guides/sdk-interaction-guidelines.md`.

**Toolkit vs strategy.** Mechanism = `src/toolkit/`. Policy = `src/lib/`. Mixed = split. Enforced by `tests/architecture/boundary.test.ts`. See `docs/architecture-plumbing-vs-strategy.md`.

## Conventions

- **TDD** — tests before implementation, committed together
- **Fix ALL review findings** — Fabric, `/simplify`, Codex. Zero skips without user approval.
- Commit messages: clear "why", prefixed by area. kebab-case files.
- Every session ends with commit + push.
