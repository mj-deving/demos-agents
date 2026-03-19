/**
 * Provider bridge — converts a demos DataProvider to an ElizaOS Provider.
 *
 * Calls fetch() on the demos provider and JSON-stringifies the full
 * ProviderResult for ElizaOS consumption.
 */

import type { DataProvider } from "../../types.js";
import type { ElizaProvider, ElizaRuntime, ElizaMessage, ElizaState } from "./types.js";

export function bridgeProvider(demosProvider: DataProvider): ElizaProvider {
  return {
    get: async (_runtime: ElizaRuntime, _message: ElizaMessage, state?: ElizaState) => {
      const result = await demosProvider.fetch((state?.topic as string) || "", {});
      return JSON.stringify(result);
    },
  };
}
