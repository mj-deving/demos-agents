# Phase 5: Agent Composition Framework — Design Plan

> **Status:** COMPLETE (implemented 2026-03-20 evening: Phase 0 + Phase 5)
> **Author:** PAI Algorithm + Codex review
> **Date:** 2026-03-20
> **Depends on:** Phases 1-4 (complete)

---

## The Vision

**Today:** Adding a new agent requires modifying `session-runner.ts` (~200 lines of `registerHook()` calls), updating `KNOWN_EXTENSIONS`, and manually wiring auth/wallet/LLM into closures.

**After Phase 5:** A new agent is a YAML file. The skill loader reads `AGENT.yaml → capabilities.skills`, resolves each to a plugin factory, topologically sorts by dependencies, injects runtime context, and wires hooks. Zero code changes.

---

## Design Principles (from first principles + creative analysis)

### 1. The Silencing Principle (Biology: Epigenetics)

The skill manifest contains ALL capabilities — like a species genome. Each agent's YAML is an **epigenetic mask** that silences what the agent shouldn't express. Mental model: you don't build up from nothing, you sculpt down from everything.

**Practical implication:** `capabilities.skills: [supercolony, sc-oracle]` means "activate these, silence everything else." A new agent with `skills: [all]` or no skills field gets everything — then specializes by pruning.

### 2. The Score Principle (Music: Orchestration)

Skills don't just declare WHAT they do — they declare WHEN they enter (which hooks) and in what ORDER relative to other skills at the same hook point. The loader orchestrates entrances like a conductor reading a score.

**Practical implication:** The manifest includes `hookPriority` per hook — e.g., `calibrate` at priority 10 (first), `sources` at 50 (middle), `tips` at 90 (last). Two plugins on `beforeSense` execute in priority order, not random.

### 3. The Stigmergy Principle (Complex Systems: Ant Colonies)

Plugins NEVER call each other directly. All inter-plugin communication happens through session state — like ants coordinating via pheromone trails. Plugin A writes to state; Plugin B reads from state later.

**Practical implication:** The `V2SessionState` schema IS the inter-plugin API contract. Adding/removing a plugin doesn't break others because they depend on state shape, not on each other's existence.

---

## Architecture

### New Type Definitions

```typescript
// src/lib/skill-manifest.ts (NEW FILE)

/**
 * SkillManifest — the "genome" of available skills.
 * Maps skill names to their factory functions, dependencies, and hook declarations.
 */
export interface SkillEntry {
  /** Skill name as referenced in AGENT.yaml capabilities.skills */
  name: string;
  /** Human-readable description */
  description: string;
  /** Factory function that creates the FrameworkPlugin instance */
  factory: () => Promise<FrameworkPlugin>;
  /** Skills that must be initialized before this one (topological sort) */
  dependencies: string[];
  /** Which lifecycle hooks this skill provides, with priority (lower = earlier) */
  hooks: Record<string, { priority: number }>;
  /** Whether this skill requires auth token at init time */
  requiresAuth: boolean;
  /** Whether this skill requires wallet at init time */
  requiresWallet: boolean;
  /** Optional: config schema hint for validation */
  configKey?: string;
}

export type SkillManifest = Map<string, SkillEntry>;
```

```typescript
// src/lib/skill-loader.ts (NEW FILE)

/**
 * SkillLoader — reads AGENT.yaml, resolves skills from manifest,
 * topologically sorts by dependencies, initializes with context.
 */
export interface SkillContext {
  config: AgentConfig;
  llm: LLMProvider | null;
  authToken: string | null;
  wallet: WalletContext | null;
  state: V2SessionState;
}

export interface LoadedSkill {
  entry: SkillEntry;
  plugin: FrameworkPlugin;
  initDuration: number;
}

export interface SkillLoadResult {
  loaded: LoadedSkill[];
  failed: Array<{ name: string; error: string }>;
  skipped: Array<{ name: string; reason: string }>;
  totalDuration: number;
}
```

### The Skill Manifest (Concrete Mapping)

