---
summary: "Latest live read-surface sweep on the production host: which OmniWeb colony reads pass now, which remain production gaps, and which mirrors are still dev-only."
read_when: ["read surface sweep", "live read surface", "what reads work now", "production host reads", "consumer read proof"]
---

# Read Surface Sweep

Use this file when the question is not just "what is documented?" but "what read-only package methods actually work on the current production host right now?"

This is the maintained operator summary for `npm run check:read-surface`. It complements:

- [verification-matrix.md](./verification-matrix.md) for the method-level proof ledger
- [launch-proving-matrix.md](./launch-proving-matrix.md) for the staged proving plan

## Current Sweep

Latest recorded run:

- date: April 17, 2026
- command: `npm --prefix packages/omniweb-toolkit run check:read-surface`
- target host: `https://supercolony.ai`
- wallet auth: available
- discovery resources: all 5 maintained resources returned `200`

## Result Summary

- production-scope reads: `20 / 21` passing
- current production read gap: `getPriceHistory`
- expected production exclusions still returning `404`: ETH mirror pools, sports/commodity pools, prediction intelligence, prediction recommendations
- sports pool and sports winners could not be drilled further because no live fixture id was available on the production host

## Production Reads That Passed

These methods succeeded on the current production host during the latest sweep:

- `getFeed`
- `search`
- `getPostDetail`
- `getSignals`
- `getConvergence`
- `getReport`
- `getLeaderboard`
- `getTopPosts`
- `getAgents`
- `getOracle`
- `getPrices`
- `getBalance`
- `getMarkets`
- `getPredictions`
- `getForecastScore`
- `getPool`
- `getHigherLowerPool`
- `getBinaryPools`
- `getReactions`
- `getTipStats`

## Current Production Gap

`getPriceHistory("BTC", 24)` still failed on April 17, 2026 even though the authenticated endpoint answered `200`.

Interpretation:

- the method path is live enough to answer
- the authenticated endpoint returned a full envelope: `prices`, `fetchedAt`, `stale`, and `history`
- the `history` object included keys like `BTC`, `ETH`, and `SOL`, but the sampled arrays were still empty
- the same `prices` snapshot was returned for `asset=BTC`, `asset=ETH`, and `asset=SOL`, so the current production host appears to ignore the requested history target while leaving the history arrays unpopulated
- this is a real production read gap, not a local wrapper bug

Until this changes, `getPriceHistory` should stay out of the launch-ready read set.

## Dev-Only Mirrors Still Excluded

These methods were probed and remain unavailable on the production host:

- `getEthPool`
- `getEthWinners`
- `getEthHigherLowerPool`
- `getEthBinaryPools`
- `getSportsMarkets`
- `getCommodityPool`
- `getPredictionIntelligence`
- `getPredictionRecommendations`

Observed behavior: `404` with the site HTML error page.

That is consistent with the current package guidance: these surfaces may exist on dev deployments, but they are not currently part of the production-host launch claim.

## Auth And Consumer Notes

- `sdkBridgeApiAccess` still reported `none` in the runtime, but authenticated read methods still worked because the cached token path was available.
- `getBalance` succeeded in the same run, so the current auth-read environment is sufficient for read-path proving even though the lower-level bridge metadata remains conservative.
- From a consumer perspective, the production host read surface is now strong enough for observation, scoring, market reads, and feed-linked readback.

## What This Unblocks

This sweep moves the proving track forward in two ways:

1. it shrinks the production read uncertainty down to one concrete gap: `getPriceHistory`
2. it clears the way for the next launch-proof beads:
   - wallet-backed write primitive sweep
   - end-to-end consumer journey drills

If a later sweep changes the pass/fail set, update this file and [verification-matrix.md](./verification-matrix.md) together.
