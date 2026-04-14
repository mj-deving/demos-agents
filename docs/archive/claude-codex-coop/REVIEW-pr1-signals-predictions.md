# PR1 Review: Signals + Predictions + SpendingPolicy

Files read per task:
- `claude-codex-coop/TASK-pr1-signals-predictions.md`
- `tools/lib/extensions.ts`
- `tools/lib/state.ts`
- `tools/session-runner.ts`
- `tools/lib/agent-config.ts`
- `skills/supercolony/scripts/supercolony.ts`
- `agents/sentinel/strategy.yaml`
- `agents/pioneer/strategy.yaml`
- `tools/lib/observe.ts`

Additional files read because the runtime paths matter for this design:
- `agents/sentinel/persona.yaml`
- `agents/pioneer/persona.yaml`
- `tools/lib/log.ts`
- `Plans/supercolony-upgrade-v2.md`

## Q1. `afterConfirm` Hook Point

**Answer:** Add `afterConfirm`, not a generic `onPhaseComplete`, but narrow its responsibility. Use `afterConfirm` only for post-confirm registration/finalization of predictions and future tip decisions. Keep prediction resolution in `beforeSense` of the next session. That matches the current dispatcher shape in `tools/lib/extensions.ts:89-93,163-176,184-256`, preserves publish/verify context, and avoids turning the extension API into an untyped event bus.

`afterConfirm` is the right seam because the current v2 loop already has phase-specific extension points and a distinct CONFIRM phase in `tools/session-runner.ts:2712-2744`. A generic `onPhaseComplete` would force every extension to understand every phase payload and would add complexity with no immediate payoff.

The important change is context shape. `publishedPosts` cannot just be reconstructed from `state.posts`, because `V2SessionState` only stores tx hashes today (`tools/lib/state.ts:98-110`), manual publish only logs a `text_preview` and predicted reactions (`tools/session-runner.ts:1482-1527`), and autonomous publish also truncates text in the session log (`tools/session-runner.ts:1762-1789`, `tools/lib/log.ts:19-37`). `afterConfirm` needs a durable `PublishedPostRecord[]` persisted in session state before CONFIRM starts.

**Risks:**
- If `afterConfirm` relies on `state.posts` only, prediction registration will not have enough data to extract deadlines, targets, or even the full text.
- If `afterConfirm` is not idempotent, `--resume` can double-register predictions after a partial CONFIRM run.
- If it runs for all published posts instead of verified posts, you will track predictions that never actually landed.

**Dependencies:**
- Add `afterConfirm?(ctx: AfterConfirmContext): Promise<void>` and `runAfterConfirm()` to `tools/lib/extensions.ts`.
- Add a persisted `publishedPosts: PublishedPostRecord[]` field to `V2SessionState`.
- Populate `publishedPosts` from both `runPublishManual()` and `runPublishAutonomous()`.
- Pass `confirmResult` into `AfterConfirmContext` so the extension can filter to verified tx hashes.

## Q2. Prediction Auto-Resolution

**Answer:** For PR1, only auto-resolve structured numeric predictions with a known resolver and an explicit evaluation condition. Everything else should stay pending for manual review.

That means:
- Auto-resolve: price thresholds, percentage moves, market cap, TVL, and other numeric metrics only when the post can be parsed into `{subject, metric, comparator, threshold, deadline, dataSource}`.
- Do not auto-resolve in PR1: qualitative claims, policy decisions, thesis statements, and loosely phrased directional takes.
- Do not treat “parse from free text later” as sufficient. If the publish path does not preserve enough structure, registration should mark the prediction as manual-only.

This keeps false resolution risk low. A wrong auto-resolution is more damaging than a delayed resolution because calibration feedback will be poisoned.

**Risks:**
- Free-text extraction from arbitrary prediction posts will misclassify edge cases.
- “Fed will cut rates in Q2” and similar macro claims are resolvable in principle but not safely with the current design.
- TVL-like metrics are only safe if the source is explicit and the deadline is unambiguous.

**Dependencies:**
- Add a resolver registry in `tools/lib/predictions.ts`, keyed by prediction kind.
- Extend tracked predictions with `resolutionKind`, `dataSource`, `comparator`, `threshold`, and `manualReviewRequired`.
- Persist full post text and deadline/payload metadata at publish time; `text_preview` is not enough.

## Q3. Signal-Driven Topic Selection

**Answer:** Signals should augment topic selection, not override it.

The current gate flow already derives candidates from room-temp scan output in `extractTopicsFromScan()` (`tools/session-runner.ts:1030-1247`) and then runs gate/publish. Hard override would break the stated goal of pioneer seeding new topics, because consensus signals only exist after multiple agents are already talking about something. Use signals as a ranking modifier:
- Sentinel: boost topics where consensus and room-temp converge, especially high-confidence/high-evidence topics.
- Pioneer: boost divergence topics and contrarian opportunities, but never hard-filter unsignaled frontier topics.
- Hard filter only for clearly unsafe cases: stale signals, alert topics requiring special handling, or signal confidence below a minimum threshold.

