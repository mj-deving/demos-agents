/**
 * Source health testing — probe sources for fetch+parse correctness.
 *
 * Uses the full adapter pipeline: supports() → buildCandidates() →
 * validateCandidate() → fetchSource() → parseResponse().
 *
 * This module is the reusable library; the CLI tool at tools/source-test.ts
 * handles arg parsing and output formatting.
 *
 * Import graph:
 *   health.ts → ./fetch.ts (fetchSource)
 *   health.ts → ./providers/index.ts (getProviderAdapter)
 *   health.ts → ./providers/types.ts (ProviderAdapter, EvidenceEntry)
 *   health.ts → ./catalog.ts (SourceRecordV2, tokenizeTopic)
 */

import type { SourceRecordV2 } from "./catalog.js";
import { tokenizeTopic } from "./catalog.js";
import { fetchSource } from "./fetch.js";
import { getProviderAdapter } from "./providers/index.js";
import type { ProviderAdapter } from "./providers/types.js";
import { toErrorMessage } from "../errors.js";

// ── Types ────────────────────────────────────────────

export type SourceTestStatus =
  | "OK"
  | "EMPTY"
  | "FETCH_FAILED"
  | "PARSE_FAILED"
  | "NO_ADAPTER"
  | "NOT_SUPPORTED"
  | "VALIDATION_REJECTED"
  | "NO_CANDIDATES"
  | "UNRESOLVED_VARS";

export interface SourceTestResult {
  sourceId: string;
  provider: string;
  status: SourceTestStatus;
  latencyMs: number;
  entryCount: number;
  sampleTitles: string[];
  error: string | null;
}

export interface FilterOptions {
  sourceId?: string;
  provider?: string;
  quarantined?: boolean;
}

// ── Default Test Variables ────────────────────────────

/**
 * Default variable values for URL template resolution during testing.
 * Used when no custom overrides are provided.
 */
export const DEFAULT_TEST_VARS: Record<string, string> = {
  asset: "bitcoin",
  symbol: "BTC",
  query: "technology",
  topic: "technology",
  currency: "usd",
  pair: "XBTUSD",
  category: "cs.AI",
  term: "artificial intelligence",
  indicator: "NY.GDP.MKTP.CD",
  country: "US",
  language: "en",
  date: new Date().toISOString().slice(0, 10),
};

// ── URL Resolution ───────────────────────────────────

/**
 * Resolve template variables in a URL for testing.
 * Priority: custom overrides → source topicAliases → defaults.
 */
export function resolveTestUrl(
  url: string,
  customVars: Record<string, string>,
  source?: SourceRecordV2,
): string {
  // Build merged variable map
  const vars: Record<string, string> = { ...DEFAULT_TEST_VARS };

  // Use source topicAliases[0] for query-like variables if available
  if (source?.topicAliases?.length) {
    vars.query = source.topicAliases[0];
    vars.term = source.topicAliases[0];
  }

  // Custom overrides take highest priority
  Object.assign(vars, customVars);

  // Replace {variable} patterns
  return url.replace(/\{([^}]+)\}/g, (match, key) => {
    return vars[key] ?? match; // leave unresolved if no default
  });
}

/**
 * Check for unresolved template variables in a URL.
 * Returns the list of unresolved variable names.
 */
function unresolvedVars(url: string): string[] {
  const matches = url.match(/\{([^}]+)\}/g) || [];
  return matches.map((m) => m.slice(1, -1));
}

// ── Source Filtering ─────────────────────────────────

/**
 * Filter a list of sources by ID, provider, or quarantine status.
 * By default, returns only active sources unless quarantined=true.
 */
export function filterSources(
  sources: SourceRecordV2[],
  options: FilterOptions,
): SourceRecordV2[] {
  let filtered = sources;

  // Status filter
  if (options.quarantined) {
    filtered = filtered.filter((s) => s.status === "quarantined");
  } else {
    filtered = filtered.filter((s) => s.status === "active" || s.status === "degraded");
  }

  // ID filter
  if (options.sourceId) {
    const id = options.sourceId.toLowerCase();
    filtered = filtered.filter((s) =>
      s.id.toLowerCase() === id || s.name.toLowerCase() === id
    );
  }

  // Provider filter
  if (options.provider) {
    const provider = options.provider.toLowerCase();
    filtered = filtered.filter((s) => s.provider.toLowerCase() === provider);
  }

  return filtered;
}

// ── Core Test Function ───────────────────────────────

/**
 * Test a single source for health.
 *
 * Uses the full adapter pipeline:
 *   1. getProviderAdapter() — find adapter
 *   2. adapter.buildCandidates() — generate test URL via adapter logic
 *   3. adapter.validateCandidate() — validate URL constraints
 *   4. fetchSource() — fetch with retry + rate limiting
 *   5. adapter.parseResponse() — parse into evidence entries
 *
 * Falls back to direct URL resolution when adapter doesn't generate candidates.
 */
