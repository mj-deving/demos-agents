/**
 * Skill Dojo adapter: chain-operations
 *
 * Multi-chain balance, transfer, sign, contract operations.
 * Modes: balance, sign-message, transfer, write-contract
 */

import type { DataProvider } from "../../types.js";
import type { SkillAdapterConfig, SkillProviderResult } from "./types.js";
import { extractProofs } from "../../lib/skill-dojo-proof.js";

export type ChainOperationsMode =
  | "balance"
  | "sign-message"
  | "transfer"
  | "write-contract";

export type ChainOperationsChain =
  | "demos"
  | "base-sepolia"
  | "ethereum"
  | "polygon"
  | "arbitrum"
  | "optimism"
  | "solana-devnet"
  | "bsc";

export function createChainOperationsProvider(
  config: SkillAdapterConfig,
): DataProvider {
  return {
    name: "skill-dojo:chain-operations",
    description: "Multi-chain balance, transfer, sign, and contract operations",
    async fetch(
      _topic: string,
      options?: Record<string, unknown>,
    ): Promise<SkillProviderResult> {
      const params = {
        mode: (options?.mode as ChainOperationsMode) || "balance",
        ...(options?.chain != null && {
          chain: options.chain as ChainOperationsChain,
        }),
        ...(options?.address != null && {
          address: options.address as string,
        }),
        ...(options?.message != null && {
          message: options.message as string,
        }),
        // Transfer params
        ...(options?.recipient != null && {
          recipient: options.recipient as string,
        }),
        ...(options?.amount != null && {
          amount: options.amount as string,
        }),
        // Contract write params
        ...(options?.contractAddress != null && {
          contractAddress: options.contractAddress as string,
        }),
        ...(options?.functionSignature != null && {
          functionSignature: options.functionSignature as string,
        }),
        ...(options?.functionArgs != null && {
          functionArgs: options.functionArgs as unknown[],
        }),
      };

      const response = await config.client.execute(
        "chain-operations",
        params,
      );
      if (!response.ok) {
        return {
          ok: false,
          error: response.error || "Skill execution failed",
          source: "skill-dojo:chain-operations",
        };
      }

      return {
        ok: true,
        data: response.result?.data,
        source: "skill-dojo:chain-operations",
        proofs: extractProofs(response.result?.data),
        executionTimeMs: response.executionTimeMs,
        skillId: "chain-operations",
        metadata: { timestamp: response.result?.timestamp },
      };
    },
  };
}
