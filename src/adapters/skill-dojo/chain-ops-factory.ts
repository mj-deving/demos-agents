/**
 * Shared factory for chain-specific operation adapters.
 *
 * Solana, TON, NEAR, Bitcoin, and Cosmos all follow the same
 * pattern: balance, transfer, sign-message with chain-specific defaults.
 */

import type { DataProvider } from "../../types.js";
import type { SkillAdapterConfig, SkillProviderResult } from "./types.js";
import { extractProofs } from "../../lib/skill-dojo-proof.js";

export type ChainOpsMode = "balance" | "transfer" | "sign-message";

export function createChainOpsProvider(
  skillId: string,
  chainName: string,
  description: string,
  config: SkillAdapterConfig,
): DataProvider {
  const source = `skill-dojo:${skillId}`;

  return {
    name: source,
    description,
    async fetch(
      _topic: string,
      options?: Record<string, unknown>,
    ): Promise<SkillProviderResult> {
      const params = {
        mode: (options?.mode as ChainOpsMode) || "balance",
        ...(options?.address != null && {
          address: options.address as string,
        }),
        ...(options?.message != null && {
          message: options.message as string,
        }),
        ...(options?.recipient != null && {
          recipient: options.recipient as string,
        }),
        ...(options?.amount != null && {
          amount: options.amount as string,
        }),
      };

      const response = await config.client.execute(skillId, params);
      if (!response.ok) {
        return {
          ok: false,
          error: response.error || "Skill execution failed",
          source,
        };
      }

      return {
        ok: true,
        data: response.result?.data,
        source,
        proofs: extractProofs(response.result?.data),
        executionTimeMs: response.executionTimeMs,
        skillId,
        metadata: {
          chain: chainName,
          timestamp: response.result?.timestamp,
        },
      };
    },
  };
}
