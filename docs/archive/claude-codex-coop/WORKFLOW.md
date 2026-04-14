# Claude-Codex Workflow

The established workflow for all development in this repo. Every PR follows this cycle.

## The Cycle

```
DESIGN → REVIEW → TESTS FIRST (fail) → IMPLEMENT (tests pass) → REVIEW IMPL → FIX → COMMIT
```

- **TESTS FIRST**: Codex writes tests from the Test Contracts in the TASK file. Tests FAIL — implementation doesn't exist yet.
- **IMPLEMENT**: Claude or Codex writes code. `npm test` must pass before this step is done.
- **REVIEW IMPL**: Codex reviews the code with tests already green. May find issues that add new tests.
- **FIX**: Address review findings. Tests must still pass. New tests may be added for uncovered edge cases.

### Step 1: Design (Claude)

Write `claude-codex-coop/TASK-{name}.md` with:

```markdown
# Codex Review: {Name} ({Design|Implementation} Review)

## Context
What we're building and why.

## Design
Types, interfaces, integration points, file changes.

## Test Contracts
Expected behaviors that define correctness. Each becomes a test case.

### module-name.ts
- functionA returns X on input Y
- functionA never throws on bad input
- functionA handles edge case Z
- functionB is idempotent (calling twice = calling once)

## Questions for Review
Q1-Q5 with specific design decisions to validate.

## Files to Read
```bash commands for Codex```

## Output Format
What Codex should produce.
```

**The Test Contracts section is mandatory.** It's the spec that tests are written from.

### Step 2: Design Review (Codex)

```bash
codex exec --full-auto "Read claude-codex-coop/TASK-{name}.md. Follow instructions exactly. Answer all questions. Validate Test Contracts — flag any missing behaviors. Write findings to claude-codex-coop/REVIEW-{name}.md. Do NOT modify source code."
```

Codex reviews design AND test contracts. May add missing test cases.

### Step 3: Tests First (Codex)

```bash
codex exec --full-auto "Read claude-codex-coop/TASK-{name}.md (Test Contracts section) and claude-codex-coop/REVIEW-{name}.md. Write vitest test suites that define the expected behavior. Tests should FAIL since implementation doesn't exist yet. Mock SDK dependencies with vi.mock(). Write to tests/{name}.test.ts. Do NOT write implementation code."
```

Tests define the contract. They fail. That's correct.

### Step 4: Implement (Claude or Codex)

```bash
# If Codex implements:
codex exec --full-auto "Read claude-codex-coop/TASK-{name}.md, REVIEW-{name}.md, and tests/{name}.test.ts. Implement the module. Run 'npm test' — all tests must pass. Address all review findings."

# If Claude implements:
# Claude writes code, runs npm test, iterates until green.
```

Implementation is driven by making tests pass.

### Step 5: Implementation Review (Codex)

```bash
codex exec --full-auto "Read claude-codex-coop/TASK-{name}-impl-review.md. Read all listed files. Answer Q1-Q5. Write findings to claude-codex-coop/REVIEW-{name}-impl.md. Do NOT modify source code."
```

### Step 6: Fix Findings (Claude or Codex)

```bash
# If Codex fixes:
codex exec --full-auto "Fix all findings from claude-codex-coop/REVIEW-{name}-impl.md. Run 'npm test' and 'npx tsc --noEmit'. Do NOT change test expectations unless a test is wrong."
```

### Step 7: Commit

Code + tests in the same commit. Never ship code without tests.

```bash
git add -A && git commit -m "feat: {description}

Tests: {N} tests, all passing
Addresses: Codex review findings (X P0, Y P1, Z P2)"
```

## File Naming Convention

```
claude-codex-coop/
├── TASK-{name}.md              # Design spec (Claude writes)
├── TASK-{name}-impl-review.md  # Impl review instructions (Claude writes)
├── REVIEW-{name}.md            # Design review (Codex writes)
├── REVIEW-{name}-impl.md       # Impl review (Codex writes)
├── PLAN-{name}.md              # Architectural plans (Codex writes)
├── STATUS.md                   # Current coop state
├── WORKFLOW.md                 # This file
└── README.md                   # Coop infrastructure reference
```

## Key Rules

1. **Test Contracts in every TASK file** — no exceptions
2. **Tests written before implementation** — they should fail initially
3. **"Do NOT modify source code"** — always include in review prompts
4. **"Run npm test and npx tsc --noEmit"** — always include in implementation prompts
5. **Mock the SDK** — `@kynesyslabs/demosdk` has ESM issues, use `vi.mock()` for any module that imports `sdk.ts`
6. **Code + tests in same commit** — never ship one without the other
7. **Codex runs in background** — use `run_in_background: true` and work on non-overlapping tasks
8. **Multiple Codex in parallel** — use `&` in bash for independent reviews

## Quick Reference Commands

```bash
# Design review
codex exec --full-auto "Read claude-codex-coop/TASK-{name}.md. Write findings to claude-codex-coop/REVIEW-{name}.md. Do NOT modify source code."

# Write tests from spec (before implementation)
codex exec --full-auto "Read TASK-{name}.md Test Contracts. Write failing vitest tests to tests/{name}.test.ts. Mock SDK deps. Do NOT write implementation."

# Implement (make tests pass)
codex exec --full-auto "Implement per TASK-{name}.md. All tests in tests/{name}.test.ts must pass. Run npm test."

# Implementation review
codex exec --full-auto "Read TASK-{name}-impl-review.md. Write findings to REVIEW-{name}-impl.md. Do NOT modify source code."

# Fix review findings
codex exec --full-auto "Fix all findings from REVIEW-{name}-impl.md. Run npm test && npx tsc --noEmit."

# Write tests for existing code (test debt)
codex exec --full-auto "Write vitest tests for {module}. Mock SDK deps. Run npm test. Write to tests/{name}.test.ts."
```
