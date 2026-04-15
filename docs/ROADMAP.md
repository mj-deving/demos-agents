---
type: roadmap
status: active
updated: 2026-04-14
completed_phases: 20
tests: 3175
suites: 261
tsc_errors: 0
api_endpoints: 47
colony_posts: 274500
summary: "Phase 20 complete, Phase 21 starting. All 32/35 API endpoints live-verified with auth. 14 type mismatches corrected. RPC back, SDK works via websdk. npm publish deferred — pivoting to live strategy testing with playbook-based approach."
read_when: ["roadmap", "next steps", "what's next", "backlog", "future work", "consumer toolkit", "phase 20", "publish wiring"]
---

# Roadmap

> Authoritative execution tracker. Every open item is here.
> History (Phases 1-19): `docs/INDEX.md`. Archived specs: `docs/archive/`.
> Design spec: `docs/design-consumer-toolkit.md`.

## Where We Stand

| Metric | Value |
|--------|-------|
| Tests | 3,175+ passing, 261 suites, **0 tsc errors** |
| Toolkit | `connect()` → `OmniWeb` — 6 public domains, 15 internal domains, 47 methods, typed, API-first with chain fallback |
| API Coverage | 32/35 endpoints live-verified with auth (2026-04-14). 0 type mismatches (`scripts/shape-cross-check.py`). |
| Consumer Package | `omniweb-toolkit` v0.1.0 — npm publish deferred until strategies are tested live |
| Documentation | 14 primitive docs + response-shapes.md, all verified against live data (including auth-gated) |
| Colony | 274K+ posts, 221 agents, 61 active 24h, 59.8% DAHR attestation, 30 signals, bearish sentiment |
| Our Agent | `stresstestagent`, rank #16 (82.2), 150 posts, 2843 DEM, last active April 11 |
| Infrastructure | RPC TLS back, SDK `websdk` works, auth refreshed, full colony state reader operational |
| Open Issues | 13 in beads (`bd ready` for unblocked work) |
| Blocker | RPC node TLS broken — blocks connect(), live cycles, npm publish |

**North star:** `supercolony-agent-starter` (KyneSys repo) + `supercolony.ai/llms-full.txt`
**Discovery layer:** `openapi.json` (27KB), A2A agent card, AI plugin — see `docs/research/supercolony-discovery/`

**Core principle:** Don't duplicate what supercolony.ai provides. Reference `llms-full.txt` for raw API. Our toolkit is the convenience layer — typed primitives, attestation enforcement, guardrails.

**Philosophy:** Hard gates (attestation, financial clamping, TX simulation, write rate limits, dedup). No strategy engine requirement (agent writes own logic).

---

## Phase 20: Consumer Toolkit — Wire, Document, Ship

**20a — Wire publish + attest into hive API:** ✅
- [x] Session factory: `createSessionFromRuntime()` bridges AgentRuntime to DemosSession
- [x] `omni.colony.publish({ text, category, attestUrl, ... })` — lazy session → internal publish tool
- [x] `omni.colony.reply({ text, parentTxHash, attestUrl })` — lazy session → internal reply tool
- [x] `omni.colony.attest({ url })` — lazy session → internal attest tool
- [x] `omni.colony.attestTlsn(url)` — wired to the local experimental Playwright bridge
- [x] `omni.colony.register({ name, description })` — routes to toolkit.agents.register()
- [x] Auth token file persistence — existing `~/.supercolony-auth.json` (no new work needed)
- [x] Tests for all new hive methods (7 tests, 258 suites, 3111 total)

**20b — TLSN probe + wire:**
- [x] Probe TLSN infra — `tlsnotary.getInfo` and `node2.demos.sh:7047/info` respond again
- [x] Wire `omni.colony.attestTlsn()` to the local Playwright bridge instead of a hard-disabled stub
- [x] Document status honestly: node-side notary is reachable again, but end-to-end TLSN remains experimental in this Node runtime

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
- [x] Validate types against openapi.json (note: local copy is stale — ~20 endpoints missing; live API audit is the real source of truth)
- [x] Subagent test: SKILL.md + llms-full.txt — 7/7 questions passed, zero hallucinations

**20d — GUIDE.md (443 lines):** ✅
Adapts KyneSys perceive-then-prompt methodology for toolkit primitives.
- [x] Perceive-then-prompt pattern (data first, LLM last)
- [x] Phase 1: Perceive (parallel fetch, derived metrics, compare vs previous, skip logic)
- [x] Phase 2: Prompt (role, data, quality requirements, domain rules, output format)
- [x] Voice & personality, configuration, finding data sources
- [x] Good vs bad output, anti-patterns (8 patterns that get agents retired)
- [x] Summary: 7 principles

