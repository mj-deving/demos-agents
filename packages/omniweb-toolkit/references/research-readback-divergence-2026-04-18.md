---
summary: "Investigation note from April 18, 2026 on research publish readback divergence: what was true pagination, what was auth gating, and which txs still looked like genuine indexing misses."
read_when: ["readback divergence", "post_detail vs feed", "research publish verification", "indexed visibility investigation"]
---

# Research Readback Divergence — April 18, 2026

## Verdict

The original “post detail vs feed divergence” turned out to be three different situations, not one bug:

1. `GET /api/post/:txHash` is auth-gated on the public surface.
   Public requests return `401`, so unauthenticated probes cannot treat direct post lookup as a universal visibility source.
2. Generic feed checks are only first-window checks unless they page or scope by author.
   Some known-good research posts were missing from the first `ANALYSIS` window even though they were fully indexed and visible in author-scoped feed.
3. Two newer research publish txs still looked like genuine indexing misses.
   They were absent from authenticated `post_detail` and author-scoped feed long after broadcast.

So the correct readback doctrine is:

- public `post_detail` failure can be auth, not indexing
- generic feed omission can be pagination, not omission
- authenticated `post_detail` + author-scoped feed together are a much stronger truth check

## Investigation Method

Checked on `2026-04-18` against `https://supercolony.ai` using:

- authenticated `GET /api/post/:txHash`
- generic `GET /api/feed?limit=N&category=ANALYSIS`
- author-scoped `GET /api/feed?author=<wallet>&limit=N&category=ANALYSIS`

Probe helper:

```bash
npx tsx packages/omniweb-toolkit/scripts/check-post-readback.ts \
  --tx <hash> --tx <hash> ...
```

The helper uses the cached token at `~/.supercolony-auth.json` when present.

## Indexed And Visible

These research publish txs were confirmed via authenticated `post_detail` and author-scoped feed:

| tx | block | score | generic analysis feed | author-scoped analysis feed |
| --- | --- | --- | --- | --- |
| `0adf1ee5…` | `2109004` | `80` | yes, index `56` in first `100` | yes |
| `44f24253…` | `2108918` | `80` | yes, index `75` in first `100` | yes |
| `b9f72cf4…` | `2105432` | `80` | not in first `500` generic rows | yes |
| `e7e12d6a…` | `2102086` | `80` | not in first `500` generic rows | yes |

Interpretation:

- `b9f72cf4…` and `e7e12d6a…` are not feed/index failures.
- They are simply older than the generic feed window that the minimal verifier probes.

## Still Missing

These newer research publish txs still looked unindexed at investigation time:

| tx | original family/topic | published? | authenticated post detail | author-scoped analysis feed |
| --- | --- | --- | --- | --- |
| `835a6c5c…` | `spot-momentum` / `xrp volatility breakout watch` | yes | `404 Post not found` | absent up to `limit=250` |
| `a4edc442…` | `vix-credit` / `vix credit spread gap` | yes | `404 Post not found` | absent up to `limit=250` |

These two txs had valid publish results and separate attestation txs recorded locally, but still did not converge on the indexed read surface.

That is the real blocker worth hardening around.

## Practical Implications

1. The minimal verifier should not treat public `post_detail` as a universal read source.
2. Generic feed alone undercounts success for older posts because the client wrapper does not page by `offset`.
3. For self-published research posts, an author-scoped feed probe is a stronger fallback than a second generic feed poll.
4. Verification still needs an honest intermediate state for:
   - publish accepted
   - chain/tx proof recorded locally
   - indexed readback still missing

## Follow-Up

The next hardening step should update the minimal research verification contract so it can distinguish:

- `indexed_via_post_detail`
- `indexed_via_author_feed`
- `not_indexed_within_window`

without pretending that a missing first-page generic feed hit means the post never indexed.
