/**
 * v3-loop-sense.ts — SENSE phase data-gathering logic.
 *
 * Extracted from v3-loop.ts to keep the orchestrator lean.
 * Handles: colony sync, chain ingestion, proof ingestion, source fetch,
 * SSE feed, strategy sense, API enrichment, and calibration.
 */

import { toErrorMessage } from "../src/toolkit/util/errors.js";
import {
  ingestChainPostsIntoColonyDb,
  fetchSourcesParallel,
} from "./v3-loop-helpers.js";
import type { AgentConfig } from "../src/lib/agent-config.js";
import type { AgentSourceView } from "../src/lib/sources/catalog.js";
import type { ApiEnrichmentData, LoopLimitsConfig } from "../src/toolkit/strategy/types.js";
import {
  LeaderboardResultSchema,
  OracleResultSchema,
  PriceDataSchema,
  SignalDataSchema,
  BettingPoolSchema,
  AgentListSchema,
} from "../src/toolkit/supercolony/api-schemas.js";
import type { SuperColonyApiClient } from "../src/toolkit/supercolony/api-client.js";
import type { AutoDataSource } from "../src/toolkit/data-source.js";
import type { Toolkit } from "../src/toolkit/primitives/index.js";
import { sense, computeAutoCalibration, type StrategyBridge } from "./v3-strategy-bridge.js";
import { refreshAgentProfiles } from "../src/toolkit/colony/intelligence.js";
import { deriveIntentsFromTopics, deriveIntentsFromSignalTopics, selectSourcesByIntent } from "../src/lib/pipeline/source-scanner.js";

export interface SenseWorkDeps {
  demos: any;
  bridge: StrategyBridge;
  dataSource: AutoDataSource;
  toolkit: Toolkit;
  apiClient: SuperColonyApiClient;
  authToken: string | null;
  authenticatedApiCall: (path: string, options?: RequestInit) => Promise<{ ok: boolean; data?: unknown }>;
  limits: LoopLimitsConfig | undefined;
  agentConfig: AgentConfig;
  getSourceView: () => AgentSourceView;
  observe: (type: string, message: string, meta?: Record<string, unknown>) => void;
  runSubprocess: (script: string, args: string[], label: string) => Promise<unknown>;
  flags: { agent: string; env: string };
}

export interface SenseWorkResult {
  scanResult: unknown;
  senseResult: ReturnType<typeof sense>;
  apiEnrichment: ApiEnrichmentData | undefined;
  calibration: ReturnType<typeof computeAutoCalibration>;
}

/**
 * Executes the SENSE phase data-gathering work.
 * Colony sync → scan-feed → chain ingestion → proofs → sources → SSE → strategy sense → enrichment → calibration.
 */
