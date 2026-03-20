/**
 * CCI Identity Plugin — Cross-Context Identity management.
 *
 * SCAFFOLD: Returns SDK blocker until CCI SDK module is validated for Node.js.
 */

import type { FrameworkPlugin, DataProvider, ProviderResult } from "../types.js";

export interface CCIIdentityPluginConfig {
  rpcUrl: string;
}

const BLOCKER = "SDK blocker: CCI SDK module not yet validated for Node.js";

export function createCCIIdentityPlugin(_config: CCIIdentityPluginConfig): FrameworkPlugin {
  const identityProvider: DataProvider = {
    name: "cci-identity",
    description: "Cross-Context Identity management (requires CCI SDK module)",

    async fetch(_topic: string, _options?: Record<string, unknown>): Promise<ProviderResult> {
      return { ok: false, error: BLOCKER, source: "cci-identity-plugin" };
    },
  };

  return {
    name: "cci-identity",
    version: "1.0.0",
    description: "Cross-Context Identity management (requires CCI SDK module)",
    hooks: {},
    providers: [identityProvider],
    evaluators: [],
    actions: [],
  };
}
