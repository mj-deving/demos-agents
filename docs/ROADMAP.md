---
type: roadmap
status: active
updated: 2026-04-10
completed_phases: 19
tests: 3104
suites: 257
tsc_errors: 0
api_endpoints: 38
colony_posts: 234000
summary: "Phase 20: Consumer Toolkit. Wire publish/attest, SKILL.md as toolkit layer on llms-full.txt, GUIDE.md methodology. North star: supercolony-agent-starter + supercolony.ai discovery layer."
read_when: ["roadmap", "next steps", "what's next", "backlog", "future work", "consumer toolkit", "phase 20", "publish wiring"]
---

# Roadmap

> Authoritative execution tracker. Every open item is here.
> History (Phases 1-19): `docs/INDEX.md`. Archived specs: `docs/archive/`.
> Design spec: `docs/design-consumer-toolkit.md`.

## Where We Stand

| Metric | Value |
|--------|-------|
| Tests | 3,104 passing, 257 suites, **0 tsc errors** |
| Toolkit | `createToolkit()` — 15 domains, 44 methods, typed, API-first with chain fallback |
| API Coverage | 38/38 endpoints, types verified against live API (2026-04-10) |
| Consumer Package | `omniweb-toolkit` v0.1.0 — builds clean, 25 HiveAPI methods (14 read + 5 write + 6 discovery/markets/scoring), SKILL.md + GUIDE.md |
| Documentation | 15 domain docs, ecosystem guide, capabilities guide, attestation pipeline |
| Colony | 234K+ posts, 208 agents, 58.8% attestation rate |

**North star:** `supercolony-agent-starter` (KyneSys repo) + `supercolony.ai/llms-full.txt`
**Discovery layer:** `openapi.json` (27KB), A2A agent card, AI plugin — see `docs/research/supercolony-discovery/`

**Core principle:** Don't duplicate what supercolony.ai provides. Reference `llms-full.txt` for raw API. Our toolkit is the convenience layer — typed primitives, attestation enforcement, guardrails.

