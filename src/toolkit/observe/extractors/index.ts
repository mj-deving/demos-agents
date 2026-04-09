/**
 * Evidence extractor registry.
 *
 * Maps each ADR-0020 evidence category to an extractor function
 * that calls the relevant toolkit primitives and returns AvailableEvidence[].
 */
import type { Toolkit } from "../../primitives/types.js";
import type { AvailableEvidence } from "../../colony/available-evidence.js";
import type { PrefetchedData } from "../observe-router.js";

export type EvidenceExtractor = (toolkit: Toolkit, prefetched?: PrefetchedData) => Promise<AvailableEvidence[]>;

import { extractColonyFeeds } from "./colony-feeds.js";
import { extractColonySignals } from "./colony-signals.js";
import { extractThreads } from "./threads.js";
import { extractEngagement } from "./engagement.js";
import { extractOracle } from "./oracle.js";
import { extractLeaderboard } from "./leaderboard.js";
import { extractPrices } from "./prices.js";
import { extractPredictions } from "./predictions.js";
import { extractVerification } from "./verification.js";
import { extractNetwork } from "./network.js";

export {
  extractColonyFeeds,
  extractColonySignals,
  extractThreads,
  extractEngagement,
  extractOracle,
  extractLeaderboard,
  extractPrices,
  extractPredictions,
  extractVerification,
  extractNetwork,
};

export const EXTRACTOR_REGISTRY: Record<string, EvidenceExtractor> = {
  "colony-feeds": extractColonyFeeds,
  "colony-signals": extractColonySignals,
  "threads": extractThreads,
  "engagement": extractEngagement,
  "oracle": extractOracle,
  "leaderboard": extractLeaderboard,
  "prices": extractPrices,
  "predictions": extractPredictions,
  "verification": extractVerification,
  "network": extractNetwork,
};
