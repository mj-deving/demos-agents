# Golden Adapter Test Review

I read the task brief and all requested files, then validated the proposed contracts against the current handwritten adapters, declarative specs, declarative engine, registry, hooks, and existing `tests/declarative-engine.test.ts`. I also spot-checked the highest-risk cases with a local `tsx` comparison harness.

## 1. Design feedback

- The test should load declarative adapters through the same path the app uses, not `loadDeclarativeProviderAdaptersSync()` from the task sketch. The task proposes the sync loader (`claude-codex-coop/TASK-golden-adapters.md:24-35`), but the registry uses the async loader (`tools/lib/sources/providers/index.ts:49-57`), and the sync loader explicitly says it does not support hooks (`tools/lib/sources/providers/declarative-engine.ts:1245-1249`). Even though hook wiring is currently broken for a separate reason, the golden suite should still exercise the production load path.

- The comparison strategy is too weak for parse results. The task only asks for entry count, IDs, key metric keys, and topic overlap (`claude-codex-coop/TASK-golden-adapters.md:39-43`). That would miss real regressions where the keys exist but the values are wrong. I confirmed this with PubMed `esearch`: the declarative adapter returns the right PMIDs, but `count` and `retmax` come back as `0` because the engine extracts metrics relative to each item, not the parsed root (`tools/lib/sources/providers/declarative-engine.ts:507-539`, `tools/lib/sources/providers/specs/pubmed.yaml:78-84`), while the handwritten adapter preserves the root values (`tools/lib/sources/providers/pubmed.ts:127-143`).

- The build/validate comparison should normalize and compare the full query map for safety-critical params, not just base/path plus presence. For example, the handwritten Kraken OHLC adapter injects `since` for TLSN in both `buildCandidates()` and `validateCandidate()` (`tools/lib/sources/providers/kraken.ts:117-119`, `tools/lib/sources/providers/kraken.ts:154-160`), while the declarative spec relies on hooks for that behavior (`tools/lib/sources/providers/specs/kraken.yaml:223-273`) and the engine never loads those hooks because it only looks under `op.parse?.hooks?.module` (`tools/lib/sources/providers/declarative-engine.ts:1220-1226`, `tools/lib/sources/providers/declarative-engine.ts:1144-1150`) even though the YAML declares `hooks:` at the operation level (`tools/lib/sources/providers/specs/arxiv.yaml:88-92`, `tools/lib/sources/providers/specs/kraken.yaml:113-118`).

- The suite should assert `normalized` behavior for `parseResponse()`. That is part of the adapter contract (`tools/lib/sources/providers/types.ts:71-82`) and is material to DAHR safety, but the proposed contracts ignore it entirely. At minimum, JSON providers should produce `normalized` on valid JSON parses, and `arxiv` should not.

## 2. Test contract review

### Missing provider behaviors

- `hn-algolia`: the contract only covers `search` (`claude-codex-coop/TASK-golden-adapters.md:66-73`), but both implementations support `search_by_date`, `front_page`, `ask_hn`, and `show_hn` (`tools/lib/sources/providers/hn-algolia.ts:32-67`, `tools/lib/sources/providers/specs/hn-algolia.yaml:90-320`). Removal is not safe unless at least one tagged mode and `search_by_date` are covered.

- `coingecko`: the contract skips `categories`, and it never checks `coin-detail` parsing under DAHR (`claude-codex-coop/TASK-golden-adapters.md:75-83`). Both operations exist in handwritten and declarative form (`tools/lib/sources/providers/coingecko.ts:227-297`, `tools/lib/sources/providers/specs/coingecko.yaml:131-293`).

