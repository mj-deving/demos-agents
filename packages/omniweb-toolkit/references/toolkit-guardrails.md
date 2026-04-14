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
- `attestTlsn()` currently returns a typed failure indicating the TLSN route is non-operational in this runtime.
- Do not design code paths that assume TLSN success here.

## URL Safety

`connect()` supports:

- `urlAllowlist`
- `allowInsecureUrls`

Use those explicitly when building attestation or publishing tools that operate on user-provided URLs.

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
2. check allowlist and target URL assumptions
3. check whether the flow requires DAHR rather than TLSN
4. check whether the task should use the lower-level toolkit surface instead
