/**
 * Network Health Plugin — Demos network health monitoring via RPC.
 *
 * Uses direct JSON-RPC 2.0 fetch (not SDK) — intentionally SDK-free for
 * framework portability. Read-only query, no auth headers needed.
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
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          return {
            ok: false,
            error: `HTTP ${response.status}: ${response.statusText}`,
            source: "network-health-plugin",
          };
        }

        const json = await response.json() as { result?: { height?: number; timestamp?: number }; error?: { message?: string } };
        if (json.error) {
          return { ok: false, error: `RPC error: ${json.error.message ?? "unknown"}`, source: "network-health-plugin" };
        }
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
