import { toErrorMessage } from "../src/toolkit/util/errors.js";
import {
  getSensePayload,
  ingestChainPostsIntoColonyDb,
  mergeExecutionResults,
  getScanContext,
  createHookLogger,
  getStrategySpecDir,
  type LightExecutionResult,
  type HeavyExecutionResult,
} from "./v3-loop-helpers.js";
import { beginPhase, completePhase, failPhase, type V3SessionState } from "../src/lib/state.js";
import type { AgentConfig } from "../src/lib/agent-config.js";
import type { LLMProvider } from "../src/lib/llm/llm-provider.js";
import type { AgentSourceView } from "../src/lib/sources/catalog.js";
import { logQualityData, type QualityDataEntry } from "../src/lib/scoring/quality-score.js";
import { appendSessionLog, type SessionLogEntry } from "../src/lib/util/log.js";
import { runBeforeSense, runAfterAct, runAfterConfirm, type ExtensionHookRegistry, type BeforeSenseContext } from "../src/lib/util/extensions.js";
import { createUsageTracker } from "../src/lib/attestation/attestation-planner.js";
import { loadDeclarativeProviderAdaptersSync } from "../src/lib/sources/providers/declarative-engine.js";
import { AUTH_PENDING_TOKEN, createSdkBridge } from "../src/toolkit/sdk-bridge.js";
import { defaultSpendingPolicy, loadSpendingLedger } from "../src/lib/spending-policy.js";
import type { ApiEnrichmentData } from "../src/toolkit/strategy/types.js";
import {
  LeaderboardResultSchema,
  OracleResultSchema,
  PriceDataSchema,
  BallotAccuracySchema,
  SignalDataSchema,
} from "../src/toolkit/supercolony/api-schemas.js";
import { executeStrategyActions } from "./action-executor.js";
import { executePublishActions } from "./publish-executor.js";
import { initStrategyBridge, sense, plan, computePerformance, computeAutoCalibration, type StrategyBridge } from "./v3-strategy-bridge.js";
import { refreshAgentProfiles } from "../src/toolkit/colony/intelligence.js";
import { upsertSourceResponse, getSourceResponse } from "../src/toolkit/colony/source-cache.js";
import { deriveIntentsFromTopics, selectSourcesByIntent } from "../src/lib/pipeline/source-scanner.js";
import { fetchSource } from "../src/toolkit/sources/fetch.js";

export interface V3LoopFlags {
  agent: string;
  env: string;
  log: string;
  dryRun: boolean;
  pretty: boolean;
  shadow: boolean;
  oversight: "full" | "approve" | "autonomous";
}

export interface V3LoopDeps {
  runSubprocess: (script: string, args: string[], label: string) => Promise<unknown>;
  connectWallet: (envPath: string) => Promise<{ demos: any; address: string }>;
  resolveProvider: (envPath: string) => LLMProvider | null;
  agentConfig: AgentConfig;
  getSourceView: () => AgentSourceView;
  observe: (type: string, message: string, meta?: Record<string, unknown>) => void;
}

