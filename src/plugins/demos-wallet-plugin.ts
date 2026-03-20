/**
 * Demos Wallet Plugin — wallet management and balance queries.
 *
 * Local reimplementation of Skill Dojo's demos-wallet-agent.
 * The Skill Dojo version is browser-only (SIWD, extension wallet).
 * This version provides Node.js-compatible wallet operations:
 * - Balance check via RPC
 * - Address info queries
 *
 * Browser-specific features (SIWD, extension connect) are not available.
 */

import type { FrameworkPlugin, DataProvider, ProviderResult } from "../types.js";

export interface DemosWalletPluginConfig {
  /** RPC URL for balance/address queries */
  rpcUrl: string;
  /** Agent's Demos address */
  agentAddress: string;
}

export function createDemosWalletPlugin(config: DemosWalletPluginConfig): FrameworkPlugin {
  const { rpcUrl, agentAddress } = config;

  const walletProvider: DataProvider = {
    name: "demos-wallet",
    description: "Demos wallet management — balance and address queries (Node.js only)",

    async fetch(_topic: string, options?: Record<string, unknown>): Promise<ProviderResult> {
      try {
        const address = (typeof options?.address === "string") ? options.address : agentAddress;

        // Query address info via JSON-RPC
        const body = JSON.stringify({
          jsonrpc: "2.0",
          method: "getAddressInfo",
          params: [address],
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
            error: `RPC error: HTTP ${response.status}: ${response.statusText}`,
            source: "demos-wallet-plugin",
          };
        }

        const json = await response.json() as { result?: { balance?: number; nonce?: number } };

        return {
          ok: true,
          data: {
            address,
            balance: json.result?.balance,
            nonce: json.result?.nonce,
            rpcUrl,
          },
          source: "demos-wallet-plugin",
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message, source: "demos-wallet-plugin" };
      }
    },
  };

  return {
    name: "demos-wallet",
    version: "1.0.0",
    description: "Demos wallet management — balance and address queries (Node.js only)",
    hooks: {},
    providers: [walletProvider],
    evaluators: [],
    actions: [],
  };
}
