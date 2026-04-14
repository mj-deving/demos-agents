---
type: design
status: draft
created: 2026-04-03
summary: "Phase 7 architecture — thread fan-out, ENGAGE txHash fix, leaderboard meta-rule, colony report + identity enrichment"
read_when: ["phase 7", "thread fan-out", "engage txHash", "leaderboard meta-rule", "colony report", "identity enrichment"]
---

# Phase 7: Strategy Phase 2 Rules — Architecture Design

## 1. Overview

Five implementation items completing Phase 7 of omniweb-agents. All follow ADR-0002 (toolkit vs strategy boundary) and ADR-0006 (TDD required).

### Items

| ID | Item | Classification | Location |
|----|------|---------------|----------|
| 7d | Thread fan-out | Toolkit (mechanism) | `src/toolkit/publish/thread-fan-out.ts` |
| 6-disc-j | ENGAGE txHash resolution | Toolkit (types) + CLI (executor) | `src/toolkit/strategy/types.ts` + `cli/action-executor.ts` |
| 6-disc-d | Colony report consumption | CLI (bridge) | `cli/v3-strategy-bridge.ts` |
| 6-disc-e | Identity enrichment | CLI (bridge) | `cli/v3-strategy-bridge.ts` |
| 6-defer-d | Leaderboard meta-rule | Toolkit (engine) | `src/toolkit/strategy/engine.ts` |

### Dependency Order

```
6-disc-j (type changes) → 6-disc-d + 6-disc-e (context additions) → 6-defer-d + 7d (engine + publish)
```

## 2. ENGAGE txHash Resolution (6-disc-j)

### Problem

`StrategyAction.target` is polymorphic: sometimes a post txHash, sometimes an agent address. The action executor calls `reactToPost(bridge, action.target!, "agree")` which requires a txHash. When `engage_verified` or `engage_novel_agents` set target to an agent address, `reactToPost` receives an address instead of a txHash and fails or reacts to the wrong thing.

### Design

Add a `targetType` discriminant to `StrategyAction`:

```typescript
// src/toolkit/strategy/types.ts
export interface StrategyAction {
  type: ActionType;
  priority: number;
  target?: string;
  targetType?: "post" | "agent";  // NEW — discriminates target semantics
  evidence?: string[];
  reason: string;
  metadata?: Record<string, unknown>;
}
```

**Why optional?** Backward compatibility. Existing REPLY/PUBLISH actions don't need it. Only ENGAGE and TIP benefit from disambiguation. Default behavior when absent: treat target as post txHash (existing behavior).

**Strategy engine changes** (engine.ts):
- `engage_verified`: set `targetType: "post"` — targets a specific post with attestation
- `engage_novel_agents`: set `targetType: "agent"` — targets an agent address
- `reply_to_mentions`: already targets txHash via `mention.txHash` (no change needed)

**But wait — engage_verified currently targets `contributor.author` (address), not a post.** The real fix is two-part:

1. **Strategy engine**: `engage_verified` should emit a post txHash target when possible. The rule iterates `topContributors` and checks `hasAttestationSignal`. To target a specific post, the rule needs the trending post's txHash. Current `ColonyState.agents.topContributors` only has `{ author, postCount, totalAgrees, totalDisagrees, topics }` — no recent post txHash.

2. **Resolution function**: For cases where only an agent address is available, add `resolveAgentToRecentPost(db, agentAddress)` in the executor that finds the agent's most recent qualifying post.

```typescript
// cli/action-executor.ts — new helper
function resolveAgentToRecentPost(
  colonyDb: ColonyDatabase | undefined,
  agentAddress: string,
): string | null {
  if (!colonyDb) return null;
  // Find most recent post by this agent in the last 48h
  const stmt = colonyDb.prepare(
    `SELECT tx_hash FROM posts
     WHERE author = ? AND created_at > datetime('now', '-48 hours')
     ORDER BY created_at DESC LIMIT 1`
  );
  const row = stmt.get(agentAddress) as { tx_hash: string } | undefined;
  return row?.tx_hash ?? null;
}
```

**Executor changes** (action-executor.ts ENGAGE case):
```typescript
case "ENGAGE": {
  let txHash = action.target!;
  // If target is an agent address, resolve to their recent post
  if (action.targetType === "agent") {
    const resolved = resolveAgentToRecentPost(deps.colonyDb, action.target!);
    if (!resolved) {
      result.skipped.push({ action, reason: "could not resolve agent to recent post" });
      break;
    }
    txHash = resolved;
  }
  await reactToPost(deps.bridge, txHash, "agree");
  // ... rest unchanged
}
```

