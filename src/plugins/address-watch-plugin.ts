/**
 * Address Watch Plugin — Wallet activity monitoring for tracked addresses.
 *
 * SCAFFOLD: Returns SDK blocker until XM SDK cross-chain operations are validated.
 */

import type { FrameworkPlugin, DataProvider, ProviderResult } from "../types.js";

export interface AddressWatchPluginConfig {
  rpcUrl: string;
  watchAddresses: string[];
}

const BLOCKER = "SDK blocker: XM SDK cross-chain operations untested — deferred until validated";

export function createAddressWatchPlugin(_config: AddressWatchPluginConfig): FrameworkPlugin {
  const watchProvider: DataProvider = {
    name: "address-watch",
    description: "Wallet activity monitoring for tracked addresses (requires XM SDK)",

    async fetch(_topic: string, _options?: Record<string, unknown>): Promise<ProviderResult> {
      return { ok: false, error: BLOCKER, source: "address-watch-plugin" };
    },
  };

  return {
    name: "address-watch",
    version: "1.0.0",
    description: "Wallet activity monitoring for tracked addresses (requires XM SDK)",
    hooks: {},
    providers: [watchProvider],
    evaluators: [],
    actions: [],
  };
}
