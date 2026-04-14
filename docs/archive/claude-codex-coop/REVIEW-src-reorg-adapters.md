# Review: `Plans/tingly-snacking-glacier.md`

## Verdict

Items 7 and 8 look straightforward. Items 5 and 6 need changes before execution.

The two biggest problems are:

1. Item 6's categories do not line up with the actual code boundaries.
2. Item 5's bridge sketches are directionally right, but several interfaces are mapped incorrectly or too loosely to be safe.

## Findings

### 1. Item 6 miscategorizes several modules

The plan says `providers/` will contain "data suppliers" and `services/` will contain "background processes" ([Plans/tingly-snacking-glacier.md:55-59](../Plans/tingly-snacking-glacier.md)), but multiple proposed moves do not match what the files actually do.

- `src/lib/event-sources/*` should not move to `src/providers/event-sources/`.
  Evidence: `EventSource` is its own runtime abstraction with `poll()`, `diff()`, and `extractWatermark()` ([src/types.ts:255-286](../src/types.ts)). `src/lib/event-sources/social-replies.ts` is a concrete `EventSource<ReplySnapshot>` implementation, not a `DataProvider` ([src/lib/event-sources/social-replies.ts:31-67](../src/lib/event-sources/social-replies.ts)). This belongs with the reactive runtime, not with providers.

- `src/lib/storage-client.ts` is not a provider.
  Evidence: it is an SDK wrapper around `@kynesyslabs/demosdk/storage` and exposes CRUD/payload builders for Storage Programs ([src/lib/storage-client.ts:1-140](../src/lib/storage-client.ts)). That is a platform connector/client or service, not a data supplier.

- `src/lib/scoring.ts` is not a provider.
  Evidence: it is a pure formula module with constants and `calculateExpectedScore()` only ([src/lib/scoring.ts](../src/lib/scoring.ts)). This fits `lib/` or `utils/`, not `providers/`.

- `src/lib/budget-tracker.ts` is not a provider.
  Evidence: it creates in-memory budget state with `canAfford`, `recordSpend`, `recordIncome`, and `getSummary` ([src/lib/budget-tracker.ts](../src/lib/budget-tracker.ts)). It is stateful policy/accounting logic, closer to a service or lib helper.

- `src/lib/source-discovery.ts` is not a provider.
  Evidence: it generates candidate URLs, scores relevance, and persists registry changes ([src/lib/source-discovery.ts:1-120](../src/lib/source-discovery.ts)). This is discovery/admin logic, not runtime provider logic.

- `src/lib/sources/lifecycle.ts` and `src/lib/sources/rate-limit.ts` are weak fits for `evaluators/`.
  `lifecycle.ts` manages state transitions; the architecture doc itself classifies source lifecycle as "Service + Events" ([docs/architecture-comparison-elizaos.md:745-746](../docs/architecture-comparison-elizaos.md)).
  `rate-limit.ts` is transport throttling, not content evaluation.

- `src/lib/predictions.ts`, `src/lib/mentions.ts`, and `src/lib/tips.ts` being left in `lib/` is inconsistent with the stated role-based split.
  `predictions.ts` persists and resolves prediction state ([src/lib/predictions.ts:1-120](../src/lib/predictions.ts)).
  `mentions.ts` persists polling cursor state and fetches mentions.
  `tips.ts` both selects candidates and executes a tip, with persisted tip state and spending-policy integration ([src/lib/tips.ts:13-59](../src/lib/tips.ts)).
  If the goal is a real role split, these need an explicit home too.

### 2. "One category at a time" is not a clean safety boundary

I do not think the proposed phase order in Item 6 is cleanly safe as written ([Plans/tingly-snacking-glacier.md:156-166](../Plans/tingly-snacking-glacier.md)).

The problem is not that the repo must be changed in one giant commit. The problem is that the proposed categories cut across the real dependency clusters:

- `action-executor.ts` imports `own-tx-hashes`, `write-rate-limit`, `publish-pipeline`, and `llm` ([src/lib/action-executor.ts:11-17](../src/lib/action-executor.ts)).
- `omniweb-action-executor.ts` imports `action-executor`, `storage-client`, and `budget-tracker` ([src/lib/omniweb-action-executor.ts:11-15](../src/lib/omniweb-action-executor.ts)).
- Event handlers import event sources (`reply-handler` → `social-replies`, `incident-alert-handler` → `status-monitor`, etc.) ([src/lib/event-handlers/reply-handler.ts:8-9](../src/lib/event-handlers/reply-handler.ts)).
- The whole `sources/*` subtree is tightly coupled: `policy.ts`, `matcher.ts`, `health.ts`, `lifecycle.ts`, `fetch.ts`, `catalog.ts`, and `providers/*` all import each other.

That means moving "actions" first still forces immediate rewrites to unmoved files, and then more rewrites later when those unmoved files move. The code can be kept compiling, but the phase boundary is artificial and churn-heavy.

Safer unit of change: move by dependency cluster, not by nominal role.

### 3. Item 5 bridge sketches do not yet match the actual Eliza/demos boundaries

The architecture doc is useful, but the plan's code sketches flatten some important differences.

- `config-bridge.ts` is wrong/incomplete as written.
  The sketch uses `loadAgentConfig(agentName)` and then references `identity.role` / `identity.mission` / `personaMdPath` even though those are not returned by `AgentConfig` and `personaMdPath` is undefined in the snippet ([Plans/tingly-snacking-glacier.md:199-212](../Plans/tingly-snacking-glacier.md)).
  `AgentConfig` gives `displayName`, topics, loop extensions, and `paths.agentYaml` / `paths.personaMd` ([src/lib/agent-config.ts:24-82](../src/lib/agent-config.ts)).
  The mapping doc explicitly says `Character.bio` comes from `AGENT.yaml`, `Character.topics` from `persona.yaml`, `Character.style.post` from `persona.md`, and `Character.plugins` from `capabilities.skills`, not from `loopExtensions` ([docs/architecture-comparison-elizaos.md:659-667](../docs/architecture-comparison-elizaos.md)).

- `action-bridge.ts` is underspecified.
  The demos `ActionInput` is `{ context, metadata }` ([src/types.ts:102-112](../src/types.ts)), so passing raw `state` as `context` drops `runtime` and `message`, which are likely the important Eliza inputs.
  Also, demos `ActionResult` is `{ success, data?, text?, error? }` ([src/types.ts:114-123](../src/types.ts)), while the Eliza doc expects `ActionResult { success, text?, values?, data? }` ([docs/architecture-comparison-elizaos.md:34-46](../docs/architecture-comparison-elizaos.md)). The bridge should normalize the result shape instead of blindly returning demos output.

- `provider-bridge.ts` should serialize the full `ProviderResult`, not only `result.data`.
  The doc says `JSON.stringify(result)` ([docs/architecture-comparison-elizaos.md:704-708](../docs/architecture-comparison-elizaos.md)).
  Demos `ProviderResult` carries `ok`, `error`, `source`, and `metadata` in addition to `data` ([src/types.ts:27-42](../src/types.ts)).
  Returning only `JSON.stringify(result.data)` throws away exactly the fields that explain provider failure or provenance.

- `evaluator-bridge.ts` is harder than the plan implies.
  Demos evaluators return `EvaluatorResult { pass, score, reason, details }` ([src/types.ts:48-77](../src/types.ts)).
  Eliza evaluators have `validate()` plus `handler(): Promise<void>` and additional required fields like `similes`, `examples`, and `alwaysRun` ([docs/architecture-comparison-elizaos.md:52-60](../docs/architecture-comparison-elizaos.md)).
  This cannot be a pure signature rename. The bridge needs a policy for how a demos evaluation result becomes Eliza-side side effects or state.

