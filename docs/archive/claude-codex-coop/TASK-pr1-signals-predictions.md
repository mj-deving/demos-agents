# Codex Review: PR1 — Signals + Predictions + SpendingPolicy (Design Review)

## Context

This is a **design review** for PR1 of the SuperColony upgrade v2. PR1 closes the calibration feedback loop by integrating consensus signals and prediction tracking into the autonomous session loop. A SpendingPolicy module is included as a security prerequisite for future tipping (PR3).

**Plan reference:** `Plans/supercolony-upgrade-v2.md`

**Origin:** Council debate (4 members, 3 rounds) reached unanimous convergence that signals + predictions must ship atomically — splitting them delivers zero feedback value.

## Current State

### Extension System (from Phase 3-4)
```typescript
// tools/lib/extensions.ts
export interface LoopExtensionHooks {
  beforeSense?(ctx: BeforeSenseContext): Promise<void>;
  beforePublishDraft?(ctx: BeforePublishDraftContext): Promise<PublishGateDecision | void>;
  afterPublishDraft?(ctx: AfterPublishDraftContext): Promise<SourceMatchDecision | void>;
}

// tools/lib/state.ts
export const KNOWN_EXTENSIONS = ["calibrate", "sources", "observe"] as const;
```

### Existing Session Flow
```
beforeSense (calibrate: fetch old scores, update offset)
  → SENSE (feed scan, room temp)
    → ACT (engage → gate → publish)
      → beforePublishDraft (sources: preflight check)
        → LLM generation
          → afterPublishDraft (sources: evidence match)
            → attestation + publish
              → CONFIRM (verify posts landed)
```

### Existing CLI Commands (already implemented, not loop-integrated)
- `supercolony.ts signals` — `/api/signals` fetch
- `supercolony.ts predictions` — `/api/predictions` query
- `supercolony.ts tip` — 2-step tip flow (validate + transfer)

### API Endpoints (from docs, 2026-03-14)
```
GET  /api/signals              — consensus, trending topics, alert clusters
GET  /api/predictions          — query by status/agent/asset
POST /api/predictions/{tx}/resolve — correct/incorrect/unresolvable
POST /api/tip                  — validate tip (1-10 DEM, anti-spam)
GET  /api/stats                — network stats (public)
```

### Scoring Context
- Sentinel: avg score 88.3, avg error 1.2, offset +3 (n=27)
- Pioneer: avg error -9.6, offset -11 (n=19)
- Scoring: Base(20) + DAHR(40) + Confidence(5) + LongText(15) + Reactions(10+10) = max 100
- Write rate limits: 15 posts/day, 5 posts/hour

## PR1 Design

### 1A. Signals Extension

**New extension: `signals`**
Hook point: `beforeSense`

```typescript
// New types
interface SignalSnapshot {
  fetchedAt: string;              // ISO timestamp
  topics: SignalTopic[];
  alerts: SignalAlert[];
}

interface SignalTopic {
  topic: string;
  direction: "bullish" | "bearish" | "neutral" | "mixed" | "alert";
  confidence: number;             // 0-100
  agentCount: number;             // how many agents discussing
  evidenceQuality: "strong" | "moderate" | "weak";
  divergence: boolean;            // high-credibility agents disagree with majority
  staleAt?: string;               // 6h eviction timestamp
}

interface SignalAlert {
  topic: string;
  severity: string;
  summary: string;
}
```

**Integration points:**
1. `beforeSense` hook: fetch `/api/signals`, parse into `SignalSnapshot`, store in session state
2. Gate phase: weight topic selection by signal alignment
   - Sentinel: prefer topics where signal + our analysis converge (verification role)
   - Pioneer: prefer topics with `divergence: true` (contrarian angle = higher engagement)
3. LLM context: pass signal direction and agent count to post generation prompt
4. Observation: log signal fetch results for improve skill

**New files:**
- `tools/lib/signals.ts` — fetch, parse, snapshot storage
- Extension registration in `extensions.ts` (new `signals` entry)

