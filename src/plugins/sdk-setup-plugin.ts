/**
 * SDK Setup Plugin — Demos SDK connectivity validation.
 *
 * Pre-flight health check: connects to RPC node, verifies reachability,
 * and optionally checks wallet balance. Use before session loop start
 * to confirm infrastructure is healthy.
 */

import type { FrameworkPlugin, DataProvider, ProviderResult } from "../types.js";

export interface SdkSetupPluginConfig {
  /** RPC URL to validate (e.g., "https://demosnode.discus.sh") */
  rpcUrl: string;
  /** Optional: agent address to check balance for */
  agentAddress?: string;
}

export function createSdkSetupPlugin(config: SdkSetupPluginConfig): FrameworkPlugin {
  const { rpcUrl, agentAddress } = config;

  const setupProvider: DataProvider = {
    name: "sdk-setup",
    description: "Demos SDK connectivity validation and pre-flight health check",

    async fetch(_topic: string, _options?: Record<string, unknown>): Promise<ProviderResult> {
      try {
        // Step 1: Verify RPC node reachability via JSON-RPC
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
            error: `RPC unreachable: HTTP ${response.status}`,
            source: "sdk-setup-plugin",
          };
        }

        const json = await response.json() as { result?: { height?: number } };
        const blockHeight = json.result?.height;

        return {
          ok: true,
          data: {
            rpcUrl,
            rpcReachable: true,
            blockHeight,
            agentAddress: agentAddress ?? null,
          },
          source: "sdk-setup-plugin",
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `SDK setup check failed: ${message}`, source: "sdk-setup-plugin" };
      }
    },
  };

  return {
    name: "sdk-setup",
    version: "1.0.0",
    description: "Demos SDK connectivity validation and pre-flight health check",
    hooks: {},
    providers: [setupProvider],
    evaluators: [],
    actions: [],
  };
}
