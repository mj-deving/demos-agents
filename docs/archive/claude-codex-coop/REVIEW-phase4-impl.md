# Phase 4 Implementation Review — Provider Adapters

Date: 2026-03-14

## Q1. ProviderAdapter Contract Correctness

**Findings:** No blocker in the interface itself. The implemented contract in `tools/lib/sources/providers/types.ts` matches the Phase 4 design: source-aware `buildCandidates()`, second-pass `validateCandidate()`, structured `EvidenceEntry` output from `parseResponse()`, and registry dispatch through `supports()` are all present at [tools/lib/sources/providers/types.ts:22](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/types.ts#L22), [tools/lib/sources/providers/types.ts:48](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/types.ts#L48), and [tools/lib/sources/providers/types.ts:135](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/types.ts#L135).

**Severity:** none

## Q2. Adapter Implementation Quality

**Findings:**

- P1: The GitHub adapter does not resolve templated repo sources correctly. `buildCandidates()` reconstructs repo/release/commit URLs from `extractOwnerRepo(ctx.source.url)` and never consults runtime vars for `owner` / `repo`, so active sources like `github-repo`, `github-releases`, and `github-commits` keep literal `{owner}` / `{repo}` path segments and produce unusable requests. See [tools/lib/sources/providers/github.ts:57](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/github.ts#L57), [tools/lib/sources/providers/github.ts:129](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/github.ts#L129), [sources/catalog.json:729](/home/mj/projects/omniweb-agents/sources/catalog.json#L729), [sources/catalog.json:793](/home/mj/projects/omniweb-agents/sources/catalog.json#L793), and [sources/catalog.json:3951](/home/mj/projects/omniweb-agents/sources/catalog.json#L3951).

- P1: Two adapters do not implement active catalog operations. `hn-algolia` only recognizes `search`, `search_by_date`, and `front_page`, so active `show_hn` and `ask_hn` rows silently downgrade to plain `search` and lose their `tags=` semantics. `defillama` only recognizes `tvl`, `protocol`, `chains`, `yields`, and `dexs`, so active `defillama-stablecoins` falls through to the default `tvl` path and fetches the wrong endpoint entirely. See [tools/lib/sources/providers/hn-algolia.ts:32](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/hn-algolia.ts#L32), [tools/lib/sources/providers/hn-algolia.ts:143](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/hn-algolia.ts#L143), [tools/lib/sources/providers/defillama.ts:29](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/defillama.ts#L29), [tools/lib/sources/providers/defillama.ts:91](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/defillama.ts#L91), [sources/catalog.json:3515](/home/mj/projects/omniweb-agents/sources/catalog.json#L3515), [sources/catalog.json:3819](/home/mj/projects/omniweb-agents/sources/catalog.json#L3819), and [sources/catalog.json:3885](/home/mj/projects/omniweb-agents/sources/catalog.json#L3885).

**Severity:** P1

## Q3. Integration Correctness

**Findings:**

- P0: `session-runner.ts` ignores a failed `afterPublishDraft` match decision and still publishes with the preflight candidate. `runAfterPublishDraft()` is explicitly designed to short-circuit on rejection, but `runPublishAutonomous()` treats any failed match as a soft fallback and proceeds to attestation/publish. That bypasses the whole post-generation verification step. See [tools/lib/extensions.ts:223](/home/mj/projects/omniweb-agents/tools/lib/extensions.ts#L223) and [tools/session-runner.ts:1647](/home/mj/projects/omniweb-agents/tools/session-runner.ts#L1647).

- P1: `match()` converts fetch/parser failures into metadata-only scoring instead of preserving a hard fetch-failure path. In practice, timeouts, 429s, and parse errors return `entries: []`, then score via `scoreMetadataOnly()`, so `MATCH_FETCH_FAILED` is effectively dead code for normal network failures and evidence-less candidates can still pass threshold. See [tools/lib/sources/matcher.ts:382](/home/mj/projects/omniweb-agents/tools/lib/sources/matcher.ts#L382) and [tools/lib/sources/matcher.ts:414](/home/mj/projects/omniweb-agents/tools/lib/sources/matcher.ts#L414).

- P2: The multi-candidate design is only partially wired. `policy.ts` validates all adapter candidates but still returns only the first source per method, hard-codes `maxCandidates = 5`, and `matcher.ts` never expands `adapterCandidates`. That means `maxCandidatesPerTopic` is not really honored end-to-end and additional adapter URLs are dead data. See [tools/lib/sources/policy.ts:68](/home/mj/projects/omniweb-agents/tools/lib/sources/policy.ts#L68), [tools/lib/sources/policy.ts:159](/home/mj/projects/omniweb-agents/tools/lib/sources/policy.ts#L159), [tools/lib/sources/policy.ts:237](/home/mj/projects/omniweb-agents/tools/lib/sources/policy.ts#L237), and [tools/lib/sources/matcher.ts:382](/home/mj/projects/omniweb-agents/tools/lib/sources/matcher.ts#L382).

**Severity:** P0 / P1 / P2

## Q4. Catalog Migration Correctness

**Findings:**

- P1: All 46 active sources are not correctly mapped to executable adapter behavior. I found 3 active rows with unsupported operations (`defillama-stablecoins`, `hn-algolia-show`, `hn-algolia-ask`) and 1 active row (`pubmed-summary`) whose adapter cannot build any candidate in the current one-step runtime because it requires `ids` / `id` vars that `extractTopicVars()` never supplies. See [tools/lib/attestation-policy.ts:78](/home/mj/projects/omniweb-agents/tools/lib/attestation-policy.ts#L78), [tools/lib/sources/providers/pubmed.ts:44](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/pubmed.ts#L44), [sources/catalog.json:3515](/home/mj/projects/omniweb-agents/sources/catalog.json#L3515), [sources/catalog.json:3819](/home/mj/projects/omniweb-agents/sources/catalog.json#L3819), [sources/catalog.json:3885](/home/mj/projects/omniweb-agents/sources/catalog.json#L3885), and [sources/catalog.json:4384](/home/mj/projects/omniweb-agents/sources/catalog.json#L4384).

- Observation: quarantined sources are still reachable through the generic adapter for non-default/testing flows, because `generic.supports()` accepts only `status === "quarantined"` and `loadAgentSourceView()` can include quarantined rows via `allowStatuses` overrides. They are not reachable in the default runtime view, which still loads only `active` and `degraded`. See [tools/lib/sources/providers/generic.ts:52](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/generic.ts#L52), [tools/lib/sources/catalog.ts:616](/home/mj/projects/omniweb-agents/tools/lib/sources/catalog.ts#L616), and [tools/lib/sources/catalog.ts:653](/home/mj/projects/omniweb-agents/tools/lib/sources/catalog.ts#L653).

**Severity:** P1

## Q5. Edge Cases

**Findings:**

- P0: If preflight passes but `match()` cannot substantiate the post, publish still goes through today. The concrete path is: fetch/parse failures degrade to metadata-only scoring in `matcher.ts`, and even an explicit failed match decision is treated as a soft fallback in `session-runner.ts`. This breaks the intended “skip publish on no matching source” failure mode. See [tools/lib/sources/matcher.ts:382](/home/mj/projects/omniweb-agents/tools/lib/sources/matcher.ts#L382) and [tools/session-runner.ts:1669](/home/mj/projects/omniweb-agents/tools/session-runner.ts#L1669).

- P2: Rate-limit bucket keys do not currently collide across the registered providers, but retry attempts are not separately tokenized. `fetchSource()` acquires one token before the retry loop, so a single logical fetch can emit multiple real HTTP requests without additional bucket accounting. With `Promise.all()`, that can overshoot provider quotas even though bucket names are unique. See [tools/lib/sources/fetch.ts:61](/home/mj/projects/omniweb-agents/tools/lib/sources/fetch.ts#L61), [tools/lib/sources/fetch.ts:82](/home/mj/projects/omniweb-agents/tools/lib/sources/fetch.ts#L82), and [tools/lib/sources/rate-limit.ts:92](/home/mj/projects/omniweb-agents/tools/lib/sources/rate-limit.ts#L92).

**Severity:** P0 / P2

## Overall Assessment

The implementation only partially matches the Phase 4 design spec. The adapter contract and most parsing/validation scaffolding are in place, but the publish path still has a blocker: failed post-generation source matching does not stop publish. On top of that, several active catalog rows are not actually executable through the current adapters.

Security-wise, I did not find a classic URL-injection issue in the provider-specific adapters because they generally use `encodeURIComponent()`. The bigger safety concern is trust correctness: unresolved or wrong requests can still make it to fetch/attestation, and the matcher can pass without fetched evidence.

This does introduce breaking behavior for autonomous sessions. The important regression is not a crash; it is silent publication after source-match rejection or after evidence fetch failure. Legacy fallback behavior is also incomplete when hooks return `void`, because the last-resort path only retries `plan.required` and does not reproduce the old required/fallback selection logic in full.

Confidence for live deployment: low until the P0 publish-path issue is fixed and the active catalog/adapter mismatches are cleaned up.