**Modified files:**
- `tools/lib/state.ts` — add `signals` to `KNOWN_EXTENSIONS`
- `tools/lib/extensions.ts` — add `signals` hook registration
- `tools/session-runner.ts` — pass signal snapshot to gate decisions
- `agents/*/persona.yaml` — add `signals` to `loop.extensions` list

### 1B. Predictions Extension

**New extension: `predictions`**
Hook points: `afterConfirm` (NEW hook point) + `beforeSense`

**Requires adding `afterConfirm` to LoopExtensionHooks:**
```typescript
export interface LoopExtensionHooks {
  beforeSense?(ctx: BeforeSenseContext): Promise<void>;
  beforePublishDraft?(ctx: BeforePublishDraftContext): Promise<PublishGateDecision | void>;
  afterPublishDraft?(ctx: AfterPublishDraftContext): Promise<SourceMatchDecision | void>;
  afterConfirm?(ctx: AfterConfirmContext): Promise<void>;  // NEW
}

interface AfterConfirmContext {
  state: AnySessionState;
  config: AgentConfig;
  publishedPosts: PublishedPost[];  // txHash, category, topic, text, predicted_reactions
}
```

**Prediction lifecycle:**
```
PUBLISH (category=PREDICTION)
  → afterConfirm: register prediction locally + via API
    → Local: append to ~/.{agent}/predictions.json
    → API: POST /api/predictions (if endpoint accepts registration)

NEXT SESSION beforeSense:
  → Check pending predictions for resolution
    → Fetch current data for price/metric predictions
    → Auto-resolve if data available and unambiguous
    → POST /api/predictions/{tx}/resolve (correct/incorrect/unresolvable)
    → Update calibration offset based on accuracy
```

**Local prediction store:**
```typescript
interface TrackedPrediction {
  txHash: string;
  topic: string;
  category: "PREDICTION";
  text: string;
  confidence: number;
  predictedValue?: string;        // extracted from text (e.g., "BTC > $100k")
  predictedDirection?: "up" | "down" | "stable";
  deadline?: string;              // ISO timestamp
  publishedAt: string;
  status: "pending" | "correct" | "incorrect" | "unresolvable" | "expired";
  resolvedAt?: string;
  resolution?: {
    actualValue?: string;
    source?: string;              // where we got the resolution data
    confidence: number;           // how confident we are in the resolution
  };
  agent: string;
}
```

**New files:**
- `tools/lib/predictions.ts` — track, resolve, query, calibrate
- Extension registration in `extensions.ts`

**Modified files:**
- `tools/lib/state.ts` — add `predictions` to `KNOWN_EXTENSIONS`
- `tools/lib/extensions.ts` — add `afterConfirm` hook point + dispatcher
- `tools/session-runner.ts` — call `runAfterConfirm()` after CONFIRM phase

### 1C. SpendingPolicy Module

**New file: `tools/lib/spending-policy.ts`**

Not an extension — a standalone policy module used by any code that transfers DEM.

```typescript
interface SpendingPolicyConfig {
  dailyCapDem: number;            // default: 10
  sessionCapDem: number;          // default: 5
  perTipCapDem: number;           // default: 10 (API max)
  perTipMinDem: number;           // default: 1 (API min)
  addressAllowlist?: string[];    // optional whitelist
  dryRun: boolean;                // default: true
  requireConfirmation: boolean;   // default: true when oversight !== "autonomous"
}

interface SpendingLedger {
  agent: string;
  date: string;                   // YYYY-MM-DD
  dailySpent: number;
  sessionSpent: number;
  transactions: SpendingTransaction[];
}

interface SpendingTransaction {
  timestamp: string;
  amount: number;
  recipient: string;
  postTxHash: string;
  type: "tip";
  dryRun: boolean;
}

// Public API
function canSpend(amount: number, recipient: string, config: SpendingPolicyConfig, ledger: SpendingLedger): { allowed: boolean; reason: string };
function recordSpend(tx: SpendingTransaction, ledger: SpendingLedger): void;
function loadLedger(agent: string): SpendingLedger;
function saveLedger(ledger: SpendingLedger): void;
```

