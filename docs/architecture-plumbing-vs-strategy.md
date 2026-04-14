---
summary: "Toolkit vs strategy boundary — classification of every module. ADR-0002 foundation. Code placement decision tree."
read_when: ["architecture", "toolkit", "strategy", "boundary", "code placement", "ADR-0002", "where does code go", "plumbing"]
---

# Architecture: Plumbing vs Strategy

> First-principles analysis of the omniweb-agents codebase boundary between **toolkit** (reusable plumbing for any Demos SDK consumer) and **strategy** (sentinel-specific personalization).
>
> Produced: 2026-03-29 | Method: 3-agent codebase mapping + FirstPrinciples decomposition + Red Team + Council debate
> Reviewed: 4-agent /simplify + Codex review (REQUEST CHANGES → addressed)
>
> Implements the boundary established in [ADR-0002](decisions/0002-toolkit-vs-strategy-boundary.md). See also [ADR-0007](decisions/0007-security-first.md) for security principles.

---

## The 10 Atomic Operations

Every Demos agent, regardless of strategy, performs combinations of these 10 irreducible operations:

| # | Operation | Description |
|---|-----------|-------------|
| 1 | **READ chain** | Get transactions, decode HIVE payloads, interpret data |
| 2 | **WRITE chain** | Encode HIVE payloads, sign transactions, broadcast |
| 3 | **VERIFY chain** | Confirm a transaction landed, check block inclusion |
| 4 | **FETCH external** | HTTP request to a URL, get response body |
| 5 | **ATTEST external** | Prove you fetched something (DAHR hash or TLSN proof) |
| 6 | **DECIDE** | Given inputs, choose an action (LLM or rules) |
| 7 | **GUARD** | Rate limit, budget cap, dedup, spend control |
| 8 | **PERSIST** | Save watermarks, budgets, session history across runs |
| 9 | **OBSERVE** | Detect changes worth responding to |
| 10 | **SCHEDULE** | Run operations on a cadence or in response to events |

**The toolkit provides primitives for operations 1-8. Strategy composes them via operations 9-10.**

---

## Current State: Classification

### Pure Plumbing (already in src/toolkit/ — KEEP)

| Module | Atomic Op | Notes |
|--------|-----------|-------|
| `src/toolkit/tools/connect.ts` | 1 | Session lifecycle (minor leak: `skillDojoFallback` — Phase 4 cleanup) |
| `src/toolkit/tools/publish.ts` (publish + reply) | 2 | HIVE post + guards |
| `src/toolkit/tools/react.ts` | 2 | Chain-first with API fallback |
| `src/toolkit/tools/tip.ts` | 2 | DEM transfer with policy guards |
| `src/toolkit/tools/scan.ts` | 1 | Chain feed + optional API enrichment |
| `src/toolkit/tools/verify.ts` | 3 | Confirmation polling |
| `src/toolkit/tools/attest.ts` | 5 | DAHR attestation (TLSN via bridge) |
| `src/toolkit/tools/discover-sources.ts` | 4 | Catalog browsing |
| `src/toolkit/tools/pay.ts` | 4+7 | D402 micropayments with atomic spend cap |
| `src/toolkit/tools/feed-parser.ts` | 1 | Feed API normalization |
| `guards/*` (6 guards + state-helpers) | 7 | Rate limit, spend cap, dedup, backoff, receipts |
| `session.ts` | 8 | Opaque session handle |
| `state-store.ts` | 8 | File-backed persistence with locking |
| `sdk-bridge.ts` | 1+2 | SDK adapter (SC-specific `apiCall` path restrictions — documented leak) |
| `chain-reader.ts` | 1 | On-chain data reading |
| `chain-scanner.ts` | 1 | Address-specific scanning |
| `hive-codec.ts` | 1+2 | HIVE payload encode/decode |
| `url-validator.ts` | 4 | SSRF protection |
| `schemas.ts` | — | Zod validation |
| `types.ts` | — | Type contracts |

**Known strategy leaks in existing toolkit:** `skillDojoFallback` in session/connect (4 files), `AUTH_PENDING_TOKEN` sentinel comment in sdk-bridge, SC-specific API path restrictions in sdk-bridge. All documented for Phase 4 cleanup.

### Pure Plumbing (trapped OUTSIDE toolkit — MOVE)

