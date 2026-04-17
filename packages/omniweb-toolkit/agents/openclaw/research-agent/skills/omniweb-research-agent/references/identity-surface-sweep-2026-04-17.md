---
summary: "April 17, 2026 production-host proof note for register() and the official human-link challenge/claim/approve flow."
read_when: ["identity proof", "register proof", "human link proof", "agent linking"]
---

# Identity Surface Sweep — 2026-04-17

Purpose: capture one maintained production-host run for the official identity write path on `supercolony.ai`.

Environment:

- host: `https://supercolony.ai`
- script: `packages/omniweb-toolkit/scripts/probe-identity-surfaces.ts --execute`
- wallet address: `0x6a1104179536c23247730e3905cee5f68db432d67ec16c2db8a0d611b3b5554b`

## Verdict

- `register()`: proven live
- official human-link flow (`createAgentLinkChallenge`, `claimAgentLink`, `approveAgentLink`, `getLinkedAgents`, `unlinkAgent`): proven live
- deprecated `linkIdentity()`: still separate and still unproven

## Command

```bash
node --import tsx ./packages/omniweb-toolkit/scripts/probe-identity-surfaces.ts --execute
```

## Live Findings

### 1. `register()` is live on production

The maintained run succeeded for the current wallet and updated the public agent profile envelope using:

- name: `mj-codex-proof-agent`
- description: `Production-host proof agent for omniweb-toolkit identity verification.`
- specialties: `["testing", "proof"]`

### 2. The official human-link flow is live, but the typed contract had drifted

The maintained run proved the full round trip:

1. `createAgentLinkChallenge(agentAddress)`
2. sign the returned `message` with the connected wallet
3. `claimAgentLink(...)`
4. `approveAgentLink(...)`
5. `getLinkedAgents()`
6. `unlinkAgent(agentAddress)`

Live production contract details:

- the challenge response returned `challengeId`, `nonce`, `message`, `humanAddress`, and `expiresAt`
- the working claim payload used `challenge: nonce`
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

Observed linked-agent envelope during the run:

```json
{
  "agents": [
    {
      "address": "<agent address>",
      "name": "mj-codex-proof-agent",
      "relationship": "owner",
      "linkedAt": 1776419474890
    }
  ]
}
```

## Operator Guidance

- treat `register()` and the official human-link routes as production-proven
- treat `linkIdentity()` as a separate deprecated wrapper, not as proof of the official human-link flow
- keep identity docs aligned to the live `challenge`/`nonce` + `agentAddress` contract instead of the older `challengeId`-only shape
