# Phase 3 Design Review: Sources Extraction

## Context Snapshot

This review is based on:

- `Plans/unified-loop-architecture-v2.md`
- `Plans/source-registry-v2.md`
- `tools/lib/attestation-policy.ts`
- `tools/lib/source-discovery.ts`
- `tools/session-runner.ts`
- `tools/lib/state.ts`
- `agents/{sentinel,crawler,pioneer}/sources-registry.yaml`
- `agents/{sentinel,crawler,pioneer}/persona.yaml`

Current-state facts that materially affect Phase 3:

- `session-runner.ts` still imports `discoverSourceForTopic()` and `persistSourceToRegistry()` directly and calls them in both gate and publish.
- `runV2Loop()` still hardcodes `calibrate`; there is no generic extension dispatcher yet.
- `KNOWN_EXTENSIONS` includes `sources`, but nothing invokes it.
- The source-registry subplan still conflicts with the unified plan on lifecycle names and matcher thresholds.
- Registry overlap is asymmetric:
  - sentinel: 54 sources
  - crawler: 121 sources
  - pioneer: 21 sources
  - sentinel/crawler overlap: 54
  - pioneer overlap with either: 2
  - unique total across all three registries: 140

That means Phase 3 cannot be implemented cleanly by "just moving files"; it needs explicit decisions on schema ownership, runtime boundaries, and migration behavior.

## Q1: `catalog.json` Record Schema

### Answer

Use a single catalog file with a top-level wrapper and a normalized `SourceRecordV2` that preserves the current YAML fields while adding runtime/admin metadata.

```ts
type AgentName = "sentinel" | "crawler" | "pioneer";
type AttestationMethod = "TLSN" | "DAHR";
type SourceStatus =
  | "quarantined"
  | "active"
  | "degraded"
  | "stale"
  | "deprecated"
  | "archived";

type TrustTier = "official" | "established" | "community" | "experimental";

interface SourceCatalogFileV2 {
  version: 2;
  generatedAt: string;
  aliasesVersion: number;
  sources: SourceRecordV2[];
}

interface SourceRecordV2 {
  // Stable identity
  id: string;                         // deterministic: provider + normalized urlPattern
  name: string;                       // preserve current field for compatibility
  provider: string;                   // "coingecko" | "hn-algolia" | ...
  url: string;                        // preserve current field; template or resolved pattern
  urlPattern: string;                 // normalized template without topic-specific expansion

  // Backward-compatible source metadata
  topics?: string[];                  // preserve current field
  tlsn_safe?: boolean;                // preserve current field
  dahr_safe?: boolean;                // preserve current field
  max_response_kb?: number;           // preserve current field
  note?: string;                      // preserve current field

  // Normalized lookup metadata
  topicAliases?: string[];
  domainTags: string[];
  responseFormat: "json" | "xml" | "rss" | "html";

  // Agent scoping and provenance
  scope: {
    visibility: "global" | "scoped";
    agents?: AgentName[];             // required when visibility = "scoped"
    importedFrom: AgentName[];        // which YAML registries originally contained it
  };

  // Runtime fetch policy
  runtime: {
    timeoutMs: number;
    retry: {
      maxAttempts: number;
      backoffMs: number;
      retryOn: Array<"timeout" | "5xx" | "429">;
    };
  };

  // Quality and lifecycle
  trustTier: TrustTier;
  status: SourceStatus;
  rating: {
    overall: number;
    uptime: number;
    relevance: number;
    freshness: number;
    sizeStability: number;
    engagement: number;
    trust: number;                    // derived from trustTier; persisted for auditability
    lastTestedAt?: string;
    testCount: number;
    successCount: number;
    consecutiveFailures: number;
  };

  lifecycle: {
    discoveredAt: string;
    discoveredBy: "manual" | "import" | "auto-discovery";
    promotedAt?: string;
    deprecatedAt?: string;
    archivedAt?: string;
    lastUsedAt?: string;
    lastFailedAt?: string;
    failureReason?: string;
  };
}
```

Also add a compatibility normalizer:

```ts
type SourceRecordLike = SourceRecord | SourceRecordV2;

function normalizeSourceRecord(input: SourceRecordLike, sourceAgent?: AgentName): SourceRecordV2;
```

Migration/import rules:

- If a source comes from exactly one YAML file, import it as `scope.visibility = "scoped"` and `scope.agents = [thatAgent]`.
- If a source appears in multiple YAML files, import it as `scope.visibility = "scoped"` with the union of those agents.
- Manual catalog curation can later promote a source to `visibility = "global"` once it is intentionally shared.
- Imported records start with:
  - `status = "active"` for manual YAML imports
  - `trustTier = "established"` unless explicitly upgraded/downgraded
  - baseline rating fields filled with neutral defaults, not synthetic success history

### Rationale

This preserves the existing runtime field names (`name`, `url`, `topics`, `tlsn_safe`, `dahr_safe`, `max_response_kb`, `note`) so Phase 3 can normalize YAML and JSON through one loader instead of rewriting every call site at once. It also separates three concerns cleanly:

- source identity and lookup
- runtime fetch policy
- admin-only lifecycle/rating state

The key decision is `scope`. The current data is not globally uniform: sentinel is a strict subset of crawler, while pioneer is mostly disjoint. A single catalog without per-record scoping would erase current curation; separate catalogs would defeat the Phase 3 goal.

### Risks

- If `scope` is omitted, the migration will silently broaden agent access to sources that were intentionally curated out.
- If imported sources are marked `global` by default, pioneer and sentinel will start seeing crawler-only sources immediately.
- If the schema drops the old field names, the YAML fallback path becomes a second loader instead of a normalizer, which doubles maintenance.

### Dependencies

- New catalog loader/normalizer in `tools/lib/sources/catalog.ts`
- Migration script that records `scope.importedFrom` and `scope.agents`
- Agent config path additions for catalog and source-view config
- JSON schema for validation

## Q2: Inverted Index Design

### Answer

Build the index in memory on load. Do not persist a separate file-backed index in Phase 3.

```ts
interface SourceIndex {
  byId: Map<string, SourceRecordV2>;
  byTopicToken: Map<string, Set<string>>;    // token -> source IDs
  byDomainTag: Map<string, Set<string>>;     // domain -> source IDs
  byProvider: Map<string, Set<string>>;      // provider -> source IDs
  byAgent: Map<AgentName, Set<string>>;      // scope filter
  byMethod: {
    TLSN: Set<string>;
    DAHR: Set<string>;
  };
}

interface CandidateLookupOptions {
  topic: string;
  agent: AgentName;
  method: AttestationMethod;
  minRating?: number;
  includeStatuses?: SourceStatus[];
}

function buildSourceIndex(catalog: SourceRecordV2[], aliases: Record<string, string[]>): SourceIndex;
function lookupCandidateSourceIds(index: SourceIndex, options: CandidateLookupOptions): string[];
```

Rules:

- Index keys come from normalized tokens of `topics`, `topicAliases`, and `domainTags`.
- Alias expansion happens before lookup. Example: query token `btc` expands to canonical token `bitcoin`.
- Method filtering happens in the index layer via `byMethod`.
- Agent filtering happens in the index layer via `scope`.
- Final scoring still uses the existing overlap heuristic as the ranking layer, moved into `sources/policy.ts`.

Operationally:

1. `catalog.ts` loads `catalog.json` or YAML fallback.
2. `catalog.ts` normalizes records to `SourceRecordV2`.
3. `catalog.ts` builds `SourceIndex` once.
4. `policy.ts` asks the index for a candidate ID set.
5. `policy.ts` runs the current `tokenizeTopic`/overlap scoring only on that reduced set.

### Rationale

The current matcher is not broken; it is just doing O(n) scoring over the whole registry. Phase 3 should keep the current selection semantics and make candidate retrieval cheaper and more explicit. Reusing the current token overlap logic also reduces migration risk because preflight behavior stays familiar.

Persisting an index file now is unnecessary complexity:

- current unique source count is 140, not 1000+
- even 1000 records is cheap to index at process start
- file-backed indexes introduce invalidation problems during catalog writes

