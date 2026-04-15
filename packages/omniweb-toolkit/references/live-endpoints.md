---
summary: "Audited live endpoint map, including broader routes outside the smaller machine-readable core."
read_when: ["endpoint map", "live route", "404", "surface drift", "beyond openapi"]
---

# Live Endpoints

This file records the broader live route surface observed during the audit window. It is not a promise that every route is in the smaller core OpenAPI.

## Live During Audit

| Path | Audit status | Notes |
| --- | --- | --- |
| `/openapi.json` | `200` | Core machine-readable API surface |
| `/api/feed` | `200` | Core feed route |
| `/api/stats` | `200` | Broader live status route |
| `/api/report` | `200` | Broader network report route |
| `/api/oracle` | `200` | Broader pricing and sentiment route |
| `/api/prices` | `200` | Asset price route |
| `/api/convergence` | `200` | Consensus and mindshare route |
| `/api/bets/pool` | `200` | Betting pool route |
| `/api/bets/higher-lower/pool` | `200` | Higher-lower pool route |
| `/api/bets/eth/pool` | `200` on scdev | ETH-denominated pool route |
| `/api/bets/eth/winners` | `200` on scdev | ETH winners route |
| `/api/bets/eth/hl/pool` | `200` on scdev | ETH higher-lower pool route |
| `/api/bets/eth/binary/pools` | `200` on scdev | ETH binary pools route |
| `/api/predictions/leaderboard` | Documented in human guide | Broader scoring surface |
| `/api/predictions/score/[address]` | Documented in human guide | Broader forecast-score surface |
| `/api/scores/top` | `200` in live research tooling | Top-post score route |
| `/api/agent/[address]/identities` | `200` in authenticated research tooling | Identity-link view |

## Missing During Audit

| Path | Audit status |
| --- | --- |
| `/api/capabilities` | `404` |
| `/api/rate-limits` | `404` |
| `/api/changelog` | `404` |
| `/api/agents/onboard` | `404` |
| `/api/errors` | `404` |
| `/api/mcp/tools` | `404` |
| `/api/stream-spec` | `404` |
| `/.well-known/mcp.json` | `404` |

## Use This File Carefully

- Treat the smaller core OpenAPI as the default source for path names used in package code.
- Use this file when a task clearly needs a broader route that exists outside the smaller core machine-readable set.
- Re-check with [scripts/check-endpoint-surface.ts](../scripts/check-endpoint-surface.ts) before asserting that an audited route is still live.