| Module | Atomic Op | Why it's plumbing | Importers | Action |
|--------|-----------|-------------------|-----------|--------|
| `src/lib/sources/providers/declarative-engine.ts` | 4 | YAML spec → provider adapter (1534 LOC) | 7 prod + 4 test | **SHIP** (after dep extraction — see blockers) |
| `src/lib/sources/catalog.ts` | — | Catalog loading + indexing | 24 prod + 14 test | **SHIP** |
| `src/lib/sources/fetch.ts` | 4 | Source data fetching with retries | ~6 | **SHIP** |
| `src/lib/sources/health.ts` | — | Source health scoring | ~3 | **SHIP** |
| `src/lib/sources/rate-limit.ts` | 7 | Per-source rate limiting | ~3 | **SHIP** |
| `src/lib/sources/providers/types.ts` | — | Provider adapter contracts | ~8 | **SHIP** |
| `src/lib/sources/providers/generic.ts` | 4 | Generic provider impl | ~3 | **SHIP** |
| `src/lib/network/fetch-with-timeout.ts` | 4 | Generic fetch utility | ~5 | **SHIP** |
| `src/lib/network/storage-client.ts` | 1 | On-chain storage queries | ~2 | **SHIP** |
| `src/lib/scoring/scoring.ts` | — | On-chain formula constants | ~4 | **SHIP** (namespaced as `supercolony/scoring`) |
| `src/lib/util/errors.ts` | — | Generic error handling (10 LOC) | ~8 | **SHIP** |
| `src/reactive/watermark-store.ts` | 8 | File-based watermark persistence | 1 prod + 1 test | **DEFER** (1 consumer) |

### Needs Redesign Before Moving

| Module | Blocker | Action |
|--------|---------|--------|
| `src/reactive/event-loop.ts` | `EventAction.type` is hardcoded to `OmniwebActionType` (sentinel-specific). Must make `EventLoop<TAction>` generic over action type. Per [design-toolkit-architecture.md decision 2026-03-30](design-toolkit-architecture.md): reactive infra primitives are allowed under Q5 "zero loops" if generic, sub-path exported, and opinion-free. | **REDESIGN then SHIP** (est. 4 hrs) |
| `src/lib/auth/auth.ts` | Hardcodes `~/.supercolony-auth.json` cache path. Imports `apiCall` from `sdk.ts` which has SC-specific `getApiUrl()`. | **REDESIGN** (inject `apiFetch` callback, parameterize cache path) |
| `src/lib/network/sdk.ts` | Contains SC-specific `apiCall()` and `getApiUrl()`. Mixed: `connectWallet` is generic, `apiCall` is strategy. | **SPLIT**: `connectWallet` → toolkit, `apiCall` → stays in strategy |
| `src/lib/sources/providers/declarative-engine.ts` | Runtime imports `inferAssetAlias`/`inferMacroEntity` from `attestation-policy.ts` (strategy). Creates toolkit→strategy circular dep. | **Extract** ~50 LOC pure functions to `src/toolkit/chain/asset-helpers.ts` OR inject as callbacks. Must resolve BEFORE move. (**DONE** — extracted 2026-04-04) |

### NOT Plumbing (incorrectly proposed in v1, corrected)

| Module | Why it stays | Correction |
|--------|-------------|------------|
| `src/lib/util/extensions.ts` | Imports from `state.ts`, `agent-config.ts`, `attestation-policy.ts` — pure strategy (plugin hook dispatcher) | Excluded from toolkit moves |
| `src/lib/util/log.ts` | Uses sentinel-specific `SessionLogEntry` types | Evaluate before moving |
| `src/lib/network/skill-dojo-client.ts` | Third-party service bridge — plumbing, but defer (1 consumer) | **DEFER** |
| `src/lib/network/skill-dojo-proof.ts` | Third-party service bridge — plumbing, but defer (1 consumer) | **DEFER** |
| `src/lib/response-validator.ts` | Zero production consumers (only test file imports it) | Likely dead code — verify |

### Mixed (needs SPLITTING)

