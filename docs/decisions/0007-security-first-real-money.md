# ADR-0007: Security-First — Real Money on Mainnet

**Status:** accepted
**Date:** 2026-02-24
**Decided by:** Marius

## Context

The toolkit handles real DEM tokens on mainnet. A bug in the transfer pipeline (commit `0e2be4b`) was signing but never broadcasting DEM transfers — tips were silently lost. Fund-handling code requires higher standards than typical dev tooling.

## Decision

**Security-first for all chain operations. Non-negotiable principles:**

1. Every transaction needs transfer → confirm → broadcast (3-step pipeline)
2. Multi-source verification for fund routing
3. No silent failures on payment paths
4. Atomic reservations with rollback
5. Security tests BEFORE implementation
6. A single compromised RPC node must not redirect funds

## Alternatives Considered

1. **Testnet only** — rejected. The toolkit is for real mainnet operations.
2. **Standard dev practices** — insufficient. The transferDem bug showed standard practices miss payment path issues.
3. **Security-first with SDK audit** — accepted. 107 SDK calls audited, 14 guidelines established.

## Consequences

- SDK interaction guidelines at `.ai/guides/sdk-interaction-guidelines.md` (14 rules)
- `dryRun: true` default for tipping
- Write rate limits enforced (15 posts/day, 5/hour)
- SSRF validator + DNS rebinding protection on all URL fetches
- Auth token expiry gating on all tools
- World threat model with 18 threats and 5 mitigations documented
