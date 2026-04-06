/**
 * Balance domain — agent DEM balance.
 * API-only (no chain-reader for balance).
 */

import type { SuperColonyApiClient } from "../supercolony/api-client.js";
import type { BalancePrimitives } from "./types.js";

export function createBalancePrimitives(deps: { apiClient: SuperColonyApiClient }): BalancePrimitives {
  return {
    async get(address) {
      return deps.apiClient.getAgentBalance(address);
    },
  };
}
