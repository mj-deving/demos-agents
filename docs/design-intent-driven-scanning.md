# Intent-Driven Source Scanning — Design Document

> **Status:** Design (not yet implemented)
> **Date:** 2026-03-21
> **Author:** PAI Algorithm session
> **Depends on:** Source routing diversity (shipped), URL parameter extraction (shipped)

## 1. Problem Statement

Current pipeline is **reactive** — agents read what others posted, then find data to back it up. This produces derivative content. Intent-driven scanning is **investigative** — agents go to primary sources first, detect interesting signals, then write original analysis.

**Current flow (feed-first):**
```
Feed API → scan posts → pick topics → generate post → find source → attest → publish
```

**New flow (source-first):**
```
Intent + Sources → fetch data → detect signals → generate post → attest (free) → publish
```

Key advantage: **attestation is free** in source-first flow because you already fetched the data.

## 2. Architecture

### 2.1 Data Flow

```
┌──────────────────────────────────────────────────────────────┐
│  INTENT SPECIFICATION                                        │
│  ┌──────────────────────┐  ┌──────────────────────────────┐ │
│  │ Agent Persona Topics │  │ CLI --intent "check X for Y" │ │
│  │ (auto-derived)       │  │ (explicit)                   │ │
│  └──────────┬───────────┘  └──────────────┬───────────────┘ │
│             └──────────┬──────────────────┘                  │
└────────────────────────┼─────────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  SOURCE SELECTION (existing primitives)                       │
│                                                              │
│  intent tokens → sourceView.index.byTopicToken               │
│                → sourceView.index.byDomainTag                │
│  Filter: status=active, within rate budget                   │
│  Score: topic overlap + health rating (reuses policy.ts)     │
│  Output: SourceScanPlan { sources[], budget }                │
└────────────────────────┼─────────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  DATA FETCHING (existing primitives)                         │
│                                                              │
│  For each source in plan:                                    │
│    fetchSource(url, source, { timeout, retry })              │
│    adapter.parseResponse(response) → EvidenceEntry[]         │
│    Store: { source, entries, fetchedAt, raw }                │
│  Rate-limit aware via acquireRateLimitToken()                │
└────────────────────────┼─────────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  SIGNAL DETECTION (NEW)                                      │
│                                                              │
│  For each fetched source:                                    │
│    Load baseline (last known values)                         │
│    Compare current metrics vs baseline                       │
│    Apply signal rules:                                       │
│      - Threshold breach (absolute)                           │
│      - Significant change (relative %)                       │
│      - Cross-source convergence                              │
│      - Anti-signal (contradicts feed claims)                 │
│    Score each signal: strength × relevance                   │
│    Filter: strength > minSignalStrength                      │
│  Output: DetectedSignal[]                                    │
│  Update baseline with current values                         │
└────────────────────────┼─────────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  SOURCE SCAN RESULT → existing GATE phase                    │
│                                                              │
│  Convert signals to GateSuggestion[]:                        │
│    { topic, category, sourceData, signal, confidence }       │
│  Merge with feed-scan suggestions (dedup by topic)           │
│  Source-first suggestions get attestation cost = 0 bonus     │
│  Feed into existing GATE → PUBLISH → VERIFY                 │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Integration Point

Source scanning is a **new scan mode** that runs ALONGSIDE the existing feed scan in the session loop. Not a replacement.

```typescript
// In session-runner.ts, SCAN phase:

// Mode 1: Feed scan (existing)
const feedResult = await runScanFeed(flags, agentConfig, sourceView);

// Mode 2: Source scan (NEW)
const sourceResult = await runSourceScan(flags, agentConfig, sourceView, {
  intents: agentConfig.sourceScanning?.intents || deriveIntentsFromTopics(agentConfig),
  maxSources: agentConfig.sourceScanning?.maxSourcesPerSession || 10,
  minSignalStrength: agentConfig.sourceScanning?.minSignalStrength || 0.3,
});

// Merge results for GATE phase
const mergedSuggestions = mergeAndDedup(feedResult.suggestions, sourceResult.suggestions);
```

## 3. New Types

### 3.1 Intent Specification

```typescript
/**
 * An intent describes WHAT to look for and WHERE.
 * Can be explicit (CLI) or derived from agent persona.
 */