export async function runSenseWork(deps: SenseWorkDeps): Promise<SenseWorkResult> {
  const { bridge, dataSource, toolkit, limits, observe } = deps;

  // Colony sync from API
  try {
    const { syncColonyFromApi } = await import("../src/toolkit/colony/api-backfill.js");
    const syncStats = await syncColonyFromApi(bridge.db, deps.apiClient, {
      onProgress: (s) => {
        if (s.pages % 50 === 0 && s.pages > 0) {
          observe("insight", `Colony sync: page ${s.pages}, ${s.inserted} new, ${s.duplicates} existing`, { source: "v3-loop:colonySync" });
        }
      },
    });
    if (syncStats.inserted > 0) {
      observe("insight", `Colony sync: ${syncStats.inserted} new posts from API (${syncStats.pages} pages)`, {
        source: "v3-loop:colonySync",
        ...syncStats,
      });
    }
  } catch (err) {
    observe("warning", `Colony sync failed: ${err instanceof Error ? err.message : String(err)}`, { source: "v3-loop:colonySync" });
  }

  // M2: DB growth monitoring — warn if colony DB exceeds 500MB
  try {
    const { statSync } = await import("node:fs");
    const dbPath = (bridge.db as any).name;
    if (typeof dbPath === "string") {
      const dbSizeMB = Math.round(statSync(dbPath).size / (1024 * 1024));
      if (dbSizeMB > 500) {
        observe("warning", `Colony DB size: ${dbSizeMB}MB exceeds 500MB threshold`, {
          source: "v3-loop:dbGrowth", dbSizeMB,
        });
      }
    }
  } catch { /* non-fatal — skip size check if path unavailable */ }

  const scanResult = await deps.runSubprocess(
    "cli/scan-feed.ts",
    ["--agent", deps.flags.agent, "--json", "--env", deps.flags.env],
    "scan-feed",
  );

  // Fetch full chain posts via API-first data source, ingest into colony DB
  const chainPosts = await dataSource.getRecentPosts(limits?.recentPostsFetchLimit ?? 500);
  await ingestChainPostsIntoColonyDb(bridge.db, chainPosts, observe);

  // Proof ingestion + agent profile refresh in parallel
  const parallelResults = await Promise.allSettled([
    (async () => {
      try {
        const { createChainReaderFromSdk } = await import("../src/toolkit/colony/proof-ingestion-rpc-adapter.js");
        const { ingestProofs } = await import("../src/toolkit/colony/proof-ingestion.js");
        const chainReader = createChainReaderFromSdk(deps.demos, { concurrency: limits?.proofIngestionConcurrency ?? 5 });
        const ingestionResult = await ingestProofs(bridge.db, chainReader, { limit: limits?.proofIngestionLimit ?? 20 });
        if (ingestionResult.resolved > 0 || ingestionResult.failed > 0) {
          observe("insight", `Proof ingestion: ${ingestionResult.verified} verified, ${ingestionResult.failed} failed, ${ingestionResult.skipped} skipped`, {
            source: "v3-loop:proofIngestion",
            ...ingestionResult,
          });
        }
      } catch (err: unknown) {
        observe("warning", `Proof ingestion failed (non-fatal): ${toErrorMessage(err)}`, {
          source: "v3-loop:proofIngestion",
        });
      }
    })(),
    (async () => {
      try {
        const profilesRefreshed = refreshAgentProfiles(bridge.db);
        if (profilesRefreshed > 0) {
          observe("insight", `Agent profiles refreshed: ${profilesRefreshed} updated`, {
            source: "v3-loop:intelligence",
            profilesRefreshed,
          });
        }
      } catch (err: unknown) {
        observe("warning", `Agent profile refresh failed: ${toErrorMessage(err)}`, {
          source: "v3-loop:intelligence",
        });
      }
    })(),
  ]);
  // Log any unexpected rejections from parallel operations
  for (const r of parallelResults) {
    if (r.status === "rejected") {
      observe("warning", `Parallel sense operation rejected: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`, { source: "v3-loop:parallelSense" });
    }
  }

  // API Enrichment via Toolkit Primitives — fetched BEFORE source selection
  // so that colony signal topics can drive source fetch (signal-driven, not config-driven).
  const apiEnrichment = await fetchApiEnrichment(toolkit, limits, observe);

  // Fetch sources in parallel with wall-clock budget.
  // Intents derived from BOTH agent config topics AND colony signal topics.
  const sourceView = deps.getSourceView();
  const configIntents = deps.agentConfig.topics?.primary?.length
    ? deriveIntentsFromTopics(deps.agentConfig.topics)
    : [];

  // Extract signal topics from API enrichment and derive additional intents
  const signalTopics = apiEnrichment?.signals
    ?.filter(s => s.topic)
    .map(s => s.topic) ?? [];
  const knownDomainTags = sourceView?.index?.byDomainTag
    ? new Set(sourceView.index.byDomainTag.keys())
    : undefined;
  const signalIntents = deriveIntentsFromSignalTopics(signalTopics, knownDomainTags);

  if (signalIntents.length > 0) {
    observe("insight", `Signal-driven sources: ${signalIntents.length} signal topics added to source selection`, {
      source: "v3-loop:sourceFetch",
      signalTopics,
    });
  }

  const allIntents = [...configIntents, ...signalIntents];
  const selectedSources = allIntents.flatMap((intent) =>
    selectSourcesByIntent(intent, sourceView).slice(0, limits?.sourcesPerIntent ?? 5),
  );

  // Deduplicate sources (config and signal intents may select overlapping sources)
  const seenSourceIds = new Set<string>();
  const dedupedSources = selectedSources.filter(s => {
    if (seenSourceIds.has(s.id)) return false;
    seenSourceIds.add(s.id);
    return true;
  });

  // Health filtering: skip degraded/stale/deprecated/archived sources (Phase 12b)
  const UNHEALTHY_STATUSES = new Set(["degraded", "stale", "deprecated", "archived"]);
  const healthySources = dedupedSources.filter(s => !UNHEALTHY_STATUSES.has(s.status));
  const skippedCount = dedupedSources.length - healthySources.length;
  if (skippedCount > 0) {
    observe("insight", `Source health filter: skipped ${skippedCount} unhealthy source(s)`, {
      source: "v3-loop:sourceHealth",
      skipped: skippedCount,
      total: dedupedSources.length,
      healthy: healthySources.length,
    });
  }

  // Bump concurrency to 10 when signal-driven sources are included — sources are
  // live data feeds (prices, news) that must be fetched fresh every cycle.
  // The 15s wall-clock budget already caps total time.
  const effectiveConcurrency = signalIntents.length > 0
    ? Math.max(limits?.sourceFetchConcurrency ?? 3, 10)
    : limits?.sourceFetchConcurrency ?? 3;

  const { fetched: sourcesFetched, cached: sourcesCached, lifecycleTransitions } =
    await fetchSourcesParallel(healthySources, bridge.db, observe, limits?.sourceFetchBudgetMs ?? 15_000, effectiveConcurrency);
  if (sourcesFetched > 0) {
    observe("insight", `Source fetch: ${sourcesFetched} fetched, ${sourcesCached} stored (${healthySources.length} selected)`, {
      source: "v3-loop:sourceFetch",
      sourcesFetched,
      sourcesCached,
      totalSelected: healthySources.length,
    });
  }
  if (lifecycleTransitions > 0) {
    observe("insight", `Source lifecycle: ${lifecycleTransitions} status transition(s) applied`, {
      source: "v3-loop:sourceLifecycle",
      transitions: lifecycleTransitions,
    });
  }

  // SSE Feed (optional, time-bounded)
  if (deps.authToken) {
    try {
      const { readSSESense } = await import("./sse-sense-adapter.js");
      const sseResult = await readSSESense(
        bridge.db,
        deps.authenticatedApiCall,
        observe,
        { timeoutMs: limits?.sseTimeoutMs ?? 5_000, maxEvents: limits?.sseMaxEvents ?? 100 },
      );
      if (sseResult.postsIngested > 0) {
        observe("insight", `SSE sense: ${sseResult.postsIngested} new posts ingested (${sseResult.source})`, {
          source: "v3-loop:sseSense",
          sseSource: sseResult.source,
          postsReceived: sseResult.postsReceived,
          postsIngested: sseResult.postsIngested,
          elapsedMs: sseResult.elapsedMs,
        });
      }
    } catch (err: unknown) {
      observe("warning", `SSE sense failed (non-fatal): ${toErrorMessage(err)}`, {
        source: "v3-loop:sseSense",
      });
    }
  }

  const senseResult = sense(bridge, sourceView);

  // Calibration
  const calibration = computeAutoCalibration(bridge);

  return { scanResult, senseResult, apiEnrichment, calibration };
}

