# PR3 Design Review: Economic Features

I read the task and all listed files, plus the referenced PR3 plan section and extension dispatcher code needed to validate the design against the current loop architecture.

## Q1. Tipping Extension Design

Recommendation: **a) a new extension (`tips`) with its own hook registration**.

Rationale:
- The plan is explicit that new integrations must use the extension dispatcher and must not be bolted directly into `session-runner.ts` (`Plans/supercolony-upgrade-v2.md:32-40`).
- The current runner already follows that pattern for `signals` and `predictions` via `registerHook(...)` (`tools/session-runner.ts:3071-3144`), so tipping should be another peer extension, not logic hidden inside `predictions`.
- The existing `cmdTip()` flow is already a clean two-step primitive: validate with `POST /api/tip`, then transfer on-chain with `HIVE_TIP:{tx}` (`skills/supercolony/scripts/supercolony.ts:344-381`). The extension should orchestrate selection, policy, and state around that primitive.
- Inline ACT/engage logic would violate the architecture decision, and a standalone post-session tool would bypass `loop.extensions`, session observability, and shared state.

Implementation note:
- Do **not** piggyback on the `predictions` afterConfirm hook. That hook is intentionally scoped to published `PREDICTION` posts only (`tools/session-runner.ts:3131-3144`).
- The clean design is `tips` as a first-class extension, with its own local state and its own execution hook. If PR3 must stay within current hook types, use `beforeSense` for candidate discovery and add one new post-ACT hook for spend execution rather than hiding tipping inside another extension.

## Q2. Tip Target Selection

Recommendation: **a) score-based**.

Rationale:
- The available data already supports a quality score: `filterPosts()` normalizes author, score, attestation presence, reactions, tags, and assets (`tools/lib/feed-filter.ts:141-179`).
- A score-based selector is the easiest path to deterministic, auditable DEM spending. It can combine:
  - attestation required,
  - minimum score floor,
  - reaction count,
  - topic/tag alignment,
  - freshness,
  - recipient diversity penalties,
  - prior-tip exclusion.
- Reciprocity should be a weak tie-breaker at most, not the primary rule. Making prior tips the main driver creates obvious collusion and gaming risk.
- Signal alignment can be one input to the score, but using it as the main selector would make tipping too narrow and less useful for general reciprocity.
- Random sampling is acceptable only as a tie-breaker among similarly scored candidates.

Recommended scoring shape:
- Hard filters: not self, attested, score >= 80, not already tipped by this agent, not over per-recipient cap, not within cooldown.
- Weighted score: `quality + reactions + topic_alignment + freshness - repeat_recipient_penalty`.
- Execution: tip top 1-2 candidates per session, not every qualifying post.

## Q3. Dry-Run Graduation

Recommendation: **d) never auto-graduate - always require explicit opt-in**.

Rationale:
- `defaultSpendingPolicy()` is intentionally conservative: `dryRun: true` and `requireConfirmation: true` (`tools/lib/spending-policy.ts:71-85`).
- More importantly, `canSpend()` returns early in dry-run mode before checking per-tip bounds, daily/session caps, or allowlist rules (`tools/lib/spending-policy.ts:102-185`). That means "N successful dry-run sessions" is not evidence that live tipping would really pass policy.
- Automatic graduation is not defensible for on-chain value transfer. Live tipping should require an explicit operator decision.

Recommended opt-in mechanism:
- Keep the policy answer as **explicit opt-in only**.
- Use a dedicated persona config such as `tipping.enabled: true` as the durable opt-in switch.
- Continue honoring `requireConfirmation` whenever the session is not running in fully autonomous mode.

## Q4. Mention Detection Scope

Recommendation: **d) since last processed mention (tracked in state)**.

Rationale:
- Mention polling needs idempotence. A durable "last processed mention" cursor avoids both gaps and duplicate handling across irregular session timing.
- "Since last session timestamp" is weaker because sessions can fail, overlap, or be delayed.
- "Last 24 hours" and "last 50 posts" are arbitrary windows that will either replay too much or miss older-but-unprocessed mentions.
- The current engage tool is not mention-aware: it only fetches the generic feed (`/api/feed?limit=50`) and applies reaction heuristics to that pool (`tools/engage.ts:5-7`, `tools/engage.ts:177-205`).

Recommended state model:
- Persist `lastProcessedMention` in a small local file such as `~/.{agent}/mentions-state.json`.
- Store at least `{ txHash, timestamp }`.
- On each session, fetch a bounded recent mention/reply window, process only items newer than the cursor, then advance the cursor after successful handling.

## Q5. Risk Mitigation

Recommendation: **d) all of the above**.

Rationale:
- SpendingPolicy protects DEM amounts, but it does not protect against social gaming patterns.
- Recipient diversity is needed to avoid visible payola loops.
- A warm-up period is needed because new agents have not yet learned which posts the network genuinely values.
- A local cooldown stricter than the API minimum is prudent for autonomous behavior.

Minimum PR3 guardrails beyond SpendingPolicy:
- Max 2 live tips to the same recipient per day.
- No live tipping in the first 3 sessions.
- Minimum 5 minutes between tips.
- Never tip self.
- Never tip the same post twice.
- Require attestation and a quality floor.
- Log every allow, deny, and dry-run decision to observations.

## Findings

### P0

No P0 findings.

### P1

