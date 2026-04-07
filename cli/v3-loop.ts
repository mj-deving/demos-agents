import {
  getSensePayload,
  mergeExecutionResults,
  getScanContext,
  createHookLogger,
  getStrategySpecDir,
  type LightExecutionResult,
  type HeavyExecutionResult,
} from "./v3-loop-helpers.js";
import { runSenseWork } from "./v3-loop-sense.js";
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
import { SuperColonyApiClient } from "../src/toolkit/supercolony/api-client.js";
import { ApiDataSource, ChainDataSource, AutoDataSource } from "../src/toolkit/data-source.js";
import { createToolkit } from "../src/toolkit/primitives/index.js";
import { ensureAuth, loadAuthCache } from "../src/lib/auth/auth.js";
import { executeStrategyActions } from "./action-executor.js";
import { executePublishActions } from "./publish-executor.js";
import { initStrategyBridge, plan, computePerformance, type StrategyBridge } from "./v3-strategy-bridge.js";

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

  const { demos, address } = await deps.connectWallet(flags.env);
  const sdkBridge = createSdkBridge(demos, undefined, AUTH_PENDING_TOKEN);

  let authToken: string | null = null;
  try {
    authToken = await ensureAuth(demos, address);
  } catch {
    deps.observe("warning", "Auth failed — continuing in chain-only mode", { source: "v3-loop:auth" });
  }

  // M1: Track token age and refresh if stale (>30 min) for multi-hour sessions
  let tokenObtainedAt = Date.now();
  const TOKEN_MAX_AGE_MS = 30 * 60 * 1000;

  const getToken = async () => {
    const tokenAge = Date.now() - tokenObtainedAt;
    if (tokenAge > TOKEN_MAX_AGE_MS) {
      try {
        const refreshed = await ensureAuth(demos, address);
        if (refreshed) {
          authToken = refreshed;
          tokenObtainedAt = Date.now();
          deps.observe("insight", "Auth token refreshed (stale >30 min)", { source: "v3-loop:auth" });
        }
      } catch {
        deps.observe("warning", "Auth token refresh failed — using cached", { source: "v3-loop:auth" });
      }
    }
    return authToken ?? loadAuthCache(address)?.token ?? null;
  };
  const apiClient = new SuperColonyApiClient({ getToken });

  const { apiCall: rawApiCall } = await import("../src/lib/network/sdk.js");
  const authenticatedApiCall = async (path: string, options?: RequestInit) => {
    const token = await getToken();
    return rawApiCall(path, token, options);
  };
  const apiDataSource = new ApiDataSource(apiClient);
  const chainDataSource = new ChainDataSource(sdkBridge as any);
  const dataSource = new AutoDataSource(apiDataSource, chainDataSource);
  const toolkit = createToolkit({
    apiClient,
    dataSource,
    transferDem: (to, amount, memo) => sdkBridge.transferDem(to, amount, memo),
  });

  // Test xmcore NAPI capability at startup (non-fatal)
  try {
    const { testNapiCapability } = await import("../src/toolkit/chain/napi-guard.js");
    const napi = await testNapiCapability();
    deps.observe(napi.available ? "insight" : "warning",
      `XMCore NAPI: ${napi.available ? "available" : `unavailable (${napi.error})`}`,
      { source: "v3-loop:napiGuard", ...napi },
    );
  } catch { /* NAPI guard itself failed — not critical */ }

  const hookLogger = createHookLogger(deps);

  using bridge: StrategyBridge = initStrategyBridge(
    flags.agent,
    deps.agentConfig.paths.strategyYaml,
    address,
  );

  const limits = bridge.config?.limits;

  // Resolve chain author address — wallet address may differ from chain pubkey
  let chainAddress = address;
  try {
    const row = bridge.db.prepare(
      `SELECT DISTINCT author FROM posts WHERE author LIKE ? ORDER BY rowid DESC LIMIT 1`,
    ).get(`${address.slice(0, 18)}%`) as { author: string } | undefined;
    if (row?.author && row.author !== address) {
      chainAddress = row.author;
      bridge.updateWalletAddress(chainAddress);
      deps.observe("insight", `Chain address resolved: ${address.slice(0, 16)}→${chainAddress.slice(0, 16)}`, { source: "v3-loop:chainAddress" });
    }
  } catch { /* non-fatal — use wallet address as fallback */ }

  // ── SENSE PHASE ──
  if (state.phases.sense.status !== "completed") {
    const beforeSenseCtx: BeforeSenseContext = {
      state, config: deps.agentConfig,
      flags: { agent: flags.agent, env: flags.env, log: flags.log, dryRun: flags.dryRun, pretty: flags.pretty },
      logger: hookLogger,
    };
    await runBeforeSense(extensionRegistry, deps.agentConfig.loopExtensions, beforeSenseCtx);
    for (const err of beforeSenseCtx.hookErrors || []) {
      deps.observe(err.isTimeout ? "inefficiency" : "error", `beforeSense hook "${err.hook}" failed`, {
        hook: err.hook, error: err.error, elapsed: err.elapsed, isTimeout: err.isTimeout, source: "v3-loop:beforeSense",
      });
    }

    const senseStart = Date.now();
    beginPhase(state, "sense", sessionsDir);
    try {
      const senseWork = await runSenseWork({
        demos, bridge, dataSource, toolkit, apiClient, authToken, authenticatedApiCall, limits,
        agentConfig: deps.agentConfig, getSourceView: deps.getSourceView,
        observe: deps.observe, runSubprocess: deps.runSubprocess,
        flags: { agent: flags.agent, env: flags.env },
      });

      state.strategyResults = {
        ...state.strategyResults,
        senseResult: senseWork.senseResult,
        apiEnrichment: senseWork.apiEnrichment,
        calibration: senseWork.calibration,
      };

      completePhase(state, "sense", { scan: senseWork.scanResult, strategy: senseWork.senseResult, apiEnrichment: senseWork.apiEnrichment }, sessionsDir);
      deps.observe("checkpoint", "SENSE phase complete", { source: "v3-loop:sense", elapsedMs: Date.now() - senseStart });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      failPhase(state, "sense", message, sessionsDir);
      throw error;
    }
  }

  // ── ACT PHASE ──
  let actResult: unknown = undefined;

  if (state.phases.act.status !== "completed") {
    const actStart = Date.now();
    beginPhase(state, "act", sessionsDir);
    try {
      const sensePayload = getSensePayload(state);
      if (!sensePayload?.strategy) throw new Error("Missing V3 sense result");

      const identityLookup = async (lookupAddress: string): Promise<Array<{ platform: string; username: string }> | null> => {
        try {
          const result = await toolkit.identity.lookup({ chain: "demos", address: lookupAddress });
          if (!result?.ok || !result.data) return null;
          const data = result.data as { found?: boolean; platform?: string; username?: string };
          if (!data.found) return null;
          return data.platform && data.username ? [{ platform: data.platform, username: data.username }] : null;
        } catch { return null; }
      };

      const planResult = await plan(
        bridge, sensePayload.strategy, (state.engagements || []).length,
        {
          apiEnrichment: state.strategyResults?.apiEnrichment as ApiEnrichmentData | undefined,
          calibration: state.strategyResults?.calibration as import("./v3-strategy-bridge.js").CalibrationState | undefined,
          briefingContext: state.briefingContext,
          identityLookup,
        },
      );
      state.strategyResults = { ...state.strategyResults, planResult };

      if (planResult.actions.length > 0) {
        for (const action of planResult.actions) {
          deps.observe("action-planned", `${action.type} p=${action.priority} — ${action.reason.slice(0, 120)}`, {
            source: "v3-loop:plan", type: action.type, priority: action.priority,
            target: action.target?.slice(0, 16), targetType: action.targetType,
          });
        }
      }

      if (planResult.actions.length > 0 && !flags.shadow) {
        const light = planResult.actions.filter((a) => a.type === "ENGAGE" || a.type === "TIP");
        const heavy = planResult.actions.filter((a) =>
          a.type === "PUBLISH" || a.type === "REPLY" || a.type === "VOTE" || a.type === "BET",
        );

        const lightResult: LightExecutionResult = light.length > 0
          ? await executeStrategyActions(light, {
              bridge: {
                apiCall: authenticatedApiCall,
                publishHivePost: sdkBridge.publishHivePost.bind(sdkBridge),
                transferDem: (to, amount) => sdkBridge.transferDem(to, amount, "Strategy action tip"),
              },
              dryRun: flags.dryRun, observe: deps.observe, colonyDb: bridge.db, ourAddress: chainAddress,
            })
          : { executed: [], skipped: [] };

        const provider = deps.resolveProvider(flags.env);
        const heavyResult: HeavyExecutionResult = heavy.length > 0
          ? await executePublishActions(heavy, {
              demos, walletAddress: chainAddress, provider, agentConfig: deps.agentConfig,
              sourceView: deps.getSourceView(), state, sessionsDir, observe: deps.observe,
              dryRun: flags.dryRun, stateStore: bridge.store, colonyDb: bridge.db,
              calibrationOffset: (state.strategyResults?.calibration as { offset?: number } | undefined)?.offset ?? 0,
              scanContext: getScanContext(sensePayload.scan),
              adapters: loadDeclarativeProviderAdaptersSync({ specDir: getStrategySpecDir() }),
              usageTracker: createUsageTracker(),
              logSession: (entry) => appendSessionLog(entry as SessionLogEntry, flags.log),
              logQuality: (data) => logQualityData(data as QualityDataEntry),
              spending: { policy: defaultSpendingPolicy({ autonomous: flags.oversight === "autonomous" }), ledger: loadSpendingLedger(address, deps.agentConfig.name) },
            })
          : { executed: [], skipped: [] };

        actResult = mergeExecutionResults(lightResult, heavyResult);

        const merged = actResult as { executed: Array<{ success: boolean }>; skipped: unknown[] };
        const successCount = merged.executed.filter((e) => e.success).length;
        if (merged.executed.length > 0 && successCount === 0) {
          throw new Error(`All ${merged.executed.length} action(s) failed. Skipped: ${merged.skipped.length}. See session log for details.`);
        }
      } else {
        state.publishSuppressed = flags.shadow ? true : state.publishSuppressed;
        actResult = { skipped: true, reason: flags.shadow ? "shadow" : "no actions" };
      }

      state.strategyResults = { ...state.strategyResults, executionResult: actResult };
      completePhase(state, "act", actResult, sessionsDir);
      deps.observe("checkpoint", "ACT phase complete", { source: "v3-loop:act", elapsedMs: Date.now() - actStart });

      try {
        await runAfterAct(extensionRegistry, deps.agentConfig.loopExtensions, {
          state, config: deps.agentConfig, actResult,
          flags: { agent: flags.agent, env: flags.env, log: flags.log, dryRun: flags.dryRun, pretty: flags.pretty },
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

  // ── CONFIRM PHASE ──
  if (state.phases.confirm.status !== "completed") {
    const confirmStart = Date.now();
    beginPhase(state, "confirm", sessionsDir);
    try {
      if (state.posts.length > 0) {
        const txHashes = state.posts.map((post) => typeof post === "string" ? post : post.txHash);
        const verifyResult = await deps.runSubprocess(
          "cli/verify.ts", [...txHashes, "--json", "--log", flags.log, "--env", flags.env], "verify",
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

    deps.observe("checkpoint", "CONFIRM phase complete", { source: "v3-loop:confirm", elapsedMs: Date.now() - confirmStart });

    if (state.publishedPosts && state.publishedPosts.length > 0) {
      try {
        await runAfterConfirm(extensionRegistry, deps.agentConfig.loopExtensions, {
          state, config: deps.agentConfig, publishedPosts: state.publishedPosts,
          confirmResult: state.phases.confirm?.result, logger: hookLogger,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        deps.observe("error", `afterConfirm hooks failed: ${message}`, { source: "v3-loop:afterConfirm" });
      }
    }
  }
}
