# Review: Source Testing CLI

## Findings

1. High: The proposed flow tests `source.url` interpolation, not the real adapter request path.
   `ProviderAdapter` already defines `supports()`, `buildCandidates()`, and `validateCandidate()` as the canonical source-aware request pipeline in `tools/lib/sources/providers/types.ts:150-177`. `fetchSource()` explicitly expects adapters to generate URLs first in `tools/lib/sources/fetch.ts:2-7`. If the CLI fills `source.url` directly, it will skip provider transforms, defaults, query rewrites, hooks, and compatibility checks. GitHub is a concrete example: the spec rewrites `per_page` for TLSN and resolves variables declaratively in `tools/lib/sources/providers/specs/github.yaml:91-120`. That means the tool would not actually verify "which adapters work"; it would only verify fetch+parse against a hand-built URL. The health check should start with `adapter.supports(source)`, then `buildCandidates()`, then `validateCandidate()`, and only then fetch/parse.

2. High: The `--quarantined --agent ...` design cannot be implemented by reusing the current agent source view as described.
   The task references `buildAgentSourceView()`, but the runtime API is `loadAgentSourceView()` in `tools/lib/sources/catalog.ts:639-695`. Its default status filter only allows `active` and `degraded` in `tools/lib/sources/catalog.ts:615-623`, so quarantined sources are excluded before the CLI ever sees them. If the CLI is meant to test recovered quarantined sources, it needs to filter the raw catalog directly or override `allowStatuses`; otherwise the contract for `--quarantined` will silently fail.

3. Medium: The selector and fallback examples do not match the current catalog shape on 2026-03-14.
   The task text says there are 46 active and 92 quarantined sources, but `sources/catalog.json` generated at `2026-03-14T12:03:01.590Z` currently contains 45 active and 93 quarantined sources. The first catalog entries also show hashed IDs such as `coingecko-2a7ea372`, not human-readable IDs like `coingecko-bitcoin`, in `sources/catalog.json:7-11`. Also, every current source has an empty `topicAliases` array; the first entries already show that in `sources/catalog.json:20` and `sources/catalog.json:85`. So the proposed `topicAliases[0]` fallback will currently never fire, and the example `--source coingecko-bitcoin` would not match the catalog as it exists today.

4. Medium: The parse-failure contract is misaligned with the actual adapter behavior.
   The declarative adapter engine does not throw parse errors back to callers. `parseResponse()` catches JSON parse failures and general exceptions and returns empty entries instead in `tools/lib/sources/providers/declarative-engine.ts:1098-1155`. The provider specs also declare `parseFailureMode: empty-entries`, for example in `tools/lib/sources/providers/specs/github.yaml:19-22`. A contract centered on "parse throws => PARSE_FAILED" will miss the real failure mode the codebase uses today. If the CLI keeps a `PARSE_FAILED` bucket, it should primarily be driven by empty entries or invalid normalized output, not by exceptions.

## Q1-Q5

Q1: Export `testSource` from a small library module, then keep the CLI thin.
That matches the existing split between reusable source runtime code and tool entrypoints, and it avoids baking health logic into a one-off CLI. A `tools/lib/sources/health.ts` module is the right shape.

Q2: Between the two options, prefer YAML-backed defaults for declarative providers, not a hardcoded CLI map.
The variable surface in the catalog is already broad, and a CLI map will rot quickly. That said, provider-level YAML alone is not sufficient for all cases: generic/quarantined sources and source-specific values still need overrides. The important part is that defaults live near the adapter/source contract, not inside the CLI.

Q3: Keep it stdout-only for now.
Auto-persisting health history adds retention, path, and schema questions that are unrelated to the first useful version. If trending matters later, add an explicit `--out` flag or a separate recorder.

Q4: Respect the existing provider buckets.
A source-health tool should measure the real operational path, and the current rate limiter is already the shared contract. A separate "testing" bucket would make results less trustworthy and raises the chance of getting providers throttled or banned.

Q5: Yes, split empty results from parser exceptions.
`FETCH_OK + 0 entries` is operationally different from a parser crash. I would use a separate status such as `EMPTY` or `NO_DATA`, and reserve `PARSE_FAILED` for structurally invalid responses or explicit parser errors. That also matches the current adapter behavior better.

## Missing Test Behaviors

- Missing: verify the CLI uses `adapter.supports(source)`, `buildCandidates()`, and `validateCandidate()` rather than direct URL template substitution.
- Missing: verify rewritten candidate URLs are respected before fetch, for example a provider rule that clamps query params.
- Missing: verify behavior when a provider adapter exists but does not support the specific source record.
- Missing: verify unresolved required variables produce an explicit failure state instead of fetching a malformed URL.
- Missing: verify `--quarantined` combined with `--agent` works against the raw catalog instead of the default active-only agent view.
- Missing: verify source selection against real catalog identifiers, including "unknown source" behavior and whether `--source` matches `id`, `name`, or both.
- Missing: verify flag validation for invalid `--agent`, invalid `--provider`, invalid `--parallel`, invalid `--delay`, and conflicting `--pretty` / `--json` behavior.
- Missing: verify concurrency and delay semantics, including the `--parallel` max of 5 and interaction with provider rate limits.
- Missing: verify malformed JSON / parse-empty responses map to the intended status, since current adapters swallow parse exceptions.
- Missing: verify stable output ordering and summary counts across mixed statuses so automation snapshots do not flap.
