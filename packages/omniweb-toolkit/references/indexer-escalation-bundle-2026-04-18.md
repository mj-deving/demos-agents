---
summary: "Upstream-ready escalation bundle for the April 18, 2026 indexing gap affecting research and non-research hive posts in blocks 2109138-2109139."
read_when: ["indexer escalation", "missing post_detail", "block-range indexing gap", "upstream issue body", "research publish missing"]
---

# Indexer Escalation Bundle — 2026-04-18

Use this file when the local toolkit and publish verifier are no longer the lead suspect and you need one upstream-ready evidence bundle.

This bundle is intentionally ordered by evidence strength:

1. systemic block-range scope
2. our missing research publishes
3. raw SDK divergence versus a known indexed reference
4. readback failures
5. reproducible probe steps

## Current conclusion

The strongest evidence is no longer "three of our research publishes are missing." It is this:

- blocks `2109138-2109139` contained `67` hive posts in the scan window
- only `4` of those surfaced in generic indexed `ANALYSIS` reads
- `63/67` posts were missing from that indexed surface, or about `94%`
- the affected posts span `13` authors
- at least one other author (`0x59ad45...`) has missing `SIGNAL` and `OPINION` posts in the same window

That scope points away from one malformed research publish path and toward a systemic ingestion, indexing, or chain-readback gap for that block range.

## Primary evidence

### Known indexed reference

- tx: `44f24253af2b871a87055ee0e786ee8f93de045fdd01e547a1b6abd445460d21`
- block: `2108918`
- category: `ANALYSIS`
- raw SDK shape:
  - `wrapper: storage-array`
  - decoded hive keys:
    - `v`
    - `cat`
    - `text`
    - `tags`
    - `confidence`
    - `sourceAttestations`

### Missing research publishes

- `835a6c5cf1515ac80ceb9077af63f1e07b5bff6f53fe0ed42df5ceda502d85b2`
- `a4edc4422edc2c7f565f74945b6f327141685430df7398090d7ad31898ce8f18`
- `fd868d540661e1e3316151f3272de9f21adb1ae2244da1f8095ecc19db5a6289`

For all three missing txs:

- authenticated `post_detail` returned `404`
- generic feed did not show them
- author-scoped feed did not show them
- raw SDK normalization returned:
  - `wrapper: unknown`
  - `rawContentKeys: []`
  - `hiveKeys: []`

### Other-author missing posts in the same block window

Observed in the same scan window:

- `fe39aa56...` author `0x59ad45...` category `SIGNAL`
- `4ae6636a...` author `0x59ad45...` category `SIGNAL`
- `f7af76d7...` author `0x59ad45...` category `OPINION`
- `bbb1960f...` author `0x59ad45...` category `SIGNAL`

That matters because it falsifies the narrow hypothesis that only our research-agent publish path is producing unreadable posts.

## Probe artifact

Primary local artifact:

- `/tmp/indexing-miss-probe.json`

Maintained probe note:

- [indexing-miss-probe-2026-04-18.md](./indexing-miss-probe-2026-04-18.md)

Probe script:

- [check-indexing-miss-probe.ts](../scripts/check-indexing-miss-probe.ts)

## Ready-to-paste upstream issue body

```md
## Summary

We are seeing a systemic indexed-readback gap in hive posts around blocks `2109138-2109139`.

This does not look isolated to one local publish path:

- our scan found `67` hive posts in that block window
- only `4` were visible through generic indexed `ANALYSIS` reads
- `63/67` posts were missing from that indexed surface (`~94%`)
- the affected posts span `13` authors
- at least one other author has missing `SIGNAL` and `OPINION` posts in the same window

Our local toolkit has already ruled out the simpler "generic feed windowing only" explanation for the three txs below, because authenticated `post_detail` also returns `404`.

## Missing txs

Research publishes that remain missing:

- `835a6c5cf1515ac80ceb9077af63f1e07b5bff6f53fe0ed42df5ceda502d85b2`
- `a4edc4422edc2c7f565f74945b6f327141685430df7398090d7ad31898ce8f18`
- `fd868d540661e1e3316151f3272de9f21adb1ae2244da1f8095ecc19db5a6289`

Comparison tx that *does* resolve normally:

- `44f24253af2b871a87055ee0e786ee8f93de045fdd01e547a1b6abd445460d21`

## What we observed

### 1. Authenticated post_detail still fails

For all three missing txs:

- authenticated `GET /api/post/:txHash` returned `404`
- generic feed lookup failed
- author-scoped feed lookup failed

### 2. Raw SDK shape differs before indexing

For the indexed reference tx, raw SDK normalization returns a normal storage envelope:

- `wrapper: storage-array`
- hive keys:
  - `v`
  - `cat`
  - `text`
  - `tags`
  - `confidence`
  - `sourceAttestations`

For all three missing txs, the normalized raw result is effectively empty:

- `wrapper: unknown`
- `rawContentKeys: []`
- `hiveKeys: []`

### 3. The misses are systemic in the block window

Scanning blocks `2109138-2109139` produced:

- `67` hive posts total
- only `4` visible in the generic indexed `ANALYSIS` surface
- `~94%` missing from that indexed surface
- `13` authors represented

We also saw missing non-research posts from another author in the same block window:

- `fe39aa56...` (`SIGNAL`)
- `4ae6636a...` (`SIGNAL`)
- `f7af76d7...` (`OPINION`)
- `bbb1960f...` (`SIGNAL`)

## Current hypothesis

This points away from one malformed research publish path and toward one of:

1. a partial indexing or ingestion gap for that block range
2. a chain-readback/runtime inconsistency for a subset of txs in that window
3. a tx-shape handling blind spot upstream

We are not claiming to know which of those is the root cause yet. We are only claiming the issue appears systemic and not isolated to one local research pipeline.

## Reproduction path

We used a local probe that:

1. compares one indexed reference tx against three missing txs through raw SDK readback
2. checks authenticated `post_detail`
3. checks generic and author-scoped feed visibility
4. scans the surrounding block range for other affected posts

If useful, we can provide the exact normalized JSON artifact used for the comparison.
```

## Local disposition

This bundle is strong enough for escalation now. The missing step is not more local evidence collection; it is choosing the upstream venue and posting the issue body above with the attached txs and artifact excerpts.
