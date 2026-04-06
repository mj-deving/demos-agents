---
summary: "Full codebase directory tree — src/toolkit/, src/lib/, cli/, docs/, agents/, config/. Updated each session."
read_when: ["project structure", "directory", "file layout", "where does code go", "codebase tree", "folder structure"]
---

# Project Structure

```
demos-agents/
├── CLAUDE.md                          # Principles + pointers (81 lines)
├── README.md                          # Public-facing docs
│
├── src/toolkit/                       # Framework-agnostic toolkit (~81 files, ADR-0002)
│   ├── index.ts                       # Barrel export
│   ├── types.ts                       # ToolResult, DemosError, DemosSession options
│   ├── session.ts                     # DemosSession — typed SigningHandle, expiry, bridge
│   ├── state-store.ts                 # FileStateStore — file-persisted state
│   ├── sdk-bridge.ts                  # SdkBridge — uses ChainTxPipeline for all chain writes
│   ├── chain-reader.ts               # On-chain data reading
│   ├── chain-scanner.ts              # Address-specific scanning
│   ├── hive-codec.ts                 # HIVE payload encode/decode
│   ├── url-validator.ts              # SSRF validator + createPinnedFetch
│   ├── schemas.ts                    # Zod schemas (11 + CatalogEntry + D402Requirement)
│   ├── tools/                        # 10 atomic tools (connect, publish, scan, verify, attest, tip, pay, discover-sources, feed-parser, tool-wrapper)
│   ├── guards/                       # 6 guards (write-rate-limit, dedup, tip-spend-cap, pay-spend-cap, pay-receipt-log, backoff)
│   ├── sources/                      # Source catalog, fetch, health, rate-limit
│   ├── providers/                    # Declarative engine, generic adapter, types
│   ├── reactive/                     # EventLoop<TAction>, watermark-store
│   ├── chain/                        # tx-pipeline (executeChainTx), asset-helpers
│   ├── math/                         # Ring buffer, MAD, z-score, winsorize
│   ├── network/                      # fetch-with-timeout, storage-client
│   ├── supercolony/                  # api-client, chain-identity, chain-utils, scoring, types
│   ├── colony/                       # Colony DB: schema, posts, reactions, claims, scanner, dedup, intelligence, embeddings, search
│   ├── supercolony/                  # api-client, api-schemas (Zod), chain-identity, chain-utils, scoring, types
│   ├── strategy/                     # Strategy engine: decideActions(), config-loader, types (split: engine, engine-helpers, engine-enrichment, engine-contradiction)
│   └── util/                         # errors.ts
│
├── src/                              # Core types + business logic
│   ├── types.ts                      # FrameworkPlugin, Action, EventPlugin, DataProvider
│   ├── plugins/                      # 24 FrameworkPlugin implementations
│   ├── actions/                      # Executor, publish pipeline (ChainTxPipeline)
│   ├── reactive/                     # @deprecated shims → toolkit/reactive/
│   └── lib/                          # 8 subdirs + flat files
│       ├── auth/                     # Challenge-response auth, token cache
│       ├── llm/                      # Provider-agnostic LLM adapter
│       ├── attestation/              # Claim extraction, attestation planner/policy
│       ├── scoring/                  # Expected score, quality signals
│       ├── sources/                  # Catalog, policy, matcher, health, lifecycle
│       ├── network/                  # SDK wrapper
│       ├── pipeline/                 # Publish pipeline
│       └── util/                     # Shared utilities
│
├── cli/                              # 34 CLI entry points (all 100% chain-only)
│   ├── session-runner.ts             # Cron loop (V3 default, --legacy-loop for V2)
│   ├── v3-loop.ts                    # V3: SENSE→ACT→CONFIRM
│   ├── v3-strategy-bridge.ts         # Strategy bridge: sense/plan/perf
│   ├── publish-executor.ts           # PUBLISH/REPLY with full attestation
│   ├── action-executor.ts            # ENGAGE/TIP lightweight executor
│   ├── event-runner.ts               # Long-lived reactive process
│   ├── hive-query.ts                 # On-chain query CLI (5 subcommands)
│   ├── backfill-colony.ts            # Full chain history backfill
│   ├── backfill-embeddings.ts        # Vector embedding backfill for semantic search
│   ├── publish-helpers.ts            # Source resolution + attestation helpers (extracted)
│   ├── publish-types.ts              # Shared types for publish executor
│   ├── v3-loop-helpers.ts            # V3 loop helper functions (extracted)
│   └── ...                           # audit, scan-feed, engage, gate, verify, identity, etc.
│
├── agents/                           # Agent definitions (YAML persona + strategy)
│   ├── sentinel/                     # General-purpose verification (active)
│   ├── crawler/                      # Deep research (100+ sources)
│   ├── pioneer/                      # Novel content originator
│   ├── nexus/                        # Inter-agent coordinator
│   ├── defi-markets/                 # DeFi market monitor
│   └── infra-ops/                    # Infrastructure operations
│
├── config/
│   ├── sources/catalog.json          # Unified source catalog (226 sources)
│   └── strategies/base-loop.yaml     # Base loop strategy
│
├── docs/                             # All docs have read_when frontmatter
│   ├── INDEX.md                      # Project history (9 eras)
│   ├── ROADMAP.md                    # Open work + Phase 10 plan
│   ├── architecture-plumbing-vs-strategy.md  # Toolkit/strategy boundary
│   ├── project-structure.md          # This file
│   ├── research/                     # Authoritative SDK + API references
│   ├── rules/                        # Project behavioral rules (6 files)
│   ├── decisions/                    # 14 ADRs (all accepted)
│   └── archive/                      # Completed docs, plans, designs, claude-codex-coop
│
├── .ai/guides/                       # Agent-facing context (5 files with use_when)
├── .sessions/                        # Session summaries (by month)
├── platform/                         # SuperColony-specific barrel
├── connectors/                       # SDK isolation
├── packages/core/                    # @demos-agents/core re-export barrel
├── skills/supercolony/               # SuperColony CLI skill
├── scripts/                          # Cron wrapper + log rotation
└── tests/                            # vitest test suites
```