| Module | Plumbing Part | Strategy Part | Extraction trigger | Action |
|--------|--------------|---------------|-------------------|--------|
| `src/lib/sources/matcher.ts` | Claim extraction fn, scoring fn signatures | Scoring weights, threshold, stopwords | First non-sentinel consumer needs claim matching | **DOCUMENT split, defer** |
| `src/lib/sources/policy.ts` | Index building, search algorithm | Ranking weights, provider relevance rules | First non-sentinel consumer needs source selection | **DOCUMENT split, defer** |
| `src/lib/pipeline/signal-detection.ts` | Ring buffer, MAD, z-score math | Crypto/macro thresholds, convergence rules | — | **SPLIT NOW: math → toolkit** |
| `src/actions/action-executor.ts` | Dispatch routing | Budget categories, action params | First non-sentinel consumer needs event dispatch | **DOCUMENT split, defer** |
| `src/actions/llm.ts` | LLM call interface | Prompt engineering, persona/strategy context | — | **Export interface only** |
| `src/lib/budget-tracker.ts` | Rolling cap mechanism | DEFAULT_ALLOCATIONS, category names | — | **DEFER — guards handle real money** |
| `src/lib/spending-policy.ts` | Policy enforcement pattern | `dryRun: true` default, specific caps | — | **DEFER** |
| `src/lib/attestation/attestation-policy.ts` | `inferAssetAlias`/`inferMacroEntity` pure fns | Entity maps (ASSET_MAP, MACRO_ENTITY_MAP) | DeclarativeEngine move (blocking dep) | **Extract pure fns → toolkit** |
| `src/lib/pipeline/source-scanner.ts` | Scanning framework | Sentinel intents | Second consumer | **DEFER** |
| `src/lib/pipeline/feed-filter.ts` | Filtering engine | Sentinel weights | Second consumer | **DEFER** |

### Pure Strategy (KEEP in omniweb-agents)

| Module | Why it's strategy |
|--------|------------------|
| `cli/session-runner.ts` | 8-phase sentinel loop orchestration |
| `cli/event-runner.ts` | Reactive daemon setup + wiring |
| `src/reactive/event-sources/*` | SuperColony-specific event detection |
| `src/reactive/event-handlers/*` | Sentinel engagement rules |
| `src/reactive/own-tx-hashes.ts` | Tracks agent's published TXs |
| `src/plugins/*` (22 plugins) | Agent-specific hooks, evaluators, providers |
| `src/lib/state.ts` | Sentinel phase machine |
| `src/lib/agent-config.ts` | Multi-agent persona loading |
| `src/lib/predictions.ts` | Prediction lifecycle tracking |
| `src/lib/tips.ts` | Autonomous tipping evaluation |
| `src/lib/mentions.ts` | Mention polling |
| `src/lib/transcript.ts` | Session transcript storage |
| `src/lib/review-findings.ts` | Session improvement findings |
| `src/lib/test-quality-validator.ts` | Dev tooling (not shipped) |
| `src/lib/improvement-utils.ts` | Evidence-based improvement proposals |
| `src/lib/scoring/quality-score.ts` | Sentinel-calibrated quality signals (n=34) |
| `src/lib/pipeline/engage-heuristics.ts` | Engagement opportunity scoring |
| `src/lib/pipeline/signals.ts` | Consensus signal fetching |
| `src/lib/pipeline/observe.ts` | JSONL observation logger |
| `src/lib/sources/lifecycle.ts` | Source onboarding hooks |
| `src/lib/sources/providers/hooks/*.ts` | Provider-specific hooks (kraken, arxiv, etc.) |
| `src/lib/llm/llm-claim-config.ts` | Claim extraction schemas |
| `src/lib/attestation/claim-extraction.ts` | Structured claim extraction |
| `src/lib/auth/identity.ts` | CCI/Ethos identity (mixed — evaluate later) |
| `src/lib/util/extensions.ts` | Plugin hook dispatcher (imports strategy modules) |
| `config/*` | Source catalog, strategies |
| `src/adapters/eliza/*` | ElizaOS adapter (unproven — types only) |

---

## New Primitives (Red Team Validated)

### SHIP NOW

| Primitive | Source | What it does | Why | Status |
|-----------|--------|-------------|-----|--------|
| **LLMProvider interface** | `src/lib/llm/llm-provider.ts` | `complete(prompt, opts?) → string` (interface only, ~10 lines) | Zero deps. Resolution logic stays in lib/. Unblocks adapter workstream. | Ready |
| **ChainTxPipeline** | Pattern across 5 files | sign → confirm → broadcast enforced sequence | Prevents the bug class that already shipped (DEM tips silently not broadcasting). Security primitive. | Complete - wired across all 5 call sites |
| **AtomicStateTransaction** | `src/toolkit/guards/state-helpers.ts` | Lock → read → validate → conditionally write → unlock | Already exported from barrel (`checkAndAppend`). Needs documentation promotion only. | **ALREADY DONE** |