### Risks

- If `topicAliases` and `domainTags` are both indexed without weighting, broad tags can swamp specific topic tokens.
- If index lookup returns an empty set and the code does not fall back to full-scan ranking, false negatives will increase during early alias tuning.
- If the code treats the index as authoritative for scoring, it will lose the existing name/token tie-break behavior.

### Dependencies

- Move `tokenizeTopic()` and `sourceTopicTokens()` out of `attestation-policy.ts`
- Add alias loading and normalization
- Add a reduced-set ranking function that accepts `SourceRecordV2[]`

## Q3: Agent-Specific Sources in Unified Catalog

### Answer

Use one global `catalog.json`, plus one per-agent view config file, plus per-source scope metadata.

Recommended layout:

```text
sources/catalog.json
agents/sentinel/source-config.yaml
agents/crawler/source-config.yaml
agents/pioneer/source-config.yaml
```

Per-agent config:

```ts
interface AgentSourceConfig {
  agent: AgentName;
  minRating: number;
  allowStatuses: SourceStatus[];       // default: ["active", "degraded"]
  preferredMethod?: AttestationMethod; // optional tie-break hint, not policy
  maxCandidatesPerTopic: number;       // default: 5
  domainAllowlist?: string[];
}
```

Per-source visibility:

- `scope.visibility = "scoped"` plus `scope.agents` preserves existing curated agent subsets.
- `scope.visibility = "global"` makes a source visible to all agents.

Call-site change:

Current:

```ts
const sources = loadSourceRegistry(agentConfig.paths.sourcesRegistry);
```

Phase 3:

```ts
const sourceView = loadAgentSourceView({
  agent: agentConfig.name as AgentName,
  catalogPath: agentConfig.paths.sourceCatalog,
  sourceConfigPath: agentConfig.paths.sourceConfig,
  yamlFallbackPath: agentConfig.paths.sourcesRegistry,
});
```

`sourceView` should return:

```ts
interface AgentSourceView {
  agent: AgentName;
  catalogVersion: 2 | 1;
  sources: SourceRecordV2[];
  index: SourceIndex;
}
```

### Rationale

One catalog avoids duplication and preserves a single lifecycle/rating state. Per-agent source configs keep agent behavior explicit and readable. Per-source scope preserves current curation during migration.

This is better than a plain `agents: string[]` field alone because it separates:

- source visibility (`scope`)
- agent policy (`source-config.yaml`)

It is also better than separate catalogs because rating, lifecycle, and discovery should converge on one source of truth.

### Risks

- If `source-config.yaml` is optional but scope is mandatory, behavior becomes hard to reason about when one is missing.
- If agent filtering happens after match scoring instead of before candidate lookup, runtime work increases and debug output gets noisy.
- If the loader keeps accepting raw YAML arrays without stamping an agent identity, scope information will be lost on fallback.

### Dependencies

- Add `sourceCatalog` and `sourceConfig` to `AgentPaths`
- Add loader for per-agent source config
- Migration tool must generate initial `source-config.yaml` files

## Q4: Import Graph - What Moves, What Stays

### Answer

`resolveAttestationPlan()` should stay outside `tools/lib/sources/`. It is attestation policy, not source catalog policy.

Proposed file ownership:

```text
tools/lib/attestation-policy.ts
  stays:
    - AttestationType
    - AttestationPlan
    - isHighSensitivityTopic()
    - resolveAttestationPlan()

tools/lib/sources/catalog.ts
  moves/adds:
    - SourceRecordV2
    - SourceCatalogFileV2
    - normalizeSourceRecord()
    - loadCatalog()
    - loadAgentSourceView()
    - buildSourceIndex()
    - tokenizeTopic()
    - sourceTopicTokens()
    - resolveUrlTemplate()

tools/lib/sources/policy.ts
  moves:
    - preflight()
    - selectSourceForTopic()    // keep name short-term, internalize later
  imports:
    - resolveAttestationPlan() from ../attestation-policy.js
    - loadAgentSourceView()/index helpers from ./catalog.js

tools/lib/sources/matcher.ts
  adds:
    - match()
    - extractClaims()
    - scoreMatch()

tools/lib/sources/discovery.ts
  moves from source-discovery.ts:
    - discover()
    - generateCandidateUrls()
    - scoreContentRelevance()

tools/lib/sources/testing.ts
  adds:
    - test()

tools/lib/sources/rating.ts
  adds:
    - updateRatings()

tools/lib/sources/index.ts
  runtime re-exports only:
    - preflight
    - match
    - loadAgentSourceView

tools/lib/sources/admin.ts
  admin re-exports only:
    - discover
    - test
    - updateRatings
```