### Files Changed
- `src/toolkit/strategy/types.ts` — add `targetType` to `StrategyAction`
- `src/toolkit/strategy/engine.ts` — set `targetType` in engage rules
- `cli/action-executor.ts` — resolve agent → post txHash before reactToPost

## 3. Colony Report Integration (6-disc-d)

### Problem

`/api/report` endpoint exists in the API client but is not consumed by the strategy bridge. Colony briefings could inform topic selection.

### Design

Add `briefingContext` to `DecisionContext`:

```typescript
// src/toolkit/strategy/types.ts — extend DecisionContext
export interface DecisionContext {
  // ... existing fields ...
  /** Colony briefing from /api/report — informs topic prioritization. */
  briefingContext?: string;
}
```

**Bridge integration** (v3-strategy-bridge.ts `plan()` function):

```typescript
// In the plan() function, before building context:
// Fetch colony report (optional, graceful failure)
let briefingContext: string | undefined;
try {
  if (ctx.apiClient) {
    const report = await ctx.apiClient.getReport();
    if (report.ok && report.data?.content) {
      briefingContext = report.data.content;
    }
  }
} catch {
  // Briefing is optional enrichment — continue without it
}
// Add to context:
if (briefingContext) {
  context.briefingContext = briefingContext;
}
```

**Strategy consumption**: The `publish_to_gaps` and `publish_signal_aligned` rules can use `briefingContext` to boost topics mentioned in the colony briefing. This is a lightweight enhancement — no new rule, just a priority boost.

```typescript
// In engine.ts publish_to_gaps section:
// If briefing mentions this gap topic, boost priority
if (context.briefingContext?.toLowerCase().includes(normalize(gap.topic))) {
  action.priority += 10;  // Briefing-aligned boost
  action.reason += " (briefing-aligned)";
}
```

### Note on API Client Access

The current `StrategyBridge` doesn't hold an API client reference. The `apiEnrichment` data is fetched externally (in session-runner or v3-loop) and passed to `plan()`. Colony report should follow the same pattern: fetch in the caller, pass as data.

**Revised approach**: Add `briefingContext` to the `plan()` parameters, not fetch inside the bridge.

```typescript
export async function plan(
  ctx: StrategyBridge,
  senseResult: SenseResult,
  sessionReactionsUsed: number,
  apiEnrichment?: ApiEnrichmentData,
  calibration?: CalibrationState,
  briefingContext?: string,  // NEW
): Promise<PlanResult> {
```

### Files Changed
- `src/toolkit/strategy/types.ts` — add `briefingContext` to `DecisionContext`
- `src/toolkit/strategy/engine.ts` — consume briefing in publish rules
- `cli/v3-strategy-bridge.ts` — thread `briefingContext` parameter to `plan()`

## 4. Identity Enrichment (6-disc-e)

### Problem

Agent profiles in `intelligence.agentProfiles` have post stats but no social identity. `/api/identity` can enrich with platform handles. This helps the strategy engine make better decisions about who to engage with.

### Design

Add `socialHandles` to the agent profile shape:

```typescript
// src/toolkit/strategy/types.ts — extend the agentProfiles shape
intelligence?: {
  recentInteractions?: Record<string, number>;
  recentTips?: Record<string, number>;
  agentProfiles?: Record<string, {
    postCount: number;
    avgAgrees: number;
    avgDisagrees: number;
    topics: string[];
    socialHandles?: Array<{ platform: string; username: string }>;  // NEW
  }>;
};
```

**Enrichment in bridge** (v3-strategy-bridge.ts):

```typescript
// After building agentProfiles, enrich with identity lookups
// Batch: only lookup agents we're actively considering (topContributors + mentions)
// Cache: skip if profile already has socialHandles from a previous session
for (const address of Object.keys(agentProfiles)) {
  try {
    const identity = await apiClient.lookupByChainAddress("demos", address);
    if (identity.ok && identity.data?.found) {
      agentProfiles[address].socialHandles = identity.data.accounts.map(a => ({
        platform: a.platform ?? "unknown",
        username: a.displayName ?? a.address,
      }));
    }
  } catch {
    // Identity lookup failure is non-blocking
  }
}
```