### REDESIGN then SHIP

| Primitive | Blocker to resolve | Estimated effort |
|-----------|-------------------|-----------------|
| **EventLoop** | Make generic over `TAction` type (currently hardcoded to `OmniwebActionType`) | 4 hrs |
| **DeclarativeEngine** | Extract `inferAssetAlias`/`inferMacroEntity` from attestation-policy first | 5-8 hrs total |
| **BaselineMath** | Split math fns from domain rules in signal-detection.ts | 2 hrs |

### DEFER (until second consumer)

| Primitive | Why defer |
|-----------|----------|
| ClaimExtractor | Two incompatible extraction systems (tokens vs structured), domain-coupled |
| EvidenceScorer | No calibration data exists, threshold 50→30→10 proves we don't understand scoring yet |
| SourceIndex | 229 items, linear scan is fine, premature optimization |
| RollingBudget | Three guards differ in kind (count, amount, category), unification adds risk to money code |

### KILL (over-engineered)

| Primitive | Why kill |
|-----------|---------|
| WeightedSignalScorer | 3 lines of `reduce()` pretending to be a primitive |
| PublishComposite | Encodes workflow opinions. Raw tools compose better. Document the pattern instead |

---

## Migration Path

### Impact Assessment

- **91 import statements across 56 files** affected by path changes
- **~30 test files** need import updates
- **Re-export shims** at old paths prevent compile-time breakage during transition
- **Dynamic imports** in `extensions.ts` and `lifecycle-plugin.ts` — shims must persist until all dynamic imports are updated
- **Validation gate** after each phase: `tsc --noEmit && npm test`

### Phase 1: Zero-Risk Moves (existing code, new exports)
1. Export `LLMProvider` interface type from toolkit barrel (30 min)
2. ~~Promote `checkAndAppend` to first-class export~~ — **already done** (line 106 of index.ts)
3. Export on-chain scoring constants from toolkit, namespaced as `supercolony/scoring` (30 min)

### Phase 2: File Moves (same code, new location)

**Batch A** (independent, parallelizable):
4. Move `catalog.ts`, `fetch.ts`, `health.ts`, `rate-limit.ts`, `generic.ts` → `src/toolkit/sources/` (3 hrs)
5. Move `errors.ts` → `src/toolkit/util/` (30 min)
6. Move `fetch-with-timeout.ts`, `storage-client.ts` → `src/toolkit/network/` (1 hr)

**Batch B** (has dependencies on Batch A or blockers):
7. Extract `inferAssetAlias`/`inferMacroEntity` from attestation-policy → `src/toolkit/chain/asset-helpers.ts` (~50 LOC pure fns) (1 hr)
8. Move `declarative-engine.ts` + `providers/types.ts` → `src/toolkit/providers/` (3 hrs, depends on step 7)

**After each batch:** Run `tsc --noEmit && npm test` to validate.

### Phase 3: Redesign + Build (new interfaces)
9. Make EventLoop generic over `TAction` type, move to `src/toolkit/reactive/` (4 hrs)
10. Split `signal-detection.ts` → `baseline-math.ts` (toolkit) + `signal-rules.ts` (strategy) (2 hrs)
11. `ChainTxPipeline` enforcing sign→confirm→broadcast across all 5 call sites - complete

### Phase 4: Document + Cleanup
12. Write next ADR: planned splits for matcher.ts, policy.ts, action-executor.ts
13. Add bounded validation to `matchThreshold` (clamp [5, 100]) [done]
14. Plan `skillDojoFallback` cleanup in toolkit session/connect
15. Redesign `auth.ts` with injected `apiFetch` + parameterized cache path
16. Split `sdk.ts`: `connectWallet` → toolkit, `apiCall` → strategy

### Breaking Changes

Re-export shims at old import paths prevent compile-time breakage. However:
- **91 imports across 56 files** will show deprecation warnings
- **Dynamic imports** require shims to persist longer than static imports
- **Deprecation timeline:** Shims get `@deprecated` JSDoc from day 1. Removal at next major version.
- **CI gate:** Lint rule to prevent new imports from deprecated paths (add in Phase 2).

---

## Attestation Method: Strategy Decision

Both DAHR and TLSN are **equally first-class toolkit primitives**. The toolkit provides both methods. Choosing which to use is a **strategy decision**:

