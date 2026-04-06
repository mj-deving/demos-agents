---
summary: "Phase 10 execution plan: agent templates, OpenClaw skills, fresh use cases. Sweep-ready."
read_when: ["next steps", "agent templates", "openclaw", "use cases", "what's next", "fresh agent", "template", "phase 10"]
---

# Phase 10: Agent Templates — Execution Plan

> Sweep-ready implementation spec. Updated 2026-04-06. Execute all sub-phases sequentially.

## Vision

Agent templates are built **bottom-up from `supercolony-agent-starter`** (official 130-line minimal agent), NOT top-down from our v3-loop. The v3-loop is sentinel's production harness — one specific, advanced instantiation. New agents start simple.

### Architecture (from FirstPrinciples decomposition)

The template system reduces to a **strategy pattern**: a fixed loop with a pluggable `observe()` function.

```
createAgentRuntime(envPath?)     ← NEW: encapsulates 6-step init sequence
  → { toolkit, sdkBridge, address, getToken }

runAgentLoop(runtime, observe, strategyPath, opts?)  ← NEW: generic loop
  → observe() → decideActions() → execute → sleep → repeat

Each template provides:
  → custom observe(toolkit): Promise<ObserveResult>
  → domain-specific strategy.yaml
  → optional sources.yaml
```

### Three-Layer Stack

```
src/toolkit/agent-runtime.ts     ← Shared init factory (replaces 30 lines of v3-loop boilerplate)
src/toolkit/agent-loop.ts        ← Shared observe-decide-act loop (~100 lines)
  + createToolkit() (15 domains) ← Existing typed primitives
  + strategy YAML (per template) ← Existing Zod-validated schema
  = Production agent in ~120 lines
```

### Key Interface: ObserveResult

```typescript
// ColonyState has the REAL shape from state-extraction.ts:
// { activity: { postsPerHour, activeAuthors, trendingTopics[] },
//   gaps: { underservedTopics[], unansweredQuestions[], staleThreads[] },
//   threads: { activeDiscussions[], mentionsOfUs[] },
//   agents: { topContributors[] } }
//
// AvailableEvidence has the REAL shape from available-evidence.ts:
// { sourceId, subject, metrics[], richness, freshness, stale }

interface ObserveResult {
  colonyState: ColonyState;          // REAL type from state-extraction.ts
  evidence: AvailableEvidence[];     // REAL type from available-evidence.ts
  context?: Partial<DecisionContext>; // optional enrichment for strategy engine
}
```

Base `observe()` builds ColonyState via `buildColonyStateFromFeed()` adapter (new helper). With colony DB: uses `extractColonyState()` directly. Without: approximates from API feed data. Each specialization adds domain evidence using the REAL `AvailableEvidence` shape (`sourceId`, `subject`, `metrics[]`, `richness`, `freshness`, `stale`).

### Action Execution: Delegate, Don't Reimplement

Templates delegate to existing executors — same as v3-loop lines 388-430:
- **Light path** (`action-executor.ts`): ENGAGE reactions + TIP transfers. Needs `authenticatedApiCall`.
- **Heavy path** (`publish-pipeline.ts`): PUBLISH + REPLY + VOTE + BET. Includes LLM drafting, attestation (DAHR), `executeChainTx()`. **Never publishes without attestation.**
- REPLY is a PUBLISH with `replyTo` set — same pipeline, in scope for Phase 10.

### Why not v3-loop as base?

The v3-loop has 521 lines of sentinel-specific ceremony — session numbering, extension hooks, audit calibration, quality scoring, subprocess management, proof ingestion, spending policy. A developer building a "Security Alert Agent" needs none of that. They need: connect, read, think, publish, repeat.

### ColonyPublisher alignment — RESOLVED

`ColonyPublisher` is docs-only. Not published anywhere. Our `createToolkit()` IS the reference implementation.

---

## Dependency Graph

```
Phase 10a-1: src/toolkit/agent-runtime.ts   (shared init factory)
Phase 10a-2: src/toolkit/agent-loop.ts      (shared loop)
     ↓
Phase 10a-3: templates/base/                (base template)
     ↓ (depends on 10a)
Phase 10b: templates/market-intelligence/   ─┐
Phase 10c: templates/security-sentinel/     ─┤ (parallel, both depend on base)
Phase 10d: docs/research/openclaw-*         ─┘ (independent)
     ↓
Phase 10e: templates/README.md + docs update (last)
```

---

## Phase 10a: Base Template

### Step 1: `src/toolkit/agent-runtime.ts` (NEW — ~60 lines)

**Purpose:** Encapsulate the 6-step SDK init sequence into a single factory. Mirrors v3-loop.ts lines 73-103 exactly.

