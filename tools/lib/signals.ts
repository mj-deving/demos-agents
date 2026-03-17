/**
 * Consensus signals from SuperColony.
 *
 * Fetches network-wide signal consensus and provides alignment scoring
 * for different agent modes. Used by gate/publish decisions to factor
 * in what the broader network is seeing.
 *
 * Runtime: Node.js + tsx
 */

import { apiCall } from "./sdk.js";
import { observe } from "./observe.js";

// ── Types ──────────────────────────────────────────

export interface SignalTopic {
  topic: string;
  direction: "bullish" | "bearish" | "neutral" | "mixed" | "alert";
  confidence: number;
  agentCount: number;
  evidenceQuality: "strong" | "moderate" | "weak";
  /** High-credibility agents disagree with majority */
  divergence: boolean;
  /** ISO timestamp when signal becomes stale */
  staleAt?: string;
}

export interface SignalAlert {
  topic: string;
  severity: string;
  summary: string;
}

export interface SignalSnapshot {
  fetchedAt: string;
  topics: SignalTopic[];
  alerts: SignalAlert[];
}

// ── Fetch ──────────────────────────────────────────

/**
 * Fetch consensus signals from the SuperColony signals endpoint.
 *
 * Returns null on any failure (network, parse, unexpected shape).
 * Never throws — callers should treat null as "signals unavailable".
 */
export async function fetchSignals(token: string): Promise<SignalSnapshot | null> {
  try {
    const res = await apiCall("/api/signals", token);

    if (!res.ok) {
      observe("error", `Signals fetch failed: HTTP ${res.status}`, {
        phase: "scan",
        source: "signals.ts",
        data: { status: res.status },
      });
      return null;
    }

    const data = res.data;

    // Normalize response shape — API may return { topics, alerts } or wrap in { data: { ... } }
    const raw = data?.topics ? data : data?.data;
    if (!raw || !Array.isArray(raw.topics)) {
      observe("error", "Signals response has unexpected shape", {
        phase: "scan",
        source: "signals.ts",
        data: { keys: data ? Object.keys(data) : null },
      });
      return null;
    }

    const snapshot: SignalSnapshot = {
      fetchedAt: new Date().toISOString(),
      topics: Array.isArray(raw.topics) ? raw.topics.map(normalizeSignalTopic) : [],
      alerts: Array.isArray(raw.alerts) ? raw.alerts.map(normalizeSignalAlert) : [],
    };

    observe("insight", `Fetched ${snapshot.topics.length} signal topics, ${snapshot.alerts.length} alerts`, {
      phase: "scan",
      source: "signals.ts",
      data: { topicCount: snapshot.topics.length, alertCount: snapshot.alerts.length },
    });

    return snapshot;
  } catch (err: any) {
    observe("error", `Signals fetch exception: ${err.message}`, {
      phase: "scan",
      source: "signals.ts",
    });
    return null;
  }
}

// ── Briefing ────────────────────────────────────────

/**
 * Fetch the latest colony briefing/report summary.
 * Returns the summary text on success, null on any failure.
 * Never throws.
 */
export async function fetchLatestBriefing(token: string): Promise<string | null> {
  try {
    const res = await apiCall("/api/report", token);
    if (!res.ok) {
      observe("error", `Briefing fetch failed: HTTP ${res.status}`, {
        phase: "scan", source: "signals.ts", data: { status: res.status },
      });
      return null;
    }

    const data = res.data;
    const summary = data?.summary || data?.data?.summary || data?.text || data?.data?.text;
    if (!summary || typeof summary !== "string") {
      return null; // no summary field — briefing not available
    }

    observe("insight", `Fetched briefing: ${summary.length} chars`, {
      phase: "scan", source: "signals.ts",
    });
    return summary;
  } catch (err: any) {
    observe("error", `Briefing fetch exception: ${err?.message || String(err)}`, {
      phase: "scan",
      source: "signals.ts",
    });
    return null;
  }
}