- `event-service.ts` must produce a `Service` class, not just wrap an `EventSource`.
  The mapping doc is explicit that Eliza `services` expects `typeof Service[]` and that this bridge is higher effort ([docs/architecture-comparison-elizaos.md:631](../docs/architecture-comparison-elizaos.md), [docs/architecture-comparison-elizaos.md:716-721](../docs/architecture-comparison-elizaos.md)).
  The plan currently does not say that.

- `watermark-adapter.ts` is conceptually backwards.
  The Eliza plugin owns an `IDatabaseAdapter`; demos needs a `WatermarkStore`.
  So the useful bridge is "Eliza DB adapter -> demos WatermarkStore", not "demos WatermarkStore -> Eliza DB adapter".
  The doc itself notes the scope mismatch: `IDatabaseAdapter` is much broader than `WatermarkStore` ([docs/architecture-comparison-elizaos.md:633](../docs/architecture-comparison-elizaos.md), [docs/architecture-comparison-elizaos.md:730-735](../docs/architecture-comparison-elizaos.md)).

### 4. The plan misses several concrete update sites

The plan mentions `src/index.ts` and `tests/import-boundaries.test.ts`, which is good, but the actual blast radius is larger.

- `src/index.ts` absolutely needs updates.
  It re-exports multiple files proposed to move: `scoring`, `sources/*`, etc. ([src/index.ts:17-94](../src/index.ts)).

- `platform/index.ts` absolutely needs updates.
  It re-exports `publish-pipeline`, `write-rate-limit`, `spending-policy`, `signals`, `predictions`, `tips`, `mentions`, `feed-filter`, and `llm` ([platform/index.ts:14-43](../platform/index.ts)).

- `src/plugins/*.ts` is not just "maybe".
  `src/plugins/budget-plugin.ts` dynamically imports `../lib/budget-tracker.js` ([src/plugins/budget-plugin.ts:33-40](../src/plugins/budget-plugin.ts)).
  `src/plugins/sources-plugin.ts` imports `../lib/sources/policy.js` and `../lib/sources/matcher.js` ([src/plugins/sources-plugin.ts:14-16](../src/plugins/sources-plugin.ts)).

- `connectors/index.ts` does not import any file proposed to move.
  It only re-exports `../src/lib/sdk.js` ([connectors/index.ts:9-14](../connectors/index.ts)).
  Unless `sdk.ts` moves too, this file is unaffected by Item 6.

- `cli/session-runner.ts` has dynamic import strings that the current plan does not call out.
  Examples: `../src/lib/sources/fetch.js`, `../src/lib/sources/providers/index.js`, `../src/lib/sources/catalog.js`, `../src/lib/sources/health.js`, `../src/lib/sources/lifecycle.js` ([cli/session-runner.ts:1901-1905](../cli/session-runner.ts), [cli/session-runner.ts:3592-3594](../cli/session-runner.ts)).

- `cli/event-runner.ts` is a concentrated consumer of the reactive subtree and will need coordinated updates if those files move ([cli/event-runner.ts:24-49](../cli/event-runner.ts)).

- Several tests use literal path strings, not import resolution:
  `tests/import-boundaries.test.ts` hardcodes source file paths ([tests/import-boundaries.test.ts:74-97](../tests/import-boundaries.test.ts)).
  `tests/declarative-engine.test.ts` hardcodes `src/lib/sources/providers/specs` ([tests/declarative-engine.test.ts:202-205](../tests/declarative-engine.test.ts)).
  `tests/golden-adapters.test.ts` hardcodes the same specs directory ([tests/golden-adapters.test.ts:28-35](../tests/golden-adapters.test.ts)).
  `tests/gate-opinion.test.ts` reads `src/lib/llm.ts` directly ([tests/gate-opinion.test.ts:47-60](../tests/gate-opinion.test.ts)).

## Direct Answers To Your Questions

### 1. Item 6 categorization accuracy

Mostly no. I would change these:

