/**
 * Source prefetch with cascading fallback.
 *
 * Tries candidates sequentially until one succeeds or maxAttempts is exhausted.
 * Emits observe() insight events on fallback for pipeline observability.
 *
 * Toolkit-layer primitive — no imports from cli/ or src/lib/.
 */

import { toErrorMessage } from "../util/errors.js";

// ── Types ──────────────────────────────────────────

export interface PrefetchCandidate {
  sourceId: string;
  url: string;
  method?: string;
  score?: number;
}

export interface PrefetchResult {
  success: boolean;
  candidate: PrefetchCandidate;
  data?: unknown;
  error?: string;
  attemptIndex: number;
  totalAttempts: number;
}

// ── Core ───────────────────────────────────────────

const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Try candidates sequentially, returning the first successful result.
 *
 * On each failure, calls `observe("insight", ...)` with fallback metadata.
 * If all candidates fail (or maxAttempts is reached), returns `{ success: false }`
 * with the last error message.
 */
export async function prefetchWithFallback(
  candidates: PrefetchCandidate[],
  fetchFn: (candidate: PrefetchCandidate) => Promise<unknown>,
  observe?: (type: string, msg: string, meta?: Record<string, unknown>) => void,
  maxAttempts?: number,
): Promise<PrefetchResult> {
  const limit = Math.min(
    maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    candidates.length,
  );

  if (limit === 0) {
    return {
      success: false,
      candidate: { sourceId: "", url: "" },
      attemptIndex: 0,
      totalAttempts: 0,
      error: "no candidates provided",
    };
  }

  let lastError = "";

  for (let i = 0; i < limit; i++) {
    const candidate = candidates[i];
    try {
      const data = await fetchFn(candidate);
      return {
        success: true,
        candidate,
        data,
        attemptIndex: i,
        totalAttempts: i + 1,
      };
    } catch (err: unknown) {
      lastError = toErrorMessage(err);
      observe?.(
        "insight",
        `Source prefetch fallback from ${candidate.sourceId}`,
        { candidateIndex: i, sourceId: candidate.sourceId, error: lastError },
      );
    }
  }

  return {
    success: false,
    candidate: candidates[limit - 1],
    error: lastError,
    attemptIndex: limit - 1,
    totalAttempts: limit,
  };
}