```typescript
// src/lib/skill-manifest.ts — THE MANIFEST

const MANIFEST: SkillManifest = new Map([
  // ── Session Loop Skills ──────────────────────
  ["calibrate", {
    name: "calibrate",
    description: "Prediction calibration offset from historical accuracy",
    factory: () => import("../plugins/calibrate-plugin.js").then(m => m.createCalibratePlugin()),
    dependencies: [],
    hooks: { beforeSense: { priority: 10 } },
    requiresAuth: false,
    requiresWallet: false,
  }],
  ["sources", {
    name: "sources",
    description: "Source preflight, matching, and discovery for publish pipeline",
    factory: () => import("../plugins/sources-plugin.js").then(m => m.createSourcesPlugin()),
    dependencies: [],
    hooks: { beforePublishDraft: { priority: 50 }, afterPublishDraft: { priority: 50 } },
    requiresAuth: false,
    requiresWallet: false,
  }],
  ["observe", {
    name: "observe",
    description: "LLM-powered observation synthesis for SENSE phase",
    factory: () => import("../plugins/observe-plugin.js").then(m => m.createObservePlugin()),
    dependencies: [],
    hooks: { /* inline in scan, not hooked */ },
    requiresAuth: false,
    requiresWallet: false,
  }],
  ["signals", {
    name: "signals",
    description: "Feed signal analysis — trending, controversial, gaps",
    factory: () => import("../plugins/signals-plugin.js").then(m => m.createSignalsPlugin()),
    dependencies: [],
    hooks: { beforeSense: { priority: 30 } },
    requiresAuth: true,
    requiresWallet: false,
  }],
  ["predictions", {
    name: "predictions",
    description: "Prediction tracking and resolution",
    factory: () => import("../plugins/predictions-plugin.js").then(m => m.createPredictionsPlugin()),
    dependencies: ["signals"],
    hooks: { beforeSense: { priority: 40 }, afterConfirm: { priority: 50 } },
    requiresAuth: true,
    requiresWallet: false,
  }],
  ["tips", {
    name: "tips",
    description: "DEM tipping for high-quality posts",
    factory: () => import("../plugins/tips-plugin.js").then(m => m.createTipsPlugin()),
    dependencies: ["sdk-setup"],
    hooks: { beforeSense: { priority: 50 }, afterAct: { priority: 80 } },
    requiresAuth: true,
    requiresWallet: true,
  }],
  ["lifecycle", {
    name: "lifecycle",
    description: "Source lifecycle management — quarantine, degrade, promote",
    factory: () => import("../plugins/lifecycle-plugin.js").then(m => m.createLifecyclePlugin()),
    dependencies: ["sources"],
    hooks: { beforeSense: { priority: 60 } },
    requiresAuth: false,
    requiresWallet: false,
  }],
  // ── SuperColony API Skills ───────────────────
  ["sc-oracle", {
    name: "sc-oracle",
    description: "SuperColony oracle data — consensus, trending, agent rankings",
    factory: () => import("../plugins/sc-oracle-plugin.js").then(m => m.createSCOraclePlugin()),
    dependencies: [],
    hooks: { beforeSense: { priority: 70 } },
    requiresAuth: true,
    requiresWallet: false,
  }],
  ["sc-prices", {
    name: "sc-prices",
    description: "On-chain price feeds via SuperColony API",
    factory: () => import("../plugins/sc-prices-plugin.js").then(m => m.createSCPricesPlugin()),
    dependencies: [],
    hooks: { beforeSense: { priority: 75 } },
    requiresAuth: true,
    requiresWallet: false,
  }],
  ["sc-predictions-markets", {
    name: "sc-predictions-markets",
    description: "Prediction market data from SuperColony",
    factory: () => import("../plugins/sc-predictions-markets-plugin.js").then(m => m.createSCPredictionsMarketsPlugin()),
    dependencies: ["sc-oracle"],
    hooks: { beforeSense: { priority: 76 } },
    requiresAuth: true,
    requiresWallet: false,
  }],
  // ── Omniweb Skills ───────────────────────────
  ["network-health", {
    name: "network-health",
    description: "Demos network node health monitoring",
    factory: () => import("../plugins/network-health-plugin.js").then(m => m.createNetworkHealthPlugin()),
    dependencies: ["sdk-setup"],
    hooks: { beforeSense: { priority: 80 } },
    requiresAuth: false,
    requiresWallet: false,
  }],
  ["chain-query", {
    name: "chain-query",
    description: "Cross-chain balance and transaction queries",
    factory: () => import("../plugins/chain-query-plugin.js").then(m => m.createChainQueryPlugin()),
    dependencies: ["sdk-setup"],
    hooks: { beforeSense: { priority: 81 } },
    requiresAuth: false,
    requiresWallet: false,
  }],
  ["address-watch", {
    name: "address-watch",
    description: "Wallet activity pattern monitoring",
    factory: () => import("../plugins/address-watch-plugin.js").then(m => m.createAddressWatchPlugin()),
    dependencies: ["sdk-setup", "chain-query"],
    hooks: { beforeSense: { priority: 82 } },
    requiresAuth: false,
    requiresWallet: false,
  }],
  ["cci-identity", {
    name: "cci-identity",
    description: "Cross-chain identity resolution",
    factory: () => import("../plugins/cci-identity-plugin.js").then(m => m.createCCIIdentityPlugin()),
    dependencies: ["sdk-setup"],
    hooks: { beforeSense: { priority: 83 } },
    requiresAuth: false,
    requiresWallet: false,
  }],
  ["tlsn-attest", {
    name: "tlsn-attest",
    description: "TLSN MPC-TLS attestation pipeline",
    factory: () => import("../plugins/tlsn-attest-plugin.js").then(m => m.createTlsnAttestPlugin()),
    dependencies: [],
    hooks: { afterPublishDraft: { priority: 30 } },
    requiresAuth: false,
    requiresWallet: false,
    configKey: "attestation",
  }],
  // ── Infrastructure Skills ────────────────────
  ["sdk-setup", {
    name: "sdk-setup",
    description: "Demos SDK initialization and connection management",
    factory: () => import("../plugins/sdk-setup-plugin.js").then(m => m.createSdkSetupPlugin()),
    dependencies: [],
    hooks: {},
    requiresAuth: false,
    requiresWallet: false,
  }],
  ["demos-wallet", {
    name: "demos-wallet",
    description: "Demos wallet management and balance queries",
    factory: () => import("../plugins/demos-wallet-plugin.js").then(m => m.createDemosWalletPlugin()),
    dependencies: ["sdk-setup"],
    hooks: {},
    requiresAuth: false,
    requiresWallet: false,
  }],
  ["demoswork", {
    name: "demoswork",
    description: "DemosWork storage program operations",
    factory: () => import("../plugins/demoswork-plugin.js").then(m => m.createDemosWorkPlugin()),
    dependencies: ["sdk-setup"],
    hooks: {},
    requiresAuth: false,
    requiresWallet: true,
  }],
]);
```

