/**
 * Network Health Plugin — Demos network health monitoring via RPC.
 *
 * Thin DataProvider wrapper around JSON-RPC getLastBlock.
 */

import type { FrameworkPlugin, DataProvider, ProviderResult } from "../types.js";

export interface NetworkHealthPluginConfig {
  rpcUrl: string;
}

export function createNetworkHealthPlugin(config: NetworkHealthPluginConfig): FrameworkPlugin {
  const { rpcUrl } = config;

  const healthProvider: DataProvider = {
    name: "network-health",
    description: "Demos network health monitoring via RPC",

    async fetch(_topic: string, _options?: Record<string, unknown>): Promise<ProviderResult> {
      try {
        const body = JSON.stringify({ jsonrpc: "2.0", method: "getLastBlock", params: [], id: 1 });
        const response = await globalThis.fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });

        if (!response.ok) {
          return {
            ok: false,
            error: `HTTP ${response.status}: ${response.statusText}`,
            source: "network-health-plugin",
          };
        }

        const json = await response.json() as { result?: { height?: number; timestamp?: number } };
        const result = json.result;

        return {
          ok: true,
          data: {
            blockHeight: result?.height,
            timestamp: result?.timestamp,
            rpcUrl,
          },
          source: "network-health-plugin",
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message, source: "network-health-plugin" };
      }
    },
  };

  return {
    name: "network-health",
    version: "1.0.0",
    description: "Demos network health monitoring via RPC",
    hooks: {},
    providers: [healthProvider],
    evaluators: [],
    actions: [],
  };
}
