# Session: Zod Validation + D402 Wiring + Pre-Packaging Audit + Core Package

**Date:** 2026-03-27 18:20
**Duration:** ~3 hours
**Mode:** full
**Working Directory:** ~/projects/omniweb-agents

## Summary

Major toolkit session: wired Zod input validation across all 10 tools, implemented D402 HTTP 402 payment protocol, created `@omniweb-agents/core` package skeleton (PR1 of 5), and ran a comprehensive pre-packaging security audit (red team + vibesec + desloppify). Fixed 6 security issues, documented 28 total findings for next session.

## Work Done

- Zod input validation: 11 schemas in `src/toolkit/schemas.ts`, `validateInput()` helper, bidirectional compile-time type sync assertions. Integrated into all 9 tool entry points. 79 tests.
- SSRF gap fixed: `publish.attestUrl` now validated via `validateUrl()` before `bridge.attestDahr()`.
- `withToolWrapper` error preservation: thrown `DemosError` codes no longer rewritten by catch block.
- D402 pay() full wiring: 402 challenge/response flow (parse requirement, validate payee, settle, retry with proof). Receipt deferred to 2xx retry. `redirect: "manual"` on all fetches. 14 tests.
- Codex implemented: wallet-scoped settlement lock (nonce safety) + redirect validation helper (3-hop max, SSRF on each hop, proof stripped cross-origin). 5 tests.
- `@omniweb-agents/core` package: npm workspaces, re-export barrel, vitest alias. 7 tests.
- Security fixes shipped: `requirePayeeApproval` default → `true`, URL allowlist enforcement in attest/pay/publish, auth sentinel mismatch fixed.
- Comprehensive audit: Red Team (22 findings), Vibesec (14 findings), Desloppify (86 open issues, 81/100 score, 20 subjective dimensions reviewed).
- Audit report: `docs/toolkit-audit-2026-03-27.md` — structured checklist with all findings.
- HTML visual report: `~/.claude/diagrams/toolkit-audit-2026-03-27.html`

## Decisions Made

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Use `createPayment` + `settle` not `handlePaymentRequired` | SDK's high-level method uses global fetch (no SSRF on retry), hides amount, no payee validation hook | Using SDK method directly |
| npm workspaces for PR1 (not pnpm) | npm already in use, zero new tooling, pnpm can be added later | pnpm-workspace.yaml |
| Receipt recorded only after 2xx retry | Prevents poisoned idempotency cache if retry fails | Recording immediately after settlement |
| `requirePayeeApproval` default → `true` | Secure by default — any 402 server could drain funds otherwise | Keep `false`, document risk |
| Spend recorded immediately after settlement (before retry) | On-chain payment is committed regardless of retry outcome | Record with receipt (allows cap bypass) |
| Desloppify review before PR2 (not after) | Fix issues in one location (src/toolkit/) rather than across packages | Review after migration |

## Key Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| `src/toolkit/schemas.ts` | created | 11 Zod schemas + validateInput + type sync assertions |
| `src/toolkit/tools/pay.ts` | edited | D402 flow, redirect validation, settlement lock, URL allowlist |
| `src/toolkit/sdk-bridge.ts` | edited | D402PaymentRequirement/SettlementResult types, payD402 method, cached D402Client |
| `src/toolkit/tools/tool-wrapper.ts` | edited | Preserve DemosError code in catch block |
| `src/toolkit/session.ts` | edited | requirePayeeApproval default → true |
| `src/toolkit/tools/connect.ts` | edited | Zod validation + auth sentinel fix |
| `src/toolkit/tools/attest.ts` | edited | Zod validation + URL allowlist |
| `src/toolkit/tools/publish.ts` | edited | Zod validation + SSRF on attestUrl + URL allowlist |
| `packages/core/` | created | PR1 package skeleton (package.json, tsconfig, barrel) |
| `vitest.config.ts` | edited | @omniweb-agents/core resolve alias |
| `docs/toolkit-audit-2026-03-27.md` | created | 28-finding structured audit report with checklists |
| `docs/INDEX.md` | edited | Toolkit shipping changelog, test counts |

## Learnings

- Fabric patterns in PAI execute natively (read system.md, apply as Claude) — not via external `fabric` CLI which needs separate API config. Saved as memory.
- Receipt-before-retry is a dangerous anti-pattern in payment flows — poisoned idempotency means caller pays but never gets the resource.
- `redirect: "manual"` is essential on payment fetches — prevents `X-Payment-Proof` header leaking to SSRF targets via 30x redirect.
- DNS rebinding is the hardest SSRF to fix — requires pinning resolved IP to the actual fetch, which most HTTP clients don't support natively.
- Multi-reviewer design reviews (Fabric + Codex + native) catch different bug classes: Codex finds code-level races, Fabric finds architectural gaps, vibesec finds trust boundary violations.
- Desloppify subjective review (20 dimensions) requires parallel subagent batches — one per dimension, each reading the blind packet independently.

## Open Items

- [ ] S1: DNS rebinding fix — pin resolved IP to fetch (Critical)
- [ ] S2: Spend cap race — atomic check+settle+record (High)
- [ ] S6: Tip recipient from chain, not API (High)
- [ ] Desloppify queue: 86 open issues (target 90+ score)
- [ ] Tier 2 security fixes: S7-S15 (12 items)
- [ ] PR2-5 migration: file moves, consumer rewrites, adapters

## Context for Next Session

Open `docs/toolkit-audit-2026-03-27.md` as the work checklist. Start with S1 (DNS rebinding), S2 (spend cap race), S6 (tip spoofing) — these are Tier 1 blockers for PR2. Then `desloppify next` to grind the queue. Desloppify state is at `.desloppify/` — run `desloppify status` to see current scores. Target: 90+ health score before starting PR2 file migration. Tests at 1713 across 115 suites, all green.
