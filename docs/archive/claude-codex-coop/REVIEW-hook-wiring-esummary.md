# Hook Wiring + PubMed Esummary Design Review

Date: 2026-03-14

I read the task and all listed files:
- [tools/lib/sources/providers/declarative-engine.ts](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/declarative-engine.ts)
- [tools/lib/sources/providers/specs/arxiv.yaml](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/specs/arxiv.yaml)
- [tools/lib/sources/providers/specs/kraken.yaml](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/specs/kraken.yaml)
- [tools/lib/sources/providers/specs/pubmed.yaml](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/specs/pubmed.yaml)
- [tools/lib/sources/providers/hooks/arxiv.ts](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/hooks/arxiv.ts)
- [tools/lib/sources/providers/hooks/kraken.ts](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/hooks/kraken.ts)

## Findings

### P1

- **The proposed non-object filter is broader than the task text says and implicitly changes `kraken.ohlc` into a hook-only path.** `extractItems()` currently iterates every entry after envelope unwrap in `object-entries` mode ([declarative-engine.ts:645](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/declarative-engine.ts#L645), [declarative-engine.ts:696](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/declarative-engine.ts#L696)). `kraken.ohlc` points that mode at `result`, where the pair payload is an array of candle tuples ([kraken.yaml:228](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/specs/kraken.yaml#L228)). The Kraken hook only does manual OHLC extraction when `entries.length === 0` ([kraken.ts:78](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/hooks/kraken.ts#L78), [kraken.ts:115](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/hooks/kraken.ts#L115)). If arrays are filtered out globally, `ohlc` will stop using declarative extraction and will succeed only because the hook backfills it. That may be acceptable, but it is a real behavior change and needs an explicit `kraken.ohlc` regression test, not just PubMed and arXiv coverage.

### P2

- **The task write-up is stale relative to the files under review.** The engine already loads and resolves hooks from `operation.parse.hooks.module` ([declarative-engine.ts:1153](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/declarative-engine.ts#L1153), [declarative-engine.ts:1227](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/declarative-engine.ts#L1227)), and the checked-in `arxiv` and `kraken` specs already place `hooks` under `parse` ([arxiv.yaml:59](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/specs/arxiv.yaml#L59), [arxiv.yaml:88](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/specs/arxiv.yaml#L88), [kraken.yaml:75](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/specs/kraken.yaml#L75), [kraken.yaml:112](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/specs/kraken.yaml#L112), [kraken.yaml:164](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/specs/kraken.yaml#L164), [kraken.yaml:264](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/specs/kraken.yaml#L264)). Likewise, only `kraken.ohlc` still carries `items.jsonPath: "$.result"` ([kraken.yaml:234](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/specs/kraken.yaml#L234)); `ticker` and `assets` no longer do. The patch plan should be rebased to current file state before implementation, otherwise the review/test matrix will be chasing changes that are already present.

## Q1

`object-entries` should apply `items.jsonPath` **after** envelope unwrap.

That matches the engine's existing mental model: `envelope` strips a shared response wrapper first, then `items` selects the iterable payload ([declarative-engine.ts:645](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/declarative-engine.ts#L645), [declarative-engine.ts:653](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/declarative-engine.ts#L653)). Keeping `object-entries` aligned with `json-path` avoids a one-off rule. The consequence is that any remaining Kraken `items.jsonPath: "$.result"` must be removed in the same change, because after envelope unwrap it would double-navigate.

## Q2

Yes, removing Kraken's `items.jsonPath` is safe where `envelope.jsonPath: "$.result"` already exists, and once `object-entries` starts honoring `items.jsonPath` it becomes necessary.

On the current files, that cleanup is only needed for `ohlc` ([kraken.yaml:232](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/specs/kraken.yaml#L232), [kraken.yaml:236](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/specs/kraken.yaml#L236)). Leaving the duplicate path in place after the engine change would make `object-entries` look for `result.result`, which is wrong.

## Q3

Yes. Non-object filtering should also exclude `null` and `undefined`.

`null` matters because `typeof null === "object"`, and the current field mapping can still synthesize a non-empty entry from `{key}` even when the payload is unusable ([declarative-engine.ts:507](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/declarative-engine.ts#L507), [declarative-engine.ts:731](/home/mj/projects/omniweb-agents/tools/lib/sources/providers/declarative-engine.ts#L731)). If this change is intentional, define the rule as "plain object values only" rather than "skip arrays/strings"; that is clearer and covers `null` explicitly. `undefined` will not come from `JSON.parse()`, but filtering it is still the safer generic behavior for tests or synthetic parsed inputs.
