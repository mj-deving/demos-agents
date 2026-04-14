# PR2 Review: Lightweight Integrations

I read the task and all listed files. One note in the task is stale: `skills/supercolony/scripts/supercolony.ts` already contains an unauthenticated `cmdStats()` wired to `/api/stats` at `skills/supercolony/scripts/supercolony.ts:625-628` and `skills/supercolony/scripts/supercolony.ts:831`.

## Q1. Briefing Integration Location

Recommendation: **b) a new `briefings.ts` module**.

Rationale:
- `tools/lib/signals.ts:48-94` has a tight contract: fetch `/api/signals`, normalize into `SignalSnapshot`, and never throw. Briefings are a different endpoint, payload shape, and downstream consumer.
- Keeping briefing fetch separate avoids overloading `SignalSnapshot` with unrelated data and keeps error handling/logging specific.
- The right reuse point is not "put all SENSE fetches in one file"; it is "call both from the same `beforeSense` lifecycle." `tools/session-runner.ts:2583-2590` already provides that hook boundary.
- If shared auth is needed, factor a tiny helper for token acquisition; do not make `signals.ts` own briefing semantics.

## Q2. OPINION Gate Policy

Recommendation: **a) only allow OPINION when `divergence=true` and `agentCount>=3`**.

Rationale:
- OPINION bypasses relevance filters, so it should have a harder admission rule than normal categories.
- The current system already tends to auto-publish from gated suggestions in `tools/session-runner.ts:1387-1450`; a loose OPINION rule would amplify mistakes.
- Start with a fixed conservative policy, collect outcomes, and only then consider persona-level tuning. Making it configurable first would widen the blast radius before the behavior is understood.

## Q3. Thread Context Size

Recommendation: **b) include only parent + direct siblings**.

Rationale:
- That captures the local conversation the reply is entering without turning every reply into an unbounded prompt expansion.
- `tools/lib/llm.ts:178-180` currently only accepts a single parent post. Extending that to parent plus sibling snippets is a straightforward change; full-thread summarization is much more complex and costly.
- Direct siblings are the highest-signal context for avoiding duplicate or off-target replies.

## Q4. Auto-Registration Timing

Recommendation: **a) session init (before SENSE)**.

Rationale:
- Registration is an idempotent prerequisite, not a post-session side effect.
- Running it after `CONFIRM` means the first session still operates without a profile, which defeats the feature's purpose.
- Manual CLI setup adds operational friction even though the codebase already has both profile lookup and registration primitives in `skills/supercolony/scripts/supercolony.ts:385-402` and `skills/supercolony/scripts/supercolony.ts:449-458`.

## Q5. Stats Impact on Gate

Recommendation: **b) soft gate: lower predicted reactions when activity is low, then let normal gate logic decide**.

Rationale:
- The runner already feeds activity into generation via `scanContext` at `tools/session-runner.ts:1641-1648` and already hard-rejects weak drafts via `predictedReactionsThreshold` at `tools/session-runner.ts:1670-1674`.
- A second hard gate on stats would duplicate existing conservatism and risks starving sessions during slow periods.
- "Info only" leaves the feature without any behavioral effect.

## Findings

### P0

No P0 findings.

### P1

- **Auth lookup in `beforeSense` is not address-scoped, which makes new SENSE integrations fragile.** The signals and predictions hooks call `loadAuthCache()` with no address in `tools/session-runner.ts:3072-3078` and `tools/session-runner.ts:3094-3098`. But `tools/lib/auth.ts:34-56` only does namespaced lookup when an address is provided; otherwise it falls back to legacy top-level fields. Any new briefing/stats fetch added beside these hooks will inherit the same failure mode for multi-agent or namespaced-only auth caches.

- **Auto-registration cannot currently be derived from `persona.yaml` as specified.** The active persona schema in `tools/lib/agent-config.ts:24-60` and `tools/lib/agent-config.ts:126-155` has no `description` or `specialties` fields, and the actual files `agents/sentinel/persona.yaml:1-39` and `agents/pioneer/persona.yaml:1-42` do not define them either. Without a schema change or explicit derivation rules, "`POST /api/agents/register` from persona.yaml" is underspecified.

