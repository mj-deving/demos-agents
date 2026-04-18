# Indexing Miss Probe — 2026-04-18

This probe compared one known indexed research publish against three known missing research publishes at the raw SDK, authenticated `post_detail`, and feed readback layers.

Probe script:
- [check-indexing-miss-probe.ts](/home/mj/projects/demos-agents/tx-format-probe/packages/omniweb-toolkit/scripts/check-indexing-miss-probe.ts)

Primary output artifact:
- `/tmp/indexing-miss-probe.json`

## Target transactions

Indexed reference:
- `44f24253af2b871a87055ee0e786ee8f93de045fdd01e547a1b6abd445460d21`

Missing research publishes:
- `835a6c5cf1515ac80ceb9077af63f1e07b5bff6f53fe0ed42df5ceda502d85b2`
- `a4edc4422edc2c7f565f74945b6f327141685430df7398090d7ad31898ce8f18`
- `fd868d540661e1e3316151f3272de9f21adb1ae2244da1f8095ecc19db5a6289`

## What was checked

1. `getTxByHash(...)` through the Demos raw SDK bridge for the indexed tx and the three missing txs.
2. Authenticated `GET /api/post/:txHash` for the three missing txs.
3. Generic `ANALYSIS` feed and author-scoped `ANALYSIS` feed presence for the same txs.
4. Other hive posts in block range `2109130-2109145` to determine whether the misses were unique to our research publishes.

## Findings

### 1. The indexed reference resolves as a normal confirmed storage envelope

The indexed tx `44f24253...` returns a full raw SDK envelope with:
- `blockNumber: 2108918`
- `status: confirmed`
- storage `content` keys present
- `content.data` encoded as a storage-array wrapper
- decoded hive keys:
  - `v`
  - `cat`
  - `text`
  - `tags`
  - `confidence`
  - `sourceAttestations`

This is the expected chain-side shape for a recoverable indexed research post.

### 2. The three missing research txs do not resolve the same way at the raw SDK layer

For all three missing txs, the normalized raw SDK result was effectively empty:
- `author: null`
- `type: null`
- `timestamp: null`
- `wrapper: unknown`
- `rawContentKeys: []`
- `rawDataKind: undefined`
- `hiveKeys: []`

This matters because the divergence appears before feed/index lookup. The indexed reference and the missing txs are not surfacing through `getTxByHash(...)` with the same chain-side envelope shape.

### 3. Authenticated `post_detail` still returns 404 for all three missing research txs

Even after the longer-delay recheck, all three still returned:
- `404`
- `{"error":"Post not found"}`

That means these are no longer “maybe generic feed windowing” cases. They remain absent from the authenticated direct post-detail path.

### 4. The misses are not unique to our research publish path

The block-range scan over `2109130-2109145` found other hive posts that also fail authenticated readback, including posts from another author:
- `fe39aa56...` author `0x59ad45...` category `SIGNAL`
- `4ae6636a...` author `0x59ad45...` category `SIGNAL`
- `f7af76d7...` author `0x59ad45...` category `OPINION`
- `bbb1960f...` author `0x59ad45...` category `SIGNAL`

At the same time, many posts in the same block window do resolve in indexed reads.

This strongly suggests a partial indexing gap in that block window rather than a bug isolated to one research-family publish path.

### 5. Feed visibility remains a weaker signal than authenticated direct readback

Most scanned block-window posts were absent from both:
- generic `ANALYSIS` feed
- author-scoped `ANALYSIS` feed

But some unrelated posts in the same window did appear in generic feed lookups.

So the current confidence ordering remains:
1. authenticated `post_detail`
2. author-scoped feed
3. generic feed

For these three missing txs, all three layers still fail.

## Interpretation

The most important result is this:

- The indexed reference tx is recoverable as a normal storage envelope.
- The missing txs are not.
- Other authors also have missing posts in the same block range.

That combination points away from “the research prompt or family logic produced a bad post body” and toward one of:
- a chain-side retrieval inconsistency for specific txs,
- a partial ingestion/indexing hole affecting a subset of posts in that time window,
- or an upstream runtime/storage issue that prevents those txs from ever being presented as normal hive envelopes to the indexer.

It does **not** currently support the narrower claim that the missing posts are caused only by one malformed minimal-loop publish pipeline.

## Practical conclusion

The verification contract is now clearer:
- older missing-looking cases can recover through auth + author feed,
- these three txs do not,
- and at least some neighboring non-research posts are affected too.

So the next debugging step should focus on runtime/indexer behavior for the affected tx/block window, not more prompt or family-level research changes.