- Move `src/lib/event-sources/*` with the reactive runtime, not `providers/`.
- Move `src/lib/event-handlers/*` alongside that reactive runtime, not under generic `actions/`.
- Keep `src/lib/scoring.ts` in `lib/` unless you create a dedicated `scoring/` or `policy/` area.
- Move `src/lib/storage-client.ts` to a platform/connectors/services area, not `providers/`.
- Move `src/lib/source-discovery.ts` to a service/admin area, not `providers/`.
- Keep `src/lib/feed-filter.ts` in `lib/` or move it to a feed-specific area; it is utility-heavy, not a provider abstraction.
- Treat `src/lib/predictions.ts`, `src/lib/mentions.ts`, and `src/lib/tips.ts` as services or explicitly justify why they remain in `lib/`.
- Keep the `src/lib/sources/*` subtree together instead of splitting it across `providers/` and `evaluators/`.

### 2. Item 6 incremental strategy

Doing one category at a time is not the right safety boundary.

What is safe:

- Move by subsystem/dependency cluster.
- Update imports, barrels, dynamic imports, and tests for that cluster in the same commit.

Suggested clusters:

- `sources/` cluster: `catalog`, `fetch`, `providers/*`, `policy`, `matcher`, `health`, `lifecycle`, `rate-limit`.
- Reactive cluster: `event-sources/*`, `event-handlers/*`, `event-loop`, `watermark-store`, `own-tx-hashes`.
- Action/runtime cluster: `action-executor`, `omniweb-action-executor`, `publish-pipeline`, `llm`, `write-rate-limit`, `storage-client`, `budget-tracker`.
- Public surface cluster: `src/index.ts`, `platform/index.ts`, plugins, CLI dynamic imports, tests.

I would not do all 62 files atomically, but I also would not use the current category order.

### 3. Item 5 adapter design

The bridge list is fine. The current bridge sketches need these corrections:

- `config-bridge` must read `AGENT.yaml` + `persona.yaml` + `persona.md`; `loadAgentConfig()` alone is not enough for `bio` and `plugins`.
- `config.loopExtensions` should not map directly to `Character.plugins`; the mapping doc says `capabilities.skills`.
- `action-bridge` should build `ActionInput.context` from `{ runtime, message, state }`, not only `state`.
- `action-bridge` should normalize demos `ActionResult` into the Eliza result shape instead of returning it verbatim.
- `provider-bridge` should stringify full `ProviderResult`, not only `result.data`.
- `evaluator-bridge` needs a concrete design for `alwaysRun`, `validate`, and what the `handler()` does with `EvaluatorResult`.
- `event-service` must be a real Eliza `Service` subclass.
- `watermark-adapter` should adapt Eliza's DB adapter into a demos `WatermarkStore`, not attempt to replace Eliza's DB adapter.

### 4. Missing items

Specific answers:

- `src/index.ts`: yes, must be updated.
- `src/plugins/*.ts`: yes, at least `budget-plugin.ts` and `sources-plugin.ts`.
- `platform/index.ts`: yes, definitely.
- `connectors/index.ts`: no, not for the current Item 6 plan.

Also missing:

- `cli/session-runner.ts` dynamic imports.
- `cli/event-runner.ts` reactive imports.
- Tests with hardcoded path strings and spec directory paths.

## What I Would Change

1. Change Item 6 from a pure role split to a subsystem-first move plan.
2. Keep the `sources/*` subtree together.
3. Create a dedicated reactive subtree for `event-sources`, `event-handlers`, `event-loop`, `watermark-store`, and related state helpers.
4. Do not put `scoring.ts`, `budget-tracker.ts`, `storage-client.ts`, or `source-discovery.ts` under `providers/` as currently proposed.
5. Expand the migration checklist to include `platform/index.ts`, plugin imports, CLI dynamic imports, and the tests with literal paths.
6. Rewrite the Item 5 bridge sketches before implementation so they match the actual source-of-truth mapping in `docs/architecture-comparison-elizaos.md`.
7. Consider decoupling Item 5 from Item 6 for P1 bridge work. `config-bridge`, `action-bridge`, and `provider-bridge` can be developed against current stable types; making them wait for a large file move increases blast radius without much benefit.
