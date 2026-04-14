# Codex Review: Lifecycle Extension Hook (Design Review)

## Context

PR8 shipped the lifecycle engine (`lifecycle.ts`) and CLI (`source-lifecycle.ts`). Currently lifecycle checks are manual — you run `npx tsx tools/source-lifecycle.ts check --pretty`. This PR wires lifecycle into the session loop as a `beforeSense` extension hook, so every session automatically:

1. Tests a sample of sources for health
2. Updates their ratings
3. Evaluates and applies lifecycle transitions (promotions/degradations)

## Design

### Changes to existing files

**`tools/lib/state.ts`:**
- Add `"lifecycle"` to `KNOWN_EXTENSIONS` array

**`tools/lib/extensions.ts`:**
- Add `lifecycle` entry in `EXTENSION_REGISTRY` (empty — registered at runtime like calibrate, signals, etc.)

**`tools/session-runner.ts`:**
- Register `lifecycle` `beforeSense` hook via `registerHook()` in `main()` init block
- The hook:
  1. Loads the raw catalog
  2. Samples up to N sources (configurable via `persona.yaml → lifecycle.sampleSize`, default 10)
  3. Runs `testSource()` on each
  4. Calls `updateRating()` on each
  5. Calls `evaluateTransition()` on each
  6. If `--dry-run` is false, applies transitions and persists to catalog.json
  7. Logs summary via `observe()`

**`agents/sentinel/persona.yaml`:**
- Add `lifecycle` to `loop.extensions` list
- Add `lifecycle:` config section with `sampleSize: 10`, `includeQuarantined: true`

### Sampling strategy

Testing all 138 sources every session is too slow. Instead:
- Sample `sampleSize` sources each session, weighted toward:
  - Quarantined sources with `successCount` near promotion threshold (2/3 passes)
  - Active sources with `consecutiveFailures > 0` (health regression)
  - Sources not tested recently (`lastTestedAt` oldest first)
- Over ~14 sessions, every source gets tested at least once

### No new files

All logic lives in session-runner (hook registration) and uses existing `lifecycle.ts` + `health.ts`.

## Test Contracts

### Integration behavior (verify in session-runner context)
- lifecycle hook runs during beforeSense when extension is enabled
- lifecycle hook skips when `lifecycle` not in agent's extensions list
- lifecycle hook respects dry-run flag (no catalog writes)
- lifecycle hook samples at most `sampleSize` sources
- lifecycle hook includes quarantined sources when `includeQuarantined: true`
- lifecycle hook updates ratings even when no transitions occur
- lifecycle hook logs transitions via observe()

### Sampling (can be unit tested if extracted)
- sampleSources returns max N sources
- sampleSources prioritizes near-promotion quarantined sources
- sampleSources prioritizes sources with consecutiveFailures > 0
- sampleSources prioritizes least-recently-tested sources
- sampleSources never returns archived/deprecated sources

## Questions for Review

Q1: Should the sampling function be in `lifecycle.ts` or `session-runner.ts`? I lean toward `lifecycle.ts` since it's reusable lifecycle logic.

Q2: Should the lifecycle hook persist catalog changes inline, or buffer them and persist once at end of session? Inline is simpler but means partial writes if session crashes mid-loop.

Q3: Is `beforeSense` the right hook point? Alternative: `afterConfirm` (end of session). beforeSense means lifecycle runs before the agent publishes, which could promote new sources that are then used for attestation in the same session.

Q4: Should the hook skip entirely if the last lifecycle run was less than N hours ago (cooldown)? This prevents redundant testing when sessions run frequently.

Q5: What's the right `sampleSize` default? 10 means full coverage in ~14 sessions. 5 means ~28 sessions. For a tool that runs 1-2x/day, 10 seems right.

## Files to Read

```bash
cat tools/lib/sources/lifecycle.ts
cat tools/lib/sources/health.ts
sed -n '3090,3120p' tools/session-runner.ts
cat tools/lib/extensions.ts
sed -n '80,90p' tools/lib/state.ts
cat agents/sentinel/persona.yaml | head -40
```

## Output Format

Write findings to `claude-codex-coop/REVIEW-lifecycle-extension.md`. Answer Q1-Q5. Flag any missing test contracts. Do NOT modify source code.
