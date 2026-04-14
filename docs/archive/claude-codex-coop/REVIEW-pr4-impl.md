# PR4 Declarative Adapter Review

## Findings

### 1. `P1` Hook modules are never used, and the registry still promotes hook-dependent declarative adapters over the working hand-written ones

- The spec format in the plan places `hooks:` at the operation level, sibling to `parse:` (`claude-codex-coop/PLAN-declarative-adapters.md:147-189`). The shipped YAML follows that shape (`tools/lib/sources/providers/specs/arxiv.yaml:59-89`, `tools/lib/sources/providers/specs/kraken.yaml:75-115`, `tools/lib/sources/providers/specs/kraken.yaml:230-268`).
- The engine only looks for hooks under `operation.parse.hooks` when preloading and resolving them (`tools/lib/sources/providers/declarative-engine.ts:1096-1104`, `tools/lib/sources/providers/declarative-engine.ts:1169-1175`), so the async loader would miss every declared hook even if it were used.
- The hybrid registry does not use the async loader anyway. It loads declarative adapters through `loadDeclarativeProviderAdaptersSync()` (`tools/lib/sources/providers/index.ts:45-57`), and that sync path explicitly disables hooks (`tools/lib/sources/providers/declarative-engine.ts:1194-1198`).
- That is a functional regression for the adapters being overridden:
  - `arxiv.yaml` depends on its hook for canonical URL normalization and author/category cleanup (`tools/lib/sources/providers/specs/arxiv.yaml:88-93`), while the hand-written adapter preserves those behaviors (`tools/lib/sources/providers/arxiv.ts:90-116`) and the hook itself only exists in the declarative path (`tools/lib/sources/providers/hooks/arxiv.ts:12-24`).
  - `kraken.yaml` explicitly says ticker/OHLC extraction and TLSN `since` handling are hook-driven (`tools/lib/sources/providers/specs/kraken.yaml:77-115`, `tools/lib/sources/providers/specs/kraken.yaml:221-273`), while the hand-written adapter implements those behaviors directly (`tools/lib/sources/providers/kraken.ts:82-167`, `tools/lib/sources/providers/kraken.ts:187-260`).

### 2. `P1` The template engine is too weak for the checked specs, so several declarative adapters do not preserve the current `parseResponse()` output contract

- `resolveTemplate()` only supports `{key}`, flat variable names, and flat item properties (`tools/lib/sources/providers/declarative-engine.ts:547-579`). It does not support dotted property lookup, array indexing, or any source/build-context variables during parse.
- `parseResponse()` passes an empty variable map into all field templates (`tools/lib/sources/providers/declarative-engine.ts:1058-1071`), so parse-time templates cannot see things like `{source.id}` or operation variables such as `{assetId}`.
- That breaks checked specs against their hand-written adapters:
  - `kraken.yaml` uses `{c[0]}`, `{v[1]}`, and tuple placeholders like `{0}`..`{7}` (`tools/lib/sources/providers/specs/kraken.yaml:90-110`, `tools/lib/sources/providers/specs/kraken.yaml:240-264`). The declarative engine cannot resolve those expressions, so ticker summaries/body text degrade and OHLC entries are malformed. The hand-written adapter extracts those values explicitly (`tools/lib/sources/providers/kraken.ts:192-215`, `tools/lib/sources/providers/kraken.ts:243-260`).
  - `coingecko.yaml` uses dotted template lookups such as `{description.en|name}` and `{source.id}` (`tools/lib/sources/providers/specs/coingecko.yaml:174-183`, `tools/lib/sources/providers/specs/coingecko.yaml:233-240`). Those expressions cannot resolve in the current engine, while the hand-written adapter emits the intended fields (`tools/lib/sources/providers/coingecko.ts:236-245`, `tools/lib/sources/providers/coingecko.ts:253-271`).
  - The same limitation would also affect World Bank templates like `{country.value}` and `{indicator.value}` (`tools/lib/sources/providers/specs/worldbank.yaml:87-97`), which the hand-written adapter currently constructs correctly (`tools/lib/sources/providers/worldbank.ts:154-173`).

### 3. `P2` TLSN/DAHR compatibility metadata is only partially enforced

- The design requires the engine to apply TLSN/DAHR constraints and validate semantic compatibility (`claude-codex-coop/PLAN-declarative-adapters.md:40-42`, `claude-codex-coop/PLAN-declarative-adapters.md:220-229`).
- In the implementation, `responseFormats`, `tlsn.maxResponseKb`, and `dahr.requireNormalizedJson` exist in the type definitions but are not used anywhere outside those type declarations (`tools/lib/sources/providers/declarative-engine.ts:92-102`; grep over the file only finds the declarations).
- Runtime enforcement currently covers `allowed`, `requireHttps`, `rewriteQuery`, and `requireQuery` (`tools/lib/sources/providers/declarative-engine.ts:905-933`, `tools/lib/sources/providers/declarative-engine.ts:977-1027`). It does not enforce:
  - `compatibility.responseFormats` against the source record.
  - `tlsn.maxResponseKb` against the candidate's estimated size.
  - `dahr.requireNormalizedJson` or `parse.format === json` when DAHR is allowed.
- The checked specs rely on metadata that is therefore advisory only. Example: `kraken.yaml` marks OHLC as TLSN-safe only if the response stays compact (`tools/lib/sources/providers/specs/kraken.yaml:221-226`), but the engine neither enforces `maxResponseKb` nor loads the hook that adds `since`, so the TLSN guard is incomplete compared with the hand-written adapter (`tools/lib/sources/providers/kraken.ts:154-160`).

### 4. `P2` The hybrid registry is not safe as implemented because it overrides working adapters with declarative ones that are known-incomplete

- The registry comment says hand-written adapters are kept as fallback during migration, but the actual behavior is "replace any provider that has a declarative spec" (`tools/lib/sources/providers/index.ts:30-57`).
- There is no per-provider validation gate before overriding, and `strictValidation` is disabled (`tools/lib/sources/providers/index.ts:49-52`).
- Because of Findings 1 and 2, providers like `arxiv` and `kraken` are currently downgraded simply by being present in `specs/`, even though their declarative forms do not preserve the behavior of the hand-written adapters they replace.

## Notes

- By inspection, the minimal `jsonPathGet()` implementation does cover the JSONPath subset used in the checked specs: `$.hits[*]`, `$.a[0]`, `$.market_data.current_price.usd`, and `$[1][*]` (`tools/lib/sources/providers/declarative-engine.ts:151-219`). I did not find a direct bug in that subset itself.
- The larger issue is that several checked specs rely on template expressions, hooks, and semantic validation beyond JSONPath, and those parts are not implemented strongly enough yet.

## Direct Answers

- `ProviderAdapter` contract: partially implemented. The engine returns objects with the right method signatures and generally avoids throwing, but the current declarative adapters do not preserve the behavior of the replaced hand-written adapters for `parseResponse()` and some validation paths.
- JSONPath for the checked spec examples: the supported subset looks correct for the examples above. The regressions I found are in template resolution and hook wiring, not the basic JSONPath evaluator.
- TLSN constraints: only partially enforced. `allowed`, HTTPS, and query rewriting are enforced; `maxResponseKb` and some hook-dependent TLSN safeguards are not.
- Hybrid registry: not correct in the current state. It overrides hand-written adapters with declarative ones even though hook support and several spec features are incomplete.
