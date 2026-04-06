/**
 * Predictions domain — query, resolve, markets.
 */

import type { SuperColonyApiClient } from "../supercolony/api-client.js";
import type { PredictionsPrimitives } from "./types.js";

export function createPredictionsPrimitives(deps: { apiClient: SuperColonyApiClient }): PredictionsPrimitives {
  return {
    async query(opts) {
      return deps.apiClient.queryPredictions(opts);
    },

    async resolve(txHash, outcome, evidence) {
      return deps.apiClient.resolvePrediction(txHash, outcome, evidence);
    },

    async markets(opts) {
      return deps.apiClient.getPredictionMarkets(opts);
    },
  };
}
