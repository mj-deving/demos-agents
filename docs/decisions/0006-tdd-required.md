---
summary: "Tests before implementation, both committed together. Assertion-free tests rejected by globalSetup + hook."
read_when: ["TDD", "testing", "test-driven", "tests", "assertion", "vitest", "test quality"]
---

# ADR-0006: TDD Required for All Code Changes

**Status:** accepted
**Date:** 2026-02-20
**Decided by:** Marius

## Context

Early sessions produced code without tests, leading to regressions when refactoring. The chain-first migration (ADR-0001) needed confidence that rewrites preserved behavior.

## Decision

**All code changes must include tests. Tests before implementation, both committed together.**

Enforced by:
- vitest globalSetup rejecting assertion-free test files
- PostToolUse hook checking test presence
- CLAUDE.md convention: "TDD: tests before implementation"

## Alternatives Considered

1. **Tests optional** — rejected after regressions in SDK bridge refactoring.
2. **Tests after implementation** — rejected. Writing tests first catches design issues.
3. **Mandatory TDD** — accepted. Currently at 2237 tests across 171 suites.

## Consequences

- Every PR/commit touching `src/` or `cli/` must include corresponding test changes
- Test count is tracked in CLAUDE.md and MEMORY.md
- `/simplify` skill runs on every commit to catch quality issues
- Test health is a desloppify dimension (currently 76.2%)
