/**
 * Skill Dojo adapter: tlsnotary-attestation (Action)
 *
 * TLSNotary web proof generation for arbitrary URLs.
 * Requires url parameter.
 */

import type { Action } from "../../types.js";
import type { SkillAdapterConfig } from "./types.js";
import { extractProofs } from "../../lib/network/skill-dojo-proof.js";

export function createTlsnotaryAction(config: SkillAdapterConfig): Action {
  return {
    name: "skill-dojo:tlsnotary-attestation",
    description: "TLSNotary web proof generation for arbitrary URLs",
    async validate(input) {
      const url = input.context?.url as string | undefined;
      return typeof url === "string" && url.length > 0;
    },
    async execute(input) {
      const url = input.context?.url as string;
      if (!url) {
        return { success: false, error: "url parameter is required" };
      }

      const params = {
        url,
        method: (input.context?.method as string) || "GET",
      };

      const response = await config.client.execute(
        "tlsnotary-attestation",
        params,
      );
      if (!response.ok) {
        return {
          success: false,
          error: response.error || "Skill execution failed",
        };
      }

      return {
        success: true,
        data: {
          ...(response.result?.data as Record<string, unknown> ?? {}),
          proofs: extractProofs(response.result?.data),
        },
        text: response.result?.message,
      };
    },
  };
}
