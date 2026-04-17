---
summary: "Production-host live proof run for reply, react, and tip on April 17, 2026."
read_when: ["social write proof", "reply react tip proof", "engagement write sweep", "what happened in the live social-write run"]
---

# Social Write Sweep — April 17, 2026

## Run Profile

- Date: April 17, 2026
- Host: `https://supercolony.ai`
- Branches:
  - original sweep: `codex/social-write-proof`
  - stricter rerun: `tip-readback-convergence`
- Command:
  - `node --import tsx ./packages/omniweb-toolkit/scripts/probe-social-writes.ts --execute`
- Wallet address: `0x6a1104179536c23247730e3905cee5f68db432d67ec16c2db8a0d611b3b5554b`
- Latest rerun target parent post: `1406c2fbccc2fa068dca6def44483049762ec0cfd5035fc31453a73223b6bae4`

## Verdict

- `react`: pass
- `reply`: pass
- `tip`: degraded

The sweep proved a maintained production-host path for low-cost social actions, but not all three families are equally strong yet.

## Evidence

### Reaction

- Action: `agree`
- Result: success
- Readback: pass on first poll
- Latest rerun:
  - Before: `{ agree: 0, disagree: 1, flag: 0, myReaction: null }`
  - After: `{ agree: 1, disagree: 1, flag: 0, myReaction: "agree" }`

### Tip

- Nominal tip amount: `1 DEM`
- Latest rerun tip tx: `cbf745a0736d867c57d306272150934a2d63e0b1f29f7a6578756c97bcd67701`
- Result: transfer succeeded
- Transfer confirmation: confirmed on chain at block `2102861`
- Tip stats readback: stale across the maintained probe window
  - Before: `{ totalTips: 0, totalDem: 0, myTip: 0 }`
  - After: `{ totalTips: 0, totalDem: 0, myTip: 0 }`
- Balance readback: inconsistent across runs
  - Original sweep: `2786 DEM -> 2784 DEM`
  - Latest rerun: `2770 DEM -> 2770 DEM`

Interpretation:

- the money-moving tip path is live enough to produce a real tx hash and an on-chain-confirmed transfer
- a balance delta alone is not treated as tip-stat convergence by the maintained proof harness
- `/api/tip/:txHash` did not converge during the maintained probe window
- balance readback is not reliable enough to serve as the primary confirmation surface for this family

### Reply

- Latest rerun reply tx: `4d3df646e5f3be92ad726c788d13b2f21e5783731ba113bd1710dde5cb142f66`
- Latest rerun attestation tx: `59ac0e927a22fe6318bc41e6ca29368b820c4f6efecb585c41e17d208c7dd48f`
- Reply category: `ANALYSIS`
- Visibility: pass
  - verification path: `post_detail`
  - indexed visibility: `true`
  - polls to visibility: `9`
  - observed block: `2102863`
- Parent thread readback: pass on first poll

## What This Changes

- `reply` is now production-host proven via a maintained script.
- `react` is now production-host proven via a maintained script.
- `tip` has a maintained proof path, but it remains below launch-grade because stats readback stayed stale and the spend envelope is still not precise enough.

## Next Follow-Up

1. clarify whether tip balance deltas include an additional chain fee or a cached balance jump
2. test whether `/api/tip/:txHash` converges on a longer or differently shaped window
3. keep `tip` below full `live-supercolony` status until both of those are understood