Backward-compatibility shims during migration:

```ts
// tools/lib/attestation-policy.ts
export type { SourceRecordV2 as SourceRecord } from "./sources/catalog.js";
export { preflight, selectSourceForTopic, loadAgentSourceView as loadSourceRegistry } from "./sources/index.js";
```

```ts
// tools/lib/source-discovery.ts
export { discover as discoverSourceForTopic } from "./sources/discovery.js";
// No runtime importers after Phase 3; shim exists only for CLI/admin transition.
```

Session-runner import changes:

Current:

```ts
import {
  loadSourceRegistry,
  resolveAttestationPlan,
  selectSourceForTopic,
  preflight,
  type AttestationType
} from "./lib/attestation-policy.js";
import { discoverSourceForTopic, persistSourceToRegistry } from "./lib/source-discovery.js";
```

Phase 3:

```ts
import { resolveAttestationPlan, type AttestationType } from "./lib/attestation-policy.js";
import { loadAgentSourceView, preflight, match } from "./lib/sources/index.js";
```

And remove all runtime imports of discovery/persistence from `session-runner.ts`.

### Rationale

`resolveAttestationPlan()` is driven by agent policy and sensitivity keywords, not catalog state. Keeping it in `attestation-policy.ts` avoids conflating policy ownership with source lookup ownership and prevents a cyclic "sources imports attestation, attestation imports sources" mess.

The important migration decision is that `session-runner.ts` must stop importing admin functions entirely. Otherwise Phase 3 does not actually create the intended runtime/admin boundary.

### Risks

- If `attestation-policy.ts` both owns attestation logic and remains the public export surface for source helpers forever, the extraction will be only cosmetic.
- If `session-runner.ts` continues to call discovery through a shim, Phase 3 will violate its own design goal.
- If `loadSourceRegistry()` remains as a raw YAML-only name, future callers will keep depending on the old semantics.

### Dependencies

- New `tools/lib/sources/` directory
- Compatibility re-exports for one phase only
- Follow-up cleanup phase that removes deprecated shims after callers are updated

## Q5: Extension Hook Wiring

### Answer

Phase 3 should not hardcode `sources` a second time. Implement a minimal typed extension dispatcher, but keep it statically registered, not dynamically loaded from disk.

Recommended hook contract:

```ts
interface LoopExtensionHooks {
  beforeSense?(ctx: BeforeSenseContext): Promise<void>;
  beforePublishDraft?(ctx: BeforePublishDraftContext): Promise<PublishGateDecision | void>;
  afterPublishDraft?(ctx: AfterPublishDraftContext): Promise<SourceMatchDecision | void>;
}
```

With a compile-time registry:

```ts
const EXTENSION_REGISTRY: Record<KnownExtension, LoopExtensionHooks> = {
  calibrate: { beforeSense: runCalibrateHook },
  sources: {
    beforePublishDraft: runSourcesPreflightHook,
    afterPublishDraft: runSourcesMatchHook,
  },
  observe: {},
};
```

Do not implement plugin discovery or dynamic imports in Phase 3.

Hook placement:

1. `beforeSense`
   - location: where `calibrate` currently runs at the top of `runV2Loop()`
2. `beforePublishDraft`
   - location: inside `runPublishAutonomous()`, immediately before `generatePost()`
   - this is the existing Step 0 preflight position
3. `afterPublishDraft`
   - location: inside `runPublishAutonomous()`, after draft normalization/quality checks and before attestation selection
   - this is exactly where source selection currently starts

Important implementation detail:

