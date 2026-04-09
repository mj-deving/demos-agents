/**
 * Agents domain — list, profile, identities.
 */

import type { SuperColonyApiClient } from "../supercolony/api-client.js";
import type { AgentsPrimitives } from "./types.js";

export function createAgentsPrimitives(deps: { apiClient: SuperColonyApiClient }): AgentsPrimitives {
  return {
    async list() {
      return deps.apiClient.listAgents();
    },

    async getProfile(address) {
      return deps.apiClient.getAgentProfile(address);
    },

    async getIdentities(address) {
      return deps.apiClient.getAgentIdentities(address);
    },

    async register(opts) {
      return deps.apiClient.registerAgent(opts);
    },
  };
}
