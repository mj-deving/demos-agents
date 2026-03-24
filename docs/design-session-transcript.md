# Session Transcript (H2) — Design Document

> **Status:** Implemented (Steps 1-5 complete)
> **Date:** 2026-03-24
> **Author:** PAI Council session (4 perspectives × 3 rounds)
> **Depends on:** Existing session-runner.ts phase boundaries

## 1. Problem Statement

Current session state is **mutable and ephemeral** — `state.phases.scan.result` gets overwritten each session. We cannot:
- Replay a session to understand why a post got low reactions
- Correlate specific phase inputs with quality outcomes
- Generate fine-tuning data from successful sessions
- A/B test prompt strategies on identical inputs
- Track per-phase cost, latency, or failure rates over time

## 2. Solution: Append-Only Session Transcript

A JSONL logger that records every phase transition, input, output, and metric as an immutable event stream. Bolted onto existing session-runner without modifying phase logic.

### 2.1 Schema (v1)

```typescript
interface TranscriptEvent {
  /** Schema version for forward compatibility */
  schemaVersion: 1;
  /** Session identifier: "{agent}-{sessionNumber}" */
  sessionId: string;
  /** Agent name */
  agent: string;
  /** Event type */
  type: "phase-start" | "phase-complete" | "phase-error" | "session-start" | "session-complete";
  /** Phase name (null for session-level events) */
  phase: string | null;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Wall-clock duration in ms (for phase-complete events) */
  durationMs?: number;
  /** Phase-specific structured data */
  data?: Record<string, unknown>;
  /** Metrics for this event */
  metrics?: TranscriptMetrics;
}

interface TranscriptMetrics {
  /** LLM token cost for this phase (USD). Placeholder in v1 — LLM provider doesn't expose usage stats yet. */
  tokenCost?: number;
  /** LLM call count */
  llmCalls?: number;
  /** Sources fetched */
  sourcesFetched?: number;
  /** Signals detected */
  signalsDetected?: number;
  /** Gate pass/fail counts */
  gatePass?: number;
  gateFail?: number;
  /** Attestation results */
  attestationSuccess?: number;
  attestationFailed?: number;
  /** Post reactions (for verify phase) */
  reactions?: { agree: number; disagree: number };
}
```

### 2.2 Storage

- **Path:** `~/.config/demos/transcripts/{agent}/session-{N}.jsonl`
- **Format:** One JSON line per event, append-only
- **Retention:** 30 days (configurable), auto-pruned on session start via file `mtime` (not filename parsing)
- **Mode:** 0o600 (same as credentials)
- **Concurrency:** One file per session eliminates concurrent-write concerns (design invariant)

### 2.3 Integration Point

```typescript
// In session-runner.ts, at each phase boundary:

function emitTranscriptEvent(event: Partial<TranscriptEvent>): void {
  const full: TranscriptEvent = {
    schemaVersion: 1,
    sessionId: currentSessionId,
    agent: agentConfig.name,
    timestamp: new Date().toISOString(),
    phase: null,
    type: "phase-start",
    ...event,
  };
  appendFileSync(transcriptPath, JSON.stringify(full) + "\n");
}

// Usage:
emitTranscriptEvent({ type: "phase-start", phase: "scan" });
// ... phase executes ...
emitTranscriptEvent({
  type: "phase-complete",
  phase: "scan",
  durationMs: Date.now() - phaseStartMs,
  data: { activity: result.activity, gapCount: result.gaps?.topics?.length },
  metrics: { sourcesFetched: result.sourceSignals?.sourcesFetched, signalsDetected: result.sourceSignals?.signalCount },
});
```

### 2.4 Four Core Metrics (Council-mandated)

| Metric | Source | Phase | Why |
|--------|--------|-------|-----|
| **Per-phase latency** | `durationMs` on phase-complete | All | Identify bottlenecks (publish took 11.6m in session 41) |
| **Gate pass/fail ratios** | `gatePass`/`gateFail` counts | Gate | Track gate effectiveness over time |
| **Attestation success by source** | `attestationSuccess`/`Failed` + source name | Publish | Identify unreliable sources |
| **Token cost per session** | `tokenCost` per phase, summed | All | Budget tracking, cost optimization |

### 2.5 Schema Versioning (Council requirement)

The `schemaVersion: 1` field enables forward-compatible evolution:
- **v1 → v2:** Add fields → consumers check version, ignore unknown fields
- **Breaking change:** Bump to v2, old consumers skip v2 events
- **Migration:** Not needed — JSONL files are per-session, retention is 30 days

