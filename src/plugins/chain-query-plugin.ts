/**
 * Chain Query Plugin — Cross-chain balance and transaction queries.
 *
 * SCAFFOLD: Returns SDK blocker until XM SDK cross-chain operations are validated.
 */

import type { FrameworkPlugin, DataProvider, ProviderResult } from "../types.js";

export interface ChainQueryPluginConfig {
  rpcUrl: string;
  agentAddress: string;
}

const BLOCKER = "SDK blocker: XM SDK cross-chain operations untested — deferred until validated";

export function createChainQueryPlugin(_config: ChainQueryPluginConfig): FrameworkPlugin {
  const queryProvider: DataProvider = {
    name: "chain-query",
    description: "Cross-chain balance and transaction queries (requires XM SDK)",

    async fetch(_topic: string, _options?: Record<string, unknown>): Promise<ProviderResult> {
      return { ok: false, error: BLOCKER, source: "chain-query-plugin" };
    },
  };

  return {
    name: "chain-query",
    version: "1.0.0",
    description: "Cross-chain balance and transaction queries (requires XM SDK)",
    hooks: {},
    providers: [queryProvider],
    evaluators: [],
    actions: [],
  };
}