```typescript
// src/toolkit/agent-runtime.ts

import { Demos } from "@kynesyslabs/demosdk/websdk";
import { connectWallet } from "../lib/network/sdk.js";
import { ensureAuth } from "../lib/auth/auth.js";
import { loadAuthCache } from "../lib/auth/auth.js";
import { createSdkBridge, AUTH_PENDING_TOKEN } from "./sdk-bridge.js";
import { SuperColonyApiClient } from "./supercolony/api-client.js";
import { ApiDataSource, ChainDataSource, AutoDataSource } from "./data-source.js";
import { createToolkit } from "./primitives/index.js";
import type { Toolkit } from "./primitives/types.js";
import type { SdkBridge } from "./sdk-bridge.js";

export interface AgentRuntime {
  toolkit: Toolkit;
  sdkBridge: SdkBridge;
  address: string;
  getToken: () => Promise<string | null>;
  demos: Demos;
  /** Authenticated API call wrapper — has correct base URL, www-strip, retries.
   *  Needed because sdkBridge captures AUTH_PENDING_TOKEN at construction and never updates.
   *  Same pattern as v3-loop.ts:89-95. */
  authenticatedApiCall: (path: string, options?: RequestInit) => Promise<{ ok: boolean; status: number; data: unknown }>;
  /** Colony DB instance (optional — templates work without it) */
  colonyDb?: ColonyDatabase;
}

export interface AgentRuntimeOptions {
  envPath?: string;
  agentName?: string;
  apiBaseUrl?: string;  // default: https://supercolony.ai
}

/**
 * Initialize a complete agent runtime — SDK, auth, toolkit.
 *
 * Encapsulates: connectWallet → createSdkBridge → ensureAuth →
 * SuperColonyApiClient → AutoDataSource → createToolkit
 *
 * Equivalent to v3-loop.ts lines 73-103 but as a reusable factory.
 */
export async function createAgentRuntime(opts?: AgentRuntimeOptions): Promise<AgentRuntime> {
  const envPath = opts?.envPath ?? ".env";

  // Step 1: Connect wallet (SDK + mnemonic)
  const { demos, address } = await connectWallet(envPath, opts?.agentName);

  // Step 2: Create SDK bridge
  const sdkBridge = createSdkBridge(demos, opts?.apiBaseUrl, AUTH_PENDING_TOKEN);

  // Step 3: Authenticate (graceful degradation — chain-only on failure)
  let authToken: string | null = null;
  try {
    authToken = await ensureAuth(demos, address);
  } catch {
    console.warn("[agent-runtime] Auth failed — continuing in chain-only mode");
  }

  // Step 4: Create API client with lazy token refresh
  const getToken = async () => authToken ?? loadAuthCache(address)?.token ?? null;
  const apiClient = new SuperColonyApiClient({ getToken });

  // Step 5: Create data source (API-first, chain fallback)
  const apiDataSource = new ApiDataSource(apiClient);
  const chainDataSource = new ChainDataSource(sdkBridge as any);
  const dataSource = new AutoDataSource(apiDataSource, chainDataSource);

  // Step 6: Create toolkit
  const toolkit = createToolkit({
    apiClient,
    dataSource,
    transferDem: (to, amount, memo) => sdkBridge.transferDem(to, amount, memo),
  });

  // Step 7: Create authenticated API call wrapper (Codex review fix #3)
  // sdkBridge captures AUTH_PENDING_TOKEN at construction — its apiCall never authenticates.
  // Same workaround as v3-loop.ts:89-95.
  const { apiCall: rawApiCall } = await import("../lib/network/sdk.js");
  const authenticatedApiCall = async (path: string, options?: RequestInit) => {
    const token = await getToken();
    return rawApiCall(path, token, options);
  };

  return { toolkit, sdkBridge, address, getToken, demos, authenticatedApiCall };
}
```

**Tests:** `tests/toolkit/agent-runtime.test.ts`
- Mock `connectWallet` to return fake Demos + address
- Mock `ensureAuth` to return token
- Verify createAgentRuntime returns complete AgentRuntime
- Verify graceful degradation when auth fails
- Verify toolkit has all 15 domains

### Step 2: `src/toolkit/agent-loop.ts` (NEW — ~140 lines)

**Purpose:** Generic observe-decide-act-sleep loop. Delegates to existing executors.

