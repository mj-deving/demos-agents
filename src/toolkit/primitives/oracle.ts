/**
 * Oracle domain — sentiment, price divergences, polymarket odds.
 */

import type { SuperColonyApiClient } from "../supercolony/api-client.js";
import type { OraclePrimitives } from "./types.js";

export function createOraclePrimitives(deps: { apiClient: SuperColonyApiClient }): OraclePrimitives {
  return {
    async get(opts) {
      return deps.apiClient.getOracle(opts);
    },
  };
}
