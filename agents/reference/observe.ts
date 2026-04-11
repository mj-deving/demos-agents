/**
 * Observe phase — parallel data fetch for the reference agent.
 *
 * Follows GUIDE.md "perceive-then-prompt" pattern:
 * 1. Fetch data in parallel (signals, feed, oracle, balance)
 * 2. Derive metrics (divergences, top posts, budget remaining)
 * 3. Return structured observation for the decide phase
 *
 * Built using ONLY omniweb-toolkit methods documented in SKILL.md.
 * Response shapes match references/response-shapes.md exactly.
 */

import type { OmniWeb } from "omniweb-toolkit";

export interface Observation {
  /** Consensus signals with direction and confidence */
  signals: Array<{
    topic: string;
    direction: string;   // "bullish" | "bearish" | "neutral"
    confidence: number;
    assets: string[];
    consensus: boolean;
  }>;
  /** Recent feed posts with content from payload */
  feed: Array<{
    txHash: string;
    text: string;
    author: string;
    score: number;
    hasAttestation: boolean;
    category: string;
  }>;
  /** Oracle prices keyed by ticker */
  oracle: Record<string, { priceUsd: number; change24h: number }>;
  /** Oracle divergences — the most actionable signal */
  divergences: Array<{
    asset: string;
    type: string;
    severity: string;
    description: string;
    signalDirection: string;
  }>;
  /** Agent's current DEM balance */
  balance: number;
  /** Top posts worth engaging with */
  topPosts: Array<{ txHash: string; score: number; hasAttestation: boolean }>;
  /** Timestamp of this observation */
  timestamp: number;
}

/**
 * Fetch all data sources in parallel and derive metrics.
 *
 * SKILL.md pattern: "Read first, publish when you have something valuable to add."
 */
export async function observe(
  omni: OmniWeb,
  opts: { assets: string[]; qualityThreshold: number; divergenceThreshold?: number },
): Promise<Observation> {
  // Phase 1: Parallel fetch — GUIDE.md principle: "data first, LLM last"
  const [signalsResult, feedResult, oracleResult, balanceResult] = await Promise.all([
    omni.colony.getSignals(),
    omni.colony.getFeed({ limit: 20 }),
    omni.colony.getOracle({ assets: opts.assets }),
    omni.colony.getBalance(),
  ]);

  // Extract signals — using SignalData shape from references/response-shapes.md
  const signals = signalsResult?.ok && signalsResult.data
    ? (signalsResult.data as any[]).map((s) => ({
        topic: s.topic ?? "",
        direction: s.direction ?? "neutral",
        confidence: s.confidence ?? 0,
        assets: s.assets ?? [],
        consensus: s.consensus ?? false,
      }))
    : [];

  // Extract feed — FeedPost shape: content is in payload.text / payload.cat
  const feedPosts = feedResult?.ok && (feedResult.data as any)?.posts
    ? (feedResult.data as any).posts.map((p: any) => ({
        txHash: p.txHash ?? "",
        text: (p.payload?.text ?? "").slice(0, 200),
        author: p.author ?? "",
        score: p.score ?? 0,
        hasAttestation: !!(p.payload?.sourceAttestations?.length),
        category: p.payload?.cat ?? "UNKNOWN",
      }))
    : [];

  // Extract oracle — OracleResult shape: assets[].ticker, assets[].price.usd
  const oracle: Record<string, { priceUsd: number; change24h: number }> = {};
  if (oracleResult?.ok && (oracleResult.data as any)?.assets) {
    for (const a of (oracleResult.data as any).assets) {
      oracle[a.ticker] = {
        priceUsd: a.price?.usd ?? 0,
        change24h: a.price?.change24h ?? 0,
      };
    }
  }

  // Extract divergences directly from oracle — these are the most actionable signal
  const rawDivergences = oracleResult?.ok && (oracleResult.data as any)?.divergences
    ? (oracleResult.data as any).divergences as Array<{
        type: string; asset: string; severity: string; description: string;
        details?: { agentDirection?: string; marketDirection?: string };
      }>
    : [];

  // Filter by severity threshold if configured
  const severityRank: Record<string, number> = { low: 1, medium: 2, high: 3 };
  const minSeverity = opts.divergenceThreshold ?? 0; // 0 = all, 2 = medium+, 3 = high only
  const filteredDivergences = rawDivergences.filter(
    (d) => (severityRank[d.severity] ?? 0) >= minSeverity,
  );

  // Enrich divergences with signal direction for bet decisions
  const divergences = filteredDivergences.map((d) => {
    // Find matching signal for this asset to get direction
    const matchingSignal = signals.find((s) =>
      s.assets.includes(d.asset) || s.topic.toLowerCase().includes(d.asset.toLowerCase())
    );
    return {
      asset: d.asset,
      type: d.type,
      severity: d.severity,
      description: d.description,
      signalDirection: matchingSignal?.direction ?? d.details?.agentDirection ?? "neutral",
    };
  });

  // Extract balance — AgentBalanceResponse: { balance: number }
  const balance = balanceResult?.ok && balanceResult.data
    ? Number((balanceResult.data as any).balance ?? 0)
    : 0;

  // Top posts — worth engaging with (reactions/tips)
  const topPosts = feedPosts
    .filter((p) => p.score >= opts.qualityThreshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ txHash, score, hasAttestation }) => ({ txHash, score, hasAttestation }));

  return {
    signals,
    feed: feedPosts,
    oracle,
    divergences,
    balance,
    topPosts,
    timestamp: Date.now(),
  };
}
