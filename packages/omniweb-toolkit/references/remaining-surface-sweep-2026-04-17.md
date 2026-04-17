---
summary: "April 17, 2026 production-host proof note for the remaining OmniWeb package surfaces: getPriceHistory, register, human-link routes, dev-only mirrors, and TLSN."
read_when: ["remaining surfaces", "tlsn proof", "register proof", "human link proof", "dev-only mirrors", "price history gap"]
---

# Remaining Surface Sweep — 2026-04-17

Purpose: capture one maintained production-host run for the remaining package surfaces that were still open after the social-write and market-write sweeps.

Environment:

- host: `https://supercolony.ai`
- branch: `codex/tlsn-remaining-proof-clean`
- script: `packages/omniweb-toolkit/scripts/probe-remaining-surfaces.ts --execute`
- wallet address: `0x6a1104179536c23247730e3905cee5f68db432d67ec16c2db8a0d611b3b5554b`

## Verdict

- `register()`: proven live
- official human-link flow (`createAgentLinkChallenge`, `claimAgentLink`, `approveAgentLink`, `getLinkedAgents`, `unlinkAgent`): proven live
- `getPriceHistory("BTC", 24)`: still degraded on production
- current dev-only mirror families: explicitly bounded as production `404`
- `attestTlsn()`: still degraded on the current runtime

## Commands

```bash
node --import tsx ./packages/omniweb-toolkit/scripts/probe-remaining-surfaces.ts --execute
```

Additional bounded TLSN confirmation:

```bash
timeout 180s node --import tsx -e "import { connect } from './packages/omniweb-toolkit/src/index.ts'; const omni = await connect(); const startedAt = Date.now(); const res = await omni.colony.attestTlsn('https://blockchain.info/ticker'); console.log(JSON.stringify({elapsedMs: Date.now()-startedAt, res},null,2));"
```

## Live Findings

### 1. `getPriceHistory()` is still a production read gap

The maintained probe returned:

```json
{
  "ok": false,
  "status": 200,
  "detail": "No history data available for BTC (API returned empty — history may not be populated yet)"
}
```

This is not a route-availability failure. It is a live data-population gap on the current production host.

### 2. `register()` is live on production

The maintained `register()` proof succeeded for the current wallet and returned a real agent profile envelope, including:

- name: `mj-codex-proof-agent`
- description: `Production-host proof agent for omniweb-toolkit live surface verification.`
- specialties: `["testing", "proof"]`

This means `register()` should no longer be treated as pending in the package proof matrix.

### 3. The official human-link flow is live, but our typed contract had drifted

The maintained run proved the full round trip:

1. `createAgentLinkChallenge(agentAddress)`
2. sign `message` with the connected wallet
3. `claimAgentLink(...)`
4. `approveAgentLink(...)`
5. `getLinkedAgents()`
6. `unlinkAgent(agentAddress)`

Live production contract details:

- the challenge response returned `nonce`, `message`, `humanAddress`, and `expiresAt`
- the working claim payload used `challenge: nonce`, not the older `challengeId`
- the working approve payload also required `agentAddress`

Working live payloads:

```json
{
  "claim": {
    "challenge": "<nonce>",
    "agentAddress": "<agent address>",
    "signature": "<wallet signature>"
  },
  "approve": {
    "challenge": "<nonce>",
    "agentAddress": "<agent address>",
    "action": "approve"
  }
}
```

The live link appeared in `getLinkedAgents()` and was then cleaned up successfully with `unlinkAgent()`.

### 4. Current dev-only mirrors are explicitly bounded by production `404`

All of these returned hard `404` responses on `supercolony.ai` during the maintained probe:

- `getEthPool`
- `getEthWinners`
- `getEthHigherLowerPool`
- `getEthBinaryPools`
- `getSportsMarkets`
- `getSportsPool`
- `getSportsWinners`
- `getCommodityPool`
- `getPredictionIntelligence`
- `getPredictionRecommendations`

These should remain excluded from launch claims for the production host. They are not “unknown”; they are currently absent there.

### 5. `attestTlsn()` still degrades after token creation

Two bounded probes were run:

- the maintained child-process probe timed out after `180000ms`
- a direct bounded run earlier returned:

```json
{
  "elapsedMs": 178674,
  "res": {
    "ok": false,
    "error": {
      "code": "ATTEST_FAILED",
      "message": "TLSN unavailable: page.evaluate: Target page, context or browser has been closed",
      "retryable": true
    }
  }
}
```

The native TLSN token request itself did succeed before the later stall/failure. So the current failure domain is not initial token minting; it is later in the Playwright/notary bridge path.

## Operator Guidance

- treat `register()` and the official human-link routes as production-proven
- treat `linkIdentity()` as a separate deprecated wrapper, not as proof of the official human-link flow
- treat the dev-only mirror families as production-excluded, not merely untested
- keep `getPriceHistory()` out of the launch-ready read set until it returns populated production data
- keep `attestTlsn()` out of launch claims until the current runtime stops timing out or closing the browser context mid-proof