### Skill Loader Algorithm

```
LOAD(agentYaml, manifest, context):
  1. Read agentYaml.capabilities.skills → skillNames[]
  2. For each name: look up in manifest → entries[]
     - If not found: add to failed[] with "unknown skill"
  3. Topological sort entries[] by dependencies
     - Cycle detection: if cycle found, add all cycle members to failed[]
  4. For each entry in sorted order:
     a. If requiresAuth && !context.authToken → add to skipped[] ("no auth")
     b. If requiresWallet && !context.wallet → add to skipped[] ("no wallet")
     c. If any dependency in failed[] or skipped[] → add to skipped[] ("dependency unavailable")
     d. Else: await entry.factory() → plugin
        - await plugin.init(context.config, context.llm)
        - Record initDuration
        - Add to loaded[]
  5. Wire hooks:
     For each loaded plugin:
       For each hook declared in manifest entry:
         Register plugin's hook function at declared priority
     Sort each hook point's handlers by priority (ascending)
  6. Return { loaded, failed, skipped, totalDuration }
```

**Key properties:**
- **Lazy dynamic imports** — plugins only loaded when an agent declares them (`import()`)
- **Graceful degradation** — failed/skipped plugins don't crash the agent; they're reported
- **Deterministic ordering** — topological sort + priority = same behavior every run
- **No double registration** — loader replaces `registerHook()` entirely

### Scope Enforcement

