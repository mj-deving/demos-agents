import { pathToFileURL } from "node:url";
import {
  buildMarketDraft,
  deriveMarketOpportunities,
  runMinimalAgentLoop,
  type MinimalObserveContext,
  type MinimalObserveResult,
} from "omniweb-toolkit/agent";

interface MarketState {
  lastAsset?: string;
  lastOpportunityKind?: string;
  lastPublishedAt?: string;
  assetHistory?: Array<{
    asset: string;
    publishedAt: string;
    opportunityKind: string;
  }>;
}

interface FeedSample {
  txHash: string | null;
  category: string | null;
  text: string;
  author: string | null;
  timestamp: number | null;
}

const TRACKED_ASSETS = ["BTC", "ETH", "SOL"];
const PUBLISH_COOLDOWN_MS = 30 * 60 * 1000;
const MAX_ASSET_HISTORY = 5;

function postText(post: unknown): string {
  if (!post || typeof post !== "object") return "";
  const payload = (post as { payload?: { text?: unknown } }).payload;
  const payloadText = payload?.text;
  if (typeof payloadText === "string") return payloadText;
  const direct = (post as { text?: unknown }).text;
  return typeof direct === "string" ? direct : "";
}

function samplePost(post: unknown): FeedSample {
  if (!post || typeof post !== "object") {
    return {
      txHash: null,
      category: null,
      text: "",
      author: null,
      timestamp: null,
    };
  }

  const payload = (post as { payload?: { cat?: unknown } }).payload;
  return {
    txHash: typeof (post as { txHash?: unknown }).txHash === "string" ? (post as { txHash: string }).txHash : null,
    category: typeof payload?.cat === "string" ? payload.cat : null,
    text: postText(post),
    author: typeof (post as { author?: unknown }).author === "string" ? (post as { author: string }).author : null,
    timestamp: typeof (post as { timestamp?: unknown }).timestamp === "number" ? (post as { timestamp: number }).timestamp : null,
  };
}

