import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { V3SessionState } from "../src/lib/state.js";
import type { HookLogger } from "../src/lib/util/extensions.js";
import { insertPost, countPosts } from "../src/toolkit/colony/posts.js";
import { insertEmbedding } from "../src/toolkit/colony/search.js";
import { embedBatch } from "../src/toolkit/colony/embeddings.js";
import type { CachedPost } from "../src/toolkit/colony/posts.js";
import type { ColonyDatabase } from "../src/toolkit/colony/schema.js";
import { createLimiter } from "../src/toolkit/util/limiter.js";
import { upsertSourceResponse, getSourceResponse } from "../src/toolkit/colony/source-cache.js";
import { fetchSource } from "../src/toolkit/sources/fetch.js";
import type { SourceRecordV2 } from "../src/toolkit/sources/catalog.js";
import { acquireRateLimitToken, isRateLimited } from "../src/toolkit/sources/rate-limit.js";
import { updateRating, evaluateTransition } from "../src/toolkit/sources/lifecycle.js";
import type { SourceTestResult } from "../src/toolkit/sources/health.js";

import type { V3LoopDeps } from "./v3-loop.js";
import type { executeStrategyActions } from "./action-executor.js";
import type { executePublishActions } from "./publish-executor.js";

export type LightExecutionResult = Awaited<ReturnType<typeof executeStrategyActions>>;
export type HeavyExecutionResult = Awaited<ReturnType<typeof executePublishActions>>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- sense result shapes are validated at runtime
export function getSensePayload(state: V3SessionState): { scan: any; strategy: any } | null {
  const phaseResult = state.phases.sense?.result as { scan?: unknown; strategy?: unknown } | undefined;
  const strategy = state.strategyResults?.senseResult ?? phaseResult?.strategy;
  const scan = phaseResult?.scan ?? {};

  if (strategy) {
    return { scan, strategy };
  }

  return null;
}

/**
 * Ingest chain posts into the colony SQLite DB using ScanPost[] from the SDK.
 * scan-feed writes to a JSON cache with filtered/truncated posts — not suitable for the colony DB.
 * We fetch the full posts directly via the SDK bridge and insert them with full text + metadata.
 */