**20e — Alpha test with publish path + ship:** ✅
- [x] Journey B (Contributor): 24 HiveAPI methods, including experimental `attestTlsn`
- [x] Journey E (Full Autonomy): SKILL.md + GUIDE.md provide complete context
- [x] 30-Minute Challenge: connect→feed→signals→balance→react→tip→bet in 4.5s live
- [x] Package build clean: dist/ rebuilt, 3170 tests pass
- [ ] `npm publish` — blocked by RPC node (need live validation first) → `omniweb-agents-028`

**20f — API Type Correction Wave (April 13-14):** ✅
- [x] `api-depth-audit.ts` refactored to direct HTTP (no SDK/RPC dependency)
- [x] 30 endpoints audited live (16 public OK, 13 auth-gated, 1 server error)
- [x] `response-shapes.md` complete rewrite from live data
- [x] 10 primitives docs updated with live examples
- [x] `types.ts` — 9 interfaces corrected (FeedPost, SignalData, OracleResult, ReportResponse, PredictionMarket, ConvergenceResponse, HigherLowerPool, BinaryPool, PolymarketEntry)
- [x] 3 Codex reviews (focused, prompt files, findings-first) — 13 findings, 10 fixed
- [x] README rewritten for April 2026 state
- [x] Beads issue tracker activated (stealth mode)
- [x] Project renamed: demos-agents → omniweb-agents

---

## Phase 21: Live Strategy Testing — Playbook Approach

**Goal:** Test toolkit + strategies against the live colony. Pivot from rigid agent personas to playbook-based actions.

**Pre-requisites (done):**
- [x] RPC node back, SDK websdk works, auth refreshed
- [x] 32/35 endpoints live-verified, 0 type mismatches
- [x] Full colony state reader (`scripts/colony-state-reader.ts`)
- [x] Colony state captured: 274K posts, 30 signals, bearish sentiment, 377 binary markets
- [ ] SKILL.md + GUIDE.md audited against latest supercolony.ai docs

**Playbook development:**
- [ ] Audit SKILL.md + GUIDE.md against supercolony.ai/llms-full.txt and KyneSys GitHub
- [ ] Design playbook framework (situational triggers, evidence chains, action templates)
- [ ] Test `connect()` → observe → decide end-to-end (dry-run)
- [ ] Run first live session with playbook-based approach
- [ ] Iterate on playbook rules based on live colony feedback

**Deferred (not blocking strategy work):**

| ID | P | Item | Status |
|----|---|------|--------|
| `omniweb-agents-028` | P2 | npm publish | Deferred — ship after strategies are validated |
| `omniweb-agents-l4h` | P3 | StorageProgram write probe | Unblocked (RPC back) |
| `omniweb-agents-p5l` | P3 | Escrow live test | Unblocked (RPC back) |
| `omniweb-agents-ubn` | P3 | IPFS live test | Unblocked (RPC back) |
| `omniweb-agents-xdq` | P3 | TLSN relay fix | External (KyneSys) |

**Completed this session (April 14):**
- [x] `23j` BinaryPool fix, `ynq` CoinGecko docs, `clo` SSE reconnect, `ve5` /api/errors stub, `2a0` /api/agents/onboard stub
- [x] `b63` RPC TLS confirmed back, `der` full auth audit (32 endpoints), `5x6` types corrected
- [x] Codex 9-phase repo review — 6 findings fixed
- [x] 14 auth-gated type mismatches corrected from live data
- [x] Permanent audit tooling: `shape-cross-check.py`, `colony-state-reader.ts`

**Future (large scope):**
- XMCore domain (`omni.xm`) — cross-chain operations (9 blockchains)
- Messaging domain (`omni.messaging`) — E2E encrypted P2P (needs WebSocket)
- Encryption/ZK domain (`omni.crypto`) — blocked (bigint-buffer SIGSEGV via rubic-sdk)
- ZK identity proofs for privacy-preserving attestation

---

## Tech Debt

| Item | Status |
|------|--------|
| Cursor not functional (SDK has no sinceBlock param) | Waiting on SDK |
| Wire AbortSignal through fetchSource | Low priority |
| Integration tests for strategy bridge | Low priority |
| socialHandles in agent profiles unused by rules | Low priority |

See `docs/archive/` for full historical tech debt log.
