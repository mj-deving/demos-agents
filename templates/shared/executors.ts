/**
 * Shared template executor factory.
 * Bridges the toolkit boundary (ADR-0019) for all templates.
 *
 * Lives in templates/ (not src/toolkit/) because it imports from cli/
 * which toolkit cannot depend on (ADR-0002).
 */
import { resolve } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { executeStrategyActions } from "../../cli/action-executor.js";
import { executePublishActions } from "../../cli/publish-executor.js";
import { FileStateStore } from "../../src/toolkit/state-store.js";
import { learnFirstObserve } from "../../src/toolkit/observe/learn-first-observe.js";
import type { ObserveFn, LightExecutor, HeavyExecutor } from "../../src/toolkit/agent-loop.js";
import type { SourceDeps } from "../../src/toolkit/observe/observe-router.js";

/**
 * Create light + heavy executor pair for a template agent.
 * Parameterized by label, agentConfig, sourceView, and dryRun flag.
 */
export function createTemplateExecutors(
  label: string,
  agentConfig: any,
  sourceView: any,
  dryRun: boolean,
  tipMemo = "Template tip",
) {
  const executeLightActions: LightExecutor = async (actions, runtime) => {
    return executeStrategyActions(actions, {
      bridge: {
        apiCall: runtime.authenticatedApiCall,
        publishHivePost: runtime.sdkBridge.publishHivePost.bind(runtime.sdkBridge),
        transferDem: (to: string, amount: number) => runtime.sdkBridge.transferDem(to, amount, tipMemo),
      },
      dryRun,
      observe: (type, msg) => console.log(`[${label}:light] ${type}: ${msg}`),
      colonyDb: runtime.colonyDb,
      ourAddress: runtime.address,
    });
  };

  const executeHeavyActions: HeavyExecutor = async (actions, runtime) => {
    const sessionsDir = resolve(homedir(), `.${agentConfig.name}/sessions`);
    mkdirSync(sessionsDir, { recursive: true });
    const stateStore = new FileStateStore(resolve(homedir(), `.${agentConfig.name}`));

    return executePublishActions(actions, {
      demos: runtime.demos,
      walletAddress: runtime.address,
      provider: runtime.llmProvider,
      agentConfig,
      sourceView,
      state: { loopVersion: 3, sessionNumber: 0, agentName: agentConfig.name, startedAt: new Date().toISOString(), pid: process.pid, phases: {}, posts: [], engagements: [] } as any,
      sessionsDir,
      observe: (type, msg) => console.log(`[${label}:heavy] ${type}: ${msg}`),
      dryRun,
      stateStore,
      colonyDb: runtime.colonyDb,
      calibrationOffset: 0,
      scanContext: { activity_level: "normal", posts_per_hour: 0 },
      logSession: () => {},
      logQuality: () => {},
    });
  };

  return { executeLightActions, executeHeavyActions };
}

/**
 * Sync colony DB from API before first observe.
 * Needed so resolveAgentToRecentPost has data for TIP/ENGAGE actions.
 * Without this, TIP actions fail with 404 (no post to tip).
 */
export async function syncColonyAtStartup(
  runtime: { colonyDb?: any; authenticatedApiCall?: any },
  label: string,
): Promise<void> {
  if (!runtime.colonyDb) return;
  try {
    const { SuperColonyApiClient } = await import("../../src/toolkit/supercolony/api-client.js");
    const { syncColonyFromApi } = await import("../../src/toolkit/colony/api-backfill.js");
    const apiClient = new SuperColonyApiClient({ getToken: async () => null });
    const stats = await syncColonyFromApi(runtime.colonyDb, apiClient, {
      maxPages: 5, // Quick sync — just recent posts, not full backfill
      onProgress: () => {},
    });
    if (stats.inserted > 0) {
      console.log(`[${label}] Colony sync: ${stats.inserted} posts from API (${stats.pages} pages)`);
    }
  } catch (err) {
    console.warn(`[${label}] Colony sync failed (non-fatal):`, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Wire source deps into an ObserveFn.
 * If colony DB and sources are available, creates a source-aware observe.
 * Otherwise falls back to colony-only observe.
 */
export function wireSourceDeps(
  runtime: { colonyDb?: any },
  sourceView: { sources: any[] },
  label: string,
  strategyPath: string,
): ObserveFn {
  if (runtime.colonyDb && sourceView.sources.length > 0) {
    console.log(`[${label}] Source pipeline wired (${sourceView.sources.length} sources)`);
    return (toolkit, address) =>
      learnFirstObserve(toolkit, address, strategyPath, {
        db: runtime.colonyDb!,
        sourceView,
        observe: (type, msg) => console.log(`[${label}:sources] ${type}: ${msg}`),
      } as SourceDeps);
  }
  return (toolkit, address) => learnFirstObserve(toolkit, address, strategyPath);
}