**Risks:**
- Override mode creates feedback loops where agents only chase already-popular topics.
- Pure augmentation can dilute signals unless the rank bonus is meaningful.
- If the signal fetch fails and the design assumes override behavior, the agent can starve itself of candidates.

**Dependencies:**
- Add signal-aware scoring to topic ranking, not just to LLM prompts.
- Pass signal context into `generatePost()` so the prompt can use direction, confidence, divergence, and agent count.
- Store signals in session state so gate and publish read the same snapshot.

## Q4. Write Rate Limit Scope

**Answer:** Treat the 15/day and 5/hour limits as address-scoped until proven otherwise, and implement shared persistent tracking by wallet address. Session-local state is not sufficient.

The current plan says “track daily/hourly post count in session state” (`Plans/supercolony-upgrade-v2.md:78-81`), but session state is per-agent and not persisted across completed sessions. `V2SessionState` is also agent-namespaced (`tools/lib/state.ts:98-110`). If three agents share one wallet, session-local counters will undercount and can still exceed the real platform cap.

Even if the backend later confirms the limit is per-agent, address-scoped tracking is the safer default. You can still record per-agent attribution inside the shared ledger.

**Risks:**
- Session-local counters allow violations across sessions and across agents on the same wallet.
- Shared ledgers without locking can race if two agents publish concurrently.
- If you enforce per-agent only and the platform enforces per-address, publishes will start failing unpredictably.

**Dependencies:**
- Add a persistent shared write-rate ledger, keyed by wallet address, not session.
- Resolve the wallet address before publish and enforce limits before each publish attempt.
- Keep a session-local summary in state for observability only; do not use it as the source of truth.

## Q5. SpendingPolicy vs Future Tipping

**Answer:** Build SpendingPolicy in PR1, but keep the scope minimal and standalone.

This is worth shipping now because it is a prerequisite for autonomous economic actions and it shares the same ledger/scoping questions as write-rate limits. The mistake would be over-integrating it into the session loop before PR3. PR1 should prove the policy API, ledger format, and observation logging, without enabling autonomous tipping yet.

**Risks:**
- If deferred to PR3, tipping will either ship late or ship without hardened controls.
- If overbuilt now, PR1 expands into an unnecessary wallet-orchestration project.
- If policy is per-agent only while the funds are per-address, multiple agents can overspend the same wallet.

**Dependencies:**
- `tools/lib/spending-policy.ts` should be a reusable library, not an extension.
- Use persistent ledger storage with atomic writes and address-scoped hard caps.
- Add observation logging for allow/deny decisions and recorded spends.

## Q6. Prediction Store Format

**Answer:** Use JSON, not JSONL, as the canonical prediction store.

This store is mutable state, not just an audit trail. Resolution status, timestamps, extracted structure, and retries all need updates by tx hash. JSONL is a poor fit for that. The current append-only pattern makes sense for observations and session logs (`tools/lib/observe.ts`, `tools/lib/log.ts`), but prediction tracking is a state machine.

The best PR1 format is a versioned JSON document keyed by tx hash, written atomically. If you want append-only history later, emit observation entries or a secondary archive log when state transitions happen.

**Risks:**
- Whole-file rewrites need atomic write discipline.
- If the file grows indefinitely, update cost rises.
- If multiple processes write the same file without locking, you can lose updates.

**Dependencies:**
- `tools/lib/predictions.ts` should load/save a versioned JSON store.
- Use temp-file + rename writes.
- Add idempotent upsert behavior keyed by tx hash.

## Overall Findings

**P0 (Critical):**
- Write-rate enforcement cannot live only in session state. The current proposal would miss publishes across sessions and across agents sharing a wallet. This is a design blocker for safe autonomous publishing.

**P1 (High):**
- The design targets the wrong config files for extension enablement. Runtime loads `loop.extensions` from `agents/*/persona.yaml`, not `strategy.yaml` (`tools/lib/agent-config.ts:320-337,342-423`; `agents/sentinel/persona.yaml:45-49`; `agents/pioneer/persona.yaml:50-54`). If implemented as written in the task’s modified-files section, the new extensions will never run.
- `afterConfirm` currently has no durable post-rich context to operate on. Session state stores only tx hashes (`tools/lib/state.ts:98-110`), and the session log truncates text (`tools/lib/log.ts:19-37`, `tools/session-runner.ts:1500-1515`, `1762-1783`). Prediction registration/resolution will be lossy unless a full `PublishedPostRecord` is persisted.
- The API contract for prediction registration is not firm. The task’s endpoint list includes `GET /api/predictions` and `POST /api/predictions/{tx}/resolve`, but not `POST /api/predictions` registration. The current CLI also only supports query, not registration (`skills/supercolony/scripts/supercolony.ts:404-415,595-608`). PR1 must define local store as the canonical source unless registration support is confirmed.

**P2 (Medium):**
- Plan/docs are inconsistent about where prediction logic starts. The v2 plan mentions `beforePublishDraft` for prediction registration and `afterConfirm` for tracking, while the PR1 design centers `afterConfirm`. Resolve that before implementation to avoid split ownership.
- Signal usage should be incorporated into candidate ranking before gate, not only into the LLM prompt, or the feature will have weak behavioral impact.
- SpendingPolicy should share ledger scoping assumptions with write-rate enforcement; otherwise two independent “safe” ledgers can still overspend one wallet.

