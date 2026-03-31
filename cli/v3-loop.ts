import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beginPhase, completePhase, failPhase, type V3SessionState } from "../src/lib/state.js";
import type { AgentConfig } from "../src/lib/agent-config.js";
import type { LLMProvider } from "../src/lib/llm/llm-provider.js";
import type { AgentSourceView } from "../src/lib/sources/catalog.js";
import type { QualityDataEntry } from "../src/lib/scoring/quality-score.js";
import type { SessionLogEntry } from "../src/lib/util/log.js";
import { logQualityData } from "../src/lib/scoring/quality-score.js";
import { appendSessionLog } from "../src/lib/util/log.js";
import {
  runBeforeSense,
  runAfterAct,
  runAfterConfirm,
  type ExtensionHookRegistry,
  type BeforeSenseContext,
  type HookLogger,
} from "../src/lib/util/extensions.js";
import { createUsageTracker } from "../src/lib/attestation/attestation-planner.js";
import { loadDeclarativeProviderAdaptersSync } from "../src/lib/sources/providers/declarative-engine.js";
import { AUTH_PENDING_TOKEN, createSdkBridge } from "../src/toolkit/sdk-bridge.js";
import { executeStrategyActions } from "./action-executor.js";
import { executePublishActions } from "./publish-executor.js";
import { initStrategyBridge, sense, plan, computePerformance } from "./v3-strategy-bridge.js";
import type { StrategyBridge } from "./v3-strategy-bridge.js";

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

type LightExecutionResult = Awaited<ReturnType<typeof executeStrategyActions>>;
type HeavyExecutionResult = Awaited<ReturnType<typeof executePublishActions>>;

function readCalibrationOffset(path: string): number {
  if (!existsSync(path)) return 0;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as { calibrationOffset?: unknown };
    return typeof data.calibrationOffset === "number" ? data.calibrationOffset : 0;
  } catch {
    return 0;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- sense result shapes are validated at runtime
function getSensePayload(state: V3SessionState): { scan: any; strategy: any } | null {
  const phaseResult = state.phases.sense?.result as { scan?: unknown; strategy?: unknown } | undefined;
  const strategy = state.strategyResults?.senseResult ?? phaseResult?.strategy;
  const scan = phaseResult?.scan ?? {};

  if (strategy) {
    return { scan, strategy };
  }

  return null;
}

function mergeExecutionResults(lightResult: LightExecutionResult, heavyResult: HeavyExecutionResult) {
  return {
    executed: [...lightResult.executed, ...heavyResult.executed],
    skipped: [...lightResult.skipped, ...heavyResult.skipped],
    light: lightResult,
    heavy: heavyResult,
  };
}

function getScanContext(scanResult: any): { activity_level: string; posts_per_hour: number; gaps?: string[] } {
  return {
    activity_level: scanResult?.activity?.level || "unknown",
    posts_per_hour: Number(scanResult?.activity?.posts_per_hour || 0),
    gaps: Array.isArray(scanResult?.gaps?.topics)
      ? scanResult.gaps.topics.filter((topic: unknown): topic is string => typeof topic === "string")
      : undefined,
  };
}

function createHookLogger(deps: V3LoopDeps): HookLogger {
  return {
    info: (message) => deps.observe("insight", message, { source: "v3-loop:hook" }),
    result: (message) => deps.observe("insight", message, { source: "v3-loop:hook" }),
  };
}

function getStrategySpecDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../src/lib/sources/providers/specs");
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
      const sourceView = deps.getSourceView();
      const senseResult = sense(bridge, sourceView);

      state.strategyResults = {
        ...state.strategyResults,
        senseResult,
      };

      completePhase(state, "sense", { scan: scanResult, strategy: senseResult }, sessionsDir);
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

      const planResult = await plan(bridge, sensePayload.strategy, (state.engagements || []).length);
      state.strategyResults = {
        ...state.strategyResults,
        planResult,
      };

      if (planResult.actions.length > 0 && !flags.shadow) {
        const light = planResult.actions.filter((action) => action.type === "ENGAGE" || action.type === "TIP");
        const heavy = planResult.actions.filter((action) => action.type === "PUBLISH" || action.type === "REPLY");

        const sdkBridge = createSdkBridge(demos, undefined, AUTH_PENDING_TOKEN);
        const lightResult: LightExecutionResult =
          light.length > 0
            ? await executeStrategyActions(light, {
                bridge: {
                  publishHiveReaction: sdkBridge.publishHiveReaction.bind(sdkBridge),
                  publishHivePost: sdkBridge.publishHivePost.bind(sdkBridge),
                  transferDem: (to, amount) => sdkBridge.transferDem(to, amount, "Strategy action tip"),
                },
                dryRun: flags.dryRun,
                observe: deps.observe,
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
                calibrationOffset: readCalibrationOffset(deps.agentConfig.paths.improvementsFile),
                scanContext: getScanContext(sensePayload.scan),
                adapters: loadDeclarativeProviderAdaptersSync({ specDir: getStrategySpecDir() }),
                usageTracker: createUsageTracker(),
                logSession: (entry) => appendSessionLog(entry as SessionLogEntry, flags.log),
                logQuality: (data) => logQualityData(data as QualityDataEntry),
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
