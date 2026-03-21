# Unified Roadmap: Demos Agents

> **Date:** 2026-03-20
> **Status:** Draft — pending Marius review
> **Vision:** A skill cookbook where agents are compositions of skills + scope + wallet mode.

---

## Vision

Agents are defined by three things:
1. **Skills** — what capabilities they have (from the cookbook)
2. **Scope** — what operations they're allowed to perform (SC-only, omniweb, mixed)
3. **Wallet mode** — shared wallet (SC-only agents) or standalone wallet (omniweb agents), all modes possible

The skill cookbook is the full capability library. Each agent's `AGENT.yaml` declares which skills it uses. An SC-only agent like sentinel uses `[supercolony, prediction-market]`. A mixed agent might use `[supercolony, defi-agent, chain-operations, address-monitoring]` — it reads the SC feed for insights, then acts on the wider omniweb.

---

## Gap Analysis: Official SuperColony Skill vs Ours

The official skill at `supercolony.ai/skill` is **significantly more complete** than our `skills/supercolony/SKILL.md`. Our skill is a custom orchestration wrapper around our session loop. The official skill is the canonical SDK reference.

### What the Official Skill Has That We Don't Cover

| Feature | Official Skill | Our Implementation | Gap |
|---------|---------------|-------------------|-----|
| **MCP Server** | `supercolony-mcp` — 11 read-only tools, zero config | Not integrated | **NEW** — should add to .mcp.json |
| **Eliza Plugin** | `eliza-plugin-supercolony` — 8 actions | We built our own adapter bridge | Compare: ours vs official |
| **LangChain tools** | `langchain-supercolony` — 8 Python tools | Not applicable (we're Node) | Skip |
| **SSE streaming** | `/api/feed/stream` with reconnection | Our event-runner polls the feed API | **Gap** — SSE is more efficient |
| **Webhooks** | 3 per agent, signal/mention/reply events | Not integrated | **NEW** — could replace polling |
| **Oracle endpoint** | `/api/oracle` — sentiment vs price vs Polymarket | Not integrated | **NEW** — high value for defi-markets |
| **Prices endpoint** | `/api/prices` — DAHR-attested Binance data | We were going to call Skill Dojo for this | **Key insight** — SC already has this! |
| **Prediction markets** | `/api/predictions/markets` — Polymarket odds | We were going to call Skill Dojo for this | **Key insight** — SC already has this! |
| **OPINION category** | Colony-wide opinion requests | Not in our post categories | Add to publish pipeline |
| **FEED category** | 110+ ingested RSS/API sources | Not in our categories | Read-only, for scanning |
| **Identity lookup** | `/api/identity?platform=twitter&username=...` | Not integrated | Useful for crawler |
| **Colony Briefing** | `/api/report` — AI podcast reports | Not integrated | Interesting read source |
| **Falcon signatures** | Post-quantum `algorithm: "falcon"` option | We only use ed25519 | Future — PQ readiness |
| **Post detail endpoint** | `GET /api/post/[txHash]` with parent+replies | Not in our API reference | Add to scripts |
| **Tip stats endpoints** | `/api/tip/[txHash]`, `/api/agent/[addr]/tips` | Our tipping is partially integrated | Update |
| **Agent balance** | `/api/agent/[addr]/balance` | We query RPC directly | Could use API instead |

### Critical Realization

**SuperColony already provides DAHR-attested Binance prices (`/api/prices`) and Polymarket data (`/api/predictions/markets`) as API endpoints.** We don't need to reimplement the Skill Dojo `defi-agent` or `prediction-market` skills locally — SuperColony's own API already exposes this data. The official skill documents how to use it.

This means:
- **defi-markets agent** can get attested price data from `/api/prices` (part of SC API, already authenticated)
- **prediction-market data** is at `/api/predictions/markets` (part of SC API)
- **oracle endpoint** at `/api/oracle` combines prices + agent sentiment + Polymarket odds
- No Skill Dojo API calls needed for these use cases
- No local reimplementation needed either

### What We Should Preserve From Our Skill

Our `skills/supercolony/SKILL.md` is an **orchestration wrapper** — it teaches the AI how to run the 8-phase session loop with our CLI tools. The official skill is the **SDK reference** — it teaches how to call the API directly. Both are needed:

| Our Skill | Official Skill |
|-----------|---------------|
| Session orchestration (audit → publish → verify) | Raw API/SDK usage |
| CLI tools (audit.ts, gate.ts, engage.ts) | Direct fetch() + DemosTransactions |
| Strategy-driven loop (persona.yaml governs behavior) | No strategy layer |
| Source lifecycle, scoring, calibration | Not covered |

**Action: Replace our `skills/supercolony/references/api-reference.md` with the official skill's API section. Keep our SKILL.md as the orchestration layer on top.**

---

## Revised Skill Cookbook

Given the official SC skill already provides price/market data, and Skill Dojo skills should be local reimplementations, here's the updated cookbook:

### Tier 0: SuperColony (already have, needs update)

| Skill | Location | Status | Action |
|-------|----------|--------|--------|
| **supercolony** | `skills/supercolony/` | Working, needs update | Update API reference from official skill. Add SSE, webhooks, oracle, prices, predictions/markets endpoints. |

### Tier 1: SC Data Skills (NEW — use SC API, not Skill Dojo)

These are thin skills that call SuperColony's own endpoints (already authenticated, no rate limit issues):

| Skill | Source | What It Provides | Target Agents |
|-------|--------|-----------------|---------------|
| **sc-prices** | `GET /api/prices` | DAHR-attested Binance price data | defi-markets |
| **sc-oracle** | `GET /api/oracle` | Sentiment vs price vs Polymarket divergence | defi-markets, sentinel |
| **sc-predictions-markets** | `GET /api/predictions/markets` | Polymarket odds | sentinel, pioneer |
| **sc-signals** | `GET /api/signals` | Consensus signals across agents | all |
| **sc-identity** | `GET /api/identity` | Cross-platform identity lookup | crawler, nexus |
| **sc-stream** | `GET /api/feed/stream` (SSE) | Real-time feed events | event-runner |

### Tier 2: Omniweb Skills (local reimplementation from Skill Dojo patterns)

These use our SDK directly — no API calls. For agents that operate beyond SuperColony:

| Skill | SDK Components | What It Provides | Target Agents |
|-------|---------------|-----------------|---------------|
| **chain-query** | XM SDK balance/tx queries | Cross-chain balance + tx data | nexus, infra-ops |
| **network-health** | Node RPC (`getLastBlock`, `getPeerList`, etc.) | Demos node health monitoring | infra-ops |
| **address-watch** | XM SDK + node `nodeCall()` | Wallet activity patterns | infra-ops, nexus |
| **cci-identity** | CCI SDK module | Cross-context identity management | nexus |
| **tlsn-attest** | TLSNotary MPC-TLS + Playwright bridge | Standalone URL attestation (omniweb context) | omniweb agents |

**Note:** DAHR/TLSN attestation for SuperColony publishing is NOT a separate skill — it's a mandatory step inside the publish pipeline (`publish-pipeline.ts`). Every SC post is attested automatically. The `tlsn-attest` skill above is for standalone omniweb attestation outside the publish flow.

### Tier 3: Blocked / Future

| Skill | Blocker | When |
|-------|---------|------|
| **demoswork** | ESM bug in baseoperation.js | After KyneSys fix |
| **storage-ops** | StorageProgram "Unknown message" | After KyneSys fix |
| **l2ps-privacy** | Buffer polyfill broken in Node ESM | After KyneSys fix |

---

## Agent Composition Examples

### SC-Only Agent (e.g., sentinel)
```yaml
capabilities:
  skills:
    - supercolony        # Core publishing + engagement (attestation is built into publish)
    - sc-oracle          # Price/sentiment divergence for topic selection
    - sc-predictions-markets  # Market consensus for calibration
scope: supercolony-only
wallet: shared           # Uses shared wallet with other SC agents
attestation: tlsn_preferred  # TLSN when possible, DAHR fallback — built into publish pipeline
```

### SC-Only with DeFi Focus (e.g., defi-markets)
```yaml
capabilities:
  skills:
    - supercolony
    - sc-prices          # DAHR-attested Binance data
    - sc-oracle          # Sentiment + Polymarket + prices
scope: supercolony-only
wallet: shared
attestation: tlsn_preferred
```

### Mixed Agent (e.g., future nexus)
```yaml
capabilities:
  skills:
    - supercolony        # Read feed + publish
    - chain-query        # Cross-chain balances
    - address-watch      # Wallet monitoring
    - network-health     # Node health
    - cci-identity       # Cross-context identity
    - tlsn-attest        # Standalone attestation for omniweb data
scope: omniweb           # Can operate beyond SuperColony
wallet: standalone       # Own wallet for economic independence
attestation: tlsn_preferred
```

### Standalone Omniweb Agent (future)
```yaml
capabilities:
  skills:
    - chain-query
    - address-watch
    - network-health
    - tlsn-attest        # Attest omniweb data without publishing to SC
    - demoswork          # When unblocked
    - storage-ops        # When unblocked
scope: omniweb
wallet: standalone
# No supercolony skill — doesn't publish to the feed
```

---

## Implementation Plan

### Phase 1: Update SuperColony Skill (This Week)

**Priority: Highest.** The official skill is the ground truth. Our skill is outdated.

1. Replace `skills/supercolony/references/api-reference.md` with official skill's complete API section
2. Add new endpoints to our API reference: `/api/prices`, `/api/oracle`, `/api/predictions/markets`, `/api/post/[txHash]`, `/api/identity`, `/api/report`, webhooks
3. Add new post categories: OPINION, FEED (read-only)
4. Update auth docs: add falcon algorithm option, fix expiresAt (milliseconds not string)
5. Add SSE streaming documentation
6. Add webhook documentation
7. Update our SKILL.md stale path (`tools/` → `cli/`)
8. Compare `eliza-plugin-supercolony` (official) vs our `src/adapters/eliza/` — document differences

### Phase 2: SC Data Skills (Week 2)

Build thin skills that use the SC API endpoints we just documented:

1. `skills/sc-prices/` — wraps `/api/prices` as a DataProvider
2. `skills/sc-oracle/` — wraps `/api/oracle` as a DataProvider
3. `skills/sc-predictions-markets/` — wraps `/api/predictions/markets`
4. Plugin wrappers in `src/plugins/` for automated loop integration
5. Wire `sc-prices` into defi-markets persona.yaml — **first pilot with real data**
6. Wire `sc-oracle` into sentinel beforeSense hook
7. Measure H1: defi-markets posts with attested price data vs without

### Phase 3: SSE + Webhooks for Event Runner (Week 3)

Replace polling with real-time:

1. Evaluate: SSE stream (`/api/feed/stream`) vs webhooks (3 per agent) vs current polling
2. If SSE: new EventSource wrapping the SSE connection
3. If webhooks: register signal/mention/reply hooks, build handler
4. Either way: more efficient than current 30s feed polling

### Phase 4: Omniweb Skills (Week 4+)

Local SDK-based skills for beyond-SuperColony operations:

1. `skills/dahr-attest/` — already mostly implemented in publish-pipeline, extract as standalone
2. `skills/chain-query/` — XM SDK wrapper for multi-chain balance queries
3. `skills/network-health/` — Node RPC health monitoring
4. `skills/address-watch/` — Wallet activity patterns

### Phase 5: Agent Composition Framework ✅ Complete (2026-03-20)

1. ~~Formalize the `capabilities.skills` + `scope` + `wallet` model in AGENT.yaml~~
2. ~~Skill loader that reads agent definition → loads declared skills~~ → `loadExtensions()` replaces `registerHook()`
3. ~~Session loop integrates loaded skills at the right lifecycle hooks~~ → 9 hook closures internalized into plugins (Phase 0)
4. ~~Test: create a new agent by composing existing skills (no new code, just YAML)~~ → Extension system fully dynamic with immutable registry

### Phase 6: Unblocked Skills (When Ready)

Depends on KyneSys fixes:
- `skills/demoswork/` — after ESM bug fix
- `skills/tlsn-attest/` — after MPC-TLS server fix
- `skills/storage-ops/` — after StorageProgram node support
- `skills/l2ps-privacy/` — after Buffer polyfill fix

### Phase 7: Full Demos SDK Integration (Systematic)

**Goal:** Every Demos SDK capability becomes an agent skill. Demos is our infrastructure layer — we consume ALL of it, not just SuperColony + attestation. Each capability = a plugin with silent-fail (try, warn, degrade).

Work through the SDK module-by-module. For each: (1) validate in Node.js, (2) build plugin, (3) write tests, (4) wire into skill manifest.

**Tier 1 — Identity & Reputation (high value, partially started)**

| SDK Module | Plugin | Status | Work Needed |
|------------|--------|--------|-------------|
| `abstraction` → Identities | cci-identity-plugin | ⚠️ RPC-direct | Blocker: NAPI SIGSEGV on barrel import. Workaround: RPC calls work. Report to KyneSys. |
| `abstraction` → Web2 Identity | identity.ts (lib) | ✅ Built | CLI done. Need: post proof tweet, complete sentinel linking. |
| `abstraction` → ZK Identity | zk-identity-plugin | 🔲 New | Groth16 ZK-SNARKs for privacy-preserving attestation. Build plugin. |
| `abstraction` → Nomis Score | reputation-plugin | 🔲 New | Wallet reputation scoring. Blocked by NAPI — use RPC-direct. |
| `abstraction` → Ethos Score | reputation-plugin | 🔲 New | Wallet reputation. Same NAPI workaround. |
| `abstraction` → Human Passport | reputation-plugin | 🔲 New | Sybil resistance scoring. Same NAPI workaround. |
| `abstraction` → PQC Identity | sdk.ts | ✅ Built | `bindPqcIdentity()` — upgrade identity to quantum-proof. |

**Tier 2 — Data & Storage (blocked, high potential)**

| SDK Module | Plugin | Status | Work Needed |
|------------|--------|--------|-------------|
| `storage` → Storage Programs | storage-plugin | ❌ Blocked | RPC "Unknown message". Need KyneSys fix. Plugin scaffold exists. |
| `demoswork` → Work Steps | demoswork-plugin | ❌ Blocked | ESM directory import bug. Plugin scaffold → silent-fail done. |
| `l2ps` → Privacy Subnets | l2ps-plugin | ❌ Blocked | Buffer polyfill issue. Build plugin when unblocked. |

**Tier 3 — Cross-Chain Operations (partially started)**

| SDK Module | Plugin | Status | Work Needed |
|------------|--------|--------|-------------|
| `xmcore/*` → Chain Operations | chain-query-plugin | ⚠️ RPC-direct | Basic address query works. Need: multi-chain balance, tx history. |
| `xm-websdk` → Cross-Chain Tx | xm-tx-plugin | 🔲 New | Cross-chain transfers, swaps. Build when tested. |
| `bridge` → Rubic Bridge | bridge-plugin | 🔲 New | Cross-chain asset bridging. |
| `xmcore/evm` → EVM Contracts | evm-plugin | 🔲 New | Smart contract read/write via Demos. |

**Tier 4 — Communication & Auth (new territory)**

| SDK Module | Plugin | Status | Work Needed |
|------------|--------|--------|-------------|
| `websdk/instant-messaging` | messaging-plugin | 🔲 New | E2E encrypted agent-to-agent messaging (ml-kem-aes). |
| `keyserver` → OAuth | keyserver-plugin | 🔲 New | OAuth flow for Web2 identity (GitHub, etc.). |
| `d402` → D402 Protocol | d402-plugin | 🔲 New | Investigate what D402 does (payment protocol?). |
| `encryption` → Crypto Utils | (library, not plugin) | 🔲 New | Unified crypto, hashing, FHE utils. |

**Tier 5 — Chain Query & Feed (direct RPC)**

| SDK Module | Plugin | Status | Work Needed |
|------------|--------|--------|-------------|
| RPC → Full Feed History | feed-history-plugin | 🔲 New | Read all 112k+ posts from GCR via RPC (API caps at ~20k). |
| RPC → Transaction Query | tx-query-plugin | 🔲 New | Query specific transactions by hash. |
| RPC → Block Query | (in network-health) | ✅ Built | getLastBlock already works. |

**Tier 6 — External Protocol Integration**

| Protocol | Plugin | Status | Work Needed |
|----------|--------|--------|-------------|
| Agent Auth Protocol | agent-auth-plugin | 🔲 New | `@auth/agent` SDK evaluated. Build capability-based service auth. |
| Demos MCP Server | mcp-client-plugin | 🔲 New | Use MCP server for documentation lookups + node queries. |

**Execution order:** Tier 1 → Tier 5 → Tier 3 → Tier 4 → Tier 2 (blocked) → Tier 6
- Tier 1 first because identity + reputation is the highest-value differentiator
- Tier 5 next because feed history unlocks source mining at scale
- Tier 2 last because it depends on KyneSys SDK fixes

**Validation protocol for each module:**
1. Test bare import: `npx tsx -e 'import { X } from "@kynesyslabs/demosdk/module"'`
2. Test instantiation: create class, call a method
3. If NAPI crash: use RPC-direct workaround (same pattern as CCI identity)
4. Build plugin with silent-fail pattern (try → warn → degrade)
5. Write tests (mock fetch for RPC calls)
6. Add to skill manifest (Phase 5 integration)
7. Wire into at least one agent's AGENT.yaml

**NAPI crash strategy:** The `abstraction` barrel import crashes because it transitively loads FHE/PQC/zK native modules. For any class in that barrel, reconstruct the RPC calls using `DemosTransactions` + `demos.sign()` + `demos.confirm()` — the same pattern that works for identity.ts. File issue with KyneSys requesting barrel splitting or lazy-loading of native deps.

---

## What Happens to Existing Work

| Code | Decision | Reason |
|------|----------|--------|
| `src/adapters/skill-dojo/` (15 adapters) | **Keep as reference** | Documents Skill Dojo API contract. Useful if we ever need API fallback. |
| `src/lib/skill-dojo-client.ts` | **Keep as reference** | Rate limiter pattern reusable. |
| `src/lib/skill-dojo-proof.ts` | **Reuse** | Proof normalization works for any DAHR response. |
| `src/adapters/eliza/` | **Compare with official** | `eliza-plugin-supercolony` exists — evaluate overlap. |
| `src/plugins/defi-markets-plugin.ts` | **Replace** in Phase 2 | Keyword evaluator → real sc-prices DataProvider. |
| `src/plugins/infra-ops-plugin.ts` | **Replace** in Phase 4 | Keyword evaluator → real network-health DataProvider. |
| H7 rate profiling | **Irrelevant** for SC API | SC endpoints use auth tokens, not IP rate limits. |
| H1 hypothesis | **Still valid** | Measure with sc-prices data instead of Skill Dojo API. |

---

## Decisions (2026-03-20)

1. **SSE primary, polling fallback** — Event-runner uses SSE (`/api/feed/stream`) as primary. Falls back to polling if SSE connection fails. Our event-runner already runs long-lived — natural fit.
2. **Eliza plugin: evaluate first** — Install official `eliza-plugin-supercolony`, compare with our adapter bridge, then decide. Both may coexist (official for SC read, ours for full framework bridge).
3. **Build the full cookbook now** — All omniweb skills built even if no agent uses them yet. Having skills ready means spinning up a new agent is just YAML config.
4. **Soft scope enforcement** — Log warnings for out-of-scope operations but don't block. Operator can override. Scope declared in AGENT.yaml.
