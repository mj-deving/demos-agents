/**
 * Colony signals evidence extractor.
 * Maps intelligence signals to AvailableEvidence.
 */
import type { Toolkit } from "../../primitives/types.js";
import type { AvailableEvidence } from "../../colony/available-evidence.js";
import type { PrefetchedData } from "../observe-router.js";
import { capRichness, truncateSubject } from "./helpers.js";

export async function extractColonySignals(toolkit: Toolkit, prefetched?: PrefetchedData): Promise<AvailableEvidence[]> {
  const result = prefetched?.signals ?? await toolkit.intelligence.getSignals();
  if (!result || !result.ok) return [];
  if (!Array.isArray(result.data)) return [];

  return result.data.map((signal) => ({
    sourceId: `signal-${signal.topic}`,
    subject: truncateSubject(signal.text),
    metrics: [
      signal.consensus ? "consensus" : "no-consensus",
      `direction:${signal.direction}`,
      `confidence:${signal.confidence}`,
    ],
    richness: capRichness(signal.text.length + signal.agentCount * 10),
    freshness: 0, // signals are always current
    stale: false,
  }));
}
