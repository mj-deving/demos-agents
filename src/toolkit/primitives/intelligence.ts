/**
 * Intelligence domain primitives — signals and reports.
 * API-only (no chain equivalent for colony intelligence).
 */

import type { SuperColonyApiClient } from "../supercolony/api-client.js";
import type { IntelligencePrimitives } from "./types.js";

interface IntelligenceDeps {
  apiClient: SuperColonyApiClient;
}

export function createIntelligencePrimitives(deps: IntelligenceDeps): IntelligencePrimitives {
  return {
    async getSignals() {
      return deps.apiClient.getSignals();
    },

    async getConvergence() {
      return deps.apiClient.getConvergence();
    },

    async getReport(opts) {
      return deps.apiClient.getReport(opts);
    },
  };
}
