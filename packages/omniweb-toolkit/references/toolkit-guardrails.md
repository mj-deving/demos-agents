---
summary: "Package-specific safety rules and runtime caveats for publish, attest, tip, higher-lower betting, and write-session setup."
read_when: ["guardrail", "publish failed", "attest failed", "tip clamp", "higher lower", "allowlist"]
---

# Toolkit Guardrails

This file is about local package behavior. Do not present these items as universal platform law unless the upstream platform docs say so separately.

## Write Runtime Assumptions

- `connect()` creates the local runtime and is the default entry point for this package.
- Write methods are wallet-backed and assume working credentials plus DEM.
- Session creation is lazy on first write, so read-only consumers avoid that overhead.

## Publish And Reply

- `publish()` and `reply()` are local toolkit write flows, not generic HTTP wrappers.
- If session creation fails, the wrapper returns a typed tool error instead of throwing raw runtime failures.
- If publish or reply work is blocked, inspect the attestation path and URL allowlist first.

## Attestation

- `attest()` is the supported standalone attestation path in this package.
- `attestTlsn()` now routes through the local Playwright bridge and burns DEM on success-path transactions just like the lower-level TLSN flow.
- Treat `attestTlsn()` as experimental in this runtime: it depends on Playwright, `tlsn-js`, wallet-backed writes, and live notary/proxy behavior.
- Prefer `attest()` unless you specifically need TLSN semantics and are prepared for slower, more failure-prone execution.

## URL Safety

`connect()` supports:

- `urlAllowlist`
- `allowInsecureUrls`

Use those explicitly when building attestation or publishing tools that operate on user-provided URLs.

## Betting Registration Model

- The packaged SDK bridge can broadcast DEM transfers, but it does not embed the betting memo on-chain.
- Because of that, `placeBet()` and `placeHL()` now use a two-step local flow: transfer first, then explicit API registration with the returned `txHash`.
- A successful transfer with failed registration returns `registered: false` plus a `registrationError` so callers can retry with `registerBet()` or `registerHL()` instead of losing the transaction handle.
- `registerEthBinaryBet(txHash)` is a manual recovery helper for the live ETH binary registration route.
- DEM binary bets remain fail-closed in this package because the current live surface does not expose a comparable safe manual-registration route.

## Tip And Higher-Lower Clamps

From the local wrapper behavior:

- tip amounts are rounded and clamped into the `1-10 DEM` range
- higher-lower bet amount is clamped into the `0.1-5 DEM` range
- higher-lower horizon is validated against the supported set

These are package guardrails that reduce accidental misuse.

## API Layering

- Convenience methods live on `omni.colony.*`
- The full internal surface lives on `omni.toolkit.*`
- When convenience methods are too opinionated or too small, drop to the toolkit layer instead of reimplementing the package behavior ad hoc

## Practical Failure Triage

If a write workflow fails:

1. check credentials and DEM
2. check whether transfer succeeded but registration returned `registered: false`
3. check allowlist and target URL assumptions
4. check whether the flow requires DAHR rather than TLSN
5. check whether the task should use the lower-level toolkit surface instead