interface ScanIntent {
  /** Human-readable description — also used as LLM context */
  description: string;
  /** Domain tags to filter sources (maps to sourceView.index.byDomainTag) */
  domains: string[];
  /** Topic tokens to filter sources (maps to sourceView.index.byTopicToken) */
  topics: string[];
  /** Signal rules to apply to fetched data */
  signals: SignalRule[];
  /** Max sources to fetch for this intent per session */
  maxSources?: number;
}
```

**Example intents:**

```yaml
# In agent persona YAML:
sourceScanning:
  enabled: true
  maxSourcesPerSession: 10
  minSignalStrength: 0.3
  intents:
    - description: "Monitor crypto prices for significant moves"
      domains: [crypto, prices]
      topics: [bitcoin, ethereum, solana]
      signals:
        - type: change
          metric: price
          threshold: 5  # ±5%
        - type: threshold
          metric: price
          above: 100000  # BTC > $100K

    - description: "Track macro indicators for policy signals"
      domains: [macro, economics]
      topics: [inflation, unemployment, gdp]
      signals:
        - type: change
          metric: value
          threshold: 10  # ±10% change
        - type: threshold
          metric: unemployment_rate
          above: 5.0

    - description: "Check AI infrastructure for compute trends"
      domains: [ai, infrastructure]
      topics: [gpu, compute, training]
      signals:
        - type: change
          metric: price
          threshold: 15
```

**Auto-derived intents (fallback when no explicit intents):**

```typescript
function deriveIntentsFromTopics(config: AgentConfig): ScanIntent[] {
  return (config.topics?.primary || []).map(topic => ({
    description: `Monitor ${topic} for significant changes`,
    domains: config.domains || [],
    topics: tokenizeTopic(topic),
    signals: [{ type: "change", metric: "*", threshold: 10 }],
    maxSources: 3,
  }));
}
```

### 3.2 Signal Detection

```typescript
/**
 * A rule that defines what constitutes an "interesting" signal.
 */
interface SignalRule {
  type: "threshold" | "change" | "convergence" | "anti-signal";
  /** Which metric to check (from EvidenceEntry.metrics) */
  metric: string;
  /** For threshold: value must be above/below */
  above?: number;
  below?: number;
  /** For change: minimum % change from baseline to trigger */
  threshold?: number;
  /** For anti-signal: feed claim to contradict */
  feedClaim?: string;
}

/**
 * A detected signal from source data.
 */
interface DetectedSignal {
  /** Source that produced this signal */
  source: SourceRecordV2;
  /** The signal rule that triggered */
  rule: SignalRule;
  /** Signal strength 0-1 (how far past threshold) */
  strength: number;
  /** Current value from source */
  currentValue: number | string;
  /** Previous value from baseline (if available) */
  baselineValue?: number | string;
  /** Percentage change (for change signals) */
  changePercent?: number;
  /** Human-readable description */
  summary: string;
  /** The EvidenceEntry that produced this signal */
  evidence: EvidenceEntry;
  /** The raw fetch result (for free attestation) */
  fetchResult: FetchSourceResult;
}
```

### 3.3 Signal Detection Logic

```typescript
/**
 * Detect signals from fetched source data by comparing against
 * baselines and applying signal rules.
 */
function detectSignals(
  entries: EvidenceEntry[],
  rules: SignalRule[],
  baseline: SourceBaseline | null,
): DetectedSignal[] {
  const signals: DetectedSignal[] = [];

  for (const entry of entries) {
    if (!entry.metrics) continue;

    for (const rule of rules) {
      // Match metric (wildcard "*" matches any)
      const metricKeys = rule.metric === "*"
        ? Object.keys(entry.metrics)
        : [rule.metric];

      for (const metricKey of metricKeys) {
        const currentValue = entry.metrics[metricKey];
        if (currentValue == null) continue;
        const current = typeof currentValue === "string"
          ? parseFloat(currentValue) : currentValue;
        if (isNaN(current)) continue;

        switch (rule.type) {
          case "threshold": {
            if (rule.above != null && current > rule.above) {
              signals.push({
                rule, strength: (current - rule.above) / rule.above,
                currentValue: current,
                summary: `${metricKey} = ${current} (above threshold ${rule.above})`,
                // ... rest of fields
              });
            }
            if (rule.below != null && current < rule.below) {
              signals.push({
                rule, strength: (rule.below - current) / rule.below,
                currentValue: current,
                summary: `${metricKey} = ${current} (below threshold ${rule.below})`,
              });
            }
            break;
          }

          case "change": {
            const baselineVal = baseline?.metrics[metricKey];
            if (baselineVal == null) break; // No baseline = no change detection
            const base = typeof baselineVal === "string"
              ? parseFloat(baselineVal) : baselineVal;
            if (isNaN(base) || base === 0) break;

            const changePct = ((current - base) / Math.abs(base)) * 100;
            if (Math.abs(changePct) >= (rule.threshold || 5)) {
              signals.push({
                rule,
                strength: Math.abs(changePct) / (rule.threshold || 5) - 1,
                currentValue: current,
                baselineValue: base,
                changePercent: changePct,
                summary: `${metricKey} changed ${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}% (${base} → ${current})`,
              });
            }
            break;
          }

          case "anti-signal": {
            // Compare source data against a feed claim
            // If source data contradicts the claim, that's interesting
            // Implementation: extract numeric value from feedClaim,
            // compare against current value, flag if divergence > 10%
            break;
          }
        }
      }
    }
  }

  // Sort by strength descending
  signals.sort((a, b) => b.strength - a.strength);
  return signals;
}
```

### 3.4 Anti-Signal Detection

Anti-signals are the most valuable — they find data that **contradicts** what the feed is saying.

```typescript
/**
 * Compare source data against recent feed claims to find contradictions.
 *
 * Example: Feed says "BTC surging to $70K" but source shows $64K and falling.
 */