export async function testSource(
  source: SourceRecordV2,
  customVars: Record<string, string> = {},
): Promise<SourceTestResult> {
  const base: Omit<SourceTestResult, "status" | "error" | "latencyMs" | "entryCount" | "sampleTitles"> = {
    sourceId: source.id,
    provider: source.provider,
  };

  // Step 1: Get adapter
  const adapter = getProviderAdapter(source.provider);
  if (!adapter) {
    return {
      ...base,
      status: "NO_ADAPTER",
      latencyMs: 0,
      entryCount: 0,
      sampleTitles: [],
      error: `No adapter for provider "${source.provider}"`,
    };
  }

  // Step 2: Check adapter supports this source
  if (!adapter.supports(source)) {
    return {
      ...base,
      status: "NOT_SUPPORTED",
      latencyMs: 0,
      entryCount: 0,
      sampleTitles: [],
      error: `Adapter "${adapter.provider}" does not support source "${source.id}"`,
    };
  }

  // Step 3: Build test URL via adapter pipeline
  let testUrl: string;
  const testTopic = source.topicAliases?.[0] || source.topics?.[0] || "test";
  const tokens = tokenizeTopic(testTopic);

  try {
    const candidates = adapter.buildCandidates({
      source,
      topic: testTopic,
      tokens: [...tokens],
      vars: { ...DEFAULT_TEST_VARS, ...customVars },
      attestation: source.tlsn_safe ? "TLSN" : "DAHR",
      maxCandidates: 1,
    });

    if (candidates.length === 0) {
      // Adapter exists but produced no candidates — matches runtime behavior (skip)
      return {
        ...base,
        status: "NO_CANDIDATES",
        latencyMs: 0,
        entryCount: 0,
        sampleTitles: [],
        error: "Adapter produced no candidates for test topic",
      };
    }

    // Validate the candidate
    const validation = adapter.validateCandidate(candidates[0]);
    if (!validation.ok) {
      return {
        ...base,
        status: "VALIDATION_REJECTED",
        latencyMs: 0,
        entryCount: 0,
        sampleTitles: [],
        error: validation.reason || "Candidate validation failed",
      };
    }
    testUrl = validation.rewrittenUrl || candidates[0].url;
  } catch (err: unknown) {
    return {
      ...base,
      status: "NO_CANDIDATES",
      latencyMs: 0,
      entryCount: 0,
      sampleTitles: [],
      error: `buildCandidates failed: ${toErrorMessage(err)}`,
    };
  }

  // Step 3: Check for unresolved variables
  const unresolved = unresolvedVars(testUrl);
  if (unresolved.length > 0) {
    return {
      ...base,
      status: "UNRESOLVED_VARS",
      latencyMs: 0,
      entryCount: 0,
      sampleTitles: [],
      error: `Unresolved variables: ${unresolved.join(", ")}`,
    };
  }

  // Step 4: Fetch
  let latencyMs = 0;
  try {
    const fetchResult = await fetchSource(testUrl, source, {
      rateLimitBucket: adapter.rateLimit.bucket,
      rateLimitRpm: adapter.rateLimit.maxPerMinute,
      rateLimitRpd: adapter.rateLimit.maxPerDay,
    });

    latencyMs = fetchResult.totalMs;

    if (!fetchResult.ok || !fetchResult.response) {
      return {
        ...base,
        status: "FETCH_FAILED",
        latencyMs,
        entryCount: 0,
        sampleTitles: [],
        error: fetchResult.error || "Fetch returned ok=false",
      };
    }

    // Step 5: Parse
    try {
      const parsed = adapter.parseResponse(source, fetchResult.response);

      if (parsed.entries.length === 0) {
        return {
          ...base,
          status: "EMPTY",
          latencyMs,
          entryCount: 0,
          sampleTitles: [],
          error: null,
        };
      }

      return {
        ...base,
        status: "OK",
        latencyMs,
        entryCount: parsed.entries.length,
        sampleTitles: parsed.entries
          .slice(0, 3)
          .map((e) => e.title || "(untitled)")
          .filter(Boolean),
        error: null,
      };
    } catch (err: unknown) {
      return {
        ...base,
        status: "PARSE_FAILED",
        latencyMs,
        entryCount: 0,
        sampleTitles: [],
        error: toErrorMessage(err),
      };
    }
  } catch (err: unknown) {
    return {
      ...base,
      status: "FETCH_FAILED",
      latencyMs,
      entryCount: 0,
      sampleTitles: [],
      error: toErrorMessage(err),
    };
  }
}