### 2.4a Phase Data Shapes (per Codex LOW-1)

| Phase | Expected `data` keys |
|-------|---------------------|
| audit | `entriesAudited`, `avgPredictionError`, `scoreDistribution` |
| scan | `activityLevel`, `postsPerHour`, `gapCount`, `sourceSignals` |
| engage | `reactionsCast`, `agrees`, `disagrees` |
| gate | `topicCount`, `topics[]`, `passCount`, `failCount` |
| publish | `txHashes[]`, `postCount`, `categories[]` |
| verify | `verified`, `total` |
| review | `postsReviewed`, `avgScore`, `avgReactions`, `suggestions[]` |
| harden | `findingsCount`, `actionable`, `strategy`, `skipped` |

### 2.4b V2 Loop Compatibility (per Codex HIGH-2)

v1 targets the V1 loop only (8 phases: audit→scan→engage→gate→publish→verify→review→harden). The V2 loop uses different phase names (`sense`, `act`, `confirm` with substages). V2 transcript support is deferred — the V2 loop is not used in production cron sessions. When added, V2 phases will emit events with their own phase names; the schema's `phase: string` field accommodates this without breaking changes.

### 2.4c Implementation Notes (per Codex review)

- **`appendFileSync`** is a deliberate trade-off: simplicity over performance. 16 sync writes per session (~1ms each) is negligible. Switch to buffered async if event volume grows.
- **`phase-error` events** must be emitted in the catch block alongside `failPhase()`, carrying `data: { error: message }` and partial `durationMs`.
- **`sessionId`** format: `"{agent}-{sessionNumber}"` (e.g., `"sentinel-42"`). Matches existing naming conventions.
- **`tokenCost`** is `undefined` in v1 — LLM provider (`claude --print`) doesn't expose usage stats. Will be populated when provider is extended.

## 3. Non-Goals

- **NOT replacing session state** — phases still use mutable state for runtime. Transcript is observability, not mechanism.
- **NOT real-time streaming** — append-only file, read after session completes
- **NOT a database** — JSONL for simplicity, not queryable without loading into memory
- **NOT replacing the session log** (`~/.sentinel-session-log.jsonl`) — that's a per-post log. Transcript is per-phase.

## 4. Future Use Cases (H3/H1 enablers)

The transcript schema is designed to enable future work without rewriting:

- **H3 (Protocol phases):** Phase identifiers in transcript become the contract. Plugins emit the same events.
- **H1 (LLM ordering):** Transcript prefix becomes the context for LLM to choose next phase.
- **Quality correlation:** Join transcript metrics with post reactions from session log.
- **Fine-tuning:** Extract (prompt, completion, outcome) tuples from transcript.
- **Replay:** Feed transcript prefix through alternative strategies, compare outputs.

## 5. Implementation Plan

| Step | What | Files | Tests |
|------|------|-------|-------|
| 1 | `TranscriptEvent` type + `emitTranscriptEvent` function | `src/lib/transcript.ts` | Type tests, emit/parse roundtrip |
| 2 | Wire into session-runner phase boundaries | `cli/session-runner.ts` | Existing session tests still pass |
| 3 | Add metrics collection per phase | `cli/session-runner.ts` | Metrics present in JSONL output |
| 4 | Add retention pruning on session start | `src/lib/transcript.ts` | Old files pruned, recent kept |
| 5 | CLI tool to query transcripts | `cli/transcript-query.ts` | Phase latency summary, cost totals |

## 6. Test Strategy

| Component | Test Type | Key Assertions |
|-----------|-----------|----------------|
| TranscriptEvent schema | Unit | Validates required fields, rejects invalid |
| emitTranscriptEvent | Unit | Appends valid JSONL, creates directory, handles errors |
| Schema version check | Unit | Unknown version events ignored gracefully |
| Retention pruning | Unit | Files older than 30 days deleted, recent kept |
| Session-runner integration | Integration | 8 phase-start + 8 phase-complete events per session |
| Metrics presence | Integration | All 4 core metrics present in at least 1 event |

## 7. Council Review Summary

4/4 unanimous on H2 first. Key requirements from council:
- Schema versioning (Diana) ✅
- Four metrics initially, no more (Kai, Diana) ✅
- Phase identifiers + transition metadata (Serena) ✅
- Additive — don't touch phase logic (Marcus, Diana) ✅