/** Fetch API enrichment data from all toolkit endpoints. Returns undefined on total failure. */
async function fetchApiEnrichment(
  toolkit: Toolkit,
  limits: LoopLimitsConfig | undefined,
  observe: (type: string, msg: string, meta?: Record<string, unknown>) => void,
): Promise<ApiEnrichmentData | undefined> {
  try {
    const [agentsResult, leaderboardResult, oracleResult, pricesResult, signalsResult, bettingPoolResult] = await Promise.all([
      toolkit.agents.list(),
      toolkit.scores.getLeaderboard({ limit: limits?.leaderboardLimit ?? 20 }),
      toolkit.oracle.get(),
      toolkit.prices.get(["BTC", "ETH", "DEM"]),
      toolkit.intelligence.getSignals(),
      toolkit.ballot.getPool({ asset: "BTC" }),
    ]);

    const apiEnrichment: ApiEnrichmentData = {};

    const validate = <T>(name: string, raw: { ok: true; data: unknown } | { ok: false; [k: string]: unknown } | null, schema: { safeParse: (d: unknown) => { success: boolean; data?: T; error?: { message: string } } }): T | undefined => {
      if (!raw || !raw.ok) return undefined;
      const r = schema.safeParse(raw.data);
      if (r.success) return r.data as T;
      observe("warning", `API schema validation failed: ${name}`, { source: "v3-loop:enrichment", error: r.error?.message }); return undefined;
    };

    const agentList = validate("agents", agentsResult, AgentListSchema);
    if (agentList) apiEnrichment.agentCount = agentList.agents.length;

    apiEnrichment.leaderboard = validate("leaderboard", leaderboardResult, LeaderboardResultSchema);
    apiEnrichment.oracle = validate("oracle", oracleResult, OracleResultSchema);
    apiEnrichment.prices = validate("prices", pricesResult, PriceDataSchema.array());
    apiEnrichment.bettingPool = validate("bettingPool", bettingPoolResult, BettingPoolSchema);
    apiEnrichment.signals = validate("signals", signalsResult, SignalDataSchema.array());

    const enrichmentKeys = Object.keys(apiEnrichment);
    if (enrichmentKeys.length > 0) {
      observe("insight", `API enrichment: ${enrichmentKeys.length} feeds (${enrichmentKeys.join(", ")})`, {
        source: "v3-loop:apiEnrichment",
        feeds: enrichmentKeys,
      });
    }

    return apiEnrichment;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    observe("warning", `API enrichment batch failed (non-fatal): ${msg}`, { source: "v3-loop:apiEnrichment" });
    return undefined;
  }
}
