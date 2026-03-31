# Phase 5 — Step B1: Publish Executor

## Task

Create `cli/publish-executor.ts` and `tests/cli/publish-executor.test.ts` — the dedicated executor for PUBLISH and REPLY strategy actions with the full attestation pipeline.

## Context

The V3 loop splits action execution into two paths:
- **Light actions** (ENGAGE/TIP) — handled by existing `cli/action-executor.ts` (1 chain call each)
- **Heavy actions** (PUBLISH/REPLY) — handled by this new module (10+ steps with error recovery)

This module replaces the inline publish logic from V2's `runPublishAutonomous()` but does NOT modify V2 code.

## What to Do

### 1. Create `cli/publish-executor.ts`

**Interfaces:**

```typescript
import type { StrategyAction } from "../cli/v3-strategy-bridge.js";
import type { V3SessionState, PublishedPostRecord } from "../src/lib/state.js";
import type { AgentConfig } from "../src/lib/agent-config.js";
import type { AgentSourceView } from "../src/lib/sources/catalog.js";
import type { LLMProvider } from "../src/lib/llm/llm-provider.js";
import type { FileStateStore } from "../src/toolkit/state/file-state-store.js";
import type { ColonyDatabase } from "../src/toolkit/colony/db.js";
import type { ProviderAdapter } from "../src/lib/sources/providers/types.js";
import type { SourceUsageTracker } from "../src/lib/attestation/attestation-planner.js";
import { getPost } from "../src/toolkit/colony/posts.js";
import { preflight } from "../src/lib/sources/policy.js";
import { match } from "../src/lib/sources/matcher.js";

export interface PublishActionResult {
  action: StrategyAction;
  success: boolean;
  txHash?: string;
  category?: string;
  textLength?: number;
  attestationType?: "DAHR" | "TLSN" | "none";
  error?: string;
}

export interface PublishExecutionResult {
  executed: PublishActionResult[];
  skipped: Array<{ action: StrategyAction; reason: string }>;
}

export interface PublishExecutorDeps {
  demos: Demos;
  walletAddress: string;
  provider: LLMProvider | null;
  agentConfig: AgentConfig;
  sourceView: AgentSourceView;
  state: V3SessionState;
  sessionsDir: string;
  observe: (type: string, message: string, meta?: Record<string, unknown>) => void;
  dryRun: boolean;
  stateStore: FileStateStore;
  colonyDb?: ColonyDatabase;
  calibrationOffset: number;
  scanContext: { activity_level: string; posts_per_hour: number; gaps?: string[] };
  adapters?: Map<string, ProviderAdapter>;
  usageTracker?: SourceUsageTracker;
  logSession: (entry: unknown) => void;
  logQuality: (data: unknown) => void;
}
```

**Main function — `executePublishActions(actions, deps)`:**

For each action in the array, execute this 12-step pipeline:

1. **Rate limit check** — `checkAndRecordWrite()` via `deps.stateStore`. If rejected, skip action with reason.
2. **Reply context loading** — If REPLY, fetch parent post:
   ```typescript
   // Use getPost() from src/toolkit/colony/posts.ts (NOT lookupPost — doesn't exist)
   if (action.type === "REPLY" && action.target) {
     const parentPost = deps.colonyDb
       ? getPost(deps.colonyDb, action.target)
       : null;
     replyContext = parentPost
       ? { txHash: action.target, author: parentPost.author, text: parentPost.text }
       : { txHash: action.target, author: action.metadata?.author ?? "unknown", text: action.reason };
   }
   ```
