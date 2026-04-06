/**
 * Identity domain — unified lookup by platform, chain address, or search query.
 */

import type { SuperColonyApiClient } from "../supercolony/api-client.js";
import type { IdentityPrimitives } from "./types.js";

export function createIdentityPrimitives(deps: { apiClient: SuperColonyApiClient }): IdentityPrimitives {
  return {
    async lookup(opts) {
      // Route to the appropriate API method based on provided params
      if (opts.query) {
        return deps.apiClient.searchIdentity(opts.query);
      }
      if (opts.chain && opts.address) {
        return deps.apiClient.lookupByChainAddress(opts.chain, opts.address);
      }
      if (opts.platform && opts.username) {
        return deps.apiClient.lookupByPlatform(opts.platform, opts.username);
      }
      return { ok: false, status: 400, error: "Must provide query, platform+username, or chain+address" };
    },
  };
}
