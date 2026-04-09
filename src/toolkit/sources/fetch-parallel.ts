import type { SourceRecordV2 } from "./catalog.js";
import type { ColonyDatabase } from "../colony/schema.js";
import { createLimiter } from "../util/limiter.js";
import { upsertSourceResponse, getSourceResponse } from "../colony/source-cache.js";
import { fetchSource } from "./fetch.js";
import { acquireRateLimitToken } from "./rate-limit.js";
import { persistRatingUpdate, persistTransition } from "./lifecycle.js";
import type { SourceTestResult } from "./health.js";

/**
 * Fetch sources in parallel (concurrency 3) with a wall-clock budget.
 * Results are cached to the colony DB source_response_cache.
 *
 * Phase 12b: Integrates rate limiting (per-source throttle) and lifecycle
 * management (update ratings + evaluate transitions after each fetch).
 *
 * Moved from cli/v3-loop-helpers.ts to toolkit in Phase 18 — source pipeline wiring.
 * All dependencies are toolkit-internal (ADR-0002 compliant).
 */
export async function fetchSourcesParallel(
  sources: SourceRecordV2[],
  db: ColonyDatabase,
  observe: (type: string, msg: string, meta?: Record<string, unknown>) => void,
  budgetMs = 15_000,
  concurrency = 3,
): Promise<{ fetched: number; cached: number; lifecycleTransitions: number }> {
  let fetched = 0;
  let cached = 0;
  let rateLimited = 0;
  const fetchOutcomes: Array<{ source: SourceRecordV2; success: boolean }> = [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), budgetMs);
  try {
    const limit = createLimiter(concurrency);
    const results = await Promise.allSettled(
      sources.map((source) =>
        limit(async () => {
          if (ctrl.signal.aborted) return;

          // Per-source rate limiting — different providers have different quota windows
          if (!acquireRateLimitToken(source.provider)) {
            rateLimited++;
            observe("insight", `Rate-limited: skipping ${source.id} (${source.provider})`, {
              source: "v3-loop:rateLimit",
              sourceId: source.id,
              provider: source.provider,
            });
            return;
          }

          try {
            const result = await fetchSource(source.url, source);
            fetched++;
            if (result.ok && result.response) {
              upsertSourceResponse(db, {
                sourceId: source.id,
                url: result.response.url,
                lastFetchedAt: new Date().toISOString(),
                responseStatus: result.response.status,
                responseSize: result.response.bodyText.length,
                responseBody: result.response.bodyText.slice(0, 10000),
                ttlSeconds: 900,
                consecutiveFailures: 0,
              });
              cached++;
              fetchOutcomes.push({ source, success: true });
            } else {
              fetchOutcomes.push({ source, success: false });
            }
          } catch (err: unknown) {
            observe("warning", `Source fetch failed for ${source.id}`, {
              source: "v3-loop:sourceFetch",
              sourceId: source.id,
              error: err instanceof Error ? err.message : String(err),
            });
            upsertSourceResponse(db, {
              sourceId: source.id,
              url: source.url,
              lastFetchedAt: new Date().toISOString(),
              responseStatus: 0,
              responseSize: 0,
              responseBody: "",
              ttlSeconds: 900,
              consecutiveFailures: (getSourceResponse(db, source.id)?.consecutiveFailures ?? 0) + 1,
            });
            fetchOutcomes.push({ source, success: false });
          }
        }),
      ),
    );
  } finally {
    clearTimeout(timer);
  }

  if (rateLimited > 0) {
    observe("insight", `Rate limiting: ${rateLimited} source(s) throttled this cycle`, {
      source: "v3-loop:rateLimit",
      rateLimited,
    });
  }

  // Lifecycle — persist ratings and evaluate transitions so degraded sources get auto-demoted
  // Uses persistRatingUpdate/persistTransition to write results to colony DB (survives across sessions)
  // Wrapped in a single transaction to avoid per-source disk syncs (N sources → 1 commit)
  let lifecycleTransitions = 0;
  const persistLifecycleBatch = db.transaction(() => {
    for (const { source, success } of fetchOutcomes) {
      const testResult: SourceTestResult = {
        sourceId: source.id,
        provider: source.provider,
        status: success ? "OK" : "FETCH_FAILED",
        latencyMs: 0,
        entryCount: 0,
        sampleTitles: [],
        error: null,
      };
      const updated = persistRatingUpdate(db, source, testResult);
      const transition = persistTransition(db, updated, testResult);
      if (transition.newStatus !== null) {
        lifecycleTransitions++;
        observe("insight", `Source lifecycle: ${source.id} ${transition.currentStatus}→${transition.newStatus} (${transition.reason})`, {
          source: "v3-loop:sourceLifecycle",
          sourceId: source.id,
          from: transition.currentStatus,
          to: transition.newStatus,
          reason: transition.reason,
        });
      }
    }
  });
  persistLifecycleBatch();

  return { fetched, cached, lifecycleTransitions };
}