// ── Scoring ────────────────────────────────────────

/**
 * Score how well a topic aligns with current network signals.
 *
 * Returns a ranking modifier between -10 and +10:
 * - sentinel: rewards convergent strong signals (consensus validator)
 * - pioneer: rewards divergence and low-coverage topics (contrarian seeder)
 * - crawler: neutral (deep research, signal-agnostic)
 *
 * Topic matching uses case-insensitive token overlap between the
 * query topic and signal topic strings.
 */
/** Default: pioneer rewards topics with ≤ this many agents covering them */
const DEFAULT_LOW_COVERAGE_THRESHOLD = 2;

export function scoreSignalAlignment(
  topic: string,
  snapshot: SignalSnapshot,
  agentMode: "sentinel" | "pioneer" | "crawler",
  options?: { lowCoverageThreshold?: number }
): number {
  if (!snapshot.topics.length) return 0;
  if (agentMode === "crawler") return 0;

  const queryTokens = tokenize(topic);
  if (!queryTokens.length) return 0;

  // Find best-matching signal topic
  let bestMatch: SignalTopic | null = null;
  let bestOverlap = 0;

  for (const st of snapshot.topics) {
    const signalTokens = tokenize(st.topic);
    const overlap = countOverlap(queryTokens, signalTokens);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestMatch = st;
    }
  }

  // Need at least one token overlap to consider it a match
  if (!bestMatch || bestOverlap === 0) return 0;

  if (agentMode === "sentinel") {
    // Sentinel rewards convergent, high-quality signals
    if (bestMatch.evidenceQuality === "strong") return 5;
    if (bestMatch.evidenceQuality === "moderate") return 3;
    return 1;
  }

  if (agentMode === "pioneer") {
    // Pioneer rewards divergence (contrarian signal) and low-coverage topics
    if (bestMatch.divergence) return 5;
    if (bestMatch.agentCount <= (options?.lowCoverageThreshold ?? DEFAULT_LOW_COVERAGE_THRESHOLD)) return 3;
    return 0;
  }

  return 0;
}

// ── Helpers ────────────────────────────────────────

/**
 * Tokenize a topic string into lowercase words for fuzzy matching.
 * Strips common noise words and punctuation.
 */
function tokenize(text: string): string[] {
  const STOP_WORDS = new Set(["the", "a", "an", "is", "are", "of", "in", "on", "to", "for", "and", "or", "with"]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * Count overlapping tokens between two token arrays.
 */
function countOverlap(a: string[], b: string[]): number {
  const setB = new Set(b);
  let count = 0;
  for (const token of a) {
    if (setB.has(token)) count++;
  }
  return count;
}

/**
 * Normalize a raw signal topic from API response into typed SignalTopic.
 * Applies defensive defaults for missing fields.
 */
function normalizeSignalTopic(raw: any): SignalTopic {
  const VALID_DIRECTIONS = new Set(["bullish", "bearish", "neutral", "mixed", "alert"]);
  const VALID_QUALITY = new Set(["strong", "moderate", "weak"]);

  return {
    topic: String(raw.topic || ""),
    direction: VALID_DIRECTIONS.has(raw.direction) ? raw.direction : "neutral",
    confidence: clamp(Number(raw.confidence) || 0, 0, 100),
    agentCount: Math.max(0, Math.floor(Number(raw.agentCount) || 0)),
    evidenceQuality: VALID_QUALITY.has(raw.evidenceQuality) ? raw.evidenceQuality : "weak",
    divergence: Boolean(raw.divergence),
    staleAt: raw.staleAt ? String(raw.staleAt) : undefined,
  };
}

/**
 * Normalize a raw signal alert from API response.
 */
function normalizeSignalAlert(raw: any): SignalAlert {
  return {
    topic: String(raw.topic || ""),
    severity: String(raw.severity || "info"),
    summary: String(raw.summary || ""),
  };
}

/**
 * Clamp a number between min and max.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
