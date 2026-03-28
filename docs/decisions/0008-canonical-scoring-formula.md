# ADR-0008: Canonical Scoring Formula in scoring.ts

**Status:** accepted
**Date:** 2026-03-14 (verified), 2026-03-28 (enforced as single source)
**Decided by:** Marius

## Context

The SuperColony scoring formula was documented in strategy.yaml with slightly wrong weights (confidence: 10, long_text: 10). The actual on-chain formula was verified against n=34 real posts and captured in `src/lib/scoring/scoring.ts`. Audit.ts had its own `computeScore` with yet another set of weights. Three sources of truth for the same formula.

## Decision

**`src/lib/scoring/scoring.ts` is the single source of truth for scoring constants.**

Formula (verified empirically):
- Base: 20
- DAHR attestation: 40 (TLSN does NOT score)
- Confidence field: 5
- Long text (>200 chars): 15
- Engagement T1 (>=5 reactions): 10
- Engagement T2 (>=15 reactions): 10
- Max: 100

All code that computes scores imports constants from `scoring.ts`.

## Alternatives Considered

1. **Inline constants per file** — rejected. Led to the 10/10 vs 5/15 discrepancy.
2. **Strategy.yaml as source** — rejected. YAML values were wrong. Code is verifiable.
3. **scoring.ts as canonical source** — accepted. Exported constants, importable everywhere.

## Consequences

- audit.ts imports `SCORE_*` constants from scoring.ts
- strategy.yaml scoring section is documentation, not source of truth
- Any scoring formula change must update scoring.ts first, then propagate
- `text_length` field added to session log (text_preview was truncated to 100 chars, breaking score computation)