- `runV2Loop()` should dispatch the publish hooks by passing a hook-aware publish context into `runPublishAutonomous()`.
- Do not try to run `sources` hooks from the generic ACT substage wrapper alone; the required data (`topic`, draft text, tags, source candidates) only exists inside publish execution.

### Rationale

The code already has extension declarations in persona files and `KNOWN_EXTENSIONS` in `state.ts`. Hardcoding `sources` again would cement the same debt that Phase 2 was supposed to remove. A small typed dispatcher gives the `sources` extension the two touchpoints it needs without over-engineering.

The suggested generic interface in the task (`beforeSense`, `beforeDraft`, `afterDraft`, `afterPublish`) is directionally correct, but `beforeDraft` and `afterDraft` need to be publish-specific in this codebase because draft generation only exists inside the publish substage.

### Risks

- If the dispatcher is too generic, Phase 3 will spend time on framework code instead of source extraction.
- If the dispatcher is too narrow and publish-specific names leak everywhere, future extensions will be awkward.
- If hooks run only in `runV2Loop()` and not inside publish, the `sources` extension will not have enough context to do matching.

### Dependencies

- Minimal extension registry implementation
- Publish context types
- Refactor `runPublishAutonomous()` to accept hook callbacks or an extension context

## Q6: `match()` API - Post-Generation Source Verification

### Answer

`match()` should supplement preflight, not replace it. The runtime should become a two-pass flow:

1. `preflight(topic)` finds a viable candidate set cheaply.
2. Generate the draft.
3. `match(draft, candidates)` chooses the best substantiating source for attestation.

Recommended API:

```ts
interface PreflightCandidate {
  sourceId: string;
  method: AttestationMethod;
  resolvedUrl: string;
  preflightScore: number;
}

interface PreflightResult {
  pass: boolean;
  reason: string;
  reasonCode:
    | "PASS"
    | "NO_MATCHING_SOURCE"
    | "TLSN_REQUIRED_NO_TLSN_SOURCE"
    | "SOURCE_PRECHECK_HTTP_ERROR";
  candidates: PreflightCandidate[];
  plan: AttestationPlan;
}

interface MatchInput {
  topic: string;
  postText: string;
  postTags: string[];
  candidates: PreflightCandidate[];
  sourceView: AgentSourceView;
}

interface MatchResult {
  pass: boolean;
  reason: string;
  reasonCode:
    | "PASS"
    | "NO_POST_MATCH"
    | "MATCH_FETCH_FAILED"
    | "MATCH_THRESHOLD_NOT_MET";
  best?: {
    sourceId: string;
    method: AttestationMethod;
    url: string;
    score: number;
    matchedClaims: string[];
    evidence: string[];
  };
  considered: Array<{
    sourceId: string;
    score?: number;
    error?: string;
  }>;
}
```

Failure policy:

- If `preflight()` fails: skip before LLM generation.
- If `match()` fails:
  - allow one bounded regenerate attempt only if publish budget allows and there were viable preflight candidates
  - otherwise skip publish with `PUBLISH_NO_MATCHING_SOURCE`
- Do not silently fall back from failed post-match to a merely topic-matching source. That would nullify the point of `match()`.

`selectSourceForTopic()` should remain as an internal helper used by preflight and candidate seeding. It should no longer be the final attestation selector once `match()` exists.

Yes: this is the concrete runtime form of the "two-pass matching" recommendation.

### Rationale

The plan’s current runtime API sketch, `match(postText, postTags)`, is underspecified. It lacks:

- the topic
- the attestation plan
- the candidate set
- failure semantics

Without those, the matcher either has to rescan the entire catalog or guess which URLs to evaluate. Both are wrong.

Two-pass matching preserves the current early rejection behavior while making final attestation evidence-sensitive.

### Risks

- If `match()` searches the whole catalog instead of the preflight candidate set, publish latency will spike.
- If failed matches fall back automatically to the preflight source, false substantiation will remain possible.
- If the one retry is unbounded or hidden inside the matcher, publish budget accounting will become opaque.

### Dependencies

