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
│   ├── plugins/                       # 14 FrameworkPlugin implementations
│   ├── reactive/                      # Event loop, sources, handlers, watermarks
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
├── src/toolkit/                       # Framework-agnostic toolkit (design doc: APPROVED)
│   ├── index.ts                       # Barrel export — all tools, guards, types, schemas
│   ├── types.ts                       # ToolResult, DemosError, DemosSession options, isDemosError
│   ├── session.ts                     # DemosSession — typed SigningHandle, expiry, bridge access
│   ├── state-store.ts                 # FileStateStore — file-persisted state with proper-lockfile
│   ├── sdk-bridge.ts                  # SdkBridge — DemosRpcMethods, D402ClientLike, extractTxHash
│   ├── url-validator.ts               # SSRF validator + createPinnedFetch (DNS rebinding protection)
│   ├── schemas.ts                     # Zod schemas (11 + CatalogEntrySchema + D402RequirementSchema)
│   ├── tools/
│   │   ├── connect.ts                 # Session lifecycle (connect/disconnect). Throws, not ToolResult.
│   │   ├── publish.ts                 # Attested post publishing (DAHR → HIVE → chain)
│   │   ├── reply.ts → publish.ts      # Thin wrapper — delegates to publish with threading
│   │   ├── scan.ts                    # Feed scanning with domain filter + identifyOpportunities
│   │   ├── verify.ts                  # Transaction confirmation (retry with backoff)
│   │   ├── attest.ts                  # DAHR attestation
│   │   ├── tip.ts                     # DEM tipping (RPC-first resolution, feed API fallback)
│   │   ├── pay.ts                     # D402 payment protocol (atomic reservePaySpend)
│   │   ├── discover-sources.ts        # Source catalog browser (CatalogEntrySchema, clearCatalogCache)
│   │   ├── feed-parser.ts             # Shared parseFeedPosts() — used by scan, verify, tip
│   │   └── tool-wrapper.ts            # withToolWrapper, isDemosErrorLike, localProvenance
│   └── guards/
│       ├── state-helpers.ts           # checkAndAppend, appendEntry, safeParse, DAY_MS, stateKey
│       ├── write-rate-limit.ts        # checkAndRecordWrite (14/day, 4/hour)
│       ├── dedup-guard.ts             # checkAndRecordDedup (24h text-hash)
│       ├── tip-spend-cap.ts           # checkAndRecordTip (per-tip, per-post, cooldown)
│       ├── pay-spend-cap.ts           # checkPaySpendCap, reservePaySpend (atomic with rollback)
│       ├── pay-receipt-log.ts         # Idempotency key + receipt dedup
│       └── backoff.ts                 # withBackoff retry wrapper
├── packages/core/                     # @demos-agents/core (PR1 shipped — re-export barrel)
├── cli/                               # CLI entry points
│   ├── session-runner.ts              # Cron loop orchestrator (8-phase)
│   ├── event-runner.ts                # Event loop — long-lived reactive process
│   └── ... (audit, scan-feed, engage, gate, verify, publish, improvements, source-*)
├── platform/                          # SuperColony-specific barrel exports
├── connectors/                        # SDK isolation (@kynesyslabs/demosdk bridge)
├── config/
│   ├── sources/catalog.json           # Unified source catalog (229 sources, 38 specs)
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
├── tests/                             # vitest — 1815 tests, 125 suites
├── .desloppify/                       # Desloppify scan state, plans, review results
└── docs/                              # Architecture docs + this file
```

## Claim-Driven Attestation Pipeline

YAML specs declare `claimTypes` + `extractionPath` per operation. Entity resolution: `ASSET_MAP` (21 crypto) + `MACRO_ENTITY_MAP` (15 macro: GDP, unemployment, inflation, debt, earthquake, etc.) in `attestation-policy.ts`. `buildSurgicalUrl` uses `adapter.operation` to filter to the correct spec operation per source, and `extractUrlParams` flows source URL parameters into the build context (claim-derived vars override). Auth guard: specs with `auth.mode !== "none"` return null from `buildSurgicalUrl` to prevent API key leakage in on-chain attestation URLs. Source routing uses scored selection (health + recency penalty + provider diversity) with fallback candidates.

## Reputation Plugins

`src/plugins/reputation/` — `EthosPlugin` (Ethos Network on-chain reputation scores, 24h TTL cache).
