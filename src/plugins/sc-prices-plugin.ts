/**
 * SC Prices Plugin — DAHR-attested cryptocurrency prices from SuperColony.
 *
 * DataProvider wrapper around GET /api/prices.
 * beforeSense hook: fetches price data and injects into session state.
 */

import type { FrameworkPlugin, DataProvider, ProviderResult } from "../types.js";
import type { BeforeSenseContext } from "../lib/util/extensions.js";

export interface SCDataPluginConfig {
  apiBaseUrl: string;
  getAuthHeaders: () => Promise<Record<string, string>>;
}

/**
 * beforeSense hook — fetch DAHR-attested prices and inject into session state.
 * Uses dynamic imports to avoid pulling SDK deps into the module graph.
 */
export async function scPricesBeforeSense(ctx: BeforeSenseContext): Promise<void> {
  ctx.logger?.info("Extension: sc-prices (fetching price data)...");
  try {
    const { loadAuthCache } = await import("../lib/auth/auth.js");
    const { getApiUrl } = await import("../lib/network/sdk.js");
    const cached = loadAuthCache();
    if (!cached) {
      ctx.logger?.info("SC Prices: no auth token cached — skipping");
      return;
    }
    const plugin = createSCPricesPlugin({
      apiBaseUrl: getApiUrl(),
      getAuthHeaders: async () => ({ Authorization: `Bearer ${cached.token}` }),
    });
    const result = await plugin.providers![0].fetch("prices");
    if (result.ok && "loopVersion" in ctx.state && ctx.state.loopVersion >= 2) {
      ctx.state.priceSnapshot = result.data;
      ctx.logger?.result("SC Prices: data injected into session state");
    } else if (!result.ok) {
      ctx.logger?.info(`SC Prices: fetch failed — ${result.error}`);
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const { observe } = await import("../lib/pipeline/observe.js");
    observe("error", `SC Prices hook failed: ${message}`, {
      phase: "sense", source: "sc-prices-plugin.ts:beforeSense",
    });
  }
}

export function createSCPricesPlugin(config: SCDataPluginConfig): FrameworkPlugin {
  const { apiBaseUrl, getAuthHeaders } = config;
  const baseUrl = new URL(`${apiBaseUrl}/api/prices`);

  const pricesProvider: DataProvider = {
    name: "sc-prices",
    description: "DAHR-attested cryptocurrency prices from SuperColony",

    async fetch(_topic: string, options?: Record<string, unknown>): Promise<ProviderResult> {
      try {
        const headers = await getAuthHeaders();
        const url = new URL(baseUrl);
        if (options?.asset && typeof options.asset === "string") {
          url.searchParams.set("asset", options.asset);
        }

        const response = await globalThis.fetch(url.toString(), { headers });
        if (!response.ok) {
          return {
            ok: false,
            error: `HTTP ${response.status}: ${response.statusText}`,
            source: "sc-prices-plugin",
          };
        }

        const data: unknown = await response.json();
        return { ok: true, data, source: "sc-prices-plugin" };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message, source: "sc-prices-plugin" };
      }
    },
  };

  return {
    name: "sc-prices",
    version: "1.0.0",
    description: "DAHR-attested cryptocurrency prices from SuperColony",
    hooks: {},
    providers: [pricesProvider],
    evaluators: [],
    actions: [],
  };
}
