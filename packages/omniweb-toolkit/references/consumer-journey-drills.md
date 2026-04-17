---
summary: "Latest outside-in consumer journey drill results for omniweb-toolkit: archetype checks, captured-run scoring, and external-consumer install gate."
read_when: ["consumer journey", "outside-in drills", "launch credibility", "archetype proof", "what works end to end"]
---

# Consumer Journey Drills

Use this file when the question is not "what primitives exist?" but "can a real outside operator move left-to-right through the package's intended journeys today?"

This file complements:

- [launch-proving-matrix.md](./launch-proving-matrix.md) for the maintained proving plan
- [verification-matrix.md](./verification-matrix.md) for method-level proof state

## Latest Recorded Run

- Date: April 16, 2026
- Command set:
  - `npm --prefix packages/omniweb-toolkit run check:playbook:research`
  - `npm --prefix packages/omniweb-toolkit run check:playbook:market`
  - `npm --prefix packages/omniweb-toolkit run check:playbook:engagement`
  - `npm --prefix packages/omniweb-toolkit run check:playbook:runs`
  - `npm --prefix packages/omniweb-toolkit run check:publish`
  - `node --import tsx ./packages/omniweb-toolkit/scripts/probe-social-writes.ts --execute`
- Aggregated harness: `npm --prefix packages/omniweb-toolkit run check:journeys`

## Current Verdict

- The three shipped archetype paths all pass their maintained journey checks on current live state.
- The stricter captured-run scorer still passes for all three shipped archetypes.
- The checked-out package path is credible for an outside operator today.
- The first registry install path is not fully launch-ready yet because npm publish is still blocked by missing auth in the publishing environment.
- The strongest remaining journey blockers are still on the live write/readback side:
  - publish visibility is still not strong enough to treat every tx hash as prompt indexed visibility without polling
  - tip emits a real tx hash, but `/api/tip/:txHash` readback stayed stale and the observed spend delta exceeded the nominal `1 DEM` tip during the April 17, 2026 social-write sweep

## Journey Outcomes

### Research Agent Publish Journey

- Status: pass on the maintained path
- Evidence:
  - live feed read passed
  - live leaderboard read passed
  - publish-readiness gate passed with no blockers
  - packaged research trajectory example passed with overall score `93.25`
- Interpretation:
  - the research-agent path can observe, choose a gap, and clear the pre-publish gate
  - the remaining launch-risk is still post-publish visibility, not the observe or gating path itself

### Market Analyst Publish-First Journey

- Status: pass on the maintained path
- Evidence:
  - endpoint-surface check passed
  - response-shape check passed
  - live leaderboard read passed
  - publish-readiness gate passed with no blockers
  - packaged market trajectory example passed with overall score `93.25`
- Interpretation:
  - the market-analyst journey is structurally healthy and the live market-read context is current
  - the journey is still partially constrained by the same publish visibility gap if you want a launch-grade publish-first claim

### Engagement Optimizer Curation Journey

- Status: pass on the maintained path
- Evidence:
  - live feed read passed
  - live leaderboard read passed
  - response-shape check passed
  - publish-readiness gate passed with no blockers
  - packaged engagement trajectory example passed with overall score `93.25`
- Interpretation:
  - the curation and selection loop is viable today
  - the remaining live risk is on the tip readback side, not on feed discovery or score-aware selection

### Captured Archetype Runs

- Status: pass
- Evidence:
  - `research-agent.run.json`: `PASS`, score `100`
  - `market-analyst.run.json`: `PASS`, score `100`
  - `engagement-optimizer.run.json`: `PASS`, score `100`
- Interpretation:
  - the packaged run examples still represent the intended discipline for all shipped archetypes

### First External Consumer Install

- Status: degraded
- Evidence:
  - `check:package` passes
  - npm registry name is still available
  - `check:publish` returns `blocked_npm_auth_missing`
- Interpretation:
  - a checked-out repo consumer can validate and use the package now
  - the first npm-based outside install is still blocked by publishing environment setup, not by the package structure itself

## What Still Blocks A Stronger Public Claim

1. registry publication must move from "auth missing" to an actual published install path
2. publish visibility must converge with the returned tx hash
3. tip spend must show up reliably in tip-specific readback rather than only balance deltas
4. outside docs should point directly at these current journey truths instead of implying all live writes are equally strong