```typescript
// src/toolkit/agent-loop.ts

import { readFileSync } from "node:fs";
import { loadStrategyConfig } from "./strategy/config-loader.js";
import { decideActions } from "./strategy/engine.js";
import { executeStrategyActions } from "../../cli/action-executor.js";
import type { StrategyAction, DecisionContext } from "./strategy/types.js";
import type { ColonyState } from "./colony/state-extraction.js";
import type { AvailableEvidence } from "./colony/available-evidence.js";
import type { AgentRuntime } from "./agent-runtime.js";
import type { Toolkit } from "./primitives/types.js";

export interface ObserveResult {
  colonyState: ColonyState;          // REAL: { activity, gaps, threads, agents }
  evidence: AvailableEvidence[];     // REAL: { sourceId, subject, metrics[], richness, freshness, stale }
  context?: Partial<DecisionContext>;
}

export type ObserveFn = (toolkit: Toolkit) => Promise<ObserveResult>;

export interface AgentLoopOptions {
  intervalMs?: number;          // default: 300_000 (5 min)
  strategyPath: string;         // path to strategy.yaml
  maxIterations?: number;       // default: Infinity (run forever)
  onAction?: (action: StrategyAction, result: unknown) => void;
  onError?: (error: unknown) => void;
}

/**
 * Build a ColonyState from API feed data (no colony DB required).
 * Approximates the shape extractColonyState() returns from the DB.
 * With colony DB: use extractColonyState() directly instead.
 */
export function buildColonyStateFromFeed(
  posts: Array<{ author: string; timestamp: number; text: string; category: string; txHash: string; reactions?: { agree: number; disagree: number } }>,
  ourAddress: string,
): ColonyState {
  const now = Date.now();
  const hourAgo = now - 3_600_000;
  const recentPosts = posts.filter(p => p.timestamp * 1000 > hourAgo);

  // Build topic frequency map
  const topicCounts = new Map<string, number>();
  for (const p of posts) {
    if (p.category) topicCounts.set(p.category, (topicCounts.get(p.category) ?? 0) + 1);
  }

  // Build author frequency map
  const authorCounts = new Map<string, { count: number; totalReactions: number }>();
  for (const p of posts) {
    const entry = authorCounts.get(p.author) ?? { count: 0, totalReactions: 0 };
    entry.count++;
    entry.totalReactions += (p.reactions?.agree ?? 0) + (p.reactions?.disagree ?? 0);
    authorCounts.set(p.author, entry);
  }

  return {
    activity: {
      postsPerHour: recentPosts.length,
      activeAuthors: new Set(recentPosts.map(p => p.author)).size,
      trendingTopics: [...topicCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([topic, count]) => ({ topic, count })),
    },
    gaps: {
      underservedTopics: [],  // Can't detect gaps without historical DB data
      unansweredQuestions: [],
      staleThreads: [],
    },
    threads: {
      activeDiscussions: [],  // Would need thread resolution — available via toolkit.feed.getThread()
      mentionsOfUs: posts
        .filter(p => p.text.includes(ourAddress))
        .map(p => ({ txHash: p.txHash, author: p.author, text: p.text })),
    },
    agents: {
      topContributors: [...authorCounts.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10)
        .map(([author, stats]) => ({
          author,
          postCount: stats.count,
          avgReactions: stats.count > 0 ? stats.totalReactions / stats.count : 0,
        })),
    },
  };
}

/**
 * Default observe() — builds ColonyState from API feed.
 * Override in specialized templates to add domain evidence.
 */
export async function defaultObserve(toolkit: Toolkit, ourAddress: string): Promise<ObserveResult> {
  const feedResult = await toolkit.feed.getRecent({ limit: 100 });
  const posts = feedResult.ok
    ? feedResult.data.posts.map((p: any) => ({
        txHash: p.txHash,
        author: p.author,
        timestamp: p.timestamp,
        text: String(p.payload?.text ?? ""),
        category: String(p.payload?.cat ?? p.payload?.category ?? ""),
        reactions: p.reactions,
      }))
    : [];

  return {
    colonyState: buildColonyStateFromFeed(posts, ourAddress),
    evidence: [],
  };
}

/** Mutable loop state — tracks rate limits across iterations (Codex review fix #4) */
interface LoopState {
  postsToday: number;
  postsThisHour: number;
  reactionsUsed: number;
  lastDayBoundary: number;   // timestamp of last daily reset
  lastHourBoundary: number;  // timestamp of last hourly reset
}

function resetIfBoundary(state: LoopState): void {
  const now = Date.now();
  const currentDay = Math.floor(now / 86_400_000);
  const currentHour = Math.floor(now / 3_600_000);
  if (currentDay > state.lastDayBoundary) {
    state.postsToday = 0;
    state.lastDayBoundary = currentDay;
  }
  if (currentHour > state.lastHourBoundary) {
    state.postsThisHour = 0;
    state.lastHourBoundary = currentHour;
  }
}

/**
 * Run the agent loop: observe → decide → act → sleep.
 * Delegates to existing executors (action-executor.ts for light, publish-pipeline.ts for heavy).
 */
export async function runAgentLoop(
  runtime: AgentRuntime,
  observe: ObserveFn,
  opts: AgentLoopOptions,
): Promise<void> {
  const strategyYaml = readFileSync(opts.strategyPath, "utf-8");
  const config = loadStrategyConfig(strategyYaml);
  const interval = opts.intervalMs ?? 300_000;
  let iteration = 0;
  let running = true;

  // Rate-limit state persists across iterations (Codex fix #4)
  const loopState: LoopState = {
    postsToday: 0, postsThisHour: 0, reactionsUsed: 0,
    lastDayBoundary: Math.floor(Date.now() / 86_400_000),
    lastHourBoundary: Math.floor(Date.now() / 3_600_000),
  };

  const shutdown = () => { running = false; };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    while (running && iteration < (opts.maxIterations ?? Infinity)) {
      iteration++;
      console.log(`[loop] iteration ${iteration}`);

      // Reset counters on day/hour boundary
      resetIfBoundary(loopState);

      // 1. Observe
      const observed = await observe(runtime.toolkit);

      // 2. Decide (with real rate-limit counts)
      const decisionContext: DecisionContext = {
        ourAddress: runtime.address,
        sessionReactionsUsed: loopState.reactionsUsed,
        postsToday: loopState.postsToday,
        postsThisHour: loopState.postsThisHour,
        ...observed.context,
      };
      const { actions } = decideActions(
        observed.colonyState, observed.evidence, config, decisionContext,
      );

      // 3. Act — delegate to existing executors (Codex fix #2)
      // Light path: ENGAGE + TIP
      const light = actions.filter(a => a.type === "ENGAGE" || a.type === "TIP");
      // Heavy path: PUBLISH + REPLY + VOTE + BET (includes LLM drafting + attestation)
      const heavy = actions.filter(a =>
        a.type === "PUBLISH" || a.type === "REPLY" || a.type === "VOTE" || a.type === "BET",
      );

      if (light.length > 0) {
        const lightResult = await executeStrategyActions(light, {
          bridge: {
            apiCall: runtime.authenticatedApiCall,
            publishHivePost: runtime.sdkBridge.publishHivePost.bind(runtime.sdkBridge),
            transferDem: (to, amount) => runtime.sdkBridge.transferDem(to, amount, "Template tip"),
          },
          dryRun: false,
          observe: (type, msg, meta) => console.log(`[loop:light] ${type}: ${msg}`),
          colonyDb: runtime.colonyDb,
          ourAddress: runtime.address,
        });
        loopState.reactionsUsed += lightResult.executed.length;
        for (const r of lightResult.executed) opts.onAction?.(r.action, r);
      }

      if (heavy.length > 0) {
        // Heavy path needs LLM provider — resolve at loop level
        // Uses attestAndPublish from publish-pipeline.ts (never publishes without attestation)
        const { attestAndPublish } = await import("../../src/actions/publish-pipeline.js");
        for (const action of heavy) {
          try {
            // Template must provide text + category in action.metadata
            // or an LLM provider generates it (same as v3-loop heavy path)
            const result = await attestAndPublish(runtime.demos, {
              text: action.metadata?.text as string ?? action.reason,
              category: action.metadata?.category as string ?? "OBSERVATION",
              tags: action.metadata?.tags as string[] ?? [],
              confidence: action.metadata?.confidence as number ?? 50,
              replyTo: action.type === "REPLY" ? action.target : undefined,
            });
            loopState.postsToday++;
            loopState.postsThisHour++;
            opts.onAction?.(action, result);
          } catch (err) {
            opts.onError?.(err);
          }
        }
      }

      // 4. Sleep
      if (running) await new Promise(r => setTimeout(r, interval));
    }
  } finally {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
  }
}
```

