# Source Discovery Review

Date: 2026-03-14

## Findings

### High

- The proposal changes the quarantine workflow without reconciling the current agent contract. The task proposes adding discoveries directly to `sources/catalog.json` as quarantined records (`claude-codex-coop/TASK-source-discovery.md:7-11`, `:62-77`), but crawler docs still say discoveries go to a separate discovered-sources log rather than the curated registry (`agents/crawler/persona.md:45-48`, `agents/crawler/strategy.yaml:51-58`, `agents/crawler/AGENT.yaml:57-59`, `:83-87`). There is also an existing discovery module that still persists discovered sources to YAML registries (`tools/lib/source-discovery.ts:242-349`). This is not just a new CLI; it is a policy and storage migration. If that migration is intended, the design should say so explicitly and include how the old discovery path is retired.

- The provider-expansion contract is underspecified and cannot satisfy its own tests as written. `DiscoveryCandidate` has no `operation` field (`claude-codex-coop/TASK-source-discovery.md:21-37`), yet the proposed tests require deduping by `provider+operation` (`claude-codex-coop/TASK-source-discovery.md:123-126`) and the provider expansion registry itself is keyed by `operation` (`claude-codex-coop/TASK-source-discovery.md:82-93`). Existing catalog records already have an `adapter.operation` slot for this identity (`tools/lib/sources/catalog.ts:82-86`). In addition, `discoverFromProviders(existingProviders, gaps)` does not receive enough information to decide whether a specific operation is already represented (`claude-codex-coop/TASK-source-discovery.md:53-60`). This needs to be fixed before implementation.

### Medium

- `addToCatalog()` is too loosely specified for `SourceRecordV2`. A valid catalog record needs more than `status`, `discoveredBy`, and a hashed ID: it must include valid `scope`, `runtime`, `trustTier`, `rating`, `domainTags`, and `responseFormat` fields (`tools/lib/sources/catalog.ts:45-115`, `:478-561`). Visibility also matters because `loadAgentSourceView()` filters by agent scope and allowed statuses (`tools/lib/sources/catalog.ts:641-697`). Without tests for these defaults, it is easy to write quarantined records that validate poorly or are visible to the wrong agents.

- The coverage-gap tests do not match runtime lookup behavior closely enough. The current source index uses topic tokens, `topicAliases`, `domainTags`, and agent scoping (`tools/lib/sources/catalog.ts:395-452`). The proposed `analyzeCoverage` tests only mention counting active sources by topic (`claude-codex-coop/TASK-source-discovery.md:112-117`). That will miss false gaps where coverage exists through aliases/tags, and it can overcount sources that are not visible to the target agent.

## Q1-Q5

**Q1:** Start CLI-only, or at most scheduled/manual. The crawler constraint says "Max 5 new source discoveries per session" (`agents/crawler/AGENT.yaml:57`, `:83-87`), but the current workflow still treats discovery as a quarantined side log (`agents/crawler/persona.md:46-48`). Automating this in every session before the storage model is unified will create duplicate paths and unclear operator expectations. Once the catalog-based flow replaces the old one, an automated crawler-only hook is reasonable.

**Q2:** Provider expansion is the right default. It is deterministic, bounded, and easy to validate against the existing catalog. LLM-based discovery is useful only as an offline suggestion layer that still feeds a deterministic validator. It should not be the primary source of candidate URLs for the first implementation.

**Q3:** Scope newly discovered sources to the discovering agent first. Current catalog records are enforced by per-agent visibility (`tools/lib/sources/catalog.ts:65-70`, `:654-659`), and the current catalog snapshot is entirely scoped rather than global. Making fresh discoveries global immediately would be a behavior expansion beyond the current model. Promote to global only after lifecycle promotion or manual curation proves the source is broadly useful.

**Q4:** Skip auth-required APIs for this phase. The crawler rules already say discovered URLs must be safe and must not receive forwarded auth headers (`agents/crawler/AGENT.yaml:58-59`, `agents/crawler/strategy.yaml:54-61`). A separate "needs-auth" inventory is fine for later, but those candidates should not enter the same auto-discovery path or quarantined catalog until there is an explicit credential model.

**Q5:** Keep the curated API directory as a TypeScript const for now. The list is part of executable discovery policy, benefits from compile-time typing, and needs tight coupling to normalized candidate shape. Move it to YAML only if non-code maintainers need to edit it frequently or the list becomes large enough that code review around it becomes noisy.

## Test Contract Validation

The current test contracts are directionally right, but incomplete.

- `analyzeCoverage`: add tests that count only sources visible to the target agent, and tests that treat `topicAliases`/`domainTags` as coverage. Also decide explicitly whether `degraded` counts toward coverage; the current contract only says "active".

- `discoverFromProviders`: add a test that the discovered candidate preserves `operation`, because otherwise `provider+operation` dedupe and `adapter.operation` population are impossible. Also add a test that quarantined catalog entries block rediscovery; dedupe should not care whether an existing record is active or quarantined.

- `deduplicateCandidates`: add a test that dedupe normalizes URL patterns before comparison, rather than trusting caller-provided `urlPattern`. The canonical normalization logic already exists in `normalizeUrlPattern()` (`tools/lib/sources/catalog.ts:241-255`).

- `addToCatalog`: add tests that the produced record passes `isValidSourceRecord()` or round-trips through `loadCatalog()`, that `scope.agents` and `scope.importedFrom` are correct for the discovering agent, that `runtime`/`rating`/`trustTier` defaults are filled, and that `generatedAt` is updated alongside the atomic write.

## Validation Notes

- I did not validate this by running discovery tests because the feature does not exist yet.
- I did try to run the adjacent source test suites with `npx vitest run tests/lifecycle.test.ts tests/source-health.test.ts`, but the workspace is on Node `v18.19.1` while `vitest@4.1.0` currently pulls code that imports `node:util.styleText`, which is not available in this runtime. So test execution is blocked by the local toolchain rather than by this design review.