**Same pattern as briefing**: Pass pre-fetched identity data, don't fetch inside the bridge. The session runner or v3-loop already fetches API enrichment — identity lookups belong there.

**Revised approach**: The identity enrichment happens in the bridge `plan()` function where `agentProfiles` are already being built. Since the bridge builds profiles from colony DB, it's the natural place to also enrich them. But the bridge needs API client access.

**Simplest approach**: Accept an optional `identityLookup` function parameter:

```typescript
export async function plan(
  ctx: StrategyBridge,
  senseResult: SenseResult,
  sessionReactionsUsed: number,
  apiEnrichment?: ApiEnrichmentData,
  calibration?: CalibrationState,
  briefingContext?: string,
  identityLookup?: (address: string) => Promise<Array<{ platform: string; username: string }> | null>,
): Promise<PlanResult> {
```

This keeps the bridge decoupled from the API client while enabling enrichment.

### Files Changed
- `src/toolkit/strategy/types.ts` — add `socialHandles` to agent profile type
- `cli/v3-strategy-bridge.ts` — accept `identityLookup`, enrich profiles

## 5. Leaderboard Meta-Rule (6-defer-d)

### Problem

The agent should adapt its behavior based on leaderboard position. Top-ranked agents should focus on community engagement (maintain position). Low-ranked agents should focus on publishing (build reputation).

### Design

New function `applyLeaderboardAdjustment` in engine.ts, called after all rules produce actions but before sorting:

```typescript
// src/toolkit/strategy/engine.ts
function applyLeaderboardAdjustment(
  actions: StrategyAction[],
  leaderboard: LeaderboardResult | undefined,
  ourAddress: string,
  config: LeaderboardAdjustmentConfig,
): void {
  if (!leaderboard?.entries?.length) return;

  const totalAgents = leaderboard.entries.length;
  const ourRank = leaderboard.entries.findIndex(
    e => e.address.toLowerCase() === ourAddress.toLowerCase()
  );
  if (ourRank === -1) return;  // Not on leaderboard

  const percentile = ourRank / totalAgents;  // 0 = top, 1 = bottom

  for (const action of actions) {
    if (percentile <= 0.25) {
      // Top quartile: boost engagement/tip, slightly reduce publish
      if (action.type === "ENGAGE" || action.type === "TIP") {
        action.priority += config.topBoostEngagement;   // default: +15
      }
      if (action.type === "PUBLISH") {
        action.priority += config.topAdjustPublish;     // default: -5
      }
    } else if (percentile >= 0.75) {
      // Bottom quartile: boost publish, slightly reduce engagement
      if (action.type === "PUBLISH") {
        action.priority += config.bottomBoostPublish;   // default: +15
      }
      if (action.type === "ENGAGE" || action.type === "TIP") {
        action.priority += config.bottomAdjustEngagement; // default: -5
      }
    }
    // Middle 50%: no adjustment
  }
}
```

**Configuration in strategy YAML:**

```yaml
leaderboardAdjustment:
  enabled: true
  topBoostEngagement: 15
  topAdjustPublish: -5
  bottomBoostPublish: 15
  bottomAdjustEngagement: -5
```

**Type additions** (types.ts):

```typescript
export interface LeaderboardAdjustmentConfig {
  enabled: boolean;
  topBoostEngagement: number;
  topAdjustPublish: number;
  bottomBoostPublish: number;
  bottomAdjustEngagement: number;
}

// Add to StrategyConfig:
export interface StrategyConfig {
  // ... existing ...
  leaderboardAdjustment?: LeaderboardAdjustmentConfig;
}
```

**Integration point**: In `decideActions()`, after all rules have produced actions and before sorting/rate-limiting:

```typescript
// After all rules, before sorting
if (config.leaderboardAdjustment?.enabled) {
  applyLeaderboardAdjustment(
    actions,
    context.apiEnrichment?.leaderboard,
    context.ourAddress,
    config.leaderboardAdjustment,
  );
}
// Then sort and apply rate limits
```

### Files Changed
- `src/toolkit/strategy/types.ts` — add `LeaderboardAdjustmentConfig` to `StrategyConfig`
- `src/toolkit/strategy/engine.ts` — add `applyLeaderboardAdjustment()`, call in `decideActions()`
- `src/toolkit/strategy/config-loader.ts` — parse `leaderboardAdjustment` from YAML
- `agents/sentinel/strategy.yaml` — add `leaderboardAdjustment` section

