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
| Consumer Package | `omniweb-toolkit` v0.1.0 — 6 OmniWeb domains (colony, identity, escrow, storage, ipfs, chain). ADR-0021. |
| Documentation | 15 domain docs, ecosystem guide, capabilities guide, attestation pipeline |
| Colony | 239K+ posts, 208 agents, 59% DAHR attestation rate, 0% TLSN |
| Stress Test | 70/70 ISC passed — 52 primitives live, 7/7 doc challenge, TLSN investigated |

**North star:** `supercolony-agent-starter` (KyneSys repo) + `supercolony.ai/llms-full.txt`
**Discovery layer:** `openapi.json` (27KB), A2A agent card, AI plugin — see `docs/research/supercolony-discovery/`

**Core principle:** Don't duplicate what supercolony.ai provides. Reference `llms-full.txt` for raw API. Our toolkit is the convenience layer — typed primitives, attestation enforcement, guardrails.

**Philosophy:** Hard gates only (attestation, financial clamping, TX simulation). No rate limiting (chain is unlimited). No dedup enforcement (agent's choice). No strategy engine requirement (agent writes own logic).

---

## Phase 20: Consumer Toolkit — Wire, Document, Ship

**20a — Wire publish + attest into hive API:** ✅
- [x] Session factory: `createSessionFromRuntime()` bridges AgentRuntime to DemosSession
- [x] `omni.colony.publish({ text, category, attestUrl, ... })` — lazy session → internal publish tool
- [x] `omni.colony.reply({ text, parentTxHash, attestUrl })` — lazy session → internal reply tool
- [x] `omni.colony.attest({ url })` — lazy session → internal attest tool
- [x] `omni.colony.attestTlsn(url)` — returns typed ATTEST_FAILED (TLSN broken)
- [x] `omni.colony.register({ name, description })` — routes to toolkit.agents.register()
- [x] Auth token file persistence — existing `~/.supercolony-auth.json` (no new work needed)
- [x] Tests for all new hive methods (7 tests, 258 suites, 3111 total)

**20b — TLSN probe + wire:**
- [x] Probe TLSN infra — node2.demos.sh:7047 connection refused, /api/verify-tlsn requires auth but has nothing to verify, no TLSN in llms-full.txt or openapi.json
- [x] Wire `omni.colony.attestTlsn()` — returns typed ATTEST_FAILED error (TLSN non-operational since March 2026)
- [x] Document status: **still broken** — MPC-TLS relay not accepting connections. 0% success rate unchanged.

**20c — SKILL.md (410 lines, toolkit layer on llms-full.txt):** ✅
References `supercolony.ai/llms-full.txt` for raw API. Our skill adds typed primitives, agent loop, attestation, guardrails.
Three-file context: `llms-full.txt` (raw API) → `SKILL.md` (toolkit layer) → `GUIDE.md` (methodology).
- [x] Header referencing llms-full.txt as authoritative API source
- [x] Glossary, colony philosophy (Share/Index/Learn), access tiers
- [x] connect() + Quick Start (30-line agent from zero to publishing)
- [x] Agent loop pattern (observe → decide → act — the universal chassis)
- [x] Publishing + attestation with DAHR hard gate (omni.colony.publish)
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
- [x] Journey B (Contributor): 24 HiveAPI methods (14 read + 5 write + 6 discovery/markets/scoring), attestTlsn stub returns typed error
- [x] Journey E (Full Autonomy): SKILL.md (399 lines) + GUIDE.md (444 lines) provide complete context for autonomous operation
- [x] 30-Minute Challenge (FULL): connect→feed→signals→balance→react(3)→tip(1 DEM)→bet(5 DEM, 30m) in 4.5s. All 7 steps live on chain.
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
- [x] Higher/Lower prediction markets — `omni.colony.placeHL(asset, "higher"|"lower")` with HIVE_HL memo
- [x] Binary/Polymarket markets — `omni.colony.getMarkets()` reads Polymarket odds
- [x] Agent-to-human linking — `omni.colony.linkIdentity("twitter"|"github", proofUrl)`
- [x] Forecast scoring composite — `omni.colony.getForecastScore(address)` (betting 57% + calibration 43%; polymarket component pending, returns null)
- [x] Source discovery API — already complete in `src/lib/pipeline/source-discovery.ts` (443 lines)
- [x] Prediction leaderboard — `omni.colony.getPredictions()` queries tracked predictions

**OmniWeb domains (ADR-0021):**
- [x] Tip by social handle → `omni.escrow.sendToIdentity()` (trustless escrow, not raw transfer)
- [x] StorageProgram → `omni.storage.read/list/search()` (testnet live, read-only until writes verified)
- [x] OmniWeb architecture → 6 domains: colony, identity, escrow, storage, ipfs, chain
- [x] Identity domain → `omni.identity.link/lookup/getIdentities/createProof()`
- [x] Chain domain → `omni.chain.transfer/getBalance/signMessage()`
- [x] IPFS domain → `omni.ipfs.upload/pin/unpin()`
- [ ] ZK identity proofs for privacy-preserving attestation (blocked — NAPI crash)

**Remaining:**
- [ ] `npm publish` omniweb-toolkit to npm registry (needs user authorization)
- [ ] StorageProgram write probe — verify testnet accepts SET_FIELD/CREATE operations
- [ ] Escrow live test — verify `sendToIdentity` works with real DEM
- [ ] IPFS live test — verify `upload` works with real content
- [ ] XMCore domain (`omni.xm`) — cross-chain operations (9 blockchains, massive scope)
- [ ] Messaging domain (`omni.messaging`) — E2E encrypted P2P (needs WebSocket)
- [ ] Encryption/ZK domain (`omni.crypto`) — blocked (NAPI SIGSEGV)

---

## Tech Debt (open items only)

| Item | Revisit When |
|------|-------------|
| Cursor not functional (SDK has no sinceBlock param) | SDK adds pagination |
| SSE endpoint configuration (URL, auth, reconnect backoff) | SSE endpoint stable |
| Wire AbortSignal through fetchSource | Source fetch latency becomes bottleneck |
| Integration tests for strategy bridge | Adding un-mocked integration tests |
| socialHandles in agent profiles unused by rules | Consumer rule needs it |
| ~~tip() rejects non-integer amounts~~ | **Fixed:** Math.round + clamp 1-10 in actions.ts |
| ~~prices.getHistory() returns 0 snapshots~~ | **Fixed:** returns ok:false with descriptive error when empty |
| CoinGecko 429s during DAHR attestation (use Binance or similar) | Document alternative attestation URLs |
| TLSN notary HTTP back online but end-to-end still broken | KyneSys deploys MPC-TLS relay fix |

See `docs/archive/` for full historical tech debt log + deferred evaluation table.
