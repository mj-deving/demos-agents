/**
 * Verification domain — DAHR and TLSN proof verification.
 * API-first; DAHR has chain fallback via verifyTransaction.
 */

import type { SuperColonyApiClient } from "../supercolony/api-client.js";
import type { VerificationPrimitives } from "./types.js";

export function createVerificationPrimitives(deps: { apiClient: SuperColonyApiClient }): VerificationPrimitives {
  return {
    async verifyDahr(txHash) {
      return deps.apiClient.verifyDahr(txHash);
    },

    async verifyTlsn(txHash) {
      return deps.apiClient.verifyTlsn(txHash);
    },
  };
}
