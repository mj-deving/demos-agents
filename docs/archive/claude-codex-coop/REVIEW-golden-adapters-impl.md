# Golden Adapter Removal Implementation Review

## Answers to Q1-Q5

### Q1. Are there any remaining references to the deleted hand-written adapter files anywhere in the codebase?

Yes, but with an important split:

- In tracked source under `tools/` and `tests/`, I did not find any remaining live TypeScript imports or re-exports of the deleted adapter files. `tools/lib/sources/providers/index.ts` is clean and declarative-only now.
- There is still a stale ignored build artifact at `dist/tools/lib/sources/providers/index.js:7-16` importing all 10 deleted adapters and registering them.
- There are also historical references in review/task/design docs, for example `claude-codex-coop/TASK-golden-adapters.md`, `claude-codex-coop/TASK-phase4-impl-review.md`, `claude-codex-coop/REVIEW-phase4.md`, `Plans/source-registry-v2.md`, and `CLAUDE.md`.

So the removal is clean in the live TypeScript source path, but not clean across the whole workspace.

### Q2. Is the `{.}` self-reference addition in `declarative-engine.ts` correctly placed and safe (no edge cases)?

Yes for the current use case.

- The implementation at `tools/lib/sources/providers/declarative-engine.ts:574-607` is correctly placed inside `resolveTemplate()`, after `{key}` handling and before variable/object lookup.
- It only activates for the exact placeholder `.` and only when the current item is a primitive (`typeof item !== "object"`), which is exactly what PubMed `esearch` needs at `tools/lib/sources/providers/specs/pubmed.yaml:61-75`.
- I did not find another current spec that would be negatively affected by this branch.

The only caveat is scope: it does not help array/object items, and it does not change other template limitations.

### Q3. Are there any other files that need to be updated after removing the hand-written adapters (imports, re-exports, documentation)?

Yes.

- `dist/tools/lib/sources/providers/index.js:7-30` should be regenerated or removed; it still wires in the deleted handwritten adapters.
- Documentation is partly stale if you want the repo to describe the current state rather than historical work. The clearest stale references are in `CLAUDE.md:101`, `Plans/source-registry-v2.md:113-120`, `claude-codex-coop/TASK-golden-adapters.md:167-176`, and `claude-codex-coop/TASK-phase4-impl-review.md:19-28`.

I did not find a missing import or re-export in the tracked TypeScript runtime path beyond the ignored `dist/` output.

### Q4. Does the test coverage adequately validate the declarative adapter behavior for production use?

No.

The golden suite passes (`62` tests), but it is not production-adequate because it misses both important runtime paths and important operations:

- It loads adapters with `loadDeclarativeProviderAdaptersSync()` at `tests/golden-adapters.test.ts:28-35`, which bypasses the async hook-loading path used by production registry initialization.
- That means it does not catch that hook-dependent providers are still miswired: the engine only looks for `operation.parse.hooks` at `tools/lib/sources/providers/declarative-engine.ts:1153-1162` and `tools/lib/sources/providers/declarative-engine.ts:1227-1233`, while the shipped specs declare `hooks:` at the operation level in `tools/lib/sources/providers/specs/arxiv.yaml:88-93` and `tools/lib/sources/providers/specs/kraken.yaml:113-118`, `166-167`, `267-272`.
- Several operations remain untested after adapter removal: `hn-algolia` `ask_hn` and `show_hn`; `coingecko` `market-chart` and `categories`; `github` `releases`; `defillama` `dexs` and `stablecoins`; `pubmed` `esummary`; `kraken` `ohlc`.
- The suite also does not assert the production hook effects that used to matter in handwritten adapters, especially arXiv canonical URL normalization/author aggregation and Kraken hook-driven behavior.

### Q5. Are the YAML spec fixes for `tokens[0]` quoting correct and complete?

Yes.

- The affected YAML array-source entries are quoted everywhere they appear in `tools/lib/sources/providers/specs/binance.yaml:39-42`, `112-115`, `202-205` and `tools/lib/sources/providers/specs/kraken.yaml:39-42`, `188-191`.
- I did not find any remaining unquoted `tokens[0]` entries in provider specs.
- The only other `tokens[0]` usage is inside a template string in `tools/lib/sources/providers/specs/hn-algolia.yaml:36`, which is not the YAML parsing problem this fix addressed.

## Findings

### P0

- None.

### P1

- Hook-dependent adapters are still not exercised through the real production path, and the current hook wiring is still wrong. The engine resolves hooks from `operation.parse.hooks` in `tools/lib/sources/providers/declarative-engine.ts:1153-1162` and preloads from `op.parse?.hooks?.module` in `tools/lib/sources/providers/declarative-engine.ts:1227-1233`, but the shipped specs put `hooks:` at the operation level in `tools/lib/sources/providers/specs/arxiv.yaml:88-93` and `tools/lib/sources/providers/specs/kraken.yaml:113-118`, `166-167`, `267-272`. With handwritten adapters removed, this is no longer masked. I confirmed the async loader still returns arXiv entries with `http://` canonical URLs and only the first author, so the hook behavior is not active.
- `pubmed` `esummary` is still broken and untested. `object-entries` ignores `items.jsonPath` and iterates the full root object in `tools/lib/sources/providers/declarative-engine.ts:696-700`, while the spec expects iteration over `$.result` in `tools/lib/sources/providers/specs/pubmed.yaml:118-148`. Current behavior collapses the response into one `id: "result"` entry instead of per-UID entries.

### P2

- The ignored build output still references the deleted handwritten adapters. `dist/tools/lib/sources/providers/index.js:7-30` statically imports and registers all 10 removed modules. This is not a tracked source regression, but it is still present in the workspace and can mislead anyone running from `dist/`.
- The test suite is materially incomplete for post-removal confidence. It covers the happy path for many providers, but it still omits `ask_hn`, `show_hn`, `market-chart`, `categories`, `releases`, `dexs`, `stablecoins`, `esummary`, and `ohlc`, and it does not validate the real registry path in `tools/lib/sources/providers/index.ts:25-33`.
- Some repository documentation still describes the deleted handwritten adapter files as current structure, especially `CLAUDE.md:101`, `Plans/source-registry-v2.md:113-120`, `claude-codex-coop/TASK-golden-adapters.md:167-176`, and `claude-codex-coop/TASK-phase4-impl-review.md:19-28`.

## Risk Assessment

Overall risk is still medium-high for production use.

- The source-tree adapter removal itself is mostly clean.
- The `{.}` fix and the `tokens[0]` YAML quoting fix both look correct.
- The main remaining risk is not leftover imports; it is behavioral coverage. Production still depends on runtime paths and operations that the current golden suite does not exercise, and one hook path plus one PubMed parse path are still demonstrably wrong after handwritten adapter removal.

I would treat the adapter-file deletion as mechanically complete, but not as fully validated for production until the P1 items are fixed and the missing operation/runtime coverage is added.