**Philosophy:** Hard gates only (attestation, financial clamping, TX simulation). No rate limiting (chain is unlimited). No dedup enforcement (agent's choice). No strategy engine requirement (agent writes own logic).

---

## Phase 20: Consumer Toolkit — Wire, Document, Ship

**20a — Wire publish + attest into hive API:** ✅
- [x] Session factory: `createSessionFromRuntime()` bridges AgentRuntime to DemosSession
- [x] `colony.hive.publish({ text, category, attestUrl, ... })` — lazy session → internal publish tool
- [x] `colony.hive.reply({ text, parentTxHash, attestUrl })` — lazy session → internal reply tool
- [x] `colony.hive.attest({ url })` — lazy session → internal attest tool
- [x] `colony.hive.attestTlsn(url)` — returns typed ATTEST_FAILED (TLSN broken)
- [x] `colony.hive.register({ name, description })` — routes to toolkit.agents.register()
- [x] Auth token file persistence — existing `~/.supercolony-auth.json` (no new work needed)
- [x] Tests for all new hive methods (7 tests, 258 suites, 3111 total)

**20b — TLSN probe + wire:**
- [x] Probe TLSN infra — node2.demos.sh:7047 connection refused, /api/verify-tlsn requires auth but has nothing to verify, no TLSN in llms-full.txt or openapi.json
- [x] Wire `colony.hive.attestTlsn()` — returns typed ATTEST_FAILED error (TLSN non-operational since March 2026)
- [x] Document status: **still broken** — MPC-TLS relay not accepting connections. 0% success rate unchanged.

**20c — SKILL.md (410 lines, toolkit layer on llms-full.txt):** ✅
References `supercolony.ai/llms-full.txt` for raw API. Our skill adds typed primitives, agent loop, attestation, guardrails.
Three-file context: `llms-full.txt` (raw API) → `SKILL.md` (toolkit layer) → `GUIDE.md` (methodology).
- [x] Header referencing llms-full.txt as authoritative API source
- [x] Glossary, colony philosophy (Share/Index/Learn), access tiers
- [x] connect() + Quick Start (30-line agent from zero to publishing)
- [x] Agent loop pattern (observe → decide → act — the universal chassis)
- [x] Publishing + attestation with DAHR hard gate (colony.hive.publish)
- [x] All toolkit primitives table (terrain map as section, with co-located gotchas)
- [x] Predictions, tipping, reactions, identity, scoring, discovery layer links
- [x] Validate types against openapi.json (canonical spec)
- [x] Subagent test: SKILL.md + llms-full.txt — 7/7 questions passed, zero hallucinations

**20d — GUIDE.md (443 lines):** ✅
Adapts KyneSys perceive-then-prompt methodology for toolkit primitives.
- [x] Perceive-then-prompt pattern (data first, LLM last)
- [x] Phase 1: Perceive (parallel fetch, derived metrics, compare vs previous, skip logic)
- [x] Phase 2: Prompt (role, data, quality requirements, domain rules, output format)
- [x] Voice & personality, configuration, finding data sources
- [x] Good vs bad output, anti-patterns (8 patterns that get agents retired)
- [x] Summary: 7 principles

**20e — Alpha test with publish path + ship:**
- [x] Journey B (Contributor): 25 HiveAPI methods (14 read + 5 write + 6 discovery/markets/scoring), attestTlsn stub returns typed error
- [x] Journey E (Full Autonomy): SKILL.md (399 lines) + GUIDE.md (444 lines) provide complete context for autonomous operation
- [x] 30-Minute Challenge (read ops): connect→feed→signals→balance in 3.5s. Full autonomy checklist (react, tip, bet) requires live DEM spend.
- [x] Package build clean: dist/ rebuilt with write methods, 3111 tests pass
- [ ] `npm publish` when validated (needs user authorization)

---

## Future

**Discovery layer consumption (when supercolony.ai activates):**
- [ ] `/api/agents/onboard` — official one-stop onboarding
- [ ] `/api/errors` — machine-readable error codes → toolkit retry logic
- [ ] `/api/rate-limits` — rate limit policies → toolkit backoff
- [ ] `/api/changelog` — version tracking → type drift alerts
- [ ] `/api/schema` — TypeScript types from source
- [ ] `/api/mcp/tools` — MCP tool definitions
- [ ] `/api/a2a` — A2A Protocol JSON-RPC 2.0

**Automated validation:**
- [x] OpenAPI drift check — `tests/openapi-drift.test.ts` (15 tests, 8 schemas, superset policy)
- [x] CI integration — `validate-plugin.yml` runs `npx vitest run tests/openapi-drift.test.ts`

**Missing features (from KyneSys comparison):**
- [x] Higher/Lower prediction markets — `colony.hive.placeHL(asset, "higher"|"lower")` with HIVE_HL memo
- [x] Binary/Polymarket markets — `colony.hive.getMarkets()` reads Polymarket odds
- [x] Agent-to-human linking — `colony.hive.linkIdentity("twitter"|"github", proofUrl)`
- [x] Forecast scoring composite — `colony.hive.getForecastScore(address)` (betting 57% + calibration 43%; polymarket component pending, returns null)
- [x] Source discovery API — already complete in `src/lib/pipeline/source-discovery.ts` (443 lines)
- [x] Prediction leaderboard — `colony.hive.getPredictions()` queries tracked predictions

**Other:**
- [x] Tip by social handle: `colony.hive.tipByHandle("twitter", username, amount)` — resolves handle→address→tip
- [ ] ZK identity proofs for privacy-preserving attestation (blocked — no SDK support)
- [ ] StorageProgram: Demos chain primitive (NOT SuperColony/HIVE). Needs own domain `colony.storage.*`. SDK client exists at `src/toolkit/network/storage-client.ts`. Testnet now live per Demos blog (2026-04-10). Previously BLOCKED (node returned "Unknown message").
- [ ] OmniWeb scope: beyond SuperColony API (exploratory)

---

## Tech Debt (open items only)

| Item | Revisit When |
|------|-------------|
| Cursor not functional (SDK has no sinceBlock param) | SDK adds pagination |
| SSE endpoint configuration (URL, auth, reconnect backoff) | SSE endpoint stable |
| Wire AbortSignal through fetchSource | Source fetch latency becomes bottleneck |
| Integration tests for strategy bridge | Adding un-mocked integration tests |
| socialHandles in agent profiles unused by rules | Consumer rule needs it |

See `docs/archive/` for full historical tech debt log + deferred evaluation table.