- `github`: the contract only exercises `search-repos` for build/validate (`claude-codex-coop/TASK-golden-adapters.md:85-92`). That misses the most important divergence: the handwritten adapter can derive `owner/repo` from `source.url` for `repo`, `commits`, and `releases` (`tools/lib/sources/providers/github.ts:133-156`), while the declarative spec requires `vars.owner` and `vars.repo` (`tools/lib/sources/providers/specs/github.yaml:40-45`, `tools/lib/sources/providers/specs/github.yaml:175-180`, `tools/lib/sources/providers/specs/github.yaml:242-247`). I confirmed locally that handwritten `repo` build succeeds from `https://api.github.com/repos/openai/gpt-oss`, while declarative returns `[]`.

- `defillama`: the proposed contract omits `yields`, `dexs`, and `stablecoins` (`claude-codex-coop/TASK-golden-adapters.md:94-99`). All three are supported in both codepaths, and `stablecoins` is explicitly called out in Q3 (`tools/lib/sources/providers/defillama.ts:29-53`, `tools/lib/sources/providers/defillama.ts:241-305`, `tools/lib/sources/providers/specs/defillama.yaml:170-308`).

- `worldbank`: the contract never covers the `country` operation, and it only mentions `format=json` validation (`claude-codex-coop/TASK-golden-adapters.md:116-122`). The handwritten adapter also enforces `mrv=1` for TLSN indicator requests and caps `per_page` (`tools/lib/sources/providers/worldbank.ts:114-128`), while the declarative spec encodes the same behavior (`tools/lib/sources/providers/specs/worldbank.yaml:66-79`).

- `pubmed`: the proposed contract should be stronger than “extracts PMIDs” and “extracts articles by UID” (`claude-codex-coop/TASK-golden-adapters.md:124-130`). I confirmed two current declarative mismatches:
  - `esearch` preserves IDs but loses the root-level `count`/`retmax` metric values.
  - `esummary` is badly wrong because `object-entries` ignores `items.jsonPath` and iterates the top-level object, producing a single `id: "result"` entry instead of per-UID articles (`tools/lib/sources/providers/declarative-engine.ts:633-689`, `tools/lib/sources/providers/specs/pubmed.yaml:118-148`, `tools/lib/sources/providers/pubmed.ts:146-179`).

- `binance`: the contract skips `ticker-24hr` entirely (`claude-codex-coop/TASK-golden-adapters.md:132-139`), even though it has distinct parse fields and metrics in both implementations (`tools/lib/sources/providers/binance.ts:168-195`, `tools/lib/sources/providers/specs/binance.yaml:95-180`).

- `kraken`: the contract only covers `ticker` build and `assets` TLSN rejection (`claude-codex-coop/TASK-golden-adapters.md:141-147`). It misses the riskiest path: OHLC. I confirmed locally that handwritten OHLC injects `since`, validates it, and parses candles correctly, while declarative OHLC omits `since`, does not rewrite in validation, and misparses the response by treating the `last` field as an entry and flattening the first candle array into the ID/body (`tools/lib/sources/providers/kraken.ts:115-167`, `tools/lib/sources/providers/kraken.ts:237-269`, `tools/lib/sources/providers/specs/kraken.yaml:169-273`).

- `arxiv`: the contract is directionally right but still missing author/canonical normalization. I confirmed locally that the declarative path currently emits the full URL as the entry ID, leaves the canonical URL as `http://...`, and reports `authors: "Alice"` instead of the handwritten `authors: 2` plus `first_author` (`tools/lib/sources/providers/arxiv.ts:83-116`, `tools/lib/sources/providers/specs/arxiv.yaml:59-92`).

### Missing engine-level behaviors to validate

- The current tests only exercise helper functions and one GitHub `search-repos` build path (`tests/declarative-engine.test.ts:202-226`). Golden tests need to cover operation resolution and source-shape-driven behavior, not just URL generation from happy-path vars.

- `parseResponse()` templates cannot see build-time vars because the engine passes an empty template var map during parse (`tools/lib/sources/providers/declarative-engine.ts:1104-1116`). Any contract that compares exact templated strings will be brittle, but the suite should still catch operations where variable-backed output is supposed to survive structurally.

