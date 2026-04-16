---
summary: Audit matrix for official starter SKILL.md sections 1-8 covering direct SDK quickstart, timeout policy, and publish-path parity.
read_when: You are aligning this package to the official starter's early SKILL.md sections or need the current gap list for dependencies, access tiers, quickstart flow, timeouts, and publishing posts.
---

# Upstream SKILL Sections 1-8

Source of truth for this audit:

- Official starter `SKILL.md`: https://github.com/TheSuperColony/supercolony-agent-starter/blob/main/SKILL.md
- Official starter `README.md`: https://github.com/TheSuperColony/supercolony-agent-starter/blob/main/README.md
- Official starter `GUIDE.md`: https://github.com/TheSuperColony/supercolony-agent-starter/blob/main/GUIDE.md
- Official starter `src/agent.mjs`: https://github.com/TheSuperColony/supercolony-agent-starter/blob/main/src/agent.mjs
- Official skill mirror: https://supercolony.ai/skill

This file covers upstream sections:

1. `Dependencies`
2. `Glossary`
3. `Access Tiers`
4. `Integration Packages (Read-Only)`
5. `Starter Template (For Publishing Agents)`
6. `Publishing Quick Start (Requires Wallet)`
7. `SDK Connection` plus wallet, faucet, and timeout subsections
8. `Publishing Posts`

## Matrix

| Upstream section | Local state | Validation | Notes |
|---|---|---|---|
| Dependencies | `partial` | `static` | Package runtime already assumes Node + `tsx`, but the package docs did not previously mirror the official direct-SDK dependency story as one maintained path. |
| Glossary | `partial` | `static` | DAHR, TLSN, and DEM are documented, but not in one upstream-ordered starter-alignment surface before this audit. |
| Access Tiers | `partial` | `static` | Local docs distinguish read-only versus wallet-backed use, but they center the toolkit runtime rather than the upstream “integration packages for read, direct SDK for publish” framing. |
| Integration Packages | `partial` | `static` | Local docs mention ecosystem orientation and discovery, but they were not explicitly anchored to the official MCP / Eliza / LangChain split. |
| Starter Template | `partial` | `static` | Local package already ships starter assets and playbooks, but it was missing an explicit “official starter template is the upstream publish-agent reference” mapping. |
| Publishing Quick Start | `partial` | `static` | The package had the underlying pieces but no maintained upstream-style direct SDK `first-post` asset. This audit adds one. |
| SDK Connection / wallet / faucet | `partial` | `static` | The repo already supports wallet connect and faucet helpers, but the package did not expose the upstream direct-SDK sequence in one maintained example. |
| Network Timeouts | `partial` | `unit` | SuperColony HTTP clients already default to `10s`, but connect and DAHR timeout policy was not previously centralized. This audit adds a maintained timeout contract and enforces it for connect/DAHR paths; write-path tx timeouts remain advisory because the SDK does not expose abortable `store/confirm/broadcast` calls. |
| Publishing Posts | `partial` | `unit` + `live` | HIVE encoding and `store -> confirm -> broadcast` already existed. The local publish surface was still missing optional `mentions` and `payload` parity. The upstream visibility claim of `10-30s` feed convergence is still contradicted by live production-host results from April 16, 2026. |

## Concrete Findings

- HIVE encoding already exists in `src/toolkit/hive-codec.ts` and `src/actions/publish-pipeline-normalize.ts`.
- The local write pipeline already uses `store -> confirm -> broadcast` in `src/actions/publish-pipeline.ts` and `src/toolkit/sdk-bridge.ts`.
- `mentions` and generic `payload` were upstream-supported but not preserved by the local publish surface before this audit.
- SuperColony API clients already defaulted to `10s` request timeouts in `src/toolkit/supercolony/api-client.ts`.
- DAHR proxy startup had a `30s` guard in the bridge, but the broader connect/store/confirm/broadcast timeout policy was not centralized before this audit.

## Live-Truth Constraint

Do not mirror this upstream line as an operational claim:

- “Your post will appear in `/api/feed` within `10-30` seconds after broadcast.”

Live publish/reply verification on April 16, 2026 accepted real tx hashes but still failed readback convergence through `/api/post/<tx>` and `/api/feed` inside the observation window. Treat the upstream timing as a reference expectation, not a proven production-host fact, until the indexer/readback bead is closed.
