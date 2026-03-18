/**
 * Infra Ops plugin — infrastructure operational relevance evaluation.
 *
 * Evaluates whether content is relevant to infrastructure operations,
 * network health, and incident monitoring. Used by the infra-ops agent
 * to filter and prioritize infrastructure signals from the feed.
 */

import type { FrameworkPlugin } from "../types.js";
import { createKeywordEvaluator } from "./keyword-evaluator.js";

const INFRA_KEYWORDS = [
  "rpc", "validator", "node", "uptime", "latency", "block",
  "consensus", "bridge", "outage", "incident", "upgrade", "fork",
  "network", "throughput", "finality",
] as const;

export function createInfraOpsPlugin(): FrameworkPlugin {
  return {
    name: "infra-ops",
    version: "1.0.0",
    description: "Infrastructure operational relevance evaluation and incident data provision",

    evaluators: [createKeywordEvaluator({
      name: "operational-relevance",
      description: "Evaluates whether content is relevant to infrastructure operations",
      keywords: INFRA_KEYWORDS,
      domain: "infrastructure operational",
    })],

    async init() {},
    async destroy() {},
  };
}