function normalizeDirection(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function observe(
  ctx: MinimalObserveContext<MarketState>,
): Promise<MinimalObserveResult<MarketState>> {
  const [signals, oracle, prices, feed, balance] = await Promise.all([
    ctx.omni.colony.getSignals(),
    ctx.omni.colony.getOracle({ assets: TRACKED_ASSETS }),
    ctx.omni.colony.getPrices(TRACKED_ASSETS),
    ctx.omni.colony.getFeed({ limit: 20 }),
    ctx.omni.colony.getBalance(),
  ]);

  if (!signals?.ok || !oracle?.ok || !prices?.ok || !feed?.ok || !balance?.ok) {
    return {
      kind: "skip",
      reason: "read_failed",
      facts: {
        signalsOk: signals?.ok === true,
        oracleOk: oracle?.ok === true,
        pricesOk: prices?.ok === true,
        feedOk: feed?.ok === true,
        balanceOk: balance?.ok === true,
      },
      nextState: ctx.memory.state ?? {},
    };
  }

  const signalList = Array.isArray(signals.data) ? signals.data : [];
  const divergences = Array.isArray(oracle.data?.divergences) ? oracle.data.divergences : [];
  const priceList = Array.isArray(prices.data) ? prices.data : [];
  const posts = Array.isArray(feed.data.posts) ? feed.data.posts : [];
  const availableBalance = Number(balance.data?.balance ?? 0);
  const feedSample = posts.slice(0, 10).map(samplePost);
  const signalSample = signalList.slice(0, 10).map((signal) => ({
    topic:
      signal && typeof signal === "object" && typeof (signal as { shortTopic?: unknown; topic?: unknown }).shortTopic === "string"
        ? (signal as { shortTopic: string }).shortTopic
        : signal && typeof signal === "object" && typeof (signal as { topic?: unknown }).topic === "string"
          ? (signal as { topic: string }).topic
          : null,
    confidence:
      signal && typeof signal === "object" && typeof (signal as { confidence?: unknown }).confidence === "number"
        ? (signal as { confidence: number }).confidence
        : null,
    direction: normalizeDirection(signal && typeof signal === "object" ? (signal as { direction?: unknown }).direction : null),
    assets:
      signal && typeof signal === "object" && Array.isArray((signal as { assets?: unknown }).assets)
        ? (signal as { assets: string[] }).assets
        : undefined,
  }));
  const divergenceSample = divergences.slice(0, 10).map((divergence) => ({
    asset: typeof divergence.asset === "string" ? divergence.asset : "",
    severity: divergence.severity,
    type: typeof divergence.type === "string" ? divergence.type : "unknown",
    description: typeof divergence.description === "string" ? divergence.description : "",
    details: divergence.details,
  }));
  const priceSample = priceList.slice(0, 10).map((price) => ({
    ticker: price.ticker,
    priceUsd: price.priceUsd,
    change24h: typeof price.change24h === "number" ? price.change24h : null,
    source: typeof price.source === "string" ? price.source : null,
    fetchedAt: typeof price.fetchedAt === "number" ? price.fetchedAt : null,
  }));

  if (availableBalance < 5 || divergenceSample.length === 0) {
    return {
      kind: "skip",
      reason: availableBalance < 5 ? "low_balance" : "no_market_edge",
      facts: {
        availableBalance,
        divergenceCount: divergenceSample.length,
        signalCount: signalList.length,
      },
      audit: {
        inputs: {
          feedSample,
          signalSample,
          divergenceSample,
          priceSample,
        },
        promptPacket: {
          objective: "Decide whether a market publish is justified from oracle, signal, and price data.",
          skipReason: availableBalance < 5 ? "low_balance" : "no_market_edge",
        },
      },
      nextState: ctx.memory.state ?? {},
    };
  }

  const opportunities = deriveMarketOpportunities({
    signals: signalSample,
    divergences: divergenceSample,
    prices: priceSample,
    posts: feedSample,
    lastAsset: ctx.memory.state?.lastAsset ?? null,
    recentAssets: (ctx.memory.state?.assetHistory ?? []).map((entry) => entry.asset),
  });
  const chosenOpportunity = opportunities[0] ?? null;

  if (!chosenOpportunity) {
    return {
      kind: "skip",
      reason: "no_publishable_market_opportunity",
      facts: {
        divergenceCount: divergenceSample.length,
        signalCount: signalList.length,
        priceCount: priceList.length,
      },
      audit: {
        inputs: {
          feedSample,
          signalSample,
          divergenceSample,
          priceSample,
        },
        promptPacket: {
          objective: "Find a publishable market opportunity grounded in real divergence or signal-price mismatch evidence.",
          result: "skip",
        },
      },
      nextState: ctx.memory.state ?? {},
    };
  }

  const publishedAtMs = parseIsoMs(ctx.memory.state?.lastPublishedAt);
  if (
    ctx.memory.state?.lastAsset === chosenOpportunity.asset
    && ctx.memory.state?.lastOpportunityKind === chosenOpportunity.kind
  ) {
    return {
      kind: "skip",
      reason: "market_edge_unchanged",
      facts: {
        asset: chosenOpportunity.asset,
        opportunityKind: chosenOpportunity.kind,
        lastPublishedAt: ctx.memory.state?.lastPublishedAt ?? null,
      },
      attestationPlan: chosenOpportunity.attestationPlan,
      audit: {
        inputs: {
          feedSample,
          signalSample,
          divergenceSample,
          priceSample,
        },
        selectedEvidence: {
          asset: chosenOpportunity.asset,
          opportunityKind: chosenOpportunity.kind,
          divergence: chosenOpportunity.divergence,
          priceSnapshot: chosenOpportunity.priceSnapshot,
          matchedSignal: chosenOpportunity.matchedSignal,
        },
        promptPacket: {
          objective: "Avoid re-publishing the same unchanged market edge too soon.",
          asset: chosenOpportunity.asset,
          opportunityKind: chosenOpportunity.kind,
          result: "skip",
          attestationPlanReady: chosenOpportunity.attestationPlan.ready,
        },
      },
      nextState: ctx.memory.state,
    };
  }

  if (publishedAtMs != null && Date.parse(ctx.cycle.startedAt) - publishedAtMs < PUBLISH_COOLDOWN_MS) {
    return {
      kind: "skip",
      reason: "published_within_last_30m",
      facts: {
        asset: chosenOpportunity.asset,
        opportunityKind: chosenOpportunity.kind,
        lastPublishedAt: ctx.memory.state?.lastPublishedAt ?? null,
        cooldownMsRemaining: PUBLISH_COOLDOWN_MS - (Date.parse(ctx.cycle.startedAt) - publishedAtMs),
      },
      attestationPlan: chosenOpportunity.attestationPlan,
      audit: {
        inputs: {
          feedSample,
          signalSample,
          divergenceSample,
          priceSample,
        },
        selectedEvidence: {
          asset: chosenOpportunity.asset,
          opportunityKind: chosenOpportunity.kind,
          divergence: chosenOpportunity.divergence,
          priceSnapshot: chosenOpportunity.priceSnapshot,
          matchedSignal: chosenOpportunity.matchedSignal,
        },
        promptPacket: {
          objective: "Skip repeated market publishes until the 30-minute cooldown expires.",
          asset: chosenOpportunity.asset,
          opportunityKind: chosenOpportunity.kind,
          result: "skip",
          attestationPlanReady: chosenOpportunity.attestationPlan.ready,
        },
      },
      nextState: ctx.memory.state ?? {},
    };
  }

  if (!chosenOpportunity.attestationPlan.ready || !chosenOpportunity.attestationPlan.primary) {
    return {
      kind: "skip",
      reason: "attestation_plan_not_ready",
      facts: {
        asset: chosenOpportunity.asset,
        opportunityKind: chosenOpportunity.kind,
        opportunityScore: chosenOpportunity.score,
        availableBalance,
      },
      attestationPlan: chosenOpportunity.attestationPlan,
      audit: {
        inputs: {
          feedSample,
          signalSample,
          divergenceSample,
          priceSample,
        },
        selectedEvidence: {
          asset: chosenOpportunity.asset,
          opportunityKind: chosenOpportunity.kind,
          divergence: chosenOpportunity.divergence,
          priceSnapshot: chosenOpportunity.priceSnapshot,
          matchedSignal: chosenOpportunity.matchedSignal,
        },
        promptPacket: {
          objective: "Only publish market analysis when the claim has a viable primary plus supporting attestation plan.",
          asset: chosenOpportunity.asset,
          opportunityKind: chosenOpportunity.kind,
          rationale: chosenOpportunity.rationale,
          result: "skip",
          attestationPlanReady: chosenOpportunity.attestationPlan.ready,
        },
        notes: chosenOpportunity.attestationPlan.warnings,
      },
      nextState: ctx.memory.state ?? {},
    };
  }

  const draft = await buildMarketDraft({
    opportunity: chosenOpportunity,
    feedCount: posts.length,
    availableBalance,
    oracleAssetCount: Array.isArray(oracle.data?.assets) ? oracle.data.assets.length : 0,
    llmProvider: ctx.omni.runtime.llmProvider,
    minTextLength: 220,
  });

  if (!draft.ok) {
    return {
      kind: "skip",
      reason: draft.reason,
      facts: {
        asset: chosenOpportunity.asset,
        opportunityKind: chosenOpportunity.kind,
        opportunityScore: chosenOpportunity.score,
        availableBalance,
      },
      attestationPlan: chosenOpportunity.attestationPlan,
      audit: {
        inputs: {
          feedSample,
          signalSample,
          divergenceSample,
          priceSample,
        },
        selectedEvidence: {
          asset: chosenOpportunity.asset,
          opportunityKind: chosenOpportunity.kind,
          divergence: chosenOpportunity.divergence,
          priceSnapshot: chosenOpportunity.priceSnapshot,
          matchedSignal: chosenOpportunity.matchedSignal,
        },
        promptPacket: draft.promptPacket as unknown as Record<string, unknown>,
        notes: [
          ...draft.notes,
          ...chosenOpportunity.attestationPlan.warnings,
        ],
      },
      nextState: ctx.memory.state ?? {},
    };
  }

  return {
    kind: "publish",
    category: draft.category,
    text: draft.text,
    attestUrl: chosenOpportunity.attestationPlan.primary.url,
    tags: draft.tags,
    confidence: draft.confidence,
    facts: {
      asset: chosenOpportunity.asset,
      opportunityKind: chosenOpportunity.kind,
      opportunityScore: chosenOpportunity.score,
      draftSource: draft.draftSource,
      recommendedDirection: chosenOpportunity.recommendedDirection,
      availableBalance,
    },
    attestationPlan: chosenOpportunity.attestationPlan,
    audit: {
      inputs: {
        feedSample,
        signalSample,
        divergenceSample,
        priceSample,
      },
      selectedEvidence: {
        asset: chosenOpportunity.asset,
        opportunityKind: chosenOpportunity.kind,
        divergence: chosenOpportunity.divergence,
        priceSnapshot: chosenOpportunity.priceSnapshot,
        matchedSignal: chosenOpportunity.matchedSignal,
      },
      promptPacket: {
        ...draft.promptPacket,
        category: draft.category,
        draftText: draft.text,
        qualityGate: draft.qualityGate,
        primaryAttestUrl: chosenOpportunity.attestationPlan.primary.url,
        supportingAttestUrls: chosenOpportunity.attestationPlan.supporting.map((candidate) => candidate.url),
      },
      notes: [
        "The market starter persists reduced raw inputs, selected evidence, the prompt packet, and the attestation plan for operator audit.",
        "Keep higher-lower bets as an optional sidecar until the publish loop is fully stable on the current host.",
        ...chosenOpportunity.attestationPlan.warnings,
      ],
    },
    nextState: {
      lastAsset: chosenOpportunity.asset,
      lastOpportunityKind: chosenOpportunity.kind,
      lastPublishedAt: ctx.cycle.startedAt,
      assetHistory: buildNextAssetHistory(ctx.memory.state?.assetHistory ?? [], {
        asset: chosenOpportunity.asset,
        publishedAt: ctx.cycle.startedAt,
        opportunityKind: chosenOpportunity.kind,
      }),
    },
  };
}

function parseIsoMs(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildNextAssetHistory(
  previous: Array<{ asset: string; publishedAt: string; opportunityKind: string }>,
  nextEntry: { asset: string; publishedAt: string; opportunityKind: string },
): Array<{ asset: string; publishedAt: string; opportunityKind: string }> {
  const deduped = previous.filter((entry) => entry.asset !== nextEntry.asset);
  return [nextEntry, ...deduped].slice(0, MAX_ASSET_HISTORY);
}

if (isMainModule()) {
  await runMinimalAgentLoop(observe, {
    intervalMs: 10 * 60_000,
    dryRun: true,
  });
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}
