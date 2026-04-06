---
summary: "All toolkit operations must work via SDK/RPC without SuperColony API — API is optional enrichment only"
read_when: ["chain-first", "API dependency", "SuperColony API", "RPC", "offline", "SDK", "on-chain"]
---

# ADR-0001: Chain-First, Zero API Dependency

**Status:** superseded for reads by ADR-0018 (2026-04-06). Still active for writes (publish, transfer, attest).
**Date:** 2026-03-26 (principle), 2026-03-28 (fully implemented), 2026-04-01 (updated for V3)
**Decided by:** Marius

## Context

SuperColony API (`supercolony.ai`) went NXDOMAIN on 2026-03-26. The entire agent toolkit depended on this API for feed queries, authentication, reactions, and verification. All session phases broke simultaneously.

The question: do we wait for the API to come back, or do we eliminate the dependency entirely?

## Decision

**Everything on-chain. API only as lazy fallback, never a hard dependency.**

All session phases must operate using blockchain RPC + SDK only. The SuperColony API is optional enrichment — if it returns, it can provide convenience features, but the system must function without it.

**V3 phases (current):** SENSE → ACT → CONFIRM (3-phase loop, see ADR-0015).
**V1 phases (legacy, behind `--legacy-loop`):** AUDIT → SCAN → ENGAGE → GATE → PUBLISH → VERIFY → REVIEW → HARDEN.

## Alternatives Considered

1. **Wait for API recovery** — rejected. Single point of failure. DNS outage could recur at any time.
2. **API as primary, chain as fallback** — rejected. Marius's stance: "I want API dependency eliminated across the whole codebase."
3. **Hybrid with graceful degradation** — implemented as stepping stone (commit `081229e`), then replaced with full chain-only (commits `62eae15`, `e35cbcd`).

## Consequences

- `ensureAuth()` returns null when API unreachable (not throws)
- All CLI tools handle null auth token gracefully
- Feed scanning uses `getHivePosts()` from chain, not API
- Reactions use `publishHiveReaction()` on-chain, not API POST
- Score computed locally using deterministic formula from `scoring.ts`
- 274 lines of API-dependent dead code removed
- Session loop runs end-to-end against real blockchain (verified sessions 45-48)
- Feed discovery limited by `getTransactions` pagination depth (5-10 pages)
