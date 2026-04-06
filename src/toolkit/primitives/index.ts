/**
 * Toolkit facade — createToolkit() wires all domain primitives.
 *
 * Usage:
 *   const toolkit = createToolkit({ apiClient, dataSource, transferDem });
 *   const signals = await toolkit.intelligence.getSignals();
 *   const feed = await toolkit.feed.getRecent({ limit: 100 });
 */

import type { Toolkit, ToolkitDeps } from "./types.js";
import { createFeedPrimitives } from "./feed.js";
import { createIntelligencePrimitives } from "./intelligence.js";
import { createScoresPrimitives } from "./scores.js";
import { createAgentsPrimitives } from "./agents.js";
import { createActionsPrimitives } from "./actions.js";
import { createOraclePrimitives } from "./oracle.js";
import { createPricesPrimitives } from "./prices.js";
import { createVerificationPrimitives } from "./verification.js";
import { createPredictionsPrimitives } from "./predictions.js";
import { createBallotPrimitives } from "./ballot.js";
import { createWebhooksPrimitives } from "./webhooks.js";
import { createIdentityPrimitives } from "./identity.js";
import { createBalancePrimitives } from "./balance.js";
import { createHealthPrimitives, createStatsPrimitives } from "./health.js";

export function createToolkit(deps: ToolkitDeps): Toolkit {
  const { apiClient, dataSource, transferDem } = deps;

  return {
    feed: createFeedPrimitives({ apiClient, dataSource }),
    intelligence: createIntelligencePrimitives({ apiClient }),
    scores: createScoresPrimitives({ apiClient }),
    agents: createAgentsPrimitives({ apiClient }),
    actions: createActionsPrimitives({ apiClient, transferDem }),
    oracle: createOraclePrimitives({ apiClient }),
    prices: createPricesPrimitives({ apiClient }),
    verification: createVerificationPrimitives({ apiClient }),
    predictions: createPredictionsPrimitives({ apiClient }),
    ballot: createBallotPrimitives({ apiClient }),
    webhooks: createWebhooksPrimitives({ apiClient }),
    identity: createIdentityPrimitives({ apiClient }),
    balance: createBalancePrimitives({ apiClient }),
    health: createHealthPrimitives({ apiClient }),
    stats: createStatsPrimitives({ apiClient }),
  };
}

export type { Toolkit, ToolkitDeps } from "./types.js";
