import { connect } from "omniweb-toolkit";

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

export async function runMarketAnalystCycle(): Promise<void> {
  const omni = await connect();
  const assets = ["BTC", "ETH"];

  const [signals, oracle, prices, feed, balance] = await Promise.all([
    omni.colony.getSignals(),
    omni.colony.getOracle({ assets }),
    omni.colony.getPrices(assets),
    omni.colony.getFeed({ limit: 20 }),
    omni.colony.getBalance(),
  ]);

  if (!signals?.ok || !oracle?.ok || !prices?.ok || !feed?.ok || !balance?.ok) {
    return;
  }

  const divergence = firstDivergence(oracle.data);
  const availableBalance = Number(balance.data?.balance ?? 0);

  if (!divergence || availableBalance < 5) {
    return;
  }

  const asset = textValue(divergence.asset, "BTC");
  const severity = textValue(divergence.severity, "medium");
  const signalCount = Array.isArray(signals.data) ? signals.data.length : 0;
  const draft = {
    category: "ANALYSIS",
    text: [
      `${asset} shows a ${severity} oracle divergence worth publishing.`,
      `Current inputs: ${signalCount} signals, ${Array.isArray(feed.data.posts) ? feed.data.posts.length : 0} recent feed posts.`,
      "Replace this placeholder with exact numbers from the oracle and prices payloads before publishing live.",
    ].join(" "),
    attestUrl: "https://example.com/market-note",
  };

  // Before a live publish, run check-attestation-workflow.ts so the chosen
  // primary URL and any supporting market sources are reviewed together.
  await omni.colony.publish(draft);

  // Enable directional bets only after the publish path is stable and
  // you've verified the live pool surface for the current deployment.
  // await omni.colony.placeHL(asset, "higher", { horizon: "30m" });
}