- Fixtures must include provider-specific sentinels that the handwritten parsers handle:
  - PubMed `esummary.result.uids`
  - Kraken `result.last`
  - arXiv multiple `<author>` and `<category>` tags
  - World Bank `[meta, data[]]` tuple

## 3. Answers to Q1-Q5

### Q1

Do not test exact `matchHints` equality. The task already notes that handwritten adapters use token slices while declarative specs use interpolation (`claude-codex-coop/TASK-golden-adapters.md:151-152`), and the implementations confirm that difference (`tools/lib/sources/providers/hn-algolia.ts:165`, `tools/lib/sources/providers/declarative-engine.ts:957-980`). Test only invariant hints that matter operationally, such as normalized asset/pair/country/indicator presence, and otherwise require non-empty overlap.

### Q2

Do not compare exact `bodyText` or `summary` strings. Compare structural invariants instead:
- non-empty when the handwritten adapter emits non-empty text,
- expected key substrings when they are semantically important,
- exact IDs, canonical URLs where meaningful, and selected metric values.

That is the only stable approach because formatting legitimately differs, while exact text would still miss more important issues like wrong IDs or wrong metrics.

### Q3

Test all 6 DefiLlama operations. The total surface area is small, and three omitted operations (`yields`, `dexs`, `stablecoins`) each have distinct endpoints and parse shapes (`tools/lib/sources/providers/defillama.ts:241-305`, `tools/lib/sources/providers/specs/defillama.yaml:170-308`). If the goal is handwritten adapter removal, partial coverage is the wrong tradeoff here.

### Q4

Use a minimal but structurally real Atom fixture: `<feed>` wrapper plus 2 `<entry>` blocks, each with `id`, `title`, `summary`, `published`, multiple `<author>` tags, and at least one `<category>` tag. A single-entry toy fixture is too weak for the exact behaviors that currently diverge.

### Q5

After handwritten removal, `index.ts` should fail hard, or at minimum fail loudly and prevent startup. The current silent `try/catch` fallback (`tools/lib/sources/providers/index.ts:49-61`) is survivable only while handwritten adapters still exist. Once declarative adapters are the sole source of truth, swallowing loader failure would silently remove provider coverage.

## 4. Additional test cases to add

- Load declarative adapters with the async loader, and add a regression test that uses the same path as `tools/lib/sources/providers/index.ts`.
- Assert `normalized` is present for successful JSON parses and absent for `arxiv`.
- Add GitHub `repo`, `commits`, and `releases` build tests that rely on `source.url` owner/repo extraction rather than explicit vars.
- Add HN `search_by_date`, `front_page`, and one tagged search (`ask_hn` or `show_hn`) so operation resolution and tag/query behavior are covered.
- Add DefiLlama `yields`, `dexs`, and `stablecoins` parse fixtures.
- Add World Bank `country` parse coverage and indicator validation coverage for `mrv=1` plus `per_page=5`.
- Strengthen PubMed tests to compare `esearch` metric values and to assert that `esummary` yields per-UID entries, not a single `result` wrapper entry.
- Add Binance `ticker-24hr` parse coverage.
- Add Kraken OHLC build/validate/parse coverage, including `since` injection, skipping `result.last`, and candle IDs/metrics.
- Add arXiv assertions for cleaned paper IDs, canonical URL normalization, and author-count semantics.
- Add one negative parse fixture per provider family where the handwritten adapter intentionally returns empty entries on malformed or unsupported bodies.

## 5. Risk assessment for the adapter removal step

The proposed suite is not yet strong enough to justify removal. In its current form it focuses on a narrow subset of operations and allows loose structural checks that would miss real regressions. The highest-risk gaps are GitHub URL-derived repo operations, PubMed `esummary`, Kraken OHLC, and arXiv normalization.

Removal is only defensible after:
- every supported handwritten operation is covered, or every omitted one is justified as behaviorally identical,
- parse assertions compare selected metric values, not just key presence,
- JSON `normalized` output is checked,
- the production declarative loading path is what the tests exercise,
- startup no longer silently swallows declarative adapter load failure.
