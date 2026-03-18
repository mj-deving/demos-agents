/**
 * Storage Plugin — on-chain state persistence via Demos Storage Programs.
 *
 * Provides agents with persistent on-chain state that other agents can read.
 * Uses deterministic addressing: {agentName}-state at a derived stor- address.
 *
 * Hooks:
 * - beforeAct: load current on-chain state into session context
 * - afterAct: persist updated state back to Storage Program
 */

import type { FrameworkPlugin, Evaluator, Action, DataProvider, HookFn } from "../types.js";

// ── Plugin Factory ──────────────────────────────────

export interface StoragePluginConfig {
  /** Agent name (used for program naming) */
  agentName: string;
  /** Storage address (if already created) — skip creation if set */
  storageAddress?: string;
  /** Fields to sync on each loop iteration */
  syncFields?: string[];
}

/**
 * Create the Storage Plugin.
 *
 * NOTE: This plugin creates FrameworkPlugin hooks that integrate with
 * the session loop. The actual StorageProgram SDK calls are delegated
 * to the storage-client (tools/lib/storage-client.ts) which is injected
 * at runtime by the omniweb-runner.
 *
 * The plugin itself is SDK-free (core/ boundary) — it only defines
 * the hook signatures and session-scoped state management.
 */
export function createStoragePlugin(config: StoragePluginConfig): FrameworkPlugin {
  const { agentName, storageAddress, syncFields } = config;

  // Session-scoped state (loaded by beforeAct, persisted by afterAct)
  let cachedState: Record<string, unknown> = {};
  let stateLoaded = false;

  return {
    name: "storage",
    version: "1.0.0",
    description: `On-chain state persistence for ${agentName} via Storage Programs`,

    hooks: {
      /**
       * beforeAct: Load agent state from Storage Program into session context.
       * Called before the ACT phase of each loop iteration.
       */
      beforeAct: (async (context: Record<string, unknown>) => {
        // Storage client is injected into context by the runner
        const client = context.storageClient as any;
        if (!client || !storageAddress) {
          return; // No client or no address — skip
        }

        try {
          const state = await client.readState(storageAddress);
          if (state) {
            cachedState = state.data;
            stateLoaded = true;
            context.agentState = cachedState;
          }
        } catch {
          // Silently continue — state loading is best-effort
        }
      }) as HookFn,

      /**
       * afterAct: Persist agent state back to Storage Program.
       * Called after the ACT phase completes.
       */
      afterAct: (async (context: Record<string, unknown>) => {
        const client = context.storageClient as any;
        if (!client || !storageAddress || !stateLoaded) {
          return; // Nothing to persist
        }

        // Merge context updates into cached state
        const updatedState = context.agentState as Record<string, unknown> | undefined;
        if (updatedState) {
          cachedState = { ...cachedState, ...updatedState };
        }

        // Generate payload — actual submission is runner's responsibility
        context.storageWritePayload = client.setFieldPayload(
          storageAddress,
          "lastUpdated",
          new Date().toISOString(),
        );
      }) as HookFn,
    },

    providers: [],
    evaluators: [],
    actions: [],
  };
}
