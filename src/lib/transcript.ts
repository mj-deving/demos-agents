/**
 * Session transcript — append-only JSONL event logger for session observability.
 *
 * Records every phase transition, input, output, and metric as an immutable
 * event stream. Bolted onto session-runner without modifying phase logic.
 *
 * Design doc: docs/design-session-transcript.md
 * Council-validated: 2026-03-24 (4 perspectives × 3 rounds)
 */

import { appendFileSync, readFileSync, mkdirSync, readdirSync, statSync, unlinkSync, chmodSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

// ── Types ─────────────────────────────────────────────

export interface TranscriptMetrics {
  /** Claim extraction quality detail for source matching. */
  claimExtraction?: ClaimExtractionDetail;
  /** Detailed score breakdown for a completed source match attempt. */
  matchScoreDetail?: MatchScoreDetail;
  /** Per-source relevance from post-generation matching. */
  sourceRelevance?: SourceRelevanceEntry[];
  /** LLM token cost for this phase (USD). Placeholder in v1 — provider doesn't expose usage. */
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

export interface ClaimExtractionDetail {
  /** Final extracted claims emitted to source matching. */
  claims: string[];
  /** Extraction path that produced the final claim set. */
  extraction_method: "regex" | "llm";
  /** Convenience count for aggregation/querying. */
  claim_count: number;
}

export interface SourceRelevanceEntry {
  /** Human-readable source name shown in matching/transcript analysis. */
  source_name: string;
  /** Whether the source fetch produced a response, independent of usefulness. */
  fetch_success: boolean;
  /** Parsed evidence entries returned by the provider adapter. */
  evidence_entries_found: number;
  /** Match relevance score for the fetched evidence (0-100). */
  evidence_relevance_score: number;
}

export interface MatchScoreDetail {
  /** Title/topic or metadata-derived relevance contribution. */
  topic_relevance: number;
  /** Body-text evidence contribution. */
  body_match: number;
  /** Numeric/metrics evidence contribution. */
  metrics_overlap: number;
  /** Source metadata contribution. */
  metadata_match: number;
  /** Final composite score used for thresholding. */
  composite: number;
  /** Effective threshold after clamping/config resolution. */
  threshold: number;
  /** Final match decision for the selected candidate. */
  passed: boolean;
  /** Human-readable candidate sources considered for this match attempt. */
  candidateSourceNames: string[];
  /** Human-readable source name selected as the best match. */
  selectedSourceName: string;
}

export interface TranscriptEvent {
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
  /** Wall-clock duration in ms (for phase-complete/phase-error events) */
  durationMs?: number;
  /** Phase-specific structured data */
  data?: Record<string, unknown>;
  /** Metrics for this event */
  metrics?: TranscriptMetrics;
}

/**
 * Context for a transcript session — created once, passed to emitTranscriptEvent.
 */
export interface TranscriptContext {
  sessionId: string;
  agent: string;
  filePath: string;
  dirCreated: boolean;
}

// ── Helpers ───────────────────────────────────────────

/**
 * Build session ID: "{agent}-{sessionNumber}".
 */
export function buildSessionId(agent: string, sessionNumber: number): string {
  return `${agent}-${sessionNumber}`;
}

/**
 * Create a transcript context for a session.
 * Does NOT create the directory yet — deferred to first write.
 */
export function createTranscriptContext(
  agent: string,
  sessionNumber: number,
  transcriptDir: string,
): TranscriptContext {
  const sessionId = buildSessionId(agent, sessionNumber);
  return {
    sessionId,
    agent,
    filePath: join(transcriptDir, `session-${sessionNumber}.jsonl`),
    dirCreated: false,
  };
}

/**
 * Extract transcript metrics from a phase result.
 * Kept in src/lib so transcript typing and metric shaping stay in one place.
 */
export function extractTranscriptMetrics(
  phase: string,
  result: any,
  state: any,
): TranscriptMetrics | undefined {
  switch (phase) {
    case "scan":
      return {
        sourcesFetched: result.sourceSignals?.sourcesFetched,
        signalsDetected: result.sourceSignals?.signalCount,
      };
    case "gate": {
      const posts = result.posts || [];
      const gateResults = posts.map((p: any) => p.gateResult?.summary);
      const totalPass = gateResults.reduce((sum: number, gate: any) => sum + (gate?.pass || 0), 0);
      const totalFail = gateResults.reduce((sum: number, gate: any) => sum + (gate?.fail || 0), 0);
      return { gatePass: totalPass, gateFail: totalFail };
    }
    case "publish": {
      const published = state.posts?.length || 0;
      return {
        attestationSuccess: published,
        sourceRelevance: Array.isArray(result.sourceRelevance) ? result.sourceRelevance : undefined,
      };
    }
    case "verify": {
      const summary = result.summary || {};
      return {
        reactions: {
          agree: summary.agrees || 0,
          disagree: summary.disagrees || 0,
        },
      };
    }
    default:
      return undefined;
  }
}

// ── Emit ──────────────────────────────────────────────

/**
 * Append a transcript event to the session's JSONL file.
 * Creates the directory on first write. Synchronous for simplicity
 * (16 writes per session at ~1ms each is negligible).
 */
export function emitTranscriptEvent(
  ctx: TranscriptContext,
  partial: Omit<TranscriptEvent, "schemaVersion" | "sessionId" | "agent" | "timestamp">,
): void {
  if (!ctx.dirCreated) {
    mkdirSync(dirname(ctx.filePath), { recursive: true });
    ctx.dirCreated = true;
  }

  const event: TranscriptEvent = {
    schemaVersion: 1,
    sessionId: ctx.sessionId,
    agent: ctx.agent,
    timestamp: new Date().toISOString(),
    ...partial,
  };

  const isNewFile = !existsSync(ctx.filePath);
  appendFileSync(ctx.filePath, JSON.stringify(event) + "\n", { mode: 0o600 });
  // Ensure permissions even if file was created by another process
  if (isNewFile) {
    try { chmodSync(ctx.filePath, 0o600); } catch { /* non-fatal */ }
  }
}

// ── Read ──────────────────────────────────────────────

/**
 * Read a transcript JSONL file into an array of events.
 * Skips malformed lines. Returns empty array if file doesn't exist.
 */
export function readTranscript(filePath: string): TranscriptEvent[] {
  try {
    const content = readFileSync(filePath, "utf8");
    const events: TranscriptEvent[] = [];
    for (const line of content.trim().split("\n")) {
      if (!line) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
      }
    }
    return events;
  } catch {
    return [];
  }
}

// ── Retention ─────────────────────────────────────────

/**
 * Delete transcript files older than `retentionDays` from a directory.
 * Uses file mtime for age check (not filename parsing).
 */
export function pruneOldTranscripts(dir: string, retentionDays: number): void {
  try {
    const files = readdirSync(dir);
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = join(dir, file);
      try {
        const stat = statSync(filePath);
        if (stat.mtimeMs < cutoffMs) {
          unlinkSync(filePath);
        }
      } catch {
        // Skip files that can't be stat'd
      }
    }
  } catch {
    // Directory doesn't exist — nothing to prune
  }
}
