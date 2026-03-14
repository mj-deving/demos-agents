/**
 * Provider adapter registry — maps provider names to adapter instances.
 *
 * Compile-time registry — all adapters are imported statically.
 * Exports lookup helpers only, not individual adapters (Codex P3.1).
 */

import type { ProviderAdapter } from "./types.js";
import { adapter as hnAlgolia } from "./hn-algolia.js";
import { adapter as coingecko } from "./coingecko.js";
import { adapter as defillama } from "./defillama.js";
import { adapter as github } from "./github.js";
import { adapter as arxiv } from "./arxiv.js";
import { adapter as wikipedia } from "./wikipedia.js";
import { adapter as worldbank } from "./worldbank.js";
import { adapter as pubmed } from "./pubmed.js";
import { adapter as binance } from "./binance.js";
import { adapter as kraken } from "./kraken.js";
import { adapter as generic } from "./generic.js";

// ── Registry ────────────────────────────────────────

const ADAPTER_REGISTRY: Map<string, ProviderAdapter> = new Map([
  ["hn-algolia", hnAlgolia],
  ["coingecko", coingecko],
  ["defillama", defillama],
  ["github", github],
  ["arxiv", arxiv],
  ["wikipedia", wikipedia],
  ["worldbank", worldbank],
  ["pubmed", pubmed],
  ["binance", binance],
  ["kraken", kraken],
  ["generic", generic],
]);

// ── Public API ──────────────────────────────────────

/**
 * Get the adapter for a provider. Returns null if no adapter is registered.
 */
export function getProviderAdapter(provider: string): ProviderAdapter | null {
  return ADAPTER_REGISTRY.get(provider) ?? null;
}

/**
 * Get the adapter for a provider. Throws if no adapter is registered.
 */
export function requireProviderAdapter(provider: string): ProviderAdapter {
  const adapter = ADAPTER_REGISTRY.get(provider);
  if (!adapter) {
    throw new Error(`No adapter registered for provider "${provider}"`);
  }
  return adapter;
}

/**
 * List all registered provider adapters.
 */
export function listProviderAdapters(): ProviderAdapter[] {
  return [...ADAPTER_REGISTRY.values()];
}