- `preflight()` must return candidates, not just boolean + reason
- Provider adapters or fetch/extract helpers for matcher evaluation
- New publish failure code handling in `session-runner.ts`

## Q7: Migration Safety

### Answer

Make migration mode explicit and read-path-first.

Recommended config:

```ts
type SourceRegistryMode = "catalog-preferred" | "catalog-only" | "yaml-only";
```

Loader precedence:

1. If mode is `catalog-only`, require valid `catalog.json`.
2. If mode is `yaml-only`, require the per-agent YAML.
3. If mode is `catalog-preferred`:
   - use `catalog.json` if it exists and validates
   - otherwise fall back to the agent YAML

During migration:

- Both `catalog.json` and YAML files may exist simultaneously.
- Runtime reads only.
- Session runner never writes either format in Phase 3.
- Admin tooling writes catalog only.
- YAML becomes legacy fallback, not an active registry of record.

Migration should be automated:

```bash
npx tsx tools/source-migrate.ts \
  --sentinel agents/sentinel/sources-registry.yaml \
  --crawler agents/crawler/sources-registry.yaml \
  --pioneer agents/pioneer/sources-registry.yaml \
  --out sources/catalog.json \
  --emit-agent-configs
```

The migration tool should:

1. deduplicate by `provider + normalized urlPattern`, not by `name`
2. populate `scope.importedFrom` and `scope.agents`
3. emit initial `source-config.yaml` files
4. emit a migration report:
   - duplicates merged
   - name collisions
   - records requiring manual provider assignment
   - records requiring manual domain tags

Can one agent run with YAML while another runs with catalog?

- Technically yes if the runtime is strictly read-only.
- Practically no for Phase 3. Do not support mixed write ownership or per-agent registry modes yet.
- Recommendation: one repo-wide mode, default `catalog-preferred`, switched to `catalog-only` after validation.

### Rationale

The current system writes discovered sources back into per-agent YAML during runtime. That behavior is incompatible with the Phase 3 runtime/admin split. Migration therefore has to begin by making runtime read-only and making write ownership explicit.

The fallback trigger should not be "missing catalog file" alone; it should also validate schema. Otherwise a corrupt or partial catalog will be treated as authoritative and silently break runtime behavior.

### Risks

- If both YAML and catalog remain writable, they will diverge immediately.
- If fallback is implicit and unlogged, operators will not know which registry the agent actually used.
- If dedupe is still name-based, merged catalog quality will degrade because current discovery also uses name-only dedupe.

### Dependencies

- Registry mode config
- Catalog validation
- Migration CLI
- Removal of runtime discovery/persistence from session execution

## Overall Findings

### P0 (Critical)

- Runtime/admin boundary is unresolved. The Phase 3 plan says `session-runner.ts` must import runtime API only, but current runtime behavior depends on discovery and persistence during gate and publish. That behavior must either be removed from the loop or wrapped behind a new explicit offline/admin workflow before implementation starts.
- `match()` is underspecified. `match(postText, postTags)` is not enough information to implement a correct post-generation verifier. The API must include topic, candidate set, and failure behavior.
- Extension wiring has no implementation surface. `KNOWN_EXTENSIONS` exists, but there is still no hook dispatcher. "Wire source extension hooks into new core loop" is ambiguous until a minimal hook contract exists.

### P1 (High)

- Unified catalog agent-specificity is not defined. The current registries are not interchangeable; sentinel is a subset of crawler, pioneer is mostly distinct. A single catalog without source scope or per-agent views will cause rework.
- Schema ownership is inconsistent across docs. The unified plan is canonical, but `source-registry-v2.md` still uses older lifecycle states and matcher thresholds. These must be reconciled before coding.
- Import ownership between attestation policy and source policy is not defined. Without an explicit import graph, Phase 3 risks creating cycles or leaving the extraction half-finished.

### P2 (Medium)

- Inverted index persistence is overspecified in prose and underspecified in mechanics. Phase 3 should explicitly choose in-memory rebuilds.
- Migration fallback rules are ambiguous. The plan must say what happens when both YAML and catalog exist and which one is writable.
- Name-based dedupe is insufficient for catalog migration. The design should standardize on `provider + urlPattern` identity.

