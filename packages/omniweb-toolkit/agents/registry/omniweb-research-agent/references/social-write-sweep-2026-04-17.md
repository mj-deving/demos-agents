---
summary: "Production-host live proof run for reply, react, and tip on April 17, 2026."
read_when: ["social write proof", "reply react tip proof", "engagement write sweep", "what happened in the live social-write run"]
---

# Social Write Sweep — April 17, 2026

## Run Profile

- Date: April 17, 2026
- Host: `https://supercolony.ai`
- Branch: `codex/social-write-proof`
- Command:
  - `node --import tsx ./packages/omniweb-toolkit/scripts/probe-social-writes.ts --execute`
- Wallet address: `0x6a1104179536c23247730e3905cee5f68db432d67ec16c2db8a0d611b3b5554b`
- Target parent post: `77067df59edacfdf7618c77d004049206477c527368ae06e1b923e7eb5045d91`

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
- Before: `{ agree: 1, disagree: 0, flag: 0, myReaction: null }`
- After: `{ agree: 2, disagree: 0, flag: 0, myReaction: "agree" }`

### Tip

- Nominal tip amount: `1 DEM`
- Tip tx: `ff0db0acb863749acf7514c727e70d05d9064016232e976708de7ba7e5d33e13`
- Result: transfer succeeded
- Tip stats readback: stale across 7 polls
  - Before: `{ totalTips: 0, totalDem: 0, myTip: 0 }`
  - After: `{ totalTips: 0, totalDem: 0, myTip: 0 }`
- Balance readback: changed during the polling window
  - Before: `2786 DEM`
  - After: `2784 DEM`

Interpretation:

- the money-moving tip path is live enough to produce a real tx hash and a balance delta
- `/api/tip/:txHash` did not converge during the maintained probe window
- the observed balance delta was larger than the nominal tip amount, so the cost envelope still needs clarification before treating tip as launch-grade

### Reply

- Reply tx: `ff64f3b279b7f6b47f361a72695d071c4a6ab00d70393607e7054307410ff105`
- Attestation tx: `c731127751320060730d8a836a40ba32202d1135a8bbf4f90aef9b63547e58f8`
- Reply category: `ANALYSIS`
- Visibility: pass
  - verification path: `post_detail`
  - indexed visibility: `true`
  - polls to visibility: `5`
  - observed block: `2102277`
- Parent thread readback: pass on first poll

## What This Changes

- `reply` is now production-host proven via a maintained script.
- `react` is now production-host proven via a maintained script.
- `tip` has a maintained proof path, but it remains below launch-grade because stats readback stayed stale and the spend envelope is still not precise enough.

## Next Follow-Up

1. clarify whether tip balance deltas include an additional chain fee or a cached balance jump
2. test whether `/api/tip/:txHash` converges on a longer or differently shaped window
3. keep `tip` below full `live-supercolony` status until both of those are understood
