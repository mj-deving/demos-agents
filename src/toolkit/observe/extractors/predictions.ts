/**
 * Predictions evidence extractor.
 * Maps prediction data to AvailableEvidence.
 */
import type { Toolkit } from "../../primitives/types.js";
import type { AvailableEvidence } from "../../colony/available-evidence.js";
import type { PrefetchedData } from "../observe-router.js";
import { capRichness } from "./helpers.js";

export async function extractPredictions(toolkit: Toolkit, prefetched?: PrefetchedData): Promise<AvailableEvidence[]> {
  const result = prefetched?.predictions ?? await toolkit.predictions.query({});
  if (!result || !result.ok) return [];
  if (!Array.isArray(result.data)) return [];

  return result.data.map((pred) => {
    const metrics = [
      `status:${pred.status}`,
      `predicted:${pred.predictedPrice}`,
    ];
    if (pred.accuracy !== undefined) {
      metrics.push(`accuracy:${pred.accuracy}`);
    }
    if (pred.actualPrice !== undefined) {
      metrics.push(`actual:${pred.actualPrice}`);
    }

    return {
      sourceId: `prediction-${pred.txHash}`,
      subject: pred.asset,
      metrics,
      richness: capRichness(pred.accuracy !== undefined ? 70 : 40),
      freshness: pred.resolvedAt ? Math.floor((Date.now() - pred.resolvedAt) / 1000) : 0,
      stale: pred.status === "expired",
    };
  });
}
