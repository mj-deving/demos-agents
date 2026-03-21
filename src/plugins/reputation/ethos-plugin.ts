/**
 * Ethos Network reputation plugin.
 * Queries api.ethos.network for on-chain reputation scores.
 * Implements FrameworkPlugin with a DataProvider.
 */

import type { FrameworkPlugin, DataProvider, ProviderResult } from "../../types.js";
import type { AgentConfig } from "../../lib/agent-config.js";
import { fetchWithTimeout } from "../../lib/fetch-with-timeout.js";

interface CacheEntry {
  data: { score: number; vouches: number; reviews: number };
  timestamp: number;
}

export class EthosPlugin implements FrameworkPlugin {
  readonly name = "ethos-reputation";
  readonly version = "1.0.0";
  readonly description = "Ethos Network on-chain reputation scores";

  private cache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  private readonly MAX_CACHE_SIZE = 500;

  readonly providers: DataProvider[] = [
    {
      name: "ethos-score",
      description: "Fetch on-chain reputation score from Ethos Network",
      fetch: async (topic: string): Promise<ProviderResult> => {
        // Check cache first
        const cached = this.cache.get(topic);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
          return {
            ok: true,
            data: cached.data,
            source: "ethos.network",
            metadata: { address: topic, cachedAt: cached.timestamp },
          };
        }

        try {
          const url = `https://api.ethos.network/v1/score/${encodeURIComponent(topic)}`;
          const response = await fetchWithTimeout(url, 10_000, {
            headers: {
              "X-Ethos-Client": "demos-agents",
              Accept: "application/json",
            },
          });

          if (!response.ok) {
            return {
              ok: false,
              error: `Ethos API error: ${response.status} ${response.statusText}`,
              source: "ethos.network",
            };
          }

          const json = await response.json();
          const data = {
            score: json.score as number,
            vouches: (json.vouches as number) ?? 0,
            reviews: (json.reviews as number) ?? 0,
          };

          const now = Date.now();
          this.cache.set(topic, { data, timestamp: now });

          // Evict oldest entries if cache exceeds max size
          if (this.cache.size > this.MAX_CACHE_SIZE) {
            const oldest = this.cache.keys().next().value!;
            this.cache.delete(oldest);
          }

          return {
            ok: true,
            data,
            source: "ethos.network",
            metadata: { address: topic, cachedAt: now },
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            ok: false,
            error: `Ethos fetch failed: ${message}`,
            source: "ethos.network",
          };
        }
      },
    },
  ];

  async init(_config: AgentConfig): Promise<void> {
    console.log("Ethos plugin initialized");
  }

  async destroy(): Promise<void> {
    this.cache.clear();
  }
}
