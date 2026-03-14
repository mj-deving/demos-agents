/**
 * Provider adapter registry — maps provider names to adapter instances.
 *
 * PR4: Hybrid registry — declarative YAML specs loaded at init time,
 * with generic.ts as the only hand-written adapter (quarantine fallback).
 * Hand-written adapters kept as fallback during migration.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProviderAdapter } from "./types.js";
import { adapter as generic } from "./generic.js";

// Hand-written adapters (kept as fallback — declarative specs take priority)
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

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Registry ────────────────────────────────────────

// Start with hand-written adapters as baseline
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

// Load declarative specs — only register providers that DON'T have a hand-written adapter.
// Codex PR4 review: hooks aren't loaded by sync loader, template resolution is incomplete
// for nested properties, so declarative adapters can't yet replace hand-written ones safely.
// Once the engine matures (dotted templates, async hook loading), this gate can be removed.
let declarativeLoaded = false;
try {
  const { loadDeclarativeProviderAdaptersSync } = await import("./declarative-engine.js");
  const specsDir = resolve(__dirname, "specs");
  const declarativeAdapters = loadDeclarativeProviderAdaptersSync({ specDir: specsDir, strictValidation: false });

  for (const [name, adapter] of declarativeAdapters) {
    if (name === "generic") continue;
    // Only register if no hand-written adapter exists (e.g., fred)
    if (!ADAPTER_REGISTRY.has(name)) {
      ADAPTER_REGISTRY.set(name, adapter);
    }
  }
  declarativeLoaded = true;
} catch {
  // Declarative engine not available or specs dir missing — fall back to hand-written only
}

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

/**
 * Whether declarative specs were successfully loaded.
 */
export function isDeclarativeLoaded(): boolean {
  return declarativeLoaded;
}