## 6. Thread Fan-Out (7d)

### Problem

Currently, the publish pipeline produces one post per strategy action. If a draft contains multiple attestable claims, only the primary claim is used and the rest are discarded. Per design-loop-v3.md §4 step 4, multi-claim drafts should produce a thread: root post = primary claim, replies = secondary claims.

### Design

New toolkit module `src/toolkit/publish/thread-fan-out.ts`:

```typescript
import type { StructuredClaim } from "./claim-types.js";

export interface ThreadPlan {
  /** The root post claim (highest attestability) */
  rootClaim: StructuredClaim;
  /** Reply claims, each gets its own attestation cycle */
  replyClaims: StructuredClaim[];
  /** Total claims extracted from the draft */
  totalClaims: number;
  /** Whether fan-out was applied (false if single claim) */
  fanOutApplied: boolean;
}

export interface ThreadFanOutConfig {
  /** Maximum claims per thread (default 5) */
  maxClaimsPerThread: number;
}

const DEFAULT_CONFIG: ThreadFanOutConfig = {
  maxClaimsPerThread: 5,
};

/**
 * Score a claim's attestability — higher = more suitable as root post.
 *
 * Factual numeric claims score highest (most verifiable).
 * Claims with source fields score higher (easier to attest).
 * Editorial claims score lowest.
 */
function scoreAttestability(claim: StructuredClaim): number {
  let score = 0;
  if (claim.type === "factual") score += 50;
  if (claim.value !== null && claim.value !== undefined) score += 30;
  if (claim.sourceField) score += 20;
  return score;
}

/**
 * Plan thread fan-out for a draft's extracted claims.
 *
 * Returns a ThreadPlan that the publish pipeline uses to:
 * 1. Publish root post with the strongest claim
 * 2. Publish reply posts for remaining claims (each independently attested)
 *
 * Single-claim drafts bypass fan-out (fanOutApplied: false).
 */
export function planThreadFanOut(
  claims: StructuredClaim[],
  config: Partial<ThreadFanOutConfig> = {},
): ThreadPlan {
  const merged = { ...DEFAULT_CONFIG, ...config };

  if (claims.length === 0) {
    throw new Error("Cannot plan thread fan-out with zero claims");
  }

  if (claims.length === 1) {
    return {
      rootClaim: claims[0],
      replyClaims: [],
      totalClaims: 1,
      fanOutApplied: false,
    };
  }

  // Sort by attestability (descending)
  const sorted = [...claims].sort((a, b) => scoreAttestability(b) - scoreAttestability(a));

  // Root = highest scored, replies = rest (capped)
  const rootClaim = sorted[0];
  const replyClaims = sorted.slice(1, merged.maxClaimsPerThread);

  return {
    rootClaim,
    replyClaims,
    totalClaims: claims.length,
    fanOutApplied: true,
  };
}
```

**This is a pure planning function** — it doesn't execute attestation or publishing. It takes extracted claims and returns a plan. The publish pipeline (in `cli/publish-executor.ts` or the signal-first pipeline) uses the plan to orchestrate multi-post publishing.

**Why toolkit?** It's a mechanism: rank claims, split into root + replies. No opinion on what to publish or when — that's strategy. Any agent with multi-claim drafts uses the same splitting logic.

### Files Changed
- `src/toolkit/publish/thread-fan-out.ts` — new file
- Tests at `tests/toolkit/publish/thread-fan-out.test.ts` — new file

## 7. Test Strategy

Each item gets its own test file or extends existing tests:

| Item | Test File | Key Cases |
|------|-----------|-----------|
| 6-disc-j | `tests/toolkit/strategy/engine.test.ts` (extend) + `tests/cli/action-executor.test.ts` (extend) | post target, agent target, resolution miss, backward compat |
| 6-disc-d | `tests/toolkit/strategy/engine.test.ts` (extend) | briefing boost, no briefing, empty briefing |
| 6-disc-e | `tests/cli/v3-strategy-bridge.test.ts` (extend or new) | identity found, not found, lookup failure |
| 6-defer-d | `tests/toolkit/strategy/engine.test.ts` (extend) | top rank boost, bottom rank boost, middle no-op, no data |
| 7d | `tests/toolkit/publish/thread-fan-out.test.ts` (new) | multi-claim, single-claim, zero claims, max cap, scoring |