- **An afterConfirm-only tipping implementation will silently skip many sessions.** The runner only executes `runAfterConfirm(...)` when `state.publishedPosts.length > 0` (`tools/session-runner.ts:2819-2834`). That means a session that reacts but does not publish cannot tip anything if tipping is attached only to `afterConfirm`. This conflicts with the PR3 goal of scanning recent feed activity and rewarding quality posts independent of whether we authored a post that session.

- **Dry-run behavior is too permissive to justify auto-graduation.** `canSpend()` exits early when `config.dryRun` is true and marks the spend allowed without evaluating per-tip bounds, daily/session caps, or allowlist checks (`tools/lib/spending-policy.ts:115-185`). Any design that promotes to live tipping after N "successful" dry-run sessions would be trusting a simulation that does not exercise the real policy path.

### P2

- **A new `tips` extension will be ignored unless the extension allowlist is expanded.** The runtime extension set is compile-time validated by `KNOWN_EXTENSIONS`, which currently contains only `calibrate`, `sources`, `observe`, `signals`, and `predictions` (`tools/lib/state.ts:81-84`). `parseLoopExtensions()` silently ignores unknown entries in `persona.yaml` (`tools/lib/agent-config.ts:320-338`). If PR3 adds `tips` only to persona files, it will no-op.

- **The current engage path does not actually provide mention/reply handling.** `tools/engage.ts` is explicitly "reactions only" (`tools/engage.ts:3-7`), fetches a generic feed page (`tools/engage.ts:177-191`), and selects reactions from score/attestation heuristics (`tools/engage.ts:108-141`). It does not fetch mentions, track a mention cursor, or pull thread context before reacting. The task text saying mention handling is "already partially supported" is directionally true only for generic reaction casting, not for the required mention-specific polling behavior.

### P3

- **There is no existing persona schema for tipping controls.** The validated agent config schema currently exposes `engagement`, `gate`, `calibration`, and `loopExtensions`, but no `tipping` block (`tools/lib/agent-config.ts:41-58`). The active personas likewise contain engagement limits only (`agents/sentinel/persona.yaml:32-51`, `agents/pioneer/persona.yaml:33-56`). If PR3 wants explicit live-tip opt-in and guardrails in config, schema work is required first rather than assuming those fields already exist.

## Final Implementation Spec

### Extension architecture

- Add `tips` to `KNOWN_EXTENSIONS` in `tools/lib/state.ts`.
- Add `tips` to the extension registry in `tools/lib/extensions.ts`.
- Add one dedicated execution hook after ACT/engage or after ACT completion. The current dispatcher only exposes `beforeSense`, `beforePublishDraft`, `afterPublishDraft`, and `afterConfirm` (`tools/lib/extensions.ts:8-12`, `tools/lib/extensions.ts:98-103`), which is not sufficient for tipping that must also run on non-publishing sessions.
- Register the `tips` hook from `tools/session-runner.ts` in the same way `signals` and `predictions` are registered today (`tools/session-runner.ts:3071-3144`).

### Tipping state and policy

- Keep `tools/lib/spending-policy.ts` as the hard amount governor.
- Add a separate local tip state file, for example `~/.{agent}/tips-state.json`, to track:
  - tipped post tx hashes,
  - per-recipient daily counts,
  - last live tip timestamp,
  - live-tip warm-up session count.
- Add persona config for tipping, for example:
  - `tipping.enabled`
  - `tipping.maxTipsPerSession`
  - `tipping.maxPerRecipientPerDay`
  - `tipping.minMinutesBetweenTips`
  - `tipping.minSessionsBeforeLive`
  - `tipping.minScore`
  - `tipping.requireAttestation`
- Default all new tipping config to safe values and keep live tipping off until explicitly enabled.

### Tipping selection and execution flow

1. In the `tips` extension, fetch a bounded recent candidate pool from the feed.
2. Normalize candidates with `filterPosts()` and exclude the agent's own address.
3. Apply hard filters:
   - different author,
   - attested,
   - score above threshold,
   - not already tipped,
   - not over recipient/day cap,
   - not within cooldown.
4. Compute a deterministic score from quality, reactions, topic alignment, freshness, and recipient diversity penalty.
5. Select at most the top 1-2 candidates per session.
6. For each selected post:
   - call `canSpend(...)`,
   - if denied, log the denial and stop,
   - if dry-run, log the simulated decision and record no transfer,
   - if live, call `POST /api/tip`,
   - on success, call `demos.transfer(recipient, amount, "HIVE_TIP:{postTxHash}")`,
   - record the spend in the spending ledger and the tip state file,
   - emit an observation entry with the decision and outcome.

### Mention/reply polling

- Do not implement real webhooks in PR3. Keep the plan's poll-based fallback.
- Add a durable mention cursor file, for example `~/.{agent}/mentions-state.json`.
- During SENSE, fetch recent mention/reply candidates for the agent, filter to items newer than the cursor, and store a bounded queue in session state.
- During ACT/engage, process queued mentions before generic feed reactions.
- For each mention candidate, fetch thread context before deciding whether to react.
- Advance the mention cursor only after the mention has been handled successfully.

### Persona/config rollout

- Add `tips` to `loop.extensions` only after the extension exists in code.
- Add a `tipping` config block to both personas with live tipping disabled by default.
- Keep mention polling enabled separately from live tipping so PR3 can ship the safer polling behavior even while tips remain dry-run.

