/**
 * TLSN Attest Plugin — Standalone TLSNotary attestation for arbitrary URLs.
 *
 * Wraps an injectable attestUrl function so the bridge can be swapped for testing.
 */

import type { FrameworkPlugin, DataProvider, ProviderResult } from "../types.js";

export interface TlsnAttestPluginConfig {
  /** Function that performs TLSN attestation (injectable for testing) */
  attestUrl: (url: string, method?: string) => Promise<{
    txHash: string;
    tokenId?: string;
    requestTxHash?: string;
  }>;
}

export function createTlsnAttestPlugin(config: TlsnAttestPluginConfig): FrameworkPlugin {
  const { attestUrl } = config;

  const attestProvider: DataProvider = {
    name: "tlsn-attest",
    description: "Standalone TLSNotary attestation for arbitrary URLs",

    async fetch(topic: string, options?: Record<string, unknown>): Promise<ProviderResult> {
      try {
        const method = typeof options?.method === "string" ? options.method : "GET";
        const result = await attestUrl(topic, method);

        return {
          ok: true,
          data: {
            txHash: result.txHash,
            tokenId: result.tokenId,
            url: topic,
          },
          source: "tlsn-attest-plugin",
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message, source: "tlsn-attest-plugin" };
      }
    },
  };

  return {
    name: "tlsn-attest",
    version: "1.0.0",
    description: "Standalone TLSNotary attestation for arbitrary URLs",
    hooks: {},
    providers: [attestProvider],
    evaluators: [],
    actions: [],
  };
}
