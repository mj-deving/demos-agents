# omniweb-toolkit — AGENTS.md

Nearest-file agent guidance for work inside `packages/omniweb-toolkit/`.

This file does not replace the root [AGENTS.md](../AGENTS.md). Read the root file first for repo-wide workflow, Beads usage, PR discipline, and merge/worktree rules. Use this file for package-local authority, commands, and doc routing.

## Package Authority

For files under `packages/omniweb-toolkit/`, this package is the public-surface authority.

- The package docs and shipped references define what the package exposes.
- If downstream repo docs disagree with the package, the package wins.
- Repo-only research under `docs/research/` is not shipped package truth.

## Read Order For Package Work

After reading the root `CLAUDE.md` and root `AGENTS.md`:

1. read [SKILL.md](./SKILL.md) for package activation and routing
2. read [TOOLKIT.md](./TOOLKIT.md) for compact package orientation
3. read the specific package references relevant to the files you are changing
4. use [GUIDE.md](./GUIDE.md) only when the task is about agent methodology or behavior, not basic API shape

## Primary References

Load only what matches the task:

- [references/response-shapes.md](./references/response-shapes.md) for exact fields and return contracts
- [references/toolkit-guardrails.md](./references/toolkit-guardrails.md) for package-specific safety constraints
- [references/platform-surface.md](./references/platform-surface.md) when package behavior, official docs, and live behavior may differ
- [references/live-endpoints.md](./references/live-endpoints.md) for audited live routes beyond the smaller core surface
- [references/categories.md](./references/categories.md) for category selection and drift
- [references/discovery-and-manifests.md](./references/discovery-and-manifests.md) for discovery, manifests, and A2A distinctions
- [references/capabilities-guide.md](./references/capabilities-guide.md) for broader surface inventory
- [references/interaction-patterns.md](./references/interaction-patterns.md) for streaming, reply, and reconnect behavior
- [references/scoring-and-leaderboard.md](./references/scoring-and-leaderboard.md) for scores and leaderboard semantics

## Package Commands

Run the smallest relevant check first, then broader package checks when justified.

From repo root:

- `npm --prefix packages/omniweb-toolkit run build`
- `npm --prefix packages/omniweb-toolkit run check:package`
- `npm --prefix packages/omniweb-toolkit run check:evals`
- `npm --prefix packages/omniweb-toolkit run check:release`
- `npm --prefix packages/omniweb-toolkit run check:live`
- `npm --prefix packages/omniweb-toolkit run check:live:detailed`

Common focused checks from repo root:

- `npx tsc --noEmit`
- `npx vitest run tests/packages/omniweb-toolkit.test.ts`
- targeted `vitest` files for the primitive or wrapper being changed

## Package Rules

- Keep the package as the source of truth for its own public API and examples.
- Update package docs and checks in the same PR when package behavior changes.
- Prefer package-local references over duplicating guidance in repo-level docs.
- Do not claim platform-wide truth when the behavior is only a package guardrail or default.
- Preserve host-agnostic naming in public APIs and exports; deployment names like `scdev` are not package surface.
- Treat live endpoint behavior as drift-prone. Re-verify unstable claims before re-exposing removed or questionable routes.

## Package Scope Boundaries

- `SKILL.md` is the activation router, not the full manual.
- `TOOLKIT.md` is compact onboarding.
- `GUIDE.md` is methodology and behavior.
- `references/` holds detailed package truth.
- `scripts/` and `evals/` are the deterministic validation layer.

If you find yourself copying large package guidance into repo-level docs, stop and link to the package source instead.
