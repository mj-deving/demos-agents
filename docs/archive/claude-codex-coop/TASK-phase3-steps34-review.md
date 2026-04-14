# Task: Review Phase 3 Steps 3+4 Implementation

## Context

Phase 3 Steps 3+4 of the unified loop architecture v2 were implemented in commit 8bb54b6. This completes Phase 3 — the full source extraction from the core loop. Changes:

1. **Source policy** (`tools/lib/sources/policy.ts`) — `preflight()` with catalog index lookup, `selectSourceForTopicV2()` with O(1) candidate retrieval
2. **Source matcher** (`tools/lib/sources/matcher.ts`) — `match()` with `extractClaims()`, `scoreMatch()`, threshold 50
3. **Extension wiring** (`tools/lib/extensions.ts`) — sources hooks wired: `runSourcesPreflightHook`, `runSourcesMatchHook` with `PreflightCandidate[]` preserved through pipeline
4. **Session-runner rewiring** (`tools/session-runner.ts`) — removed `loadSourceRegistry`, `discoverSourceForTopic`, `persistSourceToRegistry`, `selectSourceForTopic` imports; replaced with V2 catalog functions; added `getSourceView()` session-level cache
5. **Agent config** (`tools/lib/agent-config.ts`) — added `sourceCatalog`, `sourceConfig`, `sourceRegistryMode` to `AgentPaths`/`AgentConfig`
6. **Migration CLI** (`tools/source-migrate.ts`) — reads 3 YAML registries, deduplicates by provider+urlPattern, emits `sources/catalog.json`
7. **Barrel update** (`tools/lib/sources/index.ts`) — re-exports preflight, match, and types

## Files to Review

- `tools/lib/sources/policy.ts` — NEW: preflight(), selectSourceForTopicV2(), PreflightCandidate, PreflightResult, SourceSelectionResult
- `tools/lib/sources/matcher.ts` — NEW: match(), extractClaims(), scoreMatch(), MatchInput, MatchResult
- `tools/lib/extensions.ts` — MODIFIED: added runSourcesPreflightHook(), runSourcesMatchHook(), wired in EXTENSION_REGISTRY
- `tools/session-runner.ts` — MODIFIED: removed discovery imports, added getSourceView() cache, rewired gate+publish to V2 sources
- `tools/lib/agent-config.ts` — MODIFIED: added sourceCatalog/sourceConfig/sourceRegistryMode fields
- `tools/source-migrate.ts` — NEW: migration CLI
- `tools/lib/sources/index.ts` — MODIFIED: added policy+matcher re-exports
- `tools/lib/attestation-policy.ts` — MODIFIED: exported ASSET_MAP, inferAssetAlias, extractTopicVars, fillUrlTemplate, unresolvedPlaceholders (shared with policy.ts)

## Review Focus

1. **Correctness:** Do the types match the spec in `Plans/unified-loop-architecture-v2.md` Phase 3 Steps 3+4?
2. **PreflightCandidate pipeline:** Is `PreflightCandidate[]` correctly preserved from preflight → PublishGateDecision → AfterPublishDraftContext → match()? No lossy conversion to SourceRecordV2[]?
3. **Import hygiene:** No circular imports between sources/policy.ts ↔ attestation-policy.ts ↔ session-runner.ts? The shared URL helpers (ASSET_MAP, extractTopicVars, etc.) exported cleanly from attestation-policy.ts?
4. **Source selection:** Does `selectSourceForTopicV2()` correctly use the inverted index and produce equivalent results to the old `selectSourceForTopic()`? Are there edge cases where the index lookup misses candidates the O(n) scan would find?
5. **Matcher scoring:** Is the scoring breakdown in `scoreMatch()` balanced? Are the 5 dimensions (topic 0-40, domain 0-20, provider 0-20, name 0-10, alias 0-10) reasonable given the threshold of 50?
6. **Session cache:** Does `getSourceView()` correctly cache per session? Any risk of stale cache if catalog.json is updated mid-session?
7. **Migration dedup:** Does source-migrate.ts correctly merge scope/topics/tags when deduplicating? Are ID collisions handled safely?
8. **Runtime discovery removal:** Are ALL calls to `discoverSourceForTopic` and `persistSourceToRegistry` removed from session-runner.ts? No silent fallback to discovery?
9. **sourceRegistryMode validation:** Does agent-config.ts correctly validate the mode value? What happens with an unknown mode from persona.yaml?

## Validation

```bash
# Type check
npx tsc --noEmit

# Migration (idempotent — catalog.json already exists)
npx tsx tools/source-migrate.ts \
  --sentinel agents/sentinel/sources-registry.yaml \
  --crawler agents/crawler/sources-registry.yaml \
  --pioneer agents/pioneer/sources-registry.yaml \
  --out sources/catalog.json

# Verify no old imports remain
grep -rn 'discoverSourceForTopic\|persistSourceToRegistry\|loadSourceRegistry' tools/session-runner.ts
# Expected: no matches

# Verify V2 source selection works for a known topic
npx tsx -e "
import { loadAgentSourceView } from './tools/lib/sources/index.js';
import { preflight } from './tools/lib/sources/policy.js';
import { loadAgentConfig } from './tools/lib/agent-config.js';
const config = loadAgentConfig('sentinel');
const view = loadAgentSourceView('sentinel', config.paths.sourceCatalog, config.paths.sourcesRegistry, config.sourceRegistryMode);
console.log('Sources:', view.sources.length, 'Catalog v' + view.catalogVersion);
const result = preflight('bitcoin price analysis', view, config);
console.log('Preflight:', JSON.stringify(result, null, 2));
"
```

## Fix Instructions

If you find issues:
1. Fix them directly in the source files
2. Run `npx tsc --noEmit` after each fix
3. Run the migration CLI to verify it still works
4. Commit with message: `fix: address Codex review — [summary of findings]`
5. Write findings to `claude-codex-coop/REVIEW-phase3-steps34.md` with severity (P0/P1/P2/P3) and resolution
