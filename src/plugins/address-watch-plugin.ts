/**
 * Address Watch Plugin — Wallet activity monitoring for tracked addresses.
 *
 * Attempts real address queries via Demos RPC for each watched address.
 * Falls back gracefully if unavailable.
 */

import type { FrameworkPlugin, DataProvider, ProviderResult } from "../types.js";

export interface AddressWatchPluginConfig {
  rpcUrl: string;
  watchAddresses: string[];
}

export function createAddressWatchPlugin(config: AddressWatchPluginConfig): FrameworkPlugin {
  const { rpcUrl, watchAddresses } = config;

  const watchProvider: DataProvider = {
    name: "address-watch",
    description: "Wallet activity monitoring for tracked addresses via Demos RPC",

    async fetch(_topic: string, _options?: Record<string, unknown>): Promise<ProviderResult> {
      if (!watchAddresses.length) {
        return { ok: false, error: "No addresses configured for watching", source: "address-watch-plugin" };
      }

      try {
        // Query all watched addresses in parallel (capped at 10)
        const results = await Promise.all(
          watchAddresses.slice(0, 10).map(async (address): Promise<{ address: string; balance?: number; nonce?: number; error?: string }> => {
            try {
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
                signal: AbortSignal.timeout(5_000),
              });

              if (response.ok) {
                const json = await response.json() as { result?: { balance?: number; nonce?: number } };
                return { address, balance: json.result?.balance, nonce: json.result?.nonce };
              }
              return { address, error: `HTTP ${response.status}` };
            } catch (err) {
              return { address, error: err instanceof Error ? err.message : String(err) };
            }
          }),
        );

        return {
          ok: true,
          data: { watchedAddresses: results, queriedAt: Date.now() },
          source: "address-watch-plugin",
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: `Address watch unavailable: ${message}`,
          source: "address-watch-plugin",
        };
      }
    },
  };

  return {
    name: "address-watch",
    version: "1.1.0",
    description: "Wallet activity monitoring for tracked addresses via Demos RPC",
    hooks: {},
    providers: [watchProvider],
    evaluators: [],
    actions: [],
  };
}