```typescript
// Added to SkillContext or as wrapper
interface ScopePolicy {
  /** Skills this agent declared — anything else is out-of-scope */
  declaredSkills: Set<string>;
  /** Enforcement mode */
  mode: "warn" | "block" | "off";
}

// In hook dispatcher:
function runHook(hookName, ctx, scopePolicy) {
  for (const handler of sortedHandlers[hookName]) {
    if (!scopePolicy.declaredSkills.has(handler.skillName)) {
      if (scopePolicy.mode === "warn") {
        log.warn(`Scope violation: ${handler.skillName} not declared for agent ${ctx.config.name}`);
      }
      if (scopePolicy.mode === "block") continue;
    }
    await handler.fn(ctx);
  }
}
```

### Plugin Config Injection

Per-agent plugin settings via a `skillConfig` section in persona.yaml:

```yaml
# agents/sentinel/persona.yaml (existing file, new section)
skillConfig:
  sc-prices:
    pairs: [DEM/USDT, BTC/USDT]
    staleThresholdMinutes: 60
  tips:
    dryRun: true
    maxPerSession: 3
  tlsn-attest:
    maxRecvData: 16384
```

The loader passes `skillConfig[skillName]` to `plugin.init()` as an optional third argument:

```typescript
// Extended FrameworkPlugin.init signature (backward compatible)
init?(config: AgentConfig, llm?: LLMProvider, skillConfig?: Record<string, unknown>): Promise<void>;
```

### Event Runner Integration

Currently `event-runner.ts` uses `EventPlugin` — a separate type from `FrameworkPlugin`. Unification:

```typescript
// Add optional event handling to FrameworkPlugin
export interface FrameworkPlugin {
  // ... existing fields ...

  /** Event handlers — for reactive/event-runner mode */
  eventHandlers?: Record<string, EventHandlerFn>;

  /** Event sources — what events this plugin can produce */
  eventSources?: EventSourceFactory[];
}
```

The skill loader works identically for both runners:
- `session-runner` calls `loadSkills()` → wires `hooks`
- `event-runner` calls `loadSkills()` → wires `eventHandlers` + starts `eventSources`

### Migration Path (Revised per Codex Review)

**CRITICAL PREREQUISITE — Phase 0: Internalize Hook Logic (2-3 sessions)**

Codex found that many plugin files are empty shells — the real hook logic lives in `registerHook()` closures in session-runner.ts:3550+. Before the loader can replace registerHook(), each plugin must contain its own logic.

1. For each of the 9 session-loop extensions (calibrate, sources, observe, signals, predictions, tips, lifecycle, sc-oracle, sc-prices):
   - Move the closure logic from session-runner.ts INTO the plugin's `hooks` field
   - Plugin factories that currently take zero args but need runtime deps (sc-oracle, sdk-setup, tlsn-attest) → refactor to accept deps via `init()` instead of factory constructor
   - Test: each plugin works standalone with `plugin.hooks.beforeSense(ctx)` etc.
2. Normalize factory signatures: all factories take zero args. Runtime deps injected via `init(config, llm, skillConfig)`.
3. Tests confirm identical behavior with logic in plugins vs. in session-runner closures.

**Phase A: Shadow Loading (1 session)**
1. Add `skill-manifest.ts` and `skill-loader.ts`
2. `session-runner` calls `loadSkills()` AND keeps `registerHook()` block — shadow mode
3. Compare: log which hooks loader would wire vs. which are actually registered
4. Fix any mismatches (dependency graph corrections, missing manifest entries)
5. Add `supercolony` entry to manifest (Codex caught this missing entry)

**Phase B: Cutover (1 session)**
1. Populate all AGENT.yaml with explicit skills (same list as before)
2. `loadAgentConfig()` reads AGENT.yaml `capabilities.skills` — precedence: AGENT.yaml skills > persona.yaml loopExtensions
3. `session-runner` uses loader hooks INSTEAD of registerHook() block
4. Regression test: run each agent in --dry-run, compare session output

**Phase C: Event Runner (1 session)**
1. Normalize EventPlugin.init() to match FrameworkPlugin.init() (Codex found signature mismatch at types.ts:352)
2. Add `eventHandlers` + `eventSources` to FrameworkPlugin
3. event-runner uses same `loadSkills()` for handler wiring
4. This is a SEPARATE rewrite from session-runner (Codex: "same loader for both runners" is a separate rewrite)

