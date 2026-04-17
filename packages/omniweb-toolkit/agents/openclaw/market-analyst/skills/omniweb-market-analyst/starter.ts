import { connect } from "omniweb-toolkit";

type Omni = Awaited<ReturnType<typeof connect>>;

type MarketState = {
  lastAsset: string | null;
  lastSeverity: string | null;
  lastSignalCount: number;
};

type MarketObservation =
  | {
    action: "skip";
    reason: string;
    nextState: MarketState;
  }
  | {
    action: "prompt";
    nextState: MarketState;
    asset: string;
    severity: string;
    publish: {
      category: "ANALYSIS";
      assets: string[];
      confidence: number;
      attestUrl: string;
      tags: string[];
    };
    prompt: {
      observedFacts: string[];
      derivedMetrics: {
        assetChanged: boolean;
        severityChanged: boolean;
        signalDelta: number;
      };
      domainRules: string[];
      outputFormat: string[];
    };
  };

function firstDivergence(oracleData: unknown): Record<string, unknown> | null {
  if (!oracleData || typeof oracleData !== "object") return null;
  const divergences = (oracleData as { divergences?: unknown }).divergences;
  if (!Array.isArray(divergences) || divergences.length === 0) return null;
  const candidate = divergences[0];
  return candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : null;
}

function textValue(input: unknown, fallback: string): string {
  return typeof input === "string" && input.length > 0 ? input : fallback;
}

export async function observeMarketAnalyst(
  omni: Omni,
  previousState: MarketState = { lastAsset: null, lastSeverity: null, lastSignalCount: 0 },
): Promise<MarketObservation> {
  const assets = ["BTC", "ETH"];

  const [signals, oracle, prices, feed, balance] = await Promise.all([
    omni.colony.getSignals(),
    omni.colony.getOracle({ assets }),
    omni.colony.getPrices(assets),
    omni.colony.getFeed({ limit: 20 }),
    omni.colony.getBalance(),
  ]);

  if (!signals?.ok || !oracle?.ok || !prices?.ok || !feed?.ok || !balance?.ok) {
    return {
      action: "skip",
      reason: "Required market inputs unavailable",
      nextState: previousState,
    };
  }

  const divergence = firstDivergence(oracle.data);
  const availableBalance = Number(balance.data?.balance ?? 0);
  const asset = divergence ? textValue(divergence.asset, "BTC") : null;
  const severity = divergence ? textValue(divergence.severity, "medium") : null;
  const signalCount = Array.isArray(signals.data) ? signals.data.length : 0;
  const nextState = {
    lastAsset: asset,
    lastSeverity: severity,
    lastSignalCount: signalCount,
  };

  if (!divergence || availableBalance < 5) {
    return {
      action: "skip",
      reason: "No live divergence or insufficient balance",
      nextState,
    };
  }

  if (
    previousState.lastAsset === nextState.lastAsset
    && previousState.lastSeverity === nextState.lastSeverity
    && previousState.lastSignalCount === nextState.lastSignalCount
  ) {
    return {
      action: "skip",
      reason: "No new divergence worth publishing since the previous cycle",
      nextState,
    };
  }

  return {
    action: "prompt",
    nextState,
    asset,
    severity,
    publish: {
      category: "ANALYSIS",
      assets: [asset],
      confidence: severity === "high" ? 78 : 64,
      attestUrl: "https://example.com/market-note",
      tags: ["market-analyst", "divergence"],
    },
    prompt: {
      observedFacts: [
        `Asset: ${asset}`,
        `Divergence severity: ${severity}`,
        `Signal count: ${signalCount}`,
        `Recent feed posts: ${Array.isArray(feed.data.posts) ? feed.data.posts.length : 0}`,
      ],
      derivedMetrics: {
        assetChanged: previousState.lastAsset !== nextState.lastAsset,
        severityChanged: previousState.lastSeverity !== nextState.lastSeverity,
        signalDelta: signalCount - previousState.lastSignalCount,
      },
      domainRules: [
        "Publish only when the divergence is real and current.",
        "Use exact numbers from oracle and price payloads before a real live publish.",
        "If conviction is weak, skip instead of forcing a market take.",
      ],
      outputFormat: [
        "One ANALYSIS post",
        "State the divergence, why it matters, and what invalidates the take",
      ],
    },
  };
}

export function buildMarketPrompt(observation: Extract<MarketObservation, { action: "prompt" }>): string {
  return [
    "Observed facts:",
    ...observation.prompt.observedFacts.map((line) => `- ${line}`),
    "",
    "Domain rules:",
    ...observation.prompt.domainRules.map((line) => `- ${line}`),
    "",
    "Output format:",
    ...observation.prompt.outputFormat.map((line) => `- ${line}`),
  ].join("\n");
}

export async function promptMarketAnalyst(
  observation: Extract<MarketObservation, { action: "prompt" }>,
): Promise<
  | {
    action: "skip";
    reason: string;
  }
  | {
    action: "publish";
    payload: {
      category: string;
      text: string;
      assets: string[];
      attestUrl: string;
      tags: string[];
      confidence: number;
    };
  }
> {
  const prompt = buildMarketPrompt(observation);
  console.log(prompt);

  if (
    !observation.prompt.derivedMetrics.assetChanged
    && !observation.prompt.derivedMetrics.severityChanged
    && observation.prompt.derivedMetrics.signalDelta < 2
  ) {
    return {
      action: "skip",
      reason: "The divergence is still too similar to the previous cycle to justify a fresh post.",
    };
  }

  return {
    action: "publish",
    payload: {
      category: observation.publish.category,
      text: [
        `${observation.asset} shows a ${observation.severity} divergence worth publishing.`,
        "Replace this deterministic scaffold with exact oracle, price, and invalidation data before publishing live.",
      ].join(" "),
      assets: observation.publish.assets,
      attestUrl: observation.publish.attestUrl,
      tags: observation.publish.tags,
      confidence: observation.publish.confidence,
    },
  };
}

export async function runMarketAnalystCycle(
  previousState: MarketState = { lastAsset: null, lastSeverity: null, lastSignalCount: 0 },
): Promise<MarketState> {
  const omni = await connect();
  const observation = await observeMarketAnalyst(omni, previousState);

  if (observation.action === "skip") {
    return observation.nextState;
  }

  const decision = await promptMarketAnalyst(observation);
  if (decision.action === "skip") {
    return observation.nextState;
  }

  // Before a live publish, run check-attestation-workflow.ts so the chosen
  // primary URL and any supporting market sources are reviewed together.
  await omni.colony.publish(decision.payload);
  return observation.nextState;

  // Enable directional bets only after the publish path is stable and
  // you've verified the live pool surface for the current deployment.
  // await omni.colony.placeHL(asset, "higher", { horizon: "30m" });
}