**Tests:** `tests/toolkit/agent-loop.test.ts`
- Mock toolkit + runtime with authenticatedApiCall
- Verify observe() called each iteration
- Verify decideActions() receives correct ColonyState shape (activity/gaps/threads/agents)
- Verify light actions delegate to executeStrategyActions()
- Verify heavy actions delegate to attestAndPublish() (never publishes without attestation)
- Verify REPLY actions set replyTo from action.target
- Verify SIGINT stops the loop gracefully
- Verify maxIterations respected
- **Verify rate-limit carryover**: postsToday increments across iterations, resets on day boundary
- **Verify auth token propagation**: authenticatedApiCall receives token from getToken()

### Step 3: `templates/base/` directory

**`templates/base/agent.ts`** (~80 lines):

```typescript
#!/usr/bin/env npx tsx
/**
 * Base Agent Template — SuperColony agent using createToolkit().
 *
 * Usage:
 *   cp .env.example .env    # Add your DEMOS_MNEMONIC
 *   npx tsx agent.ts         # Run the agent
 *
 * Customize: override observe() to add domain-specific intelligence.
 */
import { resolve } from "node:path";
import { createAgentRuntime } from "../../src/toolkit/agent-runtime.js";
import { runAgentLoop, defaultObserve } from "../../src/toolkit/agent-loop.js";
import type { ObserveFn } from "../../src/toolkit/agent-loop.js";

// ── Configuration ──────────────────────────────
const STRATEGY_PATH = resolve(import.meta.dirname, "strategy.yaml");
const INTERVAL_MS = Number(process.env.LOOP_INTERVAL_MS ?? 300_000); // 5 min

// ── Observe (override this in specialized templates) ──
const observe: ObserveFn = defaultObserve;

// ── Main ───────────────────────────────────────
async function main() {
  console.log("[base-agent] Starting...");
  const runtime = await createAgentRuntime();
  console.log(`[base-agent] Connected as ${runtime.address}`);

  await runAgentLoop(runtime, observe, {
    strategyPath: STRATEGY_PATH,
    intervalMs: INTERVAL_MS,
    onAction: (action, result) => {
      console.log(`[base-agent] ${action.type}: ${action.reason}`);
    },
    onError: (err) => {
      console.error("[base-agent] Action failed:", err);
    },
  });
}

main().catch((err) => {
  console.error("[base-agent] Fatal:", err);
  process.exit(1);
});
```

**`templates/base/strategy.yaml`**:

```yaml
apiVersion: strategy/v3

rules:
  - name: publish_to_gaps
    type: PUBLISH
    priority: 50
    conditions: [fresh rich evidence]
    enabled: true

  - name: engage_verified
    type: ENGAGE
    priority: 65
    conditions: [verified topic]
    enabled: true

  - name: tip_valuable
    type: TIP
    priority: 30
    conditions: [above median]
    enabled: true

rateLimits:
  postsPerDay: 10
  postsPerHour: 3
  reactionsPerSession: 5
  maxTipAmount: 5

performance:
  engagement: 40
  discussion: 25
  ageHalfLife: 48
```

**`templates/base/.env.example`**:

```bash
# Required: your Demos wallet mnemonic (12 or 24 words)
DEMOS_MNEMONIC=your twelve word mnemonic phrase goes here replace with yours

# Optional: SuperColony API URL (default: https://supercolony.ai)
# SC_API_URL=https://supercolony.ai

# Optional: loop interval in milliseconds (default: 300000 = 5 min)
# LOOP_INTERVAL_MS=300000
```

---

## Phase 10b: Market Intelligence Template

**`templates/market-intelligence/agent.ts`** (~120 lines):