**Phase D: Cleanup (1 session)**
1. Remove `registerHook()` block from session-runner (~200 lines deleted)
2. Remove `KNOWN_EXTENSIONS` from state.ts
3. Remove `loopExtensions` from AgentConfig type
4. Remove `loopExtensions` from persona.yaml files
5. Update docs

### Codex Review Findings — Incorporated

| # | Finding | Impact | Resolution |
|---|---------|--------|------------|
| 1 | Plugin files are empty shells — logic is in session-runner closures | **Critical** — loader without logic = behavior regression | Added Phase 0: internalize hook logic into plugins first |
| 2 | Dependency edges are conceptual, not real (predictions→signals, lifecycle→sources, tips→sdk-setup) | **Medium** — false deps cause unnecessary skips | Remove false edges. Only encode REAL runtime deps (e.g., wallet needs SDK connection). Most plugins are independent. |
| 3 | `supercolony` skill missing from manifest but referenced in all AGENT.yaml | **High** — every agent fails to load | Add `supercolony` entry to manifest (the core SC publishing skill) |
| 4 | Factory functions take runtime deps at constructor time, not init() | **High** — manifest calls factories with zero args → break | Phase 0 refactors factories to zero-arg + deps via init() |
| 5 | EventPlugin.init() has different signature from FrameworkPlugin.init() | **Medium** — "one loader" claim is false | Separated into Phase C with explicit signature normalization |
| 6 | Phase A "INSTEAD of registerHook()" is unsafe — immediate behavior loss | **Critical** — production break | Changed to shadow mode: load + compare before cutover |
| 7 | Scope enforcement redundant after cutover — loader only wires declared skills | **Low** — wasted code | Replace runtime scope check with fail-fast validation: unknown skills, missing manifest entries, AGENT/persona mismatch |
| 8 | Omniweb plugins (chain-query, address-watch, cci-identity) are scaffolds/blockers | **Info** — nexus migration graph assigns non-functional skills | Mark blocked skills in manifest with `status: "blocked"` field. Loader warns but doesn't fail. |

### Revised Dependency Graph (Codex-corrected)

```
calibrate     → (none)              # Independent — reads prediction history
sources       → (none)              # Independent — reads catalog
observe       → (none)              # Independent — LLM synthesis
signals       → (none)              # Independent — reads auth token via context
predictions   → (none)              # Independent — reads auth + prediction store (NOT signals)
tips          → (none)              # Independent — calls connectWallet() directly (NOT sdk-setup)
lifecycle     → (none)              # Independent — edits catalog directly (NOT sources)
sc-oracle     → (none)              # Independent — reads auth token via context
sc-prices     → (none)              # Independent — reads auth token via context
sc-predictions-markets → (none)     # Independent — reads auth token via context
sdk-setup     → (none)              # Infrastructure — SDK connection
demos-wallet  → sdk-setup           # REAL dep — needs SDK connection
network-health → sdk-setup          # REAL dep — needs SDK connection
chain-query   → sdk-setup           # REAL dep — needs SDK connection (BLOCKED)
address-watch → sdk-setup           # REAL dep — needs SDK connection (BLOCKED)
cci-identity  → sdk-setup           # REAL dep — needs SDK connection (BLOCKED)
tlsn-attest   → (none)              # Independent — Playwright-based
demoswork     → sdk-setup           # REAL dep — needs SDK connection (BLOCKED)
```

Most session-loop plugins are INDEPENDENT — they get auth/wallet from context, not from other plugins. Only SDK-dependent omniweb plugins have real deps.

### Testable Hypotheses

**Hypothesis H1:** After Phase D, creating a new agent named `test-agent` requires ONLY:
1. `mkdir agents/test-agent`
2. Write `agents/test-agent/AGENT.yaml` with `capabilities.skills: [supercolony, calibrate, sources, sc-oracle]`
3. Write `agents/test-agent/persona.yaml` with topics + gate thresholds
4. Run `npx tsx cli/session-runner.ts --agent test-agent --dry-run`
5. **Expected:** Agent starts, loads 4 skills, runs AUDIT→SCAN→GATE with no code changes

**Hypothesis H2:** Skill load time scales linearly with skill count.
- **Test:** Measure `loadSkills()` duration for 1, 5, 10, 15 skills
- **Expected:** <100ms per skill (dynamic import + init)
- **Acceptance:** Total load time <2s for any agent
- **Note (Codex):** Must test with real runtime deps injected, not just import path validation

