---
summary: "Modules mixing toolkit + strategy must split — mechanism to toolkit, policy parameterized. 6 splits identified."
read_when: ["gray zone", "split", "refactor", "mixed module", "toolkit boundary", "extraction"]
---

# ADR-0013: Planned Gray-Zone Module Splits

**Status:** accepted (gray-zone modules documented; no extraction triggers fired as of 2026-04-01)
**Date:** 2026-03-30
**Decided by:** Marius

## Context

A first-principles analysis (2026-03-29) identified 6 modules that mix reusable mechanism with sentinel-specific policy. These "gray zone" modules cannot be moved to the toolkit as-is because they contain hardcoded weights, thresholds, or domain-specific logic. However, they contain reusable primitives that future consumers (OpenClaw, ElizaOS) may need.

The Red Team and Council debate concluded: do NOT extract these modules until a second consumer arrives with concrete requirements. Premature abstraction adds surface area and risk to a system handling real DEM tokens.

## Decision

**Document the intended splits now. Execute them only when triggered.**

### Module: `src/lib/sources/matcher.ts`

| Part | Classification | Target |
|------|---------------|--------|
| `extractClaims()` function | Plumbing (text tokenization) | `src/toolkit/` when extracted |
| `extractClaimsLLM()` function | Plumbing (LLM call) | `src/toolkit/` when extracted |
| Evidence scoring weights (title=25, body=25, topic=20, metrics=15, metadata=15) | Strategy | Stays in `src/lib/` |
| `DEFAULT_MATCH_THRESHOLD = 10` | Strategy | Stays, with bounded validation [5, 100] |
| Match orchestration (fetch → score → threshold) | Strategy | Stays |

**Extraction trigger:** First non-sentinel consumer needs claim-to-source matching.

### Module: `src/lib/sources/policy.ts`

| Part | Classification | Target |
|------|---------------|--------|
| Inverted index building (`tokenizeTopic`, `sourceTopicTokens`) | Plumbing | Already in `catalog.ts` (moving to toolkit) |
| `selectSourceForTopicV2` ranking algorithm | Plumbing (mechanism) | `src/toolkit/` when extracted |
| Provider relevance rules, domain-tag weights | Strategy | Stays as injected config |

**Extraction trigger:** First non-sentinel consumer needs source selection.

### Module: `src/lib/pipeline/signal-detection.ts`

| Part | Classification | Target |
|------|---------------|--------|
| Ring buffer, MAD, z-score, winsorize, median | Plumbing (math) | `src/toolkit/math/baseline.ts` (Phase 3) |
| Signal rules (5% crypto, 2% macro thresholds) | Strategy | `src/lib/pipeline/signal-rules.ts` |
| Convergence detection, anti-signals | Strategy | Stays |

**Extraction trigger:** Already planned for Phase 3 of migration. No external trigger needed.

### Module: `src/actions/action-executor.ts`

| Part | Classification | Target |
|------|---------------|--------|
| Action dispatch routing | Plumbing | `src/toolkit/` when extracted |
| Budget categories (dailyReactive, hourlyReactive) | Strategy | Stays as injected config |

**Extraction trigger:** First non-sentinel consumer needs event-driven action dispatch.

### Module: `src/lib/budget-tracker.ts`

| Part | Classification | Target |
|------|---------------|--------|
| Rolling cap mechanism | Plumbing (guard variant) | Defer — three existing guards differ in kind |
| DEFAULT_ALLOCATIONS (gas 10%, attestation 20%, tipping 15%) | Strategy | Stays |

**Extraction trigger:** Second consumer proves the budget allocation model generalizes beyond sentinel.

### Module: `src/actions/llm.ts`

| Part | Classification | Target |
|------|---------------|--------|
| `LLMProvider` interface | Plumbing | **Already exported** (Phase 1, toolkit barrel) |
| `resolveLLM()` resolution logic | Strategy | Stays in `src/lib/llm/` |
| Prompt engineering (persona, strategy context) | Strategy | Stays |

**Extraction trigger:** Complete. Interface exported; resolution stays in strategy.

## Alternatives Considered

1. **Extract all gray-zone modules now.** Rejected: Red Team killed 3 of 8 proposed primitives as over-engineered. No second consumer exists to validate interfaces.
2. **Never extract; let consumers fork.** Rejected: leads to diverging implementations of the same logic.
3. **Document splits, execute on trigger.** Accepted: zero cost now, clear path when needed.

## Consequences

- Each gray-zone module has a documented split boundary and extraction trigger
- No code changes until a trigger fires
- When a trigger fires, the split follows the documented plan (mechanism → toolkit, policy → stays)
- Bounded validation added to `matchThreshold` [5, 100] as a preventive measure
- This ADR is the reference for any future extraction discussion