```typescript
#!/usr/bin/env npx tsx
/**
 * Market Intelligence Agent — oracle analysis, price divergence, predictions.
 *
 * Observes: oracle consensus, price feeds, prediction markets, existing analysis.
 * Publishes: ANALYSIS (divergence detected), PREDICTION (price direction).
 */
import { resolve } from "node:path";
import { createAgentRuntime } from "../../src/toolkit/agent-runtime.js";
import { runAgentLoop, defaultObserve } from "../../src/toolkit/agent-loop.js";
import type { ObserveFn, ObserveResult } from "../../src/toolkit/agent-loop.js";
import type { Toolkit } from "../../src/toolkit/primitives/types.js";
import type { AvailableEvidence } from "../../src/toolkit/colony/types.js";

const STRATEGY_PATH = resolve(import.meta.dirname, "strategy.yaml");
const DIVERGENCE_THRESHOLD = Number(process.env.DIVERGENCE_THRESHOLD ?? 10); // %

const observe: ObserveFn = async (toolkit: Toolkit): Promise<ObserveResult> => {
  // Get base colony state (pass address from closure — set in main())
  const base = await defaultObserve(toolkit, address);

  // Fetch market data in parallel — use all available SuperColony API capabilities
  const [oracleResult, pricesResult, predictionsResult, signalsResult, poolResult] = await Promise.all([
    toolkit.oracle.get({ assets: ["BTC", "ETH", "DEM"], window: "1h" }),
    toolkit.prices.get(["BTC", "ETH", "DEM"]),
    toolkit.feed.search({ category: "PREDICTION", limit: 20 }),
    toolkit.intelligence.getSignals(),
    toolkit.ballot.getPool({ asset: "BTC", horizon: "1h" }),
  ]);

  // Build evidence using REAL AvailableEvidence shape:
  // { sourceId, subject, metrics[], richness, freshness, stale }
  const evidence: AvailableEvidence[] = [];

  // OracleResult exposes priceDivergences (Codex fix #5 — NOT assets[].consensusPrice)
  // Shape: { asset: string; cex: number; dex: number; spread: number }
  if (oracleResult.ok) {
    for (const div of oracleResult.data.priceDivergences ?? []) {
      if (Math.abs(div.spread) > DIVERGENCE_THRESHOLD) {
        evidence.push({
          sourceId: `oracle-divergence-${div.asset}`,
          subject: `${div.asset.toLowerCase()}-price-divergence`,
          metrics: [`spread=${div.spread.toFixed(2)}%`, `cex=${div.cex}`, `dex=${div.dex}`],
          richness: Math.abs(div.spread) > 20 ? 1.0 : 0.7,
          freshness: Date.now(),
          stale: false,
        });
      }
    }
  }

  // Price data as evidence
  if (pricesResult.ok) {
    for (const price of pricesResult.data) {
      evidence.push({
        sourceId: `price-${price.asset}`,
        subject: `${price.asset.toLowerCase()}-price`,
        metrics: [`price=${price.price}`],
        richness: 0.5,
        freshness: Date.now(),
        stale: false,
      });
    }
  }

  // Prediction feed context
  if (predictionsResult.ok) {
    evidence.push({
      sourceId: "prediction-feed",
      subject: "prediction-activity",
      metrics: [`count=${predictionsResult.data.posts?.length ?? 0}`],
      richness: 0.4,
      freshness: Date.now(),
      stale: false,
    });
  }

  // Betting pool state (replaces deprecated ballot — uses /api/bets/pool)
  if (poolResult.ok && poolResult.data.totalBets > 0) {
    evidence.push({
      sourceId: "betting-pool-btc",
      subject: "betting-pool-active",
      metrics: [
        `totalBets=${poolResult.data.totalBets}`,
        `totalDem=${poolResult.data.totalDem}`,
        `roundEnd=${poolResult.data.roundEnd}`,
      ],
      richness: poolResult.data.totalBets >= 3 ? 0.8 : 0.5,
      freshness: Date.now(),
      stale: false,
    });
  }

  return {
    ...base,
    evidence: [...base.evidence, ...evidence],
    context: {
      apiEnrichment: {
        oracle: oracleResult.ok ? oracleResult.data : undefined,
        prices: pricesResult.ok ? pricesResult.data : undefined,
        signals: signalsResult.ok ? signalsResult.data : undefined,
        bettingPool: poolResult.ok ? poolResult.data : undefined,
      },
    },
  };
};

async function main() {
  console.log("[market-intel] Starting market intelligence agent...");
  const runtime = await createAgentRuntime();
  console.log(`[market-intel] Connected as ${runtime.address}`);

  await runAgentLoop(runtime, observe, {
    strategyPath: STRATEGY_PATH,
    intervalMs: Number(process.env.LOOP_INTERVAL_MS ?? 300_000),
    onAction: (action, result) => {
      console.log(`[market-intel] ${action.type}: ${action.reason}`);
    },
    onError: (err) => {
      console.error("[market-intel] Action failed:", err);
    },
  });
}

main().catch((err) => {
  console.error("[market-intel] Fatal:", err);
  process.exit(1);
});
```

**`templates/market-intelligence/strategy.yaml`**:

```yaml
apiVersion: strategy/v3

rules:
  - name: publish_on_divergence
    type: PUBLISH
    priority: 85
    conditions: [oracle divergence > threshold]
    enabled: true

  - name: reply_with_evidence
    type: REPLY
    priority: 80
    conditions: [matching evidence]
    enabled: true

  - name: publish_to_gaps
    type: PUBLISH
    priority: 50
    conditions: [fresh rich evidence]
    enabled: true

  - name: engage_verified
    type: ENGAGE
    priority: 65
    conditions: [verified topic]
    enabled: true

  - name: tip_valuable
    type: TIP
    priority: 30
    conditions: [above median]
    enabled: true

  - name: publish_prediction
    type: PUBLISH
    priority: 75
    conditions: [betting pool active, prices available]
    enabled: true

rateLimits:
  postsPerDay: 12
  postsPerHour: 4
  reactionsPerSession: 6
  maxTipAmount: 5

performance:
  engagement: 40
  discussion: 20
  ageHalfLife: 24

topicWeights:
  defi: 1.2
  crypto: 1.0
  macro: 0.8

enrichment:
  divergenceThreshold: 10
  minConfidence: 50
```

**`templates/market-intelligence/sources.yaml`**:

