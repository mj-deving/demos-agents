---
summary: "V3 loop: SENSE/ACT/CONFIRM replaces 8-phase V1. Signal-first publishing with attestation feedback loop."
read_when: ["V3", "loop", "SENSE", "ACT", "CONFIRM", "signal-first", "session loop", "v3-loop"]
---

# ADR-0015: Loop V3 Architecture — Signal-First Publishing with Colony Intelligence

**Status:** accepted
**Date:** 2026-03-30
**Decided by:** Marius

## Context

The V1 8-phase session loop (AUDIT → SCAN → ENGAGE → GATE → PUBLISH → VERIFY → REVIEW → HARDEN) had a fundamental architectural problem: content was generated first, then the system scrambled to find proof. H0 baseline data (sessions 49-54) showed body_match=0 in 78% of matches. The 6-axis scoring pipeline was progressively weakened (threshold 50→30→10) to compensate.

A first-principles decomposition identified 7 irreducible primitives and reconstructed the loop as 3 phases. Four multi-agent review rounds (creative brainstorm, scientific hypothesis testing, red team attack, council debate) plus 5 Codex CLI reviews validated the architecture and tightened specifications.

## Decision

### 1. Three-phase loop: SENSE → ACT → CONFIRM

Replaces the 8-phase V1 loop and the cosmetic V2 relabeling. Budget: SENSE 40s, ACT 90s, CONFIRM 40s = 170s total.

- **SENSE:** Incremental colony scan, pattern extraction, available evidence computation, cached performance feedback
- **ACT:** Strategy-driven action selection (ENGAGE, REPLY, PUBLISH, TIP). All actions are strategy outputs ranked by priority, not sequential phases.
- **CONFIRM:** Verify broadcasts, update reaction cache, compute performance scores, calibrate predictions

### 2. Signal-first publishing with attestation feedback loop

Replaces both topic-first (V1, broken) and pure data-first (rejected as too constrained).

Flow: Strategy picks signal → LLM drafts freely → extract typed claims → attestation hunt per claim → faithfulness gate → finalize/revise/ditch. The draft and attestation inform each other in a loop. Creative freedom WITH attestation grounding.

### 3. 1 post = 1 attestable claim

Posts are focused, verifiable units. Multiple claims become a thread of reply posts, each with its own attestation cycle. No monolithic posts mixing attested and unattested facts.

### 4. Product rule: prove it or don't say it

Every published post MUST have at least one attested factual claim. Unattested factual claims must not appear in posts that carry attestation references. Analytical interpretation allowed only when clearly derived from the attested data.

### 5. Chain-first trust model (not chain-only)

On-chain methods preferred when they exist (XM cross-chain reads: EVM readFromContract, Solana fetchAccount, etc.). HTTP allowed as fallback for web2 data with no on-chain equivalent. SuperColony API never used for operational data. The agent IS the oracle — bridges web2 claims to on-chain via DAHR/TLSN attestation.

### 6. Colony cache: SQLite full HIVE mirror

Local mirror of the entire HIVE, growing to millions of posts. SQLite via better-sqlite3. Indexes for posts, threads, authors, topics, mentions, reactions, attestations, and claim ledger. Incremental scanning with block-number cursor.

### 7. Typed claim schema with ClaimIdentity

Claims are structured records, not text blobs. `ClaimIdentity = {chain, address, market, entityId, metric}` is the canonical dedup key. Unambiguous — distinguishes Compound USDC on Ethereum from Compound WETH on Base.

### 8. On-demand source discovery

The agent is NOT limited to pre-cataloged sources. Four discovery channels ordered by evidence strength: chain-native XM reads (strongest) → source catalog → colony cross-reference → API pattern templates (weakest, with host allowlist).

### 9. YAML-configured strategy from day one

Strategy rules in `agents/{name}/strategy.yaml`. Toolkit executes rules (mechanism), strategy defines them (policy). Financial guards enforced in toolkit layer — strategy can restrict but cannot exceed ceilings.

## Alternatives Considered

1. **Fix body_match scoring within V1.** Implemented (LLM body_match scorer) then obsoleted. Optimizes the wrong level — patches a broken pipeline instead of fixing the architectural inversion.
2. **Pure data-first publishing.** Rejected: constrains agent to parroting data. LLM hallucination unaddressed. Editorial analysis impossible.
3. **Keep 8 phases, fix incrementally.** Rejected: GATE, VERIFY-as-phase, and HARDEN have zero demonstrated value. Incremental fixes accumulate complexity without addressing root cause.

## Consequences

- The entire 6-axis scoring pipeline is eliminated (scoreEvidence, extractClaims, body_match, match threshold, gate.ts)
- V1/V2 loop codepaths retained behind flags for 10 sessions as rollback path
- 22 plugins need audit: classify as carries-forward, obsolete, or security-critical
- Colony cache introduces SQLite as a new native dependency (better-sqlite3)
- XM cross-chain reads expand the agent's verification surface to 10 blockchains
- Migration in 4 phases: signal-first pipeline → colony cache → strategy engine → cleanup
- Authoritative design document: `docs/design-loop-v3.md` (1,791 lines, 5 review cycles)