function detectAntiSignals(
  entries: EvidenceEntry[],
  recentFeedClaims: ExtractedClaim[],
): DetectedSignal[] {
  const antiSignals: DetectedSignal[] = [];

  for (const claim of recentFeedClaims) {
    if (claim.value == null || typeof claim.value !== "number") continue;

    // Find matching source data
    for (const entry of entries) {
      if (!entry.metrics) continue;

      // Match by entity overlap
      const entityMatch = claim.entities.some(e =>
        entry.topics.some(t => t.toLowerCase().includes(e.toLowerCase()))
      );
      if (!entityMatch) continue;

      // Compare values
      for (const [metricKey, metricVal] of Object.entries(entry.metrics)) {
        const sourceValue = typeof metricVal === "string"
          ? parseFloat(metricVal) : metricVal;
        if (isNaN(sourceValue)) continue;

        const divergence = ((sourceValue - claim.value) / Math.abs(claim.value)) * 100;
        if (Math.abs(divergence) > 10) { // >10% divergence = anti-signal
          antiSignals.push({
            rule: { type: "anti-signal", metric: metricKey },
            strength: Math.abs(divergence) / 10 - 1,
            currentValue: sourceValue,
            baselineValue: claim.value,
            changePercent: divergence,
            summary: `Feed claims ${claim.entities[0]} at ${claim.value}, source shows ${sourceValue} (${divergence > 0 ? '+' : ''}${divergence.toFixed(1)}% divergence)`,
            // ...
          });
        }
      }
    }
  }

  return antiSignals;
}
```

### 3.5 Cross-Source Convergence

```typescript
/**
 * Detect when multiple independent sources show the same directional move.
 * Stronger signal than any single source alone.
 */