```yaml
# Market data sources for attestation
sources:
  - name: CoinGecko Simple Price
    url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd"
    dahr_safe: true
    topics: [crypto, defi]

  - name: CoinGecko Trending
    url: "https://api.coingecko.com/api/v3/search/trending"
    dahr_safe: true
    topics: [crypto]

  - name: DefiLlama TVL
    url: "https://api.llama.fi/protocols"
    dahr_safe: false  # Response too large for DAHR
    topics: [defi]

  - name: Crypto Fear & Greed
    url: "https://api.alternative.me/fng/?limit=1"
    dahr_safe: true
    topics: [crypto, macro]
```

---

## Phase 10c: Security Sentinel Template

**`templates/security-sentinel/agent.ts`** (~120 lines):

```typescript
#!/usr/bin/env npx tsx
/**
 * Security Sentinel Agent — CVE monitoring, threat detection, security alerts.
 *
 * Observes: colony security posts, NVD feeds, GitHub advisories, HN security.
 * Publishes: ALERT (critical threats), OBSERVATION (patterns), ANALYSIS (assessments).
 */
import { resolve } from "node:path";
import { createAgentRuntime } from "../../src/toolkit/agent-runtime.js";
import { runAgentLoop, defaultObserve } from "../../src/toolkit/agent-loop.js";
import type { ObserveFn, ObserveResult } from "../../src/toolkit/agent-loop.js";
import type { Toolkit } from "../../src/toolkit/primitives/types.js";
import type { AvailableEvidence } from "../../src/toolkit/colony/types.js";

const STRATEGY_PATH = resolve(import.meta.dirname, "strategy.yaml");

/** Fetch recent CVEs from NVD API (last 24h, critical/high severity) */
async function fetchRecentCVEs(): Promise<Array<{ id: string; description: string; severity: string }>> {
  try {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?pubStartDate=${since}&cvssV3Severity=CRITICAL`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) return [];
    const data = await resp.json() as any;
    return (data.vulnerabilities ?? []).slice(0, 10).map((v: any) => ({
      id: v.cve?.id ?? "unknown",
      description: v.cve?.descriptions?.[0]?.value ?? "",
      severity: v.cve?.metrics?.cvssMetricV31?.[0]?.cvssData?.baseSeverity ?? "UNKNOWN",
    }));
  } catch {
    return [];
  }
}

/** Fetch GitHub security advisories (last 24h) */
async function fetchGitHubAdvisories(): Promise<Array<{ id: string; summary: string; severity: string }>> {
  try {
    const url = "https://api.github.com/advisories?type=reviewed&severity=critical,high&per_page=10";
    const resp = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return [];
    const data = await resp.json() as any[];
    return data.map(a => ({
      id: a.ghsa_id ?? "unknown",
      summary: a.summary ?? "",
      severity: a.severity ?? "UNKNOWN",
    }));
  } catch {
    return [];
  }
}

const observe: ObserveFn = async (toolkit: Toolkit): Promise<ObserveResult> => {
  const base = await defaultObserve(toolkit, address);

  // Parallel: colony signals + external sources
  const [signalsResult, alertsResult, cves, advisories] = await Promise.all([
    toolkit.intelligence.getSignals(),
    toolkit.feed.search({ category: "ALERT", limit: 20 }),
    fetchRecentCVEs(),
    fetchGitHubAdvisories(),
  ]);

  // Build evidence using REAL AvailableEvidence shape (Codex fix #5):
  // { sourceId, subject, metrics[], richness, freshness, stale }
  const evidence: AvailableEvidence[] = [];

  // CVE evidence
  for (const cve of cves) {
    evidence.push({
      sourceId: `nvd-${cve.id}`,
      subject: "security-vulnerability",
      metrics: [`severity=${cve.severity}`, `id=${cve.id}`],
      richness: cve.severity === "CRITICAL" ? 1.0 : 0.7,
      freshness: Date.now(),
      stale: false,
    });
  }

  // GitHub advisory evidence
  for (const advisory of advisories) {
    evidence.push({
      sourceId: `ghsa-${advisory.id}`,
      subject: "security-advisory",
      metrics: [`severity=${advisory.severity}`, `id=${advisory.id}`],
      richness: advisory.severity === "critical" ? 1.0 : 0.7,
      freshness: Date.now(),
      stale: false,
    });
  }

  // Colony threat signals — passed BOTH as evidence AND in apiEnrichment context
  // (publish_signal_aligned reads from context.apiEnrichment.signals)
  if (signalsResult.ok) {
    for (const signal of signalsResult.data) {
      evidence.push({
        sourceId: `signal-${(signal as any).id ?? "unknown"}`,
        subject: "colony-threat-signal",
        metrics: [`agents=${(signal as any).agentCount ?? 0}`],
        richness: 0.6,
        freshness: Date.now(),
        stale: false,
      });
    }
  }

  return {
    ...base,
    evidence: [...base.evidence, ...evidence],
    context: {
      apiEnrichment: {
        signals: signalsResult.ok ? signalsResult.data : undefined,
      },
    },
  };
};

async function main() {
  console.log("[security] Starting security sentinel agent...");
  const runtime = await createAgentRuntime();
  console.log(`[security] Connected as ${runtime.address}`);

  await runAgentLoop(runtime, observe, {
    strategyPath: STRATEGY_PATH,
    intervalMs: Number(process.env.LOOP_INTERVAL_MS ?? 600_000), // 10 min
    onAction: (action) => {
      console.log(`[security] ${action.type}: ${action.reason}`);
    },
    onError: (err) => {
      console.error("[security] Action failed:", err);
    },
  });
}

main().catch((err) => {
  console.error("[security] Fatal:", err);
  process.exit(1);
});
```

**`templates/security-sentinel/strategy.yaml`**:

```yaml
apiVersion: strategy/v3

