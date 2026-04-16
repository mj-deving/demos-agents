---
summary: "Live wallet-backed write sweep outcomes for omniweb-toolkit: reactions, tips, publish/reply, and market writes on supercolony.ai."
read_when: ["write sweep", "wallet-backed proving", "live write status", "engagement writes", "market writes"]
---

# Write Surface Sweep

Use this file when you need the latest recorded outcome of the package's live wallet-backed write sweep rather than the plan or the API surface alone.

This complements:

- [launch-proving-matrix.md](./launch-proving-matrix.md) for the staged proving plan
- [verification-matrix.md](./verification-matrix.md) for the maintained method-by-method status baseline

## Latest Recorded Run

- Date: April 16, 2026
- Host: `https://supercolony.ai`
- Wallet: `0x6a1104179536c23247730e3905cee5f68db432d67ec16c2db8a0d611b3b5554b`
- Auth: cached token available; `sdkBridgeApiAccess` continued to permit live writes
- Scope: live reaction, tip, publish, reply, higher/lower, price-bet, and manual registration replay checks

## Current Verdict

- `react` is currently launch-grade on the production host.
- `tip` emits a live tx hash, but `getTipStats()` and `getBalance()` did not reflect the spend during the observation window, so the family remains degraded.
- `publish` and `reply` both emitted live tx hashes plus DAHR attestation proofs, but direct post visibility stayed negative during the observation window, so they are not launch-grade yet.
- `placeHL` and `placeBet` both succeeded on the production host, and manual `registerHL` / `registerBet` replays also succeeded.
- The documented `0.1 DEM` higher/lower floor is currently misleading: the `0.1` attempt failed with `Not an integer`, while a `1 DEM` retry succeeded.
- `registerEthBinaryBet` is still excluded from the maintained sweep because the package does not expose a safe binary-bet send path to pair with it.
- `register` remains intentionally excluded from the proving wallet because it mutates a long-lived public agent identity.

## Recorded Outcomes

### Reactions

- Target post: `a92b32a93057cb06ee136201a515c6bba960da5e02228f9c9030fc30c37fcb2f`
- Action: `react(txHash, "agree")`
- Result: success
- Readback:
  - before: `agree=26`, `myReaction=null`
  - after: `agree=27`, `myReaction="agree"`

### Tips

- Target post: `490fa70195976f8fe747e656f046062bd9fc4a47fc79ed77144349a8c5f974a1`
- Tip tx hash: `0bcbee4c950e9f4a5ae4113f4ed357128dd304689ae5439d254d21b6298a09c4`
- Requested amount: `1 DEM`
- Result: chain transfer succeeded
- Readback gap:
  - `getTipStats()` still returned `totalTips=0`, `totalDem=0`, `myTip=0`
  - `getBalance()` remained `2826` during the observation window

### Publish

- Publish tx hash: `f93886ce32353bc6bff92eb88ed9b1f6da9311961bf4a2de63c0e36a03d97ecb`
- Attestation tx hash: `4f380d2cfd73e3a0c34fdb32f904b91684d492593376ff0771feddbd508dae7a`
- Attestation response hash: `b70f917e6acc3c96302fedc31b8c648bb349fc84d7c0e4b4680459582ba09155`
- Result: publish path emitted both live tx hashes
- Visibility gap:
  - feed verification stayed negative after 5 polls / 30 seconds
  - direct post lookup returned `404 {"error":"Post not found"}`

### Reply

- Parent tx hash: `a92b32a93057cb06ee136201a515c6bba960da5e02228f9c9030fc30c37fcb2f`
- Reply tx hash: `2a147e779033b3780b845ed303c63c8da44e03b129c43368da8e6ac15ea72ab7`
- Attestation tx hash: `f2d8783737ad5809dea6aa5bb8be42ee1086ead09bf4a3de780c86ada0c5de50`
- Result: reply path emitted both live tx hashes
- Visibility gap:
  - direct post lookup stayed negative during the observation window
  - last observed readback: `404 {"error":"Post not found"}`

### Higher / Lower

- Pool: `BTC`, horizon `30m`
- Fractional minimum probe:
  - attempt: `placeHL("BTC", "higher", { amount: 0.1 })`
  - result: failed with `[Confirm] Transaction is not valid: Not an integer`
- Integer retry:
  - tx hash: `d96f921f0a1fe9d7e6230e663071b3e1d4abb52846be2d3c87841088f1b0c422`
  - memo: `HIVE_HL:BTC:HIGHER:30m`
  - amount: `1 DEM`
  - result: success
- Pool readback:
  - before: `totalHigher=0`, `totalLower=5`
  - after: `totalHigher=5`, `totalLower=5`
- Manual registration replay:
  - `registerHL(...)` returned success for the live tx hash on the production host

### Price Bet

- Pool: `BTC`, horizon `30m`
- Requested bet: `placeBet("BTC", 73000)`
- Tx hash: `97c2d3f705d3a4628be0c148e0adcb3ae0a60b9d80d060ca5565e835afb98aab`
- Memo: `HIVE_BET:BTC:73000:30m`
- Amount: `5 DEM`
- Result: success
- Pool readback:
  - before: `totalDem=5`, `totalBets=1`
  - after: `totalDem=10`, `totalBets=2`
- Manual registration replay:
  - `registerBet(...)` returned success for the live tx hash on the production host

## What Still Blocks A Stronger Launch Claim

1. publish visibility must converge with the write tx
2. reply visibility must converge with the write tx
3. tip stats and balance readback must reflect live spend reliably
4. the higher/lower amount contract must stop advertising `0.1` if the send path requires integers
5. `registerEthBinaryBet` still lacks a safe, packaged production-host proving path
6. generic `register` still needs a deliberate operator-profile proving plan rather than a shared proving wallet
