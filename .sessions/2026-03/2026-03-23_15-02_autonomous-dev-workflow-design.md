# Session: Autonomous Dev Workflow Design

**Date:** 2026-03-23 15:02
**Duration:** ~90 min
**Mode:** full
**Working Directory:** /home/mj/projects/omniweb-agents

## Summary

Designed and established a comprehensive autonomous development workflow with tiered review heuristics. Used first principles analysis, creative brainstorming (7 detection domains), scientific hypothesis testing (3 models), and a 3-round council debate (4 agents, 12 positions) to validate the design. Mapped 11 Fabric patterns across all workflow stages. Identified need for global memory promotion (deferred).

## Work Done

- Designed 3-tier dev workflow (Surgical/Standard/Complex) with self-classification heuristics
- Established invariant gates: TDD, npm test, Codex commit review (enriched with spec-catalog checking)
- Designed security pre-flight gate: glob watchlist (8 patterns) + diff grep (7 keywords), invokes Security skill SecureCoding/CodeReview
- Ran 3-round council debate with Engineer, Architect, Pentester, Process Skeptic — unanimous on security gate design
- Explored Security skill: mapped SecureCoding/CodeReview, SecureDesign, PromptInjection, WebAssessment workflows
- A/B trial protocol: /simplify vs Fabric review_code for quality review slot (10 sessions)
- Mapped 11 high-value Fabric patterns to workflow stages (plan, code-review, commit, security)
- Identified that workflow is project-scoped, should be promoted to PAI global (deferred)

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Security gate is cross-cutting, not tier-dependent | Council unanimous: cost asymmetry (false negative = irrevocable on-chain leak) | Tier-dependent conditional (rejected: relies on human judgment) |
| Path-triggered security via glob watchlist + diff grep | Deterministic, no LLM/human judgment in loop | Manual "touching auth?" assessment (rejected: all 4 council members) |
| /simplify vs Fabric review_code A/B trial | Neither proven yet; different detection domains | Make /simplify mandatory (rejected: no data), exclude both (rejected: quality gap) |
| Fabric patterns at plan phase, not just code review | ask_secure_by_design_questions catches issues at cheapest fix point | Fabric only at code review (rejected: misses plan-phase value) |
| Defer global memory promotion | Needs ~/.claude/memory/ directory creation + convention | Promote now (deferred: separate task) |

## Key Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| `~/.claude/projects/.../memory/feedback_default_dev_workflow.md` | Created | Tiered workflow: tiers, invariant gates, behavioral rules |
| `~/.claude/projects/.../memory/feedback_review_heuristics.md` | Created | Review taxonomy: detection domains, security gate, Fabric integration, trial protocol |
| `~/.claude/projects/.../memory/MEMORY.md` | Edited | Added Workflow Established section, 2 memory file index entries, next step #6 |
| `CLAUDE.md` | Edited | Added Development Workflow subsection to Conventions |
| `MEMORY/WORK/20260323-183000_optimal-dev-workflow/PRD.md` | Created | Algorithm PRD for workflow design (8/8 ISC, complete) |
| `MEMORY/WORK/20260323-184000_review-agent-heuristics/PRD.md` | Created | Algorithm PRD for review heuristics (18/18 ISC, complete) |

## Learnings

- Council debate was highest-value capability — 4 perspectives independently converged on security gate design
- Process skeptic (Devon) was most valuable member — forced empirical justification for every gate
- Rook's "security isn't a tier, it's a pre-flight" reframing changed the entire architecture
- Fabric patterns add value at EVERY workflow stage, not just code review — plan phase patterns (ask_secure_by_design_questions) are highest leverage
- /simplify and Fabric review_code are NOT redundant — different detection domains (narrow+fast vs broad+slower)
- There is NO /security-review built-in command — security reviews route through Security skill SecureCoding/CodeReview
- No global memory directory exists yet (~/.claude/memory/) — needs creation for cross-project workflow rules

## Open Items

- [ ] Promote universal workflow rules to PAI global memory (~/.claude/memory/)
- [ ] Run quality review A/B trial: /simplify vs Fabric review_code (10 sessions)
- [ ] Intent-driven scanning Phase 2 (top coding priority, unchanged)

## Context for Next Session

Autonomous dev workflow is fully designed and persisted in memory. The workflow is currently project-scoped to omniweb-agents. Next session should either: (a) promote universal parts to global memory, or (b) start Phase 2 intent-driven scanning using the new workflow for the first time. The A/B trial between /simplify and Fabric review_code starts on the next coding session.