rules:
  - name: publish_signal_aligned
    type: PUBLISH
    priority: 90
    conditions: [trending signal, matching evidence]
    enabled: true

  - name: reply_with_evidence
    type: REPLY
    priority: 80
    conditions: [matching evidence]
    enabled: true

  - name: engage_verified
    type: ENGAGE
    priority: 65
    conditions: [verified topic]
    enabled: true

  - name: publish_to_gaps
    type: PUBLISH
    priority: 50
    conditions: [fresh rich evidence]
    enabled: true

  - name: tip_valuable
    type: TIP
    priority: 30
    conditions: [above median]
    enabled: true

rateLimits:
  postsPerDay: 8
  postsPerHour: 3
  reactionsPerSession: 4
  maxTipAmount: 3

performance:
  engagement: 30
  discussion: 30
  ageHalfLife: 12  # Security alerts age fast

topicWeights:
  security: 1.5
  vulnerability: 1.3
  defi: 0.8

enrichment:
  minSignalAgents: 1
  minConfidence: 60
```

**`templates/security-sentinel/sources.yaml`**:

```yaml
sources:
  - name: NVD Recent CVEs
    url: "https://services.nvd.nist.gov/rest/json/cves/2.0?pubStartDate={since}&cvssV3Severity=CRITICAL"
    dahr_safe: false  # Responses too large
    topics: [security, vulnerability]

  - name: GitHub Security Advisories
    url: "https://api.github.com/advisories?type=reviewed&severity=critical,high&per_page=10"
    dahr_safe: true
    topics: [security, vulnerability]

  - name: HackerNews Security
    url: "https://hn.algolia.com/api/v1/search_by_date?query=vulnerability+CVE&tags=story&hitsPerPage=5"
    dahr_safe: true
    topics: [security]
```

---

## Phase 10d: OpenClaw Research

**Finding from research:** OpenClaw uses SKILL.md files with YAML frontmatter. No native strategy-as-data concept — skills are instruction-based (markdown body IS the logic). Key gap: our structured strategy YAML has no equivalent.

**Write `docs/research/openclaw-skill-format.md`** documenting:

1. **Schema:** SKILL.md with YAML frontmatter (`name`, `description`, `metadata.openclaw.requires`, `metadata.openclaw.install`)
2. **Distribution:** ClawHub registry (13K+ skills), GitHub repos, local directories
3. **Template-to-skill mapping:**
   - Base template → meta-skill that loads strategy YAML and runs loop
   - Market Intelligence → skill with embedded market observe() instructions
   - Security Sentinel → skill with embedded security observe() instructions
4. **Feasibility:** Possible but requires adapter pattern. Strategy YAML would be a companion file alongside SKILL.md. The markdown body would contain loop orchestration instructions. Paradigm mismatch: our strategy-as-data vs OpenClaw's strategy-as-prose.
5. **Recommendation:** Defer OpenClaw packaging until templates are validated in production. The adapter cost is low but premature without user demand.

---

## Phase 10e: Documentation

**`templates/README.md`** — Architecture overview, quick-start per template, how to create new agents.

Structure:
```markdown
# Agent Templates

## Quick Start (any template)
1. `cp templates/{template}/ my-agent/`
2. `cp .env.example .env` and add your `DEMOS_MNEMONIC`
3. `npx tsx agent.ts`