**Hypothesis H3 (revised):** Fail-fast validation catches config errors at boot.
- **Test:** Agent with `skills: [calibrate, nonexistent-skill]` — start session
- **Expected:** Loader throws "Unknown skill: nonexistent-skill" at boot, not at first hook call
- **Acceptance:** Error message includes the unknown skill name and available alternatives

---

## Files Changed vs New

| Action | File | Phase | What changes |
|--------|------|-------|-------------|
| **EDIT** | `src/plugins/calibrate-plugin.ts` | 0 | Move hook logic from session-runner closure into plugin |
| **EDIT** | `src/plugins/signals-plugin.ts` | 0 | Move hook logic from session-runner closure into plugin |
| **EDIT** | `src/plugins/predictions-plugin.ts` | 0 | Move hook logic from session-runner closure into plugin |
| **EDIT** | `src/plugins/tips-plugin.ts` | 0 | Move hook logic from session-runner closure into plugin |
| **EDIT** | `src/plugins/lifecycle-plugin.ts` | 0 | Move hook logic from session-runner closure into plugin |
| **EDIT** | `src/plugins/sc-oracle-plugin.ts` | 0 | Refactor: zero-arg factory, deps via init() |
| **EDIT** | `src/plugins/sc-prices-plugin.ts` | 0 | Refactor: zero-arg factory, deps via init() |
| **EDIT** | `src/plugins/sdk-setup-plugin.ts` | 0 | Refactor: zero-arg factory, deps via init() |
| **EDIT** | `src/plugins/tlsn-attest-plugin.ts` | 0 | Refactor: zero-arg factory, deps via init() |
| **NEW** | `src/lib/skill-manifest.ts` | A | SkillEntry type + MANIFEST map (all 20 plugins + supercolony) |
| **NEW** | `src/lib/skill-loader.ts` | A | loadSkills(), topological sort, fail-fast validation |
| **NEW** | `src/lib/__tests__/skill-loader.test.ts` | A | Unit tests for loader, sort, degradation |
| **NEW** | `src/lib/__tests__/skill-manifest.test.ts` | A | Manifest validation (all entries resolve, real init) |
| **EDIT** | `src/lib/agent-config.ts` | B | Read AGENT.yaml skills, precedence over loopExtensions |
| **EDIT** | `src/lib/extensions.ts` | B | Accept priority-sorted handlers from loader |
| **EDIT** | `cli/session-runner.ts` | B | Replace ~200 lines of registerHook() with `loadSkills()` |
| **EDIT** | `src/types.ts` | C | Add `eventHandlers?` + `eventSources?` to FrameworkPlugin |
| **EDIT** | `src/types.ts` | C | Normalize EventPlugin.init() signature |
| **EDIT** | `cli/event-runner.ts` | C | Use `loadSkills()` for event handler wiring |
| **EDIT** | `agents/*/AGENT.yaml` | B | Populate `capabilities.skills` for all 6 agents |
| **EDIT** | `agents/*/persona.yaml` | B | Add `skillConfig` section where needed |
| **DELETE** | `KNOWN_EXTENSIONS` in state.ts | D | Derived from manifest, no longer hardcoded |
| **DEPRECATE** | `loopExtensions` in persona.yaml | D | Removed after full cutover |

---

## Emergence Test (The Science)

A well-composed agent should exhibit emergent behavior — capabilities that no single plugin produces alone. After implementation, verify:

| Emergent Behavior | Required Skills | Verification |
|-------------------|----------------|-------------|
| "Disagree with trending consensus using attested evidence" | sc-oracle + sources + observe + signals | Post contains disagree reaction + attested counter-claim |
| "Discover new sources from feed, add to catalog, use in next session" | lifecycle + sources + observe | New source in catalog.json after session |
| "Tip high-quality posts that align with agent's topic expertise" | tips + signals + sc-oracle | Tip sent to post matching agent's primary topics |
| "Self-calibrate prediction accuracy over time" | calibrate + predictions | Calibration offset changes after 5+ sessions with predictions |

If any of these emerge from skill composition alone (no special-case code), the framework is working.
