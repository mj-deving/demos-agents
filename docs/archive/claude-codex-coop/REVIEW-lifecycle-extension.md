# Review: Lifecycle Extension Hook

## Findings

1. High: The proposed `persona.yaml -> lifecycle` config is not actually available to the hook through the current config loader.
   `beforeSense` hooks receive `ctx.config` as `AgentConfig`, but `AgentConfig` has no `lifecycle` section in [`tools/lib/agent-config.ts`](/home/mj/projects/omniweb-agents/tools/lib/agent-config.ts#L40). The loader only validates and returns known top-level config slices plus `loopExtensions` in [`tools/lib/agent-config.ts`](/home/mj/projects/omniweb-agents/tools/lib/agent-config.ts#L382) and [`tools/lib/agent-config.ts`](/home/mj/projects/omniweb-agents/tools/lib/agent-config.ts#L457). Adding `lifecycle.sampleSize` and `includeQuarantined` to [`agents/sentinel/persona.yaml`](/home/mj/projects/omniweb-agents/agents/sentinel/persona.yaml#L54) is therefore not enough by itself; the listed file changes are missing `agent-config.ts`.

2. Medium: The proposed dry-run contract does not match the current `session-runner` control flow.
   In the v2 runner, `--dry-run` exits before session startup, observer init, hook registration, or `runBeforeSense()` in [`tools/session-runner.ts`](/home/mj/projects/omniweb-agents/tools/session-runner.ts#L3076) and [`tools/session-runner.ts`](/home/mj/projects/omniweb-agents/tools/session-runner.ts#L3098). A test that expects "hook runs but does not write" will fail against the current runner shape. Either the contract should say "hook is skipped entirely on session dry-run", or the runner flow needs to change.

3. Medium: Failure isolation for the new hook is underspecified, and a thrown lifecycle error would block later `beforeSense` extensions.
   `runBeforeSense()` executes hooks sequentially with no per-hook isolation in [`tools/lib/extensions.ts`](/home/mj/projects/omniweb-agents/tools/lib/extensions.ts#L219), and `runV2Loop()` only catches around the whole dispatcher call in [`tools/session-runner.ts`](/home/mj/projects/omniweb-agents/tools/session-runner.ts#L2614). If the lifecycle hook throws during catalog load, `testSource()`, or catalog write, later hooks such as `signals`, `predictions`, and `tips` will not run in that session. The design should explicitly require an internal `try/catch + observe()` boundary for the lifecycle hook and test that behavior.

## Q1-Q5

**Q1. Should the sampling function be in `lifecycle.ts` or `session-runner.ts`?**

Put `sampleSources()` in [`tools/lib/sources/lifecycle.ts`](/home/mj/projects/omniweb-agents/tools/lib/sources/lifecycle.ts#L1) as a pure helper over `SourceRecordV2[]` plus options. Keep hook registration, catalog I/O, and observation logging in [`tools/session-runner.ts`](/home/mj/projects/omniweb-agents/tools/session-runner.ts#L3100). That gives reuse for both the session hook and the existing lifecycle CLI without mixing sampling policy into runner orchestration.

**Q2. Should the lifecycle hook persist catalog changes inline, or buffer them and persist once at end of session?**

Buffer in memory and do one atomic write at the end of the lifecycle hook, not inline per source and not at end of the full session. Inline writes create partial-write behavior and unnecessary churn. Deferring until end-of-session would also defeat the stated `beforeSense` benefit, because later gate/publish source loading reads the catalog lazily via [`tools/session-runner.ts`](/home/mj/projects/omniweb-agents/tools/session-runner.ts#L110) and [`tools/session-runner.ts`](/home/mj/projects/omniweb-agents/tools/session-runner.ts#L1421).

**Q3. Is `beforeSense` the right hook point?**

Yes, if the intent is for source promotions/degradations to affect the same session. The runner loads source view later, so a `beforeSense` write will be visible to gate/publish in the same run. `afterConfirm` is only better if you explicitly want lifecycle changes to lag by one full session and never influence the session that performed the checks.

**Q4. Should the hook skip entirely if the last lifecycle run was less than N hours ago?**

Yes. A cooldown is useful both for frequent sessions and for resume paths where `beforeSense` can rerun before SENSE completes. If you adopt it, persist an explicit "last lifecycle run" timestamp in catalog metadata or session state; it should not be inferred indirectly from whatever sample happened to be tested last.

**Q5. What's the right `sampleSize` default?**

`10` is a reasonable default. It is large enough to cycle through the catalog at a useful pace without turning every session into a full health sweep, and it remains small enough to keep the `beforeSense` path bounded. Keep it configurable.

## Test Contract Validation

Current baseline: the pure lifecycle suite in [`tests/lifecycle.test.ts`](/home/mj/projects/omniweb-agents/tests/lifecycle.test.ts#L1) passes (`32/32` via `npx vitest run tests/lifecycle.test.ts`). Those tests cover `updateRating()`, `evaluateTransition()`, and `applyTransitions()`. They do not cover the proposed session-runner hook.

The proposed contracts are directionally right, but they are incomplete.

- Incorrect as written: "lifecycle hook respects dry-run flag (no catalog writes)". In the current runner, session `--dry-run` skips the hook entirely.
- Missing: config plumbing coverage that `KNOWN_EXTENSIONS` accepts `lifecycle`, the registry accepts it, and `AgentConfig` parses `lifecycle.sampleSize` / `includeQuarantined` defaults.
- Missing: persistence coverage that the hook writes the full catalog atomically and preserves untouched records.
- Missing: persistence coverage that rating updates are saved even when zero transitions occur.
- Missing: `includeQuarantined: false` should exclude quarantined sources.
- Missing: cooldown behavior if Q4 is adopted.
- Missing: failure-isolation coverage that lifecycle errors are observed without preventing later `beforeSense` hooks from running.
- Missing: same-session visibility coverage that a `beforeSense` lifecycle write is what later gate/publish source loading sees.
- Missing: sampling should return unique sources only.
