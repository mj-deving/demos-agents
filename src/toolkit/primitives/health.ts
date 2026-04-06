/**
 * Health + Stats domain — system monitoring (public endpoints, no auth).
 */

import type { SuperColonyApiClient } from "../supercolony/api-client.js";
import type { HealthPrimitives, StatsPrimitives } from "./types.js";

export function createHealthPrimitives(deps: { apiClient: SuperColonyApiClient }): HealthPrimitives {
  return {
    async check() {
      return deps.apiClient.getHealth();
    },
  };
}

export function createStatsPrimitives(deps: { apiClient: SuperColonyApiClient }): StatsPrimitives {
  return {
    async get() {
      return deps.apiClient.getStats();
    },
  };
}