export async function ingestChainPostsIntoColonyDb(
  db: import("../src/toolkit/colony/schema.js").ColonyDatabase,
  chainPosts: import("../src/toolkit/types.js").ScanPost[],
  observe: (type: string, msg: string, meta?: Record<string, unknown>) => void,
): Promise<void> {
  const before = countPosts(db);

  if (chainPosts.length === 0) return;

  // Temporarily disable FK checks — reply parents may not be in the DB yet.
  // insertPost uses ON CONFLICT upsert, so re-ingesting the parent later is safe.
  db.pragma("foreign_keys = OFF");
  try {
    const ingest = db.transaction((posts: import("../src/toolkit/types.js").ScanPost[]) => {
      for (const p of posts) {
        const tsNum = Number(p.timestamp);
        const tsDate = Number.isFinite(tsNum) ? new Date(tsNum) : null;
        if (!tsDate || isNaN(tsDate.getTime())) {
          observe("warning", `Post ${p.txHash} has invalid timestamp ${p.timestamp} — skipped`, {
            source: "v3-loop:ingestChainPosts",
            txHash: p.txHash,
            rawTimestamp: p.timestamp,
          });
          continue;
        }
        const post: CachedPost = {
          txHash: p.txHash,
          author: p.author,
          blockNumber: p.blockNumber ?? 0,
          timestamp: tsDate.toISOString(),
          replyTo: p.replyTo ?? null,
          tags: p.tags ?? [],
          text: p.text,
          rawData: { category: p.category, reactions: p.reactions, reactionsKnown: p.reactionsKnown },
        };
        if (post.blockNumber === 0) {
          observe("warning", `Post ${p.txHash} missing blockNumber — inserted with 0`, {
            source: "v3-loop:ingestChainPosts",
            txHash: p.txHash,
          });
        }
        if (post.txHash) insertPost(db, post);
      }
    });
    ingest(chainPosts);
  } finally {
    db.pragma("foreign_keys = ON");
  }

  // Invalidate contradiction cache once after batch (not per-insert)
  const { invalidateContradictionCache } = await import("../src/toolkit/colony/contradiction-scanner.js");
  invalidateContradictionCache();

  // TODO: Advance cursor once SDK bridge supports sinceBlock param for incremental ingestion.
  // Currently getHivePosts(limit) fetches the latest N posts regardless of cursor position.

  const after = countPosts(db);
  const newCount = after - before;
  observe("insight", `Colony DB: ingested ${newCount} new posts (${after} total, ${chainPosts.length} from chain)`, {
    source: "v3-loop:ingestChainPosts",
    newPosts: newCount,
    totalPosts: after,
    chainFetched: chainPosts.length,
  });

  // Embed newly inserted posts for semantic search (non-blocking on failure)
  if (newCount > 0) {
    try {
      const unembedded = db.prepare(`
        SELECT p.rowid as rid, p.text FROM posts p
        LEFT JOIN post_embeddings pe ON pe.post_rowid = p.rowid
        WHERE pe.post_rowid IS NULL
        ORDER BY p.rowid DESC LIMIT ?
      `).all(Math.min(newCount, 500)) as Array<{ rid: number; text: string }>;

      if (unembedded.length > 0) {
        const embeddings = await embedBatch(unembedded.map((r) => r.text));
        let embedded = 0;
        for (let i = 0; i < unembedded.length; i++) {
          if (embeddings[i]) {
            insertEmbedding(db, unembedded[i].rid, embeddings[i]!);
            embedded++;
          }
        }
        if (embedded > 0) {
          observe("insight", `Embedded ${embedded} new posts for semantic search`, {
            source: "v3-loop:embedPosts", embedded,
          });
        }
      }
    } catch {
      // Embedding failure is non-critical — search falls back to FTS5
    }
  }
}

export function mergeExecutionResults(lightResult: LightExecutionResult, heavyResult: HeavyExecutionResult) {
  return {
    executed: [...lightResult.executed, ...heavyResult.executed],
    skipped: [...lightResult.skipped, ...heavyResult.skipped],
    light: lightResult,
    heavy: heavyResult,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getScanContext(scanResult: any): { activity_level: string; posts_per_hour: number; gaps?: string[] } {
  return {
    activity_level: scanResult?.activity?.level || "unknown",
    posts_per_hour: Number(scanResult?.activity?.posts_per_hour || 0),
    gaps: Array.isArray(scanResult?.gaps?.topics)
      ? scanResult.gaps.topics.filter((topic: unknown): topic is string => typeof topic === "string")
      : undefined,
  };
}

export function createHookLogger(deps: V3LoopDeps): HookLogger {
  return {
    info: (message) => deps.observe("insight", message, { source: "v3-loop:hook" }),
    result: (message) => deps.observe("insight", message, { source: "v3-loop:hook" }),
  };
}

export function getStrategySpecDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../src/lib/sources/providers/specs");
}

/**
 * Fetch sources in parallel (concurrency 3) with a wall-clock budget.
 * Results are cached to the colony DB source_response_cache.
 *
 * Phase 12b: Integrates rate limiting (per-source throttle) and lifecycle
 * management (update ratings + evaluate transitions after each fetch).
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

          // Phase 12b: Per-source rate limiting
          if (isRateLimited(source.provider)) {
            rateLimited++;
            observe("insight", `Rate-limited: skipping ${source.id} (${source.provider})`, {
              source: "v3-loop:rateLimit",
              sourceId: source.id,
              provider: source.provider,
            });
            return;
          }
          acquireRateLimitToken(source.provider);

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

  // Phase 12b: Lifecycle — update ratings and evaluate transitions after fetch
  let lifecycleTransitions = 0;
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
    const updated = updateRating(source, testResult);
    const transition = evaluateTransition(updated, testResult);
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

  return { fetched, cached, lifecycleTransitions };
}
