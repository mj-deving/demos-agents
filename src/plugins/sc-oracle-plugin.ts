/**
 * SC Oracle Plugin — sentiment, prices, and Polymarket data from SuperColony oracle.
 *
 * DataProvider wrapper around GET /api/oracle.
 * beforeSense hook: fetches oracle data and injects into session state.
 */

import type { FrameworkPlugin, DataProvider, ProviderResult } from "../types.js";
import type { SCDataPluginConfig } from "./sc-prices-plugin.js";
import type { BeforeSenseContext } from "../lib/extensions.js";

/**
 * beforeSense hook — fetch oracle data and inject into session state.
 * Uses dynamic imports to avoid pulling SDK deps into the module graph.
 */
export async function scOracleBeforeSense(ctx: BeforeSenseContext): Promise<void> {
  ctx.logger?.info("Extension: sc-oracle (fetching oracle data)...");
  try {
    const { loadAuthCache } = await import("../lib/auth.js");
    const { SUPERCOLONY_API } = await import("../lib/sdk.js");
    const cached = loadAuthCache();
    if (!cached) {
      ctx.logger?.info("SC Oracle: no auth token cached — skipping");
      return;
    }
    const plugin = createSCOraclePlugin({
      apiBaseUrl: SUPERCOLONY_API,
      getAuthHeaders: async () => ({ Authorization: `Bearer ${cached.token}` }),
    });
    const result = await plugin.providers![0].fetch("oracle");
    if (result.ok && ctx.state.loopVersion === 2) {
      (ctx.state as any).oracleSnapshot = result.data;
      ctx.logger?.result("SC Oracle: data injected into session state");
    } else if (!result.ok) {
      ctx.logger?.info(`SC Oracle: fetch failed — ${result.error}`);
    }
  } catch (e: any) {
    const { observe } = await import("../lib/observe.js");
    observe("error", `SC Oracle hook failed: ${e.message}`, {
      phase: "sense", source: "sc-oracle-plugin.ts:beforeSense",
    });
  }
}

export function createSCOraclePlugin(config: SCDataPluginConfig): FrameworkPlugin {
  const { apiBaseUrl, getAuthHeaders } = config;
  const baseUrl = new URL(`${apiBaseUrl}/api/oracle`);

  const oracleProvider: DataProvider = {
    name: "sc-oracle",
    description: "Sentiment, prices, and Polymarket data from SuperColony oracle",

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
            source: "sc-oracle-plugin",
          };
        }

        const data: unknown = await response.json();
        return { ok: true, data, source: "sc-oracle-plugin" };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message, source: "sc-oracle-plugin" };
      }
    },
  };

  return {
    name: "sc-oracle",
    version: "1.0.0",
    description: "Sentiment, prices, and Polymarket data from SuperColony oracle",
    hooks: {},
    providers: [oracleProvider],
    evaluators: [],
    actions: [],
  };
}
