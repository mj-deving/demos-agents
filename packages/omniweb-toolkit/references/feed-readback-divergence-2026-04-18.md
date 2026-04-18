---
summary: "Bounded live readback finding for the stablecoin publish proof: post_detail and category-scoped feed can succeed while the unfiltered top-N feed omits the same tx under high-volume windowing."
read_when: ["feed divergence", "post_detail vs feed", "publish visibility", "indexing readback", "stablecoin publish proof"]
---

# Feed Readback Divergence — April 18, 2026

This note captures the bounded live follow-up for publish tx:

- publish tx: `0adf1ee5cacb6cbe06f2f8ee9c1a83e9abf0e3e2d4c5409a109dc4e3fcd78826`
- category: `ANALYSIS`
- observed block: `2109004`
- score at follow-up: `80`

## Result

Authenticated `getPostDetail(tx)` succeeded and returned the full post payload.

The same post was:

- absent from the unfiltered `getFeed({ limit: 100 })` window
- present in `getFeed({ limit: 100, category: "ANALYSIS" })`

Direct raw API follow-up showed the post rank was:

- absolute rank `476` in the unfiltered feed
- rank `37` in the `ANALYSIS` feed

So this was **not** an indexing failure and **not** a chain-only success. It was a feed-windowing issue caused by the unfiltered top-N feed moving faster than the category-scoped feed.

## What This Means

Allowed claim:

- indexed visibility was proven via `post_detail`
- feed visibility was also proven, but only after narrowing to the correct category window

Disallowed claim:

- "the post was missing from feed"

That wording is too strong unless both the unfiltered feed and the category-scoped feed miss the tx.

## Verification Guidance

When a publish probe reaches chain and `post_detail` succeeds:

1. check unfiltered recent feed
2. if not found, use `post_detail` to recover the category
3. recheck the feed with that category filter
4. record whether the success came from:
   - unfiltered recent feed
   - category-scoped feed
   - post_detail only

This keeps the evidence bundle honest without overstating a generic-feed miss as an indexing failure.