- **Reply-aware generation is missing a prerequisite data path: the runner does not carry `replyTo` through gate to publish.** `tools/lib/llm.ts:60-64` and `tools/lib/llm.ts:178-180` support reply context, but `GatePost` in `tools/session-runner.ts:842-847` has no `replyTo`, and `runPublishAutonomous()` builds `generatePost()` input without any reply data at `tools/session-runner.ts:1637-1651`. PR2D needs state-shape changes before thread fetching matters.

### P2

- **OPINION support is only partially wired today.** `tools/lib/llm.ts:208-211` accepts `OPINION` during validation, but the prompt schema still tells the model to emit only `"ANALYSIS or PREDICTION"` at `tools/lib/llm.ts:132-148`, and gate suggestions still emit `ANALYSIS` or `QUESTION` in `tools/session-runner.ts:1081-1086`, `tools/session-runner.ts:1098-1103`, `tools/session-runner.ts:1111-1127`, and `tools/session-runner.ts:1238-1268`. If PR2 only "adds OPINION to the enum," it will not become a reliable end-to-end category.

- **The task’s CLI assumption is outdated.** The PR text says there is no stats command, but `cmdStats()` already exists and is public/no-auth in `skills/supercolony/scripts/supercolony.ts:625-628`. The implementation should reuse that fact, not add a duplicate path or churn the CLI unnecessarily.

### P3

- **`cmdRegister()` currently derives profile metadata from skill-local `agent-config.json`, not the runner’s multi-agent persona schema.** See `skills/supercolony/scripts/supercolony.ts:62-80` and `skills/supercolony/scripts/supercolony.ts:385-402`. That is not wrong, but it means PR2 should pick one source of truth for registration metadata instead of silently having two.

## Implementation Spec

### `tools/session-runner.ts`

- Add a small session-init step before `runBeforeSense(...)` in the v2 loop to:
  - connect wallet,
  - obtain an address-scoped token,
  - check `/api/agent/{address}`,
  - register only when the profile is missing.
- Reuse that same resolved address/token for `beforeSense` fetches instead of calling `loadAuthCache()` with no address.
- In `beforeSense`, fetch briefing and stats alongside signals, then persist them on `state` as separate fields, not inside `SignalSnapshot`.
- Add a bounded OPINION selector: only convert a candidate to `OPINION` when the matched signal for that topic has `divergence=true` and `agentCount>=3`.
- Apply stats as a soft adjustment to predicted reactions or topic ranking, not as a hard skip.
- Extend `GatePost` to carry `replyTo`, and when a reply target exists, fetch `/api/feed/thread/{txHash}` before `generatePost()`, then pass parent plus sibling context into the LLM input.

### `tools/lib/briefings.ts` (new)

- Add a dedicated fetcher for `/api/report`.
- Keep the contract parallel to `signals.ts`: normalize defensively, return `null` on failure, and emit briefing-specific observability.
- Export a compact typed shape, for example `{ fetchedAt, summary, title?, txHash? }`, instead of leaking raw API payloads into the runner.

### `tools/lib/llm.ts`

- Extend `GeneratePostInput` with:
  - `briefingContext?: { summary: string; title?: string }`
  - `replyContext?: { parent: {...}; siblings: Array<...> }`
- Update the prompt schema and guidance so OPINION is a first-class category rather than an after-the-fact validator exception.
- In reply generation, include the parent and short sibling excerpts; do not send the full thread.

### `tools/lib/signals.ts`

- Keep this module signal-only.
- Optional improvement: export a helper for matching a gate topic to the best signal topic so `session-runner.ts` does not keep duplicating ad hoc matching logic.
- Do not fold briefing fetch into `SignalSnapshot`.

### `tools/lib/agent-config.ts`

- If persona-driven auto-registration is required, extend the validated schema to include explicit registration metadata such as `profile.description` and `profile.specialties`, or define deterministic derivation rules from existing fields.
- Make the source of truth explicit so the runner and CLI do not diverge.

### `agents/sentinel/persona.yaml`

- Add profile metadata only if PR2 is meant to derive registration data from persona config.
- If the team does not want schema growth, document the fallback derivation instead.

### `agents/pioneer/persona.yaml`

- Same requirement as Sentinel: either add explicit registration metadata or keep the registration feature out of persona.yaml and derive it elsewhere consistently.

### `skills/supercolony/scripts/supercolony.ts`

- No new `stats` command is needed; it already exists.
- Reuse existing profile primitives (`cmdRegister`, `cmdProfile`) if the runner shells out, though direct API use from `session-runner.ts` is cleaner than spawning the CLI from inside the runner.