**Ledger storage:** `~/.{agent}/spending-ledger.json` (daily reset)

**Guardrails (Security, from council):**
- Hard daily cap with NO override in autonomous mode
- All transactions logged to observation JSONL
- Dry-run mode default for new deployments
- Address allowlist optional but recommended

### 1D. Write Rate Limit Enforcement

**Modification to session-runner.ts publish path:**

```typescript
interface WriteRateLimitState {
  dailyCount: number;
  hourlyCount: number;
  dailyReset: string;   // ISO date
  hourlyReset: string;  // ISO timestamp
}

// Before each publish attempt:
// - Check daily < 14 (margin of 1 from 15 limit)
// - Check hourly < 4 (margin of 1 from 5 limit)
// - Skip with observation log if at limit
```

**Storage:** In session state (not persisted across sessions — conservative approach).

## Questions for Review

### Q1: afterConfirm Hook Point
Is adding a 4th hook point (`afterConfirm`) to `LoopExtensionHooks` the right approach? Alternatives:
- Run prediction tracking inside the existing CONFIRM phase directly
- Use a `beforeSense` hook on the NEXT session instead (but loses the publish context)
- Add a generic `onPhaseComplete` hook that fires after each phase

### Q2: Prediction Auto-Resolution
How should auto-resolution work for non-price predictions? Examples:
- "BTC will exceed $100k by March" — resolvable via price API
- "Fed will cut rates in Q2" — not auto-resolvable, needs manual
- "This protocol will gain TVL" — partially resolvable via DefiLlama

Should we only auto-resolve numeric/price predictions and queue everything else?

### Q3: Signal-Driven Topic Selection
Should signals OVERRIDE the current topic selection from room-temp scan, or just AUGMENT it?
- Override: "Only publish on topics that have consensus signal activity"
- Augment: "Prefer signal-active topics but don't exclude others"
- The consensus pipeline requires 2+ agents — if we only post on signaled topics, we never seed new topics.

### Q4: Write Rate Limit Scope
The 15/day, 5/hour limits — are these per-agent or per-address? If per-address and we run 3 agents on the same wallet, we need shared tracking. If per-agent, session-local is fine.

### Q5: SpendingPolicy vs Future Tipping
SpendingPolicy ships in PR1 but autonomous tipping ships in PR3. Is it worth building SpendingPolicy now or should we defer it until PR3 when it's actually needed? Counter-argument: the council said it's a hard dependency and should be proven before tipping code ships.

### Q6: Prediction Store Format
JSON file (`predictions.json`) vs JSONL (append-only like observations)? JSON is easier to query/update but has write-amplification. JSONL is append-efficient but harder to update resolution status.

## Files to Read

```bash
# Current extension system
cat tools/lib/extensions.ts
cat tools/lib/state.ts
grep -n "KNOWN_EXTENSIONS\|loopExtensions\|beforeSense\|afterConfirm" tools/lib/state.ts tools/lib/extensions.ts tools/session-runner.ts tools/lib/agent-config.ts

# Current calibration (what predictions will enhance)
grep -n "calibrationOffset\|prediction\|predicted_reactions" tools/session-runner.ts tools/lib/llm.ts

# Existing signals/predictions CLI
grep -n "cmdSignals\|cmdPredictions\|signals\|predictions" skills/supercolony/scripts/supercolony.ts

# Session state structure
cat tools/lib/state.ts

# Agent strategy configs (loop.extensions)
cat agents/sentinel/strategy.yaml
cat agents/pioneer/strategy.yaml

# How observe() works (pattern for spending ledger logging)
cat tools/lib/observe.ts
```

## Output Format

For each question (Q1-Q6), provide:
- **Answer:** Concrete recommendation with rationale
- **Risks:** What could go wrong
- **Dependencies:** What else needs to change

Then provide overall findings:
- **P0 (Critical):** Design blockers
- **P1 (High):** Gaps that will cause rework
- **P2 (Medium):** Edge cases
- **P3 (Low):** Suggestions

**Final deliverable:** Concrete implementation spec with file-by-file changes, types, and integration points.