| Method | When to use (strategy) | Toolkit provides |
|--------|----------------------|------------------|
| **DAHR** (default) | Standard claims, news analysis, general posts | `attest(session, { url })` → responseHash + txHash |
| **TLSN** (high-stakes) | Legal contracts, prediction outcomes, economic stakes where proof hardness matters | `attest(session, { url, method: "tlsn" })` → cryptographic proof + txHash |

---

## The Fundamental Principle

> **The toolkit boundary is a security boundary, not just an abstraction boundary.**
> (See [ADR-0007](decisions/0007-security-first.md) and CLAUDE.md "Security-First" section)

**Design rule:** Toolkit primitives accept configuration through typed, bounded interfaces with validated defaults. Guards enforce invariants that cannot be overridden. When in doubt, keep it opinionated.

**Sub-path exports:** Use `@omniweb-agents/core/reactive`, `@omniweb-agents/core/providers` to keep the main barrel lean. A minimal consumer (`connect`, `publish`, `verify`) should not need to import the EventLoop or DeclarativeEngine.

---

## Proposed Toolkit Barrel (after migration)

```
src/toolkit/
├── index.ts                    # Barrel — lean, core tools only
├── tools/                      # 10 existing tools (unchanged)
├── guards/                     # 6 existing guards + state-helpers (unchanged)
├── sdk-bridge.ts               # SDK adapter (flat, no connectors/ dir)
├── chain-reader.ts             # On-chain data reading
├── chain-scanner.ts            # Address-specific scanning
├── hive-codec.ts               # HIVE payload encode/decode
├── session.ts                  # DemosSession (unchanged)
├── state-store.ts              # FileStateStore (unchanged)
├── schemas.ts                  # Zod validation (unchanged)
├── types.ts                    # Types + LLMProvider interface (NEW export)
├── url-validator.ts            # SSRF protection (unchanged)
│
├── reactive/                   # NEW (sub-path export)
│   ├── event-loop.ts           # Generic poll-diff-dispatch (TAction generic)
│   └── watermark-store.ts      # File-based watermark persistence
│
├── providers/                  # NEW (sub-path export)
│   ├── declarative-engine.ts   # YAML spec → adapter (1534 LOC)
│   ├── types.ts                # Provider adapter contracts
│   ├── generic.ts              # Generic provider implementation
│   ├── fetch.ts                # Source fetching with retries
│   ├── health.ts               # Source health scoring
│   └── rate-limit.ts           # Per-source rate limiting
│
├── sources/                    # NEW (sub-path export)
│   └── catalog.ts              # Catalog loading + indexing
│
├── chain/                      # NEW
│   ├── tx-pipeline.ts          # Enforced sign→confirm→broadcast
│   └── asset-helpers.ts        # inferAssetAlias, inferMacroEntity
│
├── network/                    # NEW
│   ├── fetch-with-timeout.ts   # Generic fetch utility
│   └── storage-client.ts       # On-chain storage queries
│
├── math/                       # NEW (sub-path export)
│   └── baseline.ts             # Ring buffer, MAD, z-score
│
├── supercolony/                # NEW — SC-specific constants (namespaced)
│   └── scoring.ts              # On-chain scoring formula
│
└── util/                       # NEW
    └── errors.ts               # Error handling
```

**NOT in toolkit (stays in src/lib/):** auth.ts (needs redesign), sdk.ts (needs split), extensions.ts (pure strategy), log.ts (sentinel types), skill-dojo-*.ts (defer).

---

## Phase 9 Realization (2026-04-06)

The proposed structure above was fully realized in Phase 9 (ADR-0018). Key additions:

- **`src/toolkit/primitives/`** — 15 domain factories (feed, intelligence, scores, agents, actions, oracle, prices, verification, predictions, ballot, webhooks, identity, balance, health, stats) + `createToolkit()` facade
- **`src/toolkit/data-source.ts`** — `DataSource` interface with `ApiDataSource` (wraps `SuperColonyApiClient`), `ChainDataSource` (wraps `chain-reader.ts`), `AutoDataSource` (API-first, chain fallback)
- **`src/toolkit/colony/api-backfill.ts`** — `syncColonyFromApi()` for auto-gap-fill at session start

The **three-layer architecture** is now concrete:
1. **Toolkit primitives** (`src/toolkit/primitives/`) — universal plumbing, template-agnostic
2. **Strategy layer** (`src/toolkit/strategy/`) — swappable YAML rules per agent use case
3. **Agent harness** (`cli/v3-loop.ts`, `cli/session-runner.ts`) — owns the loop, config, oversight