3. **Source resolution** — from `action.evidence` or catalog lookup:
   ```typescript
   async function resolveSourceForAction(action, sourceView, agentConfig) {
     // Path 1: Evidence from strategy engine
     if (action.evidence?.length) {
       const source = findSourceByEvidence(action.evidence[0], sourceView);
       if (source) return source;
     }
     // Path 2: Topic-based catalog lookup (fallback)
     const topic = action.metadata?.topics?.[0] ?? action.target ?? action.reason;
     const plan = resolveAttestationPlan(topic, agentConfig);
     const selection = selectSourceForTopicV2(topic, sourceView, plan.required);
     if (selection) return { url: selection.url, method: plan.required, sourceName: selection.source.name };
     return null; // skipped — no source
   }
   ```
4. **Source data pre-fetch** for LLM context
5. **LLM text generation** — `generatePost()` from `src/actions/llm.ts` with `scanContext + calibrationOffset`
6. **Quality checks** — min length, predicted reactions threshold
7. **Substantiation gate** — Run `preflight()` on the draft topic and `match()` on the generated text against source candidates. If no substantiation, skip action with reason "unsubstantiated draft". Import directly from `src/lib/sources/policy.ts` and `src/lib/sources/matcher.ts`.
8. **Claim extraction** — `extractStructuredClaimsAuto()` from `src/lib/attestation/claim-extraction.ts`
9. **Attestation plan + execution** — `buildAttestationPlan()` + `executeAttestationPlan()` with adapters/tracker
10. **Verification** — `verifyAttestedValues()` from `src/lib/attestation/attestation-planner.ts`
11. **Fallback** — if claim path fails, fallback to single `attestDahr()` or `attestTlsn()` from `src/actions/publish-pipeline.ts`
12. **Publish on-chain** — `publishPost()` from `src/actions/publish-pipeline.ts`
13. **State persistence** — update `state.posts`, `state.publishedPosts`, call `logSession()`, `logQuality()`

**Reused functions (import, do NOT rewrite):**

| Function | Module |
|----------|--------|
| `extractStructuredClaimsAuto()` | `src/lib/attestation/claim-extraction.ts` |
| `buildAttestationPlan()` | `src/lib/attestation/attestation-planner.ts` |
| `verifyAttestedValues()` | `src/lib/attestation/attestation-planner.ts` |
| `executeAttestationPlan()` | `src/actions/attestation-executor.ts` |
| `attestDahr()` | `src/actions/publish-pipeline.ts` |
| `attestTlsn()` | `src/actions/publish-pipeline.ts` |
| `publishPost()` | `src/actions/publish-pipeline.ts` |
| `generatePost()` | `src/actions/llm.ts` |
| `checkAndRecordWrite()` | `src/toolkit/guards/write-rate-limit.ts` |
| `getWriteRateRemaining()` | `src/toolkit/guards/write-rate-limit.ts` |
| `selectSourceForTopicV2()` | `src/lib/sources/policy.ts` |
| `resolveAttestationPlan()` | `src/lib/attestation/attestation-policy.ts` |
| `preflight()` | `src/lib/sources/policy.ts` |
| `match()` | `src/lib/sources/matcher.ts` |
| `getPost()` | `src/toolkit/colony/posts.ts` |

### 2. Create `tests/cli/publish-executor.test.ts`

Test the following (mock all chain/LLM calls):
- PUBLISH action: source resolution → LLM gen → claims → attestation → publish → state update
- REPLY action: same pipeline with replyTo context from colonyDb
- Rate limit rejection skips action with reason
- Source resolution fallback (evidence → catalog)
- Claim attestation failure falls back to single attestation
- Dry-run mode logs but doesn't broadcast
- State persistence (posts, publishedPosts arrays updated)
- Provider missing skips action gracefully
- Substantiation gate rejects unsubstantiated draft
- Empty actions array returns empty result

## Constraints

- This module depends on `V3SessionState` from Step A1 — that must be merged first
- Do NOT modify any existing files — this is a new module only
- Do NOT modify `sources-plugin.ts` — import `preflight()`/`match()` directly from their source modules
- All chain operations MUST use `executeChainTx()` from `src/toolkit/chain/tx-pipeline.ts`
- `npx tsc --noEmit` must pass
- `npm test` must pass