export async function runV3Loop(
  state: V3SessionState,
  flags: V3LoopFlags,
  sessionsDir: string,
  extensionRegistry: ExtensionHookRegistry,
  deps: V3LoopDeps,
): Promise<void> {
  if (flags.oversight !== "autonomous") {
    throw new Error("V3 loop supports only --oversight autonomous. Use --legacy-loop for interactive/manual modes.");
  }

  // Connect wallet before bridge init so strategy performance and rate-limits use the real address.
  const { demos, address } = await deps.connectWallet(flags.env);

  // Single SDK bridge instance — reused across sense (ingest) and act (execute) phases.
  const sdkBridge = createSdkBridge(demos, undefined, AUTH_PENDING_TOKEN);

  // Phase 8 Feature 6: Test xmcore NAPI capability at startup (non-fatal)
  try {
    const { testNapiCapability } = await import("../src/toolkit/chain/napi-guard.js");
    const napi = await testNapiCapability();
    deps.observe(napi.available ? "insight" : "warning",
      `XMCore NAPI: ${napi.available ? "available" : `unavailable (${napi.error})`}`,
      { source: "v3-loop:napiGuard", ...napi },
    );
  } catch {
    // NAPI guard itself failed — not critical
  }

  const hookLogger = createHookLogger(deps);

  using bridge: StrategyBridge = initStrategyBridge(
    flags.agent,
    deps.agentConfig.paths.strategyYaml,
    address,
  );

  if (state.phases.sense.status !== "completed") {
    const beforeSenseCtx: BeforeSenseContext = {
      state,
      config: deps.agentConfig,
      flags: {
        agent: flags.agent,
        env: flags.env,
        log: flags.log,
        dryRun: flags.dryRun,
        pretty: flags.pretty,
      },
      logger: hookLogger,
    };

    await runBeforeSense(extensionRegistry, deps.agentConfig.loopExtensions, beforeSenseCtx);
    for (const err of beforeSenseCtx.hookErrors || []) {
      deps.observe(err.isTimeout ? "inefficiency" : "error", `beforeSense hook "${err.hook}" failed`, {
        hook: err.hook,
        error: err.error,
        elapsed: err.elapsed,
        isTimeout: err.isTimeout,
        source: "v3-loop:beforeSense",
      });
    }

    beginPhase(state, "sense", sessionsDir);
    try {
      const scanResult = await deps.runSubprocess(
        "cli/scan-feed.ts",
        ["--agent", flags.agent, "--json", "--env", flags.env],
        "scan-feed",
      );

      // Bridge the gap: scan-feed writes JSON cache with truncated posts,
      // but strategy engine reads full posts from the colony SQLite DB.
      // Fetch full chain posts via SDK and ingest into colony DB.
      await ingestChainPostsIntoColonyDb(bridge.db, sdkBridge, deps.observe);

      // Proof ingestion: resolve unverified attestations against the chain
      try {
        const { createChainReaderFromSdk } = await import("../src/toolkit/colony/proof-ingestion-rpc-adapter.js");
        const { ingestProofs } = await import("../src/toolkit/colony/proof-ingestion.js");
        const chainReader = createChainReaderFromSdk(demos, { concurrency: 5 });
        const ingestionResult = await ingestProofs(bridge.db, chainReader, { limit: 20 });
        if (ingestionResult.resolved > 0 || ingestionResult.failed > 0) {
          deps.observe("insight", `Proof ingestion: ${ingestionResult.verified} verified, ${ingestionResult.failed} failed, ${ingestionResult.skipped} skipped`, {
            source: "v3-loop:proofIngestion",
            ...ingestionResult,
          });
        }
      } catch (err: unknown) {
        deps.observe("warning", `Proof ingestion failed (non-fatal): ${toErrorMessage(err)}`, {
          source: "v3-loop:proofIngestion",
        });
      }

      // Full recompute of agent profiles from colony DB.
      // Incremental (since param) double-counts overlapping windows — full recompute is correct.
      // 188K posts GROUP BY author takes <1s on SQLite WAL.
      try {
        const profilesRefreshed = refreshAgentProfiles(bridge.db);
        if (profilesRefreshed > 0) {
          deps.observe("insight", `Agent profiles refreshed: ${profilesRefreshed} updated`, {
            source: "v3-loop:intelligence",
            profilesRefreshed,
          });
        }
      } catch (err: unknown) {
        deps.observe("warning", `Agent profile refresh failed: ${err instanceof Error ? err.message : String(err)}`, {
          source: "v3-loop:intelligence",
        });
      }

      // Fetch sources and cache responses so computeAvailableEvidence() has data.
      // The strategy engine gates ALL actions on evidence from source_response_cache.
      const sourceView = deps.getSourceView();
      const topics = deps.agentConfig.topics;
      const intents = topics?.primary?.length ? deriveIntentsFromTopics(topics) : [];
      let sourcesFetched = 0;
      let sourcesCached = 0;
      const sourceFetchStart = Date.now();
      const SOURCE_FETCH_BUDGET_MS = 15_000; // 15s max for all source fetches
      for (const intent of intents) {
        if (Date.now() - sourceFetchStart > SOURCE_FETCH_BUDGET_MS) break;
        const sources = selectSourcesByIntent(intent, sourceView);
        for (const source of sources.slice(0, 5)) {
          if (Date.now() - sourceFetchStart > SOURCE_FETCH_BUDGET_MS) break;
          try {
            const result = await fetchSource(source.url, source);
            sourcesFetched++;
            if (result.ok && result.response) {
              upsertSourceResponse(bridge.db, {
                sourceId: source.id,
                url: result.response.url,
                lastFetchedAt: new Date().toISOString(),
                responseStatus: result.response.status,
                responseSize: result.response.bodyText.length,
                responseBody: result.response.bodyText.slice(0, 10000),
                ttlSeconds: 900,
                consecutiveFailures: 0,
              });
              sourcesCached++;
            }
          } catch (err: unknown) {
            deps.observe("warning", `Source fetch failed for ${source.id}`, {
              source: "v3-loop:sourceFetch",
              sourceId: source.id,
              error: err instanceof Error ? err.message : String(err),
            });
            upsertSourceResponse(bridge.db, {
              sourceId: source.id,
              url: source.url,
              lastFetchedAt: new Date().toISOString(),
              responseStatus: 0,
              responseSize: 0,
              responseBody: "",
              ttlSeconds: 900,
              consecutiveFailures: (getSourceResponse(bridge.db, source.id)?.consecutiveFailures ?? 0) + 1,
            });
          }
        }
      }
      if (sourcesFetched > 0) {
        deps.observe("insight", `Source fetch: ${sourcesCached}/${sourcesFetched} cached in colony DB`, {
          source: "v3-loop:sourceFetch",
          sourcesFetched,
          sourcesCached,
        });
      }

      // ── SSE Feed (optional, time-bounded) ── Feature 7
      if (sdkBridge.apiAccess === "authenticated") {
        try {
          const { readSSESense } = await import("./sse-sense-adapter.js");
          const sseResult = await readSSESense(
            bridge.db,
            sdkBridge.apiCall.bind(sdkBridge),
            deps.observe,
            { timeoutMs: 5_000, maxEvents: 100 },
          );
          if (sseResult.postsIngested > 0) {
            deps.observe("insight", `SSE sense: ${sseResult.postsIngested} new posts ingested (${sseResult.source})`, {
              source: "v3-loop:sseSense",
              sseSource: sseResult.source,
              postsReceived: sseResult.postsReceived,
              postsIngested: sseResult.postsIngested,
              elapsedMs: sseResult.elapsedMs,
            });
          }
        } catch (err: unknown) {
          deps.observe("warning", `SSE sense failed (non-fatal): ${toErrorMessage(err)}`, {
            source: "v3-loop:sseSense",
          });
        }
      }

      const senseResult = sense(bridge, sourceView);

      // ── API Enrichment (optional, graceful degradation) ──
      let apiEnrichment: ApiEnrichmentData | undefined;
      if (sdkBridge.apiAccess === "authenticated") {
        try {
          const enrichmentTimeout = 5_000;
          const safeCall = (path: string) =>
            sdkBridge.apiCall(path, { signal: AbortSignal.timeout(enrichmentTimeout) }).catch(() => null);

          const [agentsRaw, leaderboardRaw, oracleRaw, pricesRaw, ballotAccRaw, signalsRaw] = await Promise.all([
            safeCall("/api/agents"),
            safeCall("/api/scores/agents?limit=20"),
            safeCall("/api/oracle"),
            safeCall("/api/prices?assets=BTC,ETH,DEM"),
            safeCall(`/api/ballot/accuracy?address=${encodeURIComponent(bridge.walletAddress)}`),
            safeCall("/api/signals"),
          ]);

          apiEnrichment = {};

          if (agentsRaw?.ok && agentsRaw.data && typeof agentsRaw.data === "object") {
            const agents = (agentsRaw.data as { agents?: unknown[] }).agents;
            if (Array.isArray(agents)) {
              apiEnrichment.agentCount = agents.length;
            }
          }
          const validate = <T>(name: string, raw: { ok: boolean; data: unknown } | null, schema: { safeParse: (d: unknown) => { success: boolean; data?: T; error?: { message: string } } }): T | undefined => {
            if (!raw?.ok) return undefined;
            const r = schema.safeParse(raw.data);
            if (r.success) return r.data as T;
            deps.observe("warning", `API schema validation failed: ${name}`, { source: "v3-loop:enrichment", error: r.error?.message }); return undefined;
          };
          apiEnrichment.leaderboard = validate("leaderboard", leaderboardRaw, LeaderboardResultSchema);
          apiEnrichment.oracle = validate("oracle", oracleRaw, OracleResultSchema);
          apiEnrichment.prices = validate("prices", pricesRaw, PriceDataSchema.array());
          apiEnrichment.ballotAccuracy = validate("ballot", ballotAccRaw, BallotAccuracySchema);
          apiEnrichment.signals = validate("signals", signalsRaw, SignalDataSchema.array());

          const enrichmentKeys = Object.keys(apiEnrichment);
          if (enrichmentKeys.length > 0) {
            deps.observe("insight", `API enrichment: ${enrichmentKeys.length} feeds (${enrichmentKeys.join(", ")})`, {
              source: "v3-loop:apiEnrichment",
              feeds: enrichmentKeys,
            });
          }
        } catch {
          // API enrichment is optional — continue with colony DB data only.
        }
      }

      // Compute calibration once in sense phase — avoids hot-path DB query during act
      const calibration = computeAutoCalibration(bridge);

      state.strategyResults = {
        ...state.strategyResults,
        senseResult,
        apiEnrichment,
        calibration,
      };

      completePhase(state, "sense", { scan: scanResult, strategy: senseResult, apiEnrichment }, sessionsDir);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      failPhase(state, "sense", message, sessionsDir);
      throw error;
    }
  }

  let actResult: unknown = undefined;

  if (state.phases.act.status !== "completed") {
    beginPhase(state, "act", sessionsDir);
    try {
      const sensePayload = getSensePayload(state);
      if (!sensePayload?.strategy) {
        throw new Error("Missing V3 sense result");
      }

      // Phase 7: Build identity lookup from SDK bridge (graceful — returns null on failure)
      const identityLookup = sdkBridge.apiAccess === "authenticated"
        ? async (address: string): Promise<Array<{ platform: string; username: string }> | null> => {
            try {
              const result = await sdkBridge.apiCall(
                `/api/identity?chain=demos&address=${encodeURIComponent(address)}`,
                { signal: AbortSignal.timeout(3_000) },
              );
              if (!result.ok || !result.data) return null;
              const data = result.data as { found?: boolean; platform?: string; username?: string };
              if (!data.found) return null;
              return data.platform && data.username
                ? [{ platform: data.platform, username: data.username }]
                : null;
            } catch {
              return null;
            }
          }
        : undefined;

      const planResult = await plan(
        bridge,
        sensePayload.strategy,
        (state.engagements || []).length,
        {
          apiEnrichment: state.strategyResults?.apiEnrichment as ApiEnrichmentData | undefined,
          calibration: state.strategyResults?.calibration as import("./v3-strategy-bridge.js").CalibrationState | undefined,
          briefingContext: state.briefingContext,
          identityLookup,
        },
      );
      state.strategyResults = {
        ...state.strategyResults,
        planResult,
      };

      if (planResult.actions.length > 0 && !flags.shadow) {
        const light = planResult.actions.filter((action) => action.type === "ENGAGE" || action.type === "TIP");
        // VOTE/BET route through heavy path (publish-executor) — Codex review fix H1
        const heavy = planResult.actions.filter((action) =>
          action.type === "PUBLISH" || action.type === "REPLY" || action.type === "VOTE" || action.type === "BET",
        );

        const lightResult: LightExecutionResult =
          light.length > 0
            ? await executeStrategyActions(light, {
                bridge: {
                  apiCall: sdkBridge.apiCall.bind(sdkBridge),
                  publishHivePost: sdkBridge.publishHivePost.bind(sdkBridge),
                  transferDem: (to, amount) => sdkBridge.transferDem(to, amount, "Strategy action tip"),
                },
                dryRun: flags.dryRun,
                observe: deps.observe,
                colonyDb: bridge.db,
                ourAddress: address,
              })
            : { executed: [], skipped: [] };

        const provider = deps.resolveProvider(flags.env);
        const heavyResult: HeavyExecutionResult =
          heavy.length > 0
            ? await executePublishActions(heavy, {
                demos,
                walletAddress: address,
                provider,
                agentConfig: deps.agentConfig,
                sourceView: deps.getSourceView(),
                state,
                sessionsDir,
                observe: deps.observe,
                dryRun: flags.dryRun,
                stateStore: bridge.store,
                colonyDb: bridge.db,
                calibrationOffset: (state.strategyResults?.calibration as { offset?: number } | undefined)?.offset ?? 0,
                scanContext: getScanContext(sensePayload.scan),
                adapters: loadDeclarativeProviderAdaptersSync({ specDir: getStrategySpecDir() }),
                usageTracker: createUsageTracker(),
                logSession: (entry) => appendSessionLog(entry as SessionLogEntry, flags.log),
                logQuality: (data) => logQualityData(data as QualityDataEntry),
                spending: { policy: defaultSpendingPolicy(), ledger: loadSpendingLedger(address, deps.agentConfig.name) },
              })
            : { executed: [], skipped: [] };

        actResult = mergeExecutionResults(lightResult, heavyResult);

        // Fail ACT if all actions failed — don't silently succeed
        const merged = actResult as { executed: Array<{ success: boolean }>; skipped: unknown[] };
        const successCount = merged.executed.filter((e) => e.success).length;
        if (merged.executed.length > 0 && successCount === 0) {
          throw new Error(
            `All ${merged.executed.length} action(s) failed. ` +
            `Skipped: ${merged.skipped.length}. See session log for details.`,
          );
        }
      } else {
        state.publishSuppressed = flags.shadow ? true : state.publishSuppressed;
        actResult = {
          skipped: true,
          reason: flags.shadow ? "shadow" : "no actions",
        };
      }

      state.strategyResults = {
        ...state.strategyResults,
        executionResult: actResult,
      };

      completePhase(state, "act", actResult, sessionsDir);

      try {
        await runAfterAct(extensionRegistry, deps.agentConfig.loopExtensions, {
          state,
          config: deps.agentConfig,
          actResult,
          flags: {
            agent: flags.agent,
            env: flags.env,
            log: flags.log,
            dryRun: flags.dryRun,
            pretty: flags.pretty,
          },
          logger: hookLogger,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        deps.observe("error", `afterAct hooks failed: ${message}`, { source: "v3-loop:afterAct" });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      failPhase(state, "act", message, sessionsDir);
      throw error;
    }
  }

  if (state.phases.confirm.status !== "completed") {
    beginPhase(state, "confirm", sessionsDir);
    try {
      if (state.posts.length > 0) {
        const txHashes = state.posts.map((post) => typeof post === "string" ? post : post.txHash);
        const verifyResult = await deps.runSubprocess(
          "cli/verify.ts",
          [...txHashes, "--json", "--log", flags.log, "--env", flags.env],
          "verify",
        );
        const perfScores = computePerformance(bridge);
        completePhase(state, "confirm", { verify: verifyResult, performance: perfScores }, sessionsDir);
      } else {
        completePhase(state, "confirm", { skipped: true, reason: "no posts" }, sessionsDir);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      failPhase(state, "confirm", message, sessionsDir);
      throw error;
    }

    if (state.publishedPosts && state.publishedPosts.length > 0) {
      try {
        await runAfterConfirm(extensionRegistry, deps.agentConfig.loopExtensions, {
          state,
          config: deps.agentConfig,
          publishedPosts: state.publishedPosts,
          confirmResult: state.phases.confirm?.result,
          logger: hookLogger,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        deps.observe("error", `afterConfirm hooks failed: ${message}`, { source: "v3-loop:afterConfirm" });
      }
    }
  }
}
