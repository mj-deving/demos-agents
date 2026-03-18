/**
 * DeFi Markets plugin — market relevance evaluation and protocol-specific data provision.
 *
 * Provides an evaluator that scores content for DeFi market relevance,
 * detecting protocol-level signals like TVL, APY, liquidity, and lending terms.
 */

import type { FrameworkPlugin } from "../types.js";
import { createKeywordEvaluator } from "./keyword-evaluator.js";

const DEFI_KEYWORDS = [
  "tvl", "apy", "yield", "liquidity", "protocol", "defi",
  "amm", "lending", "borrowing", "swap", "pool", "vault", "stake",
] as const;

export function createDefiMarketsPlugin(): FrameworkPlugin {
  return {
    name: "defi-markets",
    version: "1.0.0",
    description: "DeFi market relevance evaluation and protocol-specific data provision",

    evaluators: [createKeywordEvaluator({
      name: "market-relevance",
      description: "Evaluates whether content is relevant to current DeFi market conditions",
      keywords: DEFI_KEYWORDS,
      domain: "DeFi",
    })],

    async init() {},
    async destroy() {},
  };
}