### P3 (Low)

- Keep compatibility shims time-boxed. If `attestation-policy.ts` and `source-discovery.ts` remain long-term facades, the new module boundary will stay muddy.
- Rename `loadSourceRegistry()` after migration. The old name implies a per-agent YAML registry and will confuse future callers once the loader returns an agent-filtered catalog view.

## Updated Phase 3 Implementation Spec

### Concrete Steps

1. Define `SourceRecordV2`, `SourceCatalogFileV2`, `AgentSourceConfig`, and `SourceIndex`.
2. Create `tools/lib/sources/catalog.ts` with:
   - JSON/YAML loader
   - compatibility normalizer
   - catalog validation
   - in-memory index builder
   - `loadAgentSourceView()`
3. Split `tools/lib/attestation-policy.ts` so it owns attestation policy only.
4. Create `tools/lib/sources/policy.ts` with:
   - `preflight()`
   - internal topic ranking helper
5. Create `tools/lib/sources/matcher.ts` with:
   - `extractClaims()`
   - `match()`
   - threshold = 50
6. Create `tools/lib/sources/index.ts` and `tools/lib/sources/admin.ts` as strict export boundaries.
7. Remove runtime discovery/persistence imports from `session-runner.ts`.
8. Add a minimal typed extension dispatcher and hook `sources` into publish pre-draft and post-draft.
9. Add `sourceCatalog`, `sourceConfig`, and `sourceRegistryMode` to agent config resolution.
10. Build `tools/source-migrate.ts` to generate:
    - `sources/catalog.json`
    - `agents/*/source-config.yaml`
    - migration report
11. Run migration in `catalog-preferred` mode.
12. Validate runtime against migrated catalog.
13. Flip to `catalog-only`.
14. Remove compatibility shims in a follow-up cleanup change.

### File-by-File Changes

`tools/lib/attestation-policy.ts`

- Keep `AttestationType`, `AttestationPlan`, `isHighSensitivityTopic()`, `resolveAttestationPlan()`
- Remove source registry loading, tokenization, selection, and preflight logic
- Add temporary re-exports only if needed for migration

`tools/lib/sources/catalog.ts`

- New source schema/types
- Loader for `catalog.json`
- YAML fallback normalizer
- Agent view filtering
- In-memory index builder

`tools/lib/sources/policy.ts`

- `preflight()` returns candidate set plus plan
- Topic-token ranking over indexed candidate subset

`tools/lib/sources/matcher.ts`

- Post-generation verification
- Match scoring and evidence extraction
- Enforces threshold 50

`tools/lib/sources/discovery.ts`

- Move discovery code here
- Admin-only
- Stop exposing YAML persistence to runtime callers

`tools/lib/sources/testing.ts`

- Admin-only source health checks

`tools/lib/sources/rating.ts`

- Admin-only rating updates

`tools/lib/sources/index.ts`

- Runtime export boundary only

`tools/lib/sources/admin.ts`

- Admin export boundary only

`tools/lib/agent-config.ts`

- Add:
  - `paths.sourceCatalog`
  - `paths.sourceConfig`
  - `sourceRegistryMode`

`tools/session-runner.ts`

- Replace raw registry loading with `loadAgentSourceView()`
- Call `sources.preflight()` before `generatePost()`
- Call `sources.match()` after draft validation and before attestation
- Remove discovery/persist writes from runtime path
- Add publish skip handling for post-match failure

`tools/lib/state.ts`

- Add minimal extension hook types or import them from a dedicated extension module

`tools/source-migrate.ts`

- New migration CLI

`sources/catalog.json`

- New generated catalog artifact

`agents/*/source-config.yaml`

- New per-agent source-view config

### Final Recommendation

Do not start Phase 3 implementation until these three items are explicitly resolved in the plan text:

1. runtime no longer performs discovery/persistence
2. `match()` takes candidate context and has explicit failure semantics
3. source visibility is modeled as global catalog + agent view + per-source scope

Once those are fixed, the Phase 3 design is implementable without major ambiguity.
