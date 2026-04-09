/**
 * Verification evidence extractor.
 * Maps network stats (attestation/quality metrics) to AvailableEvidence.
 */
import type { Toolkit } from "../../primitives/types.js";
import type { AvailableEvidence } from "../../colony/available-evidence.js";
import type { PrefetchedData } from "../observe-router.js";
import { capRichness } from "./helpers.js";

export async function extractVerification(toolkit: Toolkit, prefetched?: PrefetchedData): Promise<AvailableEvidence[]> {
  const result = prefetched?.stats ?? await toolkit.stats.get();
  if (!result || !result.ok) return [];
  if (!result.data) return [];

  const stats = result.data;
  return [{
    sourceId: "verification-stats",
    subject: "network-quality",
    metrics: [
      `attestationRate:${stats.quality.attestationRate}`,
      `avgScore:${stats.quality.avgScore}`,
      `predictionAccuracy:${stats.predictions.accuracy}`,
      `totalPredictions:${stats.predictions.total}`,
    ],
    richness: capRichness(60 + stats.quality.attestationRate * 30),
    freshness: Math.floor((Date.now() - Date.parse(stats.computedAt)) / 1000),
    stale: false,
  }];
}