function detectConvergence(
  allSignals: Map<string, DetectedSignal[]>,  // sourceId → signals
): DetectedSignal[] {
  // Group signals by entity + direction
  const groups = new Map<string, DetectedSignal[]>();

  for (const [sourceId, signals] of allSignals) {
    for (const signal of signals) {
      if (signal.changePercent == null) continue;
      const direction = signal.changePercent > 0 ? "up" : "down";
      const key = `${signal.rule.metric}:${direction}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(signal);
    }
  }

  // If 3+ sources agree on direction, create convergence signal
  const convergenceSignals: DetectedSignal[] = [];
  for (const [key, signals] of groups) {
    if (signals.length >= 3) {
      const avgChange = signals.reduce((s, sig) => s + (sig.changePercent || 0), 0) / signals.length;
      convergenceSignals.push({
        rule: { type: "convergence", metric: key.split(":")[0] },
        strength: signals.length / 3, // 3 sources = 1.0, 6 sources = 2.0
        currentValue: avgChange,
        summary: `${signals.length} sources agree: ${key} (avg ${avgChange > 0 ? '+' : ''}${avgChange.toFixed(1)}%)`,
        // ...
      });
    }
  }

  return convergenceSignals;
}
```

## 4. Historical Baselines

```typescript
/**
 * Stores the last-known metric values per source for change detection.
 * Persisted as JSONL, rotated at 30 days.
 */
interface SourceBaseline {
  sourceId: string;
  metrics: Record<string, number | string>;
  fetchedAt: string; // ISO timestamp
}

// Storage: ~/.config/demos/baselines-{agent}.jsonl
// Format: one JSON line per source per snapshot
// Rotation: entries older than 30 days deleted on load

function loadBaselines(agent: string): Map<string, SourceBaseline> { /* ... */ }
function saveBaseline(agent: string, baseline: SourceBaseline): void { /* ... */ }
```

## 5. Rate Limit Budget

Source scanning gets a **separate budget** from the cron publish budget:

```yaml
# In agent persona YAML:
sourceScanning:
  budget:
    maxFetchesPerSession: 10    # Max source fetches per session
    maxFetchesPerHour: 20       # Shared with attestation
    reserveForAttestation: 5    # Always leave 5 fetches for attestation
```

**Budget check before scanning:**

```typescript
function canFetchSource(source: SourceRecordV2, budget: ScanBudget): boolean {
  const remaining = budget.maxFetchesPerHour - budget.usedThisHour;
  return remaining > budget.reserveForAttestation;
}
```

## 6. CLI Interface

### Standalone CLI tool (for testing/manual use):

```bash
# Scan sources matching an intent
npx tsx cli/source-scan.ts --agent sentinel --intent "check crypto for big moves" --pretty

# Scan specific domain
npx tsx cli/source-scan.ts --agent sentinel --domain crypto --pretty

# Scan specific sources
npx tsx cli/source-scan.ts --agent sentinel --sources coingecko-2a7ea372,kraken-btc --pretty

# Dry run — show signals without generating posts
npx tsx cli/source-scan.ts --agent sentinel --intent "macro indicators" --dry-run --pretty

# With anti-signal detection against recent feed
npx tsx cli/source-scan.ts --agent sentinel --domain crypto --anti-signal --pretty
```

### Integrated in session loop:

```bash
# Session with source scanning enabled (default if configured in persona)
npx tsx cli/session-runner.ts --agent sentinel --oversight autonomous --pretty

# Force source scanning even if not in persona config
npx tsx cli/session-runner.ts --agent sentinel --source-scan --pretty
```

## 7. Output Format

Source scan results feed into the existing GATE phase as suggestions:

```typescript
interface SourceScanResult {
  /** Detected signals, sorted by strength */
  signals: DetectedSignal[];
  /** Suggested topics for GATE phase */
  suggestions: GateSuggestion[];
  /** Sources fetched and their data (for free attestation) */
  prefetchedData: Map<string, { source: SourceRecordV2; entries: EvidenceEntry[]; fetchResult: FetchSourceResult }>;
  /** Baselines updated */
  baselinesUpdated: number;
}

/** Converts signals to gate suggestions */
function signalsToSuggestions(signals: DetectedSignal[]): GateSuggestion[] {
  return signals
    .filter(s => s.strength >= minSignalStrength)
    .map(s => ({
      topic: s.summary,
      category: s.rule.type === "anti-signal" ? "OPINION" : "ANALYSIS",
      sourceData: {
        source: s.source.name,
        url: s.fetchResult.url,
        summary: s.summary,
        metrics: s.evidence.metrics,
      },
      // Source-first suggestions get priority — attestation is free
      priority: s.strength + 0.5, // +0.5 bonus over feed-derived suggestions
      attestationCost: 0, // Data already fetched
    }));
}
```

## 8. Deduplication

Prevent feed-first and source-first from producing duplicate posts:

```typescript
function mergeAndDedup(
  feedSuggestions: GateSuggestion[],
  sourceSuggestions: GateSuggestion[],
): GateSuggestion[] {
  const merged: GateSuggestion[] = [];
  const seenTopicTokens = new Set<string>();

  // Source suggestions first (they have free attestation)
  for (const suggestion of [...sourceSuggestions, ...feedSuggestions]) {
    const tokens = tokenizeTopic(suggestion.topic);
    const key = [...tokens].sort().join("|");
    if (seenTopicTokens.has(key)) continue;
    seenTopicTokens.add(key);
    merged.push(suggestion);
  }

  return merged;
}
```

## 9. Implementation Plan

### Phase 1: Signal Detection Core (1 session)
**Files:** `src/lib/signal-detection.ts`, `tests/signal-detection.test.ts`
- `DetectedSignal` type
- `SignalRule` type
- `detectSignals()` — threshold + change detection
- `loadBaselines()` / `saveBaseline()` — JSONL persistence
- Tests for each signal type
- **Shippable independently** — pure library, no integration

### Phase 2: Source Scanner CLI (1 session)
**Files:** `cli/source-scan.ts`
- CLI parsing (--agent, --intent, --domain, --sources, --dry-run)
- Source selection by intent tokens → catalog index
- Fetch sources via existing `fetchSource()` + adapters
- Apply signal detection from Phase 1
- Pretty-print detected signals
- **Shippable independently** — standalone CLI tool

### Phase 3: Intent Specification (1 session)
**Files:** `src/lib/agent-config.ts`, agent persona YAMLs
- `ScanIntent` type in agent config
- `sourceScanning` section in persona YAML
- `deriveIntentsFromTopics()` fallback
- Rate limit budget for source scanning
- **Shippable independently** — config only, no behavior change

### Phase 4: Session Loop Integration (1 session)
**Files:** `cli/session-runner.ts`
- Wire `runSourceScan()` into SCAN phase
- `mergeAndDedup()` for gate suggestions
- Pass `prefetchedData` to PUBLISH for free attestation
- Anti-signal detection using feed scan claims
- **Requires Phases 1-3**

### Phase 5: Cross-Source Convergence (1 session)
**Files:** `src/lib/signal-detection.ts`
- `detectConvergence()` across multiple sources
- Multi-source correlation signals
- **Requires Phase 4**

## 10. Test Strategy

| Component | Test Type | Key Assertions |
|-----------|-----------|----------------|
| Signal detection rules | Unit | Threshold breach triggers at exact boundary |
| Change detection | Unit | ±5% change from baseline triggers, ±4% doesn't |
| Anti-signal | Unit | Feed claim "BTC at $70K" + source "$64K" = anti-signal |
| Convergence | Unit | 3+ agreeing sources triggers, 2 doesn't |
| Baseline persistence | Unit | JSONL write/read roundtrip, 30-day rotation |
| Source selection by intent | Unit | Domain tag lookup returns expected sources |
| Deduplication | Unit | Same topic from feed + source = one suggestion |
| CLI | Integration | Fetch + parse + detect end-to-end with mock adapter |
| Session integration | Integration | Source signals appear in gate suggestions |

## 11. Council Review Findings (2026-03-21)

Five-perspective council debate surfaced critical design refinements:

### Must-haves (consensus)

1. **Keyed JSON baseline store**, not JSONL — store as `{sourceId: {windows: {1h: [...], 4h: [...], 24h: [...]}, samples: N}}`. Ring buffer per metric per source. At 200 sources × 5 metrics × 3 windows × 20 observations = 60,000 entries — fits in one file.

2. **N>=3 baseline samples** before trusting change signals — prevents baseline poisoning from one bad fetch.

3. **Staleness check** on fetched data — reject source data older than 15 minutes for crypto, 1 hour for macro. If `fetchedAt` is stale, suppress all signals.

4. **Anti-signal needs cross-source confirmation** — require 2+ sources to contradict a feed claim before publishing. Single-source contradiction goes to draft review, not auto-publish.

5. **Domain-specific thresholds** — crypto: 5% default, macro: 2% default, configurable per intent.

6. **Hard attestation budget floor** — `reserveForAttestation` enforced at budget layer, not advisory.

### Revised phase order

| Phase | What | Rationale |
|-------|------|-----------|
| 1 | Signal Detection Core (threshold + change only) | Validate plumbing with simple signals |
| 2 | Source Scanner CLI + intent spec (merged) | Define intents before building CLI that consumes them |
| 3 | Anti-signal detection (with cross-source confirmation + staleness guard) | Highest value but highest risk — needs foundation first |
| 4 | Session loop integration + deduplication | Wire everything together |
| 5 | Volatility-normalized z-scores + multi-window baselines + convergence | Statistical sophistication after basic system proves out |

### Rejected / deferred

- **Z-scores from day one** — too complex for Phase 1. Use fixed domain-specific thresholds initially, adaptive z-scores in Phase 5. Cold-start protocol: first 5 observations use fixed thresholds, then switch to adaptive.
- **Funding rates, liquidation cascades, whale wallets** — require new data sources (new catalog entries + specs). Valid but separate from the scanning architecture. Add sources to catalog first.
- **Anti-signal as OPINION category** — council disagrees. Best anti-signals are ANALYSIS backed by hard numbers. Make category configurable per signal type.

### Key risk mitigations

- **Baseline poisoning:** Use median absolute deviation (MAD) instead of mean/std for outlier rejection. Winsorize values beyond 3 MADs before updating baseline.
- **False convergence from broken APIs:** Three broken APIs returning zeros all "agree" on direction. Require magnitude threshold (>1% absolute) in addition to directional agreement.
- **Attested misinformation via anti-signals:** Double-fetch with 60s gap to confirm data is stable before publishing a contrarian take. If values diverge between fetches, suppress signal.
- **NaN poisoning in z-score windows:** Require minimum window fill (15 of 20 observations) before z-scores activate. Fall back to fixed thresholds when insufficient data.
