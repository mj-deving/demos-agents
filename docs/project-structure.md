# Project Structure

```
demos-agents/
├── CLAUDE.md                          # Project context for AI assistants (69 lines, trimmed)
├── .ai/guides/                        # Detailed reference docs (moved from CLAUDE.md)
│   ├── cli-reference.md               # Full CLI command list
│   ├── gotchas-detail.md              # Credentials, scoring, quality gate, TLSN, LLM provider
│   └── dev-workflow.md                # Tiered dev workflow (Surgical/Standard/Complex)
├── README.md                          # Public-facing docs
├── src/                               # Core types + business logic
│   ├── index.ts                       # Barrel exports for all portable modules
│   ├── types.ts                       # FrameworkPlugin, Action, EventPlugin, DataProvider, Evaluator
│   ├── adapters/
│   │   └── specs.ts                   # Adapter specification types (moved from src/)
│   ├── plugins/                       # 22 FrameworkPlugin implementations
│   ├── reactive/                      # @deprecated shims → toolkit/reactive/ + event sources/handlers
│   ├── actions/                       # Executor, LLM, publish pipeline
│   └── lib/                           # Shared utilities (partially restructured)
│       ├── auth/                      # auth.ts, identity.ts — challenge-response auth, token cache
│       ├── llm/                       # llm-provider.ts, llm-claim-config.ts — provider-agnostic adapters
│       ├── attestation/               # claim-extraction.ts, attestation-planner.ts, attestation-policy.ts
│       ├── scoring/                   # scoring.ts, quality-score.ts — expected score + quality signals
│       ├── sources/                   # catalog.ts, policy.ts, matcher.ts, health.ts, lifecycle.ts, providers/
│       ├── sdk.ts                     # Wallet connection, API calls, 502 retry
│       ├── write-rate-limit.ts        # @deprecated — legacy sync/file-based. Use toolkit guards.
│       ├── publish-pipeline.ts        # DAHR/TLSN attestation + HIVE publish
│       └── ... (33 files remaining flat — ongoing restructuring)
├── src/toolkit/                       # Framework-agnostic toolkit (~85 files, ADR-0002)
│   ├── index.ts                       # Barrel export — all tools, guards, types, schemas, new modules
│   ├── types.ts                       # ToolResult, DemosError, DemosSession options, LLMProvider interface
│   ├── session.ts                     # DemosSession — typed SigningHandle, expiry, bridge access
│   ├── state-store.ts                 # FileStateStore — file-persisted state with proper-lockfile
│   ├── sdk-bridge.ts                  # SdkBridge — uses ChainTxPipeline for all chain writes
│   ├── chain-reader.ts               # On-chain data reading (ADR-0011)
│   ├── chain-scanner.ts              # Address-specific scanning (ADR-0011)
│   ├── hive-codec.ts                 # HIVE payload encode/decode (ADR-0011)
│   ├── url-validator.ts               # SSRF validator + createPinnedFetch (DNS rebinding protection)
│   ├── schemas.ts                     # Zod schemas (11 + CatalogEntrySchema + D402RequirementSchema)
│   ├── tools/
│   │   ├── connect.ts                 # Session lifecycle (connect/disconnect). Throws, not ToolResult.
│   │   ├── publish.ts                 # Attested post publishing (publish + reply)
│   │   ├── scan.ts                    # Feed scanning with domain filter + identifyOpportunities
│   │   ├── verify.ts                  # Transaction confirmation (retry with backoff)
│   │   ├── attest.ts                  # DAHR attestation
│   │   ├── tip.ts                     # DEM tipping (RPC-first resolution, feed API fallback)
│   │   ├── pay.ts                     # D402 payment protocol (atomic reservePaySpend)
│   │   ├── discover-sources.ts        # Source catalog browser (CatalogEntrySchema, clearCatalogCache)
│   │   ├── feed-parser.ts             # Shared parseFeedPosts() — used by scan, verify, tip
│   │   └── tool-wrapper.ts            # withToolWrapper, isDemosErrorLike, localProvenance
│   ├── guards/
│   │   ├── state-helpers.ts           # checkAndAppend, appendEntry, safeParse, DAY_MS, stateKey
│   │   ├── write-rate-limit.ts        # checkAndRecordWrite (14/day, 4/hour)
│   │   ├── dedup-guard.ts             # checkAndRecordDedup (24h text-hash)
│   │   ├── tip-spend-cap.ts           # checkAndRecordTip (per-tip, per-post, cooldown)
│   │   ├── pay-spend-cap.ts           # checkPaySpendCap, reservePaySpend (atomic with rollback)
│   │   ├── pay-receipt-log.ts         # Idempotency key + receipt dedup
│   │   └── backoff.ts                 # withBackoff retry wrapper
│   ├── sources/                       # Source catalog + fetching (moved from src/lib/sources/)
│   │   ├── catalog.ts                 # Catalog loading, indexing, tokenization
│   │   ├── fetch.ts                   # Source data fetching with retries
│   │   ├── health.ts                  # Source health testing + filtering
│   │   └── rate-limit.ts             # Per-source rate limiting
│   ├── providers/                     # Declarative provider system (moved from src/lib/sources/providers/)
│   │   ├── declarative-engine.ts      # YAML spec → provider adapter (1534 LOC)
│   │   ├── types.ts                   # ProviderAdapter, EvidenceEntry, FetchedResponse contracts
│   │   └── generic.ts                 # Generic (fallback) provider adapter
│   ├── reactive/                      # Generic event loop (moved from src/reactive/)
│   │   ├── event-loop.ts             # EventLoop<TAction> — poll-diff-dispatch
│   │   ├── watermark-store.ts         # File + memory watermark persistence
│   │   └── types.ts                   # AgentEvent, EventSource, EventHandler, OmniwebAction
│   ├── chain/                         # Chain transaction primitives
│   │   ├── tx-pipeline.ts            # executeChainTx — enforced store→confirm→broadcast
│   │   └── asset-helpers.ts          # inferAssetAlias, inferMacroEntity (pure functions)
│   ├── math/                          # Statistical primitives
│   │   └── baseline.ts               # Ring buffer, MAD, z-score, winsorize
│   ├── network/                       # Network utilities
│   │   ├── fetch-with-timeout.ts     # Generic fetch with timeout
│   │   └── storage-client.ts         # On-chain storage queries
│   ├── supercolony/                   # SC-specific constants (namespaced)
│   │   └── scoring.ts                # On-chain scoring formula + constants
│   ├── colony/                        # Colony intelligence layer
│   │   ├── schema.ts                  # Colony DB schema + migrations (better-sqlite3)
│   │   ├── posts.ts                   # Post CRUD (insertPost, getPost, getRecentPosts, countPosts)
│   │   ├── source-cache.ts            # Source response cache (upsertSourceResponse, getFreshSources)
│   │   ├── state-extraction.ts        # extractColonyState() — activity, gaps, threads, agents
│   │   ├── available-evidence.ts      # computeAvailableEvidence() — reads source cache
│   │   ├── performance.ts             # computePerformanceScores()
│   │   ├── reactions.ts               # Reaction cache CRUD
│   │   ├── claims.ts                  # Claim ledger CRUD
│   │   ├── dead-letters.ts            # Dead letter queue for failed ingestion
│   │   ├── scanner.ts                 # Batch post processor
│   │   └── index.ts                   # Barrel export
│   ├── strategy/                      # Strategy engine
│   │   ├── engine.ts                  # decideActions() — 5 rules, rate limiting, evidence gating
│   │   ├── config-loader.ts           # Load strategy YAML
│   │   └── types.ts                   # StrategyAction, StrategyConfig, DecisionLog
│   └── util/                          # Generic utilities
│       └── errors.ts                  # toErrorMessage helper
├── packages/core/                     # @demos-agents/core (PR1 shipped — re-export barrel)
├── cli/                               # CLI entry points
│   ├── session-runner.ts              # Cron loop orchestrator (V2 legacy + V3 default)
│   ├── v3-loop.ts                     # V3 loop: SENSE→ACT→CONFIRM (~460 lines)
│   ├── v3-strategy-bridge.ts          # Strategy bridge: sense/plan/computePerformance
│   ├── publish-executor.ts            # PUBLISH/REPLY executor with full attestation pipeline
│   ├── action-executor.ts             # ENGAGE/TIP lightweight executor
│   ├── event-runner.ts                # Event loop — long-lived reactive process
│   └── ... (audit, scan-feed, engage, gate, verify, publish, source-scan, etc.)
│         # All CLI tools are 100% chain-only — no API auth required
├── platform/                          # SuperColony-specific barrel exports
├── connectors/                        # SDK isolation (@kynesyslabs/demosdk bridge)
├── config/
│   ├── sources/catalog.json           # Unified source catalog (226 sources)
│   └── strategies/base-loop.yaml      # Base loop strategy definition
├── agents/                            # Agent definitions (YAML persona + strategy)
│   ├── sentinel/                      # General-purpose verification agent
│   ├── crawler/                       # Deep research agent (100+ sources)
│   ├── pioneer/                       # Novel content originator (signal-gated)
│   ├── nexus/                         # Inter-agent coordinator (omniweb)
│   ├── defi-markets/                  # DeFi market monitor
│   └── infra-ops/                     # Infrastructure operations
├── skills/supercolony/                # SuperColony CLI skill (auth, post, feed, search, react)
├── scripts/                           # Cron wrapper + log rotation
├── tests/                             # vitest — 2200 tests, 169 suites
├── .desloppify/                       # Desloppify scan state, plans, review results
└── docs/                              # Architecture docs, roadmap, archive/
    ├── v3-roadmap.md                  # THE roadmap — tickable checklist (14/23 done)
    ├── colony-tooling-plan.md         # Active detail spec (Phases 5.1-5.6)
    ├── colony-db-ingestion-plan.md    # Backfill spec (step 2 open)
    ├── archive/                       # Completed/superseded plans (read-only)
    └── decisions/                     # ADRs (14 accepted)
```

## Claim-Driven Attestation Pipeline

YAML specs declare `claimTypes` + `extractionPath` per operation. Entity resolution: `ASSET_MAP` (21 crypto) + `MACRO_ENTITY_MAP` (15 macro: GDP, unemployment, inflation, debt, earthquake, etc.) — now in `src/toolkit/chain/asset-helpers.ts` (extracted from attestation-policy.ts). `buildSurgicalUrl` uses `adapter.operation` to filter to the correct spec operation per source, and `extractUrlParams` flows source URL parameters into the build context (claim-derived vars override). Auth guard: specs with `auth.mode !== "none"` return null from `buildSurgicalUrl` to prevent API key leakage in on-chain attestation URLs. Source routing uses scored selection (health + recency penalty + provider diversity) with fallback candidates. `matchThreshold` clamped to [5, 100].

## Reputation Plugins

`src/plugins/reputation/` — `EthosPlugin` (Ethos Network on-chain reputation scores, 24h TTL cache).
