# Session: Toolkit Design Review Complete — 7 Mechanisms, ~60 Findings

**Date:** 2026-03-27 01:15
**Duration:** ~3 hours
**Mode:** full
**Working Directory:** /home/mj/projects/demos-agents

## Summary

Completed the most thorough pre-implementation design review of the toolkit architecture across 7 independent review mechanisms (Codex, Fabric review_design, Red Team 32-agent, Council 4-member, STRIDE 18-threat, VibeSec 7.5/10, World Threat Model 1-year). ~60 unique findings identified, all resolved in 3 commits. Design doc grew from 577 → 918 lines. Status: ready for implementation.

## Work Done

- Launched Codex design review (GPT-5.4) + Fabric review_design (Sonnet) in parallel — Round 1
- Consolidated 23 findings (3H/5M/1L + 8 sections), applied all to design doc
- Launched Red Team (32-agent) + Council (4 members, 3 rounds) in parallel — Round 2
- Launched STRIDE threat model (18 threats) after Round 2 completed
- Consolidated 25 deduplicated findings from 3 Round 2 reviews, applied all
- Launched VibeSec + World Threat Model (1-year horizon) in parallel — Round 3
- Applied 8 VibeSec findings (symlink, Symbol(), payee allowlist, SSRF gaps, redirect policy, etc.)
- Saved world threat model mitigations to memory for post-shipping application
- Generated comprehensive VisualExplainer HTML (`~/.claude/diagrams/toolkit-architecture.html`)
- 3 commits pushed to main: round 1 fixes, round 2 fixes, VibeSec fixes

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Security → Safety Architecture reframing | All enforcement is client-side; Stripe SDK model | Keep "Security" framing (rejected: dishonest) |
| Exclusive file locking via proper-lockfile | TOCTOU race identified by 6 agents | Advisory locking (rejected: no real enforcement), sqlite (considered as alternative backend) |
| Rolling 24h spend cap (not session-scoped) | Session caps reset on connect() — unlimited sessions = unlimited spend | Per-session caps only (rejected: trivially bypassed) |
| SSRF default-deny + DNS rebinding protection | attest()/pay() accept arbitrary URLs | Allowlist-only (too restrictive), no blocklist (too dangerous) |
| DemosSession class with Symbol()-keyed authToken | console.log/APM leaks token if plain object | Symbol.for() (rejected: globally discoverable), Proxy (too heavy) |
| 5-PR migration with re-export compatibility shim | 4-PR plan lacked rollback path after Stage 2 | Big-bang migration (rejected: too risky), flat package (fallback if workspace fails) |
| D402 payee allowlist + first-payment confirmation | Auto-pay on 402 is attacker-controlled trigger | No validation (rejected: 100 DEM/day drain), manual-only payments (rejected: defeats automation) |

## Key Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| `docs/design-toolkit-architecture.md` | edited (3 commits) | 577 → 918 lines. Safety Architecture, typed contracts, SSRF protection, StateStore, migration plan, glossary, decision log, VibeSec fixes |
| `~/.claude/diagrams/toolkit-architecture.html` | rewritten | 29KB interactive HTML with 7 sections, Mermaid diagrams, risk matrix, decision timeline |
| `memory/project_world_threat_model_mitigations.md` | created | 1-year threat model: 18 threats, top 5 mitigations by ROI |

## Learnings

- **Zero overlap between review types validates multi-mechanism approach.** Codex found codebase-grounded boundary issues. Fabric found structured architecture gaps. Red team found implementation-level flaws. Council found ergonomic trade-offs. STRIDE found trust boundary threats. VibeSec found the most dangerous real-world attack path (D402 auto-pay). World threat model found operational risks (burnout).
- **"Security" vs "Safety" is a meaningful distinction.** Client-side libraries provide safety (protecting cooperative users from mistakes), not security (protecting against adversaries). Honest framing prevents false confidence.
- **The most dangerous attack path requires zero access to the consumer's system.** D402 auto-pay lets any URL the agent visits drain DEM tokens — the agent's normal operation is the attack vector.
- **World threat model's #1 risk is developer burnout (40-50%)**, not any technical threat. Scope discipline is the highest-ROI mitigation.

## Open Items

- [ ] **Implement Toolkit MVP with full TDD** — Task #4, next session
- [ ] Mark design doc status as APPROVED before implementation
- [ ] Apply world threat model mitigations AFTER shipping (saved to memory)
- [ ] VibeSec visual HTML could be verified in browser for rendering quality

## Context for Next Session

The toolkit design doc (`docs/design-toolkit-architecture.md`, 918 lines) has been through 7 independent review mechanisms and is ready for implementation. Next step: change status to APPROVED, then implement the 10 tools + 6 safety guards using full TDD. Dev workflow: tests first → implement → npm test → /simplify → Fabric review_code → Fabric summarize_git_diff → commit → Codex commit review → fix ALL findings → push. The world threat model recommends cutting scope to core + OpenClaw + CLI only (defer ElizaOS adapter). Design doc has the full typed contracts (DemosSession, ToolResult<T>, DemosError) ready to implement.
