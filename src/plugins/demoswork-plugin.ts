/**
 * DemosWork Plugin — Multi-step batch/conditional/cross-chain workflows.
 *
 * Attempts to use DemosWork SDK. Falls back gracefully if ESM import fails
 * (known bug: baseoperation.js uses broken directory import in Node ESM).
 */

import type { FrameworkPlugin, DataProvider, ProviderResult } from "../types.js";

export interface DemosWorkPluginConfig {
  rpcUrl: string;
  agentAddress: string;
}

export function createDemosWorkPlugin(config: DemosWorkPluginConfig): FrameworkPlugin {
  const { rpcUrl } = config;
  let sdkAvailable: boolean | null = null; // null = not yet checked

  const workProvider: DataProvider = {
    name: "demoswork",
    description: "Multi-step batch/conditional/cross-chain workflows via DemosWork",

    async fetch(_topic: string, _options?: Record<string, unknown>): Promise<ProviderResult> {
      // Lazy-check SDK availability on first call
      if (sdkAvailable === null) {
        try {
          await import("@kynesyslabs/demosdk/demoswork");
          sdkAvailable = true;
        } catch {
          sdkAvailable = false;
        }
      }

      if (!sdkAvailable) {
        return {
          ok: false,
          error: "DemosWork SDK not available in current runtime (ESM import issue) — will retry next session",
          source: "demoswork-plugin",
        };
      }

      try {
        // SDK available — attempt real operation
        // For now, just verify connectivity
        const body = JSON.stringify({
          jsonrpc: "2.0",
          method: "getLastBlock",
          params: [],
          id: 1,
        });
        const response = await globalThis.fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          return {
            ok: false,
            error: `DemosWork RPC unavailable: HTTP ${response.status}`,
            source: "demoswork-plugin",
          };
        }

        const json = await response.json() as { result?: unknown; error?: { message?: string } };
        if (json.error) {
          return { ok: false, error: `DemosWork RPC error: ${json.error.message ?? "unknown"}`, source: "demoswork-plugin" };
        }

        return {
          ok: true,
          data: { available: true, rpcUrl },
          source: "demoswork-plugin",
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: `DemosWork unavailable: ${message}`,
          source: "demoswork-plugin",
        };
      }
    },
  };

  return {
    name: "demoswork",
    version: "1.1.0",
    description: "Multi-step batch/conditional/cross-chain workflows via DemosWork",
    hooks: {},
    providers: [workProvider],
    evaluators: [],
    actions: [],
  };
}