**P3 (Low):**
- Store signal snapshots with explicit TTL/staleness handling and reuse them on resume instead of refetching blindly.
- Emit observation entries for prediction registration/resolution and spend-policy decisions so the improve loop can analyze them later.

## Concrete Implementation Spec

### 1. `tools/lib/state.ts`
- Add `"signals"` and `"predictions"` to `KNOWN_EXTENSIONS`.
- Extend `V2SessionState` with:
  - `publishedPosts?: PublishedPostRecord[]`
  - `signalSnapshot?: SignalSnapshot`
- Define:
  - `PublishedPostRecord { txHash, topic, category, text, confidence, predictedReactions, hypothesis, tags, replyTo?, deadline?, publishedAt, attestationType, verified?: boolean }`
- Do not use session state as the source of truth for write-rate limits.

### 2. `tools/lib/extensions.ts`
- Extend `LoopExtensionHooks` with `afterConfirm?(ctx: AfterConfirmContext): Promise<void>`.
- Add `AfterConfirmContext { state, config, confirmResult, publishedPosts }`.
- Add `runAfterConfirm()` with the same sequential dispatch behavior as the other hooks.
- Register `signals` and `predictions` in `EXTENSION_REGISTRY`.

### 3. `tools/lib/signals.ts` (new)
- Implement:
  - `fetchSignals(...)`
  - `normalizeSignalSnapshot(...)`
  - `scoreSignalAlignment(topic, snapshot, agentMode)`
- `beforeSense` behavior:
  - Fetch `/api/signals`
  - Normalize to `SignalSnapshot`
  - Persist `state.signalSnapshot`
  - Emit an observation on success/failure
- Export helpers used by gate/topic-ranking and LLM prompt building.

### 4. `tools/lib/predictions.ts` (new)
- Implement a versioned JSON store at `~/.{agent}/predictions.json`.
- Store shape:
  - `{ version, agent, updatedAt, itemsByTxHash }`
- Registration path:
  - `afterConfirm` upserts only verified PREDICTION posts into the local store.
  - If API registration support is confirmed later, mirror local registration to the API after the local write succeeds.
- Resolution path:
  - `beforeSense` scans pending predictions, runs known resolvers, updates statuses, and logs outcomes.
- Include:
  - parser/extractor for structured numeric predictions
  - resolver registry
  - idempotent upsert by tx hash
  - atomic save

### 5. `tools/lib/write-rate-limit.ts` (new)
- Add a persistent shared ledger keyed by wallet address:
  - `{ address, dailyWindowStart, hourlyWindowStart, dailyCount, hourlyCount, items[] }`
- Enforce limits before each publish attempt.
- Record per-agent attribution in each ledger item.
- Use atomic writes and a simple lockfile or create-exclusive file pattern.
- Optionally mirror the current counts into session state for reporting only.

### 6. `tools/lib/spending-policy.ts` (new)
- Implement `canSpend`, `recordSpend`, `loadLedger`, `saveLedger`.
- Use address-scoped hard caps plus agent attribution.
- Default to `dryRun: true`.
- Emit observation entries for:
  - denied spend attempts
  - dry-run approvals
  - recorded spends

### 7. `tools/session-runner.ts`
- In `beforeSense`, run both calibrate and predictions resolution, then continue into room-temp scan.
- After SENSE scan completes, merge room-temp output with any persisted `signalSnapshot`.
- Update topic selection logic to apply signal-based bonuses/penalties before gate.
- Update `generatePost()` inputs to include signal context.
- Before each publish attempt:
  - load shared write-rate ledger
  - enforce address-scoped caps
  - skip and observe when capped
- In `runPublishManual()` and `runPublishAutonomous()`:
  - build full `PublishedPostRecord`
  - persist it to `state.publishedPosts`
  - keep `state.posts` for verify compatibility
- After CONFIRM completes successfully:
  - mark verified posts in `state.publishedPosts`
  - call `runAfterConfirm(agentConfig.loopExtensions, { state, config, confirmResult, publishedPosts })`

### 8. `tools/lib/llm.ts`
- Extend `GeneratePostInput` with optional signal context:
  - `signalDirection`, `signalConfidence`, `signalAgentCount`, `signalDivergence`
- Add prompt guidance:
  - sentinel: converge with verified consensus when evidence is strong
  - pioneer: use divergence as a contrarian input, not as a hard command

### 9. `agents/sentinel/persona.yaml` and `agents/pioneer/persona.yaml`
- Add:
  - `signals`
  - `predictions`
- Do not modify `strategy.yaml` for extension enablement; the runtime does not read loop extensions from strategy files.

### 10. Optional CLI follow-up
- If API registration/resolution endpoints are confirmed and meant to be used through the skill CLI, extend `skills/supercolony/scripts/supercolony.ts` with explicit prediction registration/resolution commands.
- This is optional for PR1 if the new libraries call the API directly.