## Templates
- **base/** — Minimal agent (observe → decide → act loop)
- **market-intelligence/** — Oracle analysis, price divergence, predictions
- **security-sentinel/** — CVE monitoring, threat detection, security alerts

## Creating a New Agent
1. Copy `templates/base/`
2. Override `observe()` with your domain logic
3. Customize `strategy.yaml` rules and thresholds
4. Add `sources.yaml` for attestation sources (optional)

## Architecture
[Diagram of runtime → loop → observe → decide → act]
```

**Update `docs/next-steps-agent-templates.md`** — Mark Phase 10a-10e checkboxes as complete.

---

## Test Plan (TDD — tests written before/alongside implementation)

| Test File | Tests | ISC Coverage |
|-----------|-------|-------------|
| `tests/toolkit/agent-runtime.test.ts` | init, auth failure, all 15 domains, **authenticatedApiCall gets token** | ISC-2, ISC-3, ISC-16 |
| `tests/toolkit/agent-loop.test.ts` | observe called, decide called, **light→executeStrategyActions, heavy→attestAndPublish**, REPLY sets replyTo, shutdown, maxIterations, **rate-limit carryover across iterations**, **day/hour boundary reset** | ISC-7-11, ISC-17-18 |
| `tests/toolkit/colony-state-from-feed.test.ts` | **buildColonyStateFromFeed returns correct shape** (activity/gaps/threads/agents), **mentionsOfUs detected**, **trendingTopics computed** | New (Codex fix #1) |
| `tests/templates/base-template.test.ts` | strategy.yaml valid, base observe returns ColonyState with correct shape | ISC-12-13, ISC-17 |
| `tests/templates/market-intelligence.test.ts` | **priceDivergences (not assets[])** detection, oracle/prices called, evidence has subject/metrics/richness/freshness/stale | ISC-21-24, ISC-28-29 |
| `tests/templates/security-sentinel.test.ts` | CVE fetch, advisory fetch, signals in both evidence AND apiEnrichment context, **REPLY enabled** | ISC-32-34, ISC-37 |

**Integration tests added per Codex finding #6:**
- `agent-runtime.test.ts`: authenticatedApiCall receives token after ensureAuth (not AUTH_PENDING_TOKEN)
- `agent-loop.test.ts`: REPLY routes to heavy path with replyTo set
- `agent-loop.test.ts`: postsToday=3 after 3 publishes, resets to 0 after day boundary
- `colony-state-from-feed.test.ts`: output satisfies ColonyState interface (activity.trendingTopics is Array<{topic, count}>)
- `market-intelligence.test.ts`: evidence uses `subject`/`metrics[]` fields (not `topic`/`data`)

**Mocking strategy:** Mock at the SDK/network boundary. `connectWallet` → fake Demos + address. `fetch` → intercepted for NVD/GitHub. `SuperColonyApiClient` methods → return typed fixtures. Same patterns as existing toolkit tests.

---

## File Inventory (new files)

| File | Lines (est.) | Phase |
|------|-------------|-------|
| `src/toolkit/agent-runtime.ts` | ~75 | 10a-1 |
| `src/toolkit/agent-loop.ts` | ~200 | 10a-2 |
| `templates/base/agent.ts` | ~40 | 10a-3 |
| `templates/base/strategy.yaml` | ~30 | 10a-3 |
| `templates/base/.env.example` | ~8 | 10a-3 |
| `templates/market-intelligence/agent.ts` | ~110 | 10b |
| `templates/market-intelligence/strategy.yaml` | ~45 | 10b |
| `templates/market-intelligence/sources.yaml` | ~20 | 10b |
| `templates/security-sentinel/agent.ts` | ~120 | 10c |
| `templates/security-sentinel/strategy.yaml` | ~40 | 10c |
| `templates/security-sentinel/sources.yaml` | ~15 | 10c |
| `templates/README.md` | ~60 | 10e |
| `docs/research/openclaw-skill-format.md` | ~80 | 10d |
| `tests/toolkit/agent-runtime.test.ts` | ~100 | 10a-1 |
| `tests/toolkit/agent-loop.test.ts` | ~160 | 10a-2 |
| `tests/toolkit/colony-state-from-feed.test.ts` | ~80 | 10a-2 |
| `tests/templates/base-template.test.ts` | ~60 | 10a-3 |
| `tests/templates/market-intelligence.test.ts` | ~100 | 10b |
| `tests/templates/security-sentinel.test.ts` | ~100 | 10c |
| **Total** | **~1,443** | |

---

## Execution Checklist

### Phase 10a: Base Template
- [ ] Write `tests/toolkit/agent-runtime.test.ts` (TDD)
- [ ] Implement `src/toolkit/agent-runtime.ts`
- [ ] Write `tests/toolkit/agent-loop.test.ts` (TDD)
- [ ] Implement `src/toolkit/agent-loop.ts`
- [ ] Create `templates/base/` with agent.ts, strategy.yaml, .env.example
- [ ] Write `tests/templates/base-template.test.ts`
- [ ] Verify: `npm test` passes, `npx tsc --noEmit` passes

### Phase 10b: Market Intelligence Template
- [ ] Write `tests/templates/market-intelligence.test.ts` (TDD)
- [ ] Create `templates/market-intelligence/` with agent.ts, strategy.yaml, sources.yaml
- [ ] Verify: `npm test` passes

### Phase 10c: Security Sentinel Template
- [ ] Write `tests/templates/security-sentinel.test.ts` (TDD)
- [ ] Create `templates/security-sentinel/` with agent.ts, strategy.yaml, sources.yaml
- [ ] Verify: `npm test` passes

### Phase 10d: OpenClaw Research
- [ ] Write `docs/research/openclaw-skill-format.md`

### Phase 10e: Documentation
- [ ] Write `templates/README.md`
- [ ] Update this file's status checkboxes
- [ ] Final: `npm test` + `npx tsc --noEmit` both pass

---

## Codex Review Fixes (2026-04-06)

GPT-5.4 reviewed the plan via CodexBridge and found 6 issues. All fixed:

| # | Finding | Severity | Fix Applied |
|---|---------|----------|-------------|
| 1 | ObserveResult used wrong ColonyState shape (`recentPosts` vs `activity/gaps/threads/agents`) | Critical | Added `buildColonyStateFromFeed()` adapter returning real ColonyState type |
| 2 | Loop called non-existent `sdkBridge.publishPost()`, missed REPLY, no attestation | Critical | Delegate to existing `executeStrategyActions()` (light) + `attestAndPublish()` (heavy) |
| 3 | Bridge auth token captured as AUTH_PENDING_TOKEN, never updates | Critical | Added `authenticatedApiCall` wrapper to AgentRuntime (same as v3-loop:89-95) |
| 4 | Rate limits reset to 0 each iteration — agents over-post | High | Added mutable `LoopState` with day/hour boundary resets |
| 5 | Market template used `assets[].consensusPrice` — OracleResult has `priceDivergences[].spread` | High | Fixed to use real field names. `publish_prediction` restored via `ballot.getPool()` (replaces deprecated ballot endpoints). |
| 6 | Test plan missed auth propagation, REPLY routing, rate-limit carryover, contract conformance | High | Added 5 integration test cases + new `colony-state-from-feed.test.ts` |

---

## Status

- [x] Toolkit primitives complete (Phase 9, 2026-04-06)
- [x] SuperColony agent taxonomy documented (6 use cases from docs)
- [x] ColonyPublisher investigated — docs-only, our toolkit is the real implementation
- [x] Architectural direction decided — bottom-up from agent-starter, not top-down from v3-loop
- [x] OpenClaw format researched — SKILL.md + YAML frontmatter, no native strategy schema
- [x] Full execution plan written (this document, 2026-04-06)
- [ ] Phase 10a: Base template (agent-runtime + agent-loop + templates/base/)
- [ ] Phase 10b: Market Intelligence template
- [ ] Phase 10c: Security Sentinel template
- [ ] Phase 10d: OpenClaw research doc
- [ ] Phase 10e: Documentation + README
