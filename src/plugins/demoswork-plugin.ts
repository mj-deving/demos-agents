/**
 * DemosWork Plugin — Multi-step batch/conditional/cross-chain workflows.
 *
 * SCAFFOLD: Returns SDK blocker until DemosWork ESM directory import bug is fixed.
 * See: baseoperation.js uses `from "."` (broken directory import in Node ESM).
 */

import type { FrameworkPlugin, DataProvider, ProviderResult } from "../types.js";

export interface DemosWorkPluginConfig {
  rpcUrl: string;
  agentAddress: string;
}

const BLOCKER = "SDK blocker: DemosWork has ESM directory import bug — blocked until SDK fix";

export function createDemosWorkPlugin(_config: DemosWorkPluginConfig): FrameworkPlugin {
  const workProvider: DataProvider = {
    name: "demoswork",
    description: "Multi-step batch/conditional/cross-chain workflows (requires DemosWork SDK fix)",

    async fetch(_topic: string, _options?: Record<string, unknown>): Promise<ProviderResult> {
      return { ok: false, error: BLOCKER, source: "demoswork-plugin" };
    },
  };

  return {
    name: "demoswork",
    version: "1.0.0",
    description: "Multi-step batch/conditional/cross-chain workflows (requires DemosWork SDK fix)",
    hooks: {},
    providers: [workProvider],
    evaluators: [],
    actions: [],
  };
}
