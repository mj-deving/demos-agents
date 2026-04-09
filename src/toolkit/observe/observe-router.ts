/**
 * Strategy-driven observe router.
 *
 * Single-fetch architecture: prefetches all needed API data once,
 * then passes results to extractors. No duplicate API calls.
 *
 * Two evidence streams:
 * 1. Colony intelligence (Learn) — colony API extractors
 * 2. Source evidence (Share) — external URL fetching via catalog pipeline
 *
 * Both feed into the same AvailableEvidence[] for the strategy engine.
 * Also builds ApiEnrichmentData from the prefetched results.
 */
import type { StrategyConfig, ApiEnrichmentData } from "../strategy/types.js";
import type { Toolkit } from "../primitives/types.js";
import type { AvailableEvidence } from "../colony/available-evidence.js";
import type { ColonyDatabase } from "../colony/schema.js";
import type { AgentSourceView } from "../sources/catalog.js";
import { EXTRACTOR_REGISTRY, type EvidenceExtractor } from "./extractors/index.js";
import { fetchSourcesParallel } from "../sources/fetch-parallel.js";
import { computeAvailableEvidence } from "../colony/available-evidence.js";

/** All ADR-0020 evidence categories (colony intelligence). */
const ALL_CATEGORIES = Object.keys(EXTRACTOR_REGISTRY);

/** Raw API results shared between extractors to avoid duplicate calls. */
export interface PrefetchedData {
  feed?: Awaited<ReturnType<Toolkit["feed"]["getRecent"]>>;
  feedQuestions?: Awaited<ReturnType<Toolkit["feed"]["search"]>>;
  signals?: Awaited<ReturnType<Toolkit["intelligence"]["getSignals"]>>;
  oracle?: Awaited<ReturnType<Toolkit["oracle"]["get"]>>;
  prices?: Awaited<ReturnType<Toolkit["prices"]["get"]>>;
  leaderboard?: Awaited<ReturnType<Toolkit["scores"]["getLeaderboard"]>>;
  stats?: Awaited<ReturnType<Toolkit["stats"]["get"]>>;
  health?: Awaited<ReturnType<Toolkit["health"]["check"]>>;
  predictions?: Awaited<ReturnType<Toolkit["predictions"]["query"]>>;
  agents?: Awaited<ReturnType<Toolkit["agents"]["list"]>>;
  /** All recent posts (no category filter) for colony state building. */
  recentPosts?: Awaited<ReturnType<Toolkit["feed"]["getRecent"]>>;
  /** Betting pools discovered from oracle asset tickers. */
  bettingPools?: Array<{ asset: string; pool: any }>;
}

/** Which API calls each category needs. */
const CATEGORY_DEPS: Record<string, (keyof PrefetchedData)[]> = {
  "colony-feeds": ["feed"],
  "colony-signals": ["signals"],
  "threads": ["feedQuestions"],
  "engagement": ["leaderboard"],
  "oracle": ["oracle"],
  "leaderboard": ["leaderboard"],
  "prices": ["prices"],
  "predictions": ["predictions"],
  "verification": ["stats"],
  "network": ["stats", "health"],
};

/**
 * Determine which evidence categories are active based on strategy config.
 * If no evidence.categories is configured, all colony intelligence categories are active.
 */
export function getActiveCategories(config: StrategyConfig): string[] {
  const ev = config.evidence?.categories;
  if (!ev) return [...ALL_CATEGORIES];

  return [
    ...(ev.core ?? []),
    ...(ev.domain ?? []),
    ...(ev.meta ?? []),
  ];
}

/**
 * Prefetch all API data needed by active categories in one parallel batch.
 * Always fetches enrichment-critical data regardless of categories.
 */
async function prefetchData(
  toolkit: Toolkit,
  categories: string[],
  config?: StrategyConfig,
): Promise<PrefetchedData> {
  // Determine which API calls are needed
  const needed = new Set<keyof PrefetchedData>();
  for (const cat of categories) {
    for (const dep of CATEGORY_DEPS[cat] ?? []) {
      needed.add(dep);
    }
  }
  // Always fetch enrichment-critical data (needed by buildEnrichmentFromPrefetched
  // for publish_signal_aligned, publish_on_divergence, publish_prediction rules)
  needed.add("agents");
  needed.add("signals");
  needed.add("oracle");
  needed.add("prices");
  needed.add("leaderboard");
  // Always fetch unfiltered recent posts for colony state building
  needed.add("recentPosts");

  // Fire all needed calls in parallel
  const promises: Record<string, Promise<unknown>> = {};

  if (needed.has("feed")) {
    promises.feed = toolkit.feed.getRecent({ limit: 50, category: "FEED" });
  }
  if (needed.has("feedQuestions")) {
    promises.feedQuestions = toolkit.feed.search({ text: "", category: "QUESTION", limit: 20 });
  }
  if (needed.has("signals")) {
    promises.signals = toolkit.intelligence.getSignals();
  }
  if (needed.has("oracle")) {
    promises.oracle = toolkit.oracle.get({ window: (config?.limits?.oracleWindow as "6h" | "24h" | "7d") ?? "24h" });
  }
  if (needed.has("prices")) {
    promises.prices = toolkit.prices.get(["BTC", "ETH", "DEM"]);
  }
  if (needed.has("leaderboard")) {
    // Use the larger limit to serve both leaderboard and engagement extractors
    promises.leaderboard = toolkit.scores.getLeaderboard({ limit: config?.limits?.leaderboardLimit ?? 50 });
  }
  if (needed.has("stats")) {
    promises.stats = toolkit.stats.get();
  }
  if (needed.has("health")) {
    promises.health = toolkit.health.check();
  }
  if (needed.has("predictions")) {
    promises.predictions = toolkit.predictions.query({});
  }
  if (needed.has("agents")) {
    promises.agents = toolkit.agents.list();
  }
  if (needed.has("recentPosts")) {
    promises.recentPosts = toolkit.feed.getRecent({ limit: 100 });
  }

  // Await all in parallel
  const keys = Object.keys(promises);
  const values = await Promise.all(Object.values(promises));
  const result: PrefetchedData = {};
  for (let i = 0; i < keys.length; i++) {
    (result as Record<string, unknown>)[keys[i]] = values[i];
  }

  // Follow-up: fetch ballot pools for discovered oracle assets
  // (depends on oracle results, so can't be in the initial Promise.all)
  if (result.oracle?.ok && result.oracle.data?.assets) {
    const assetTickers = Array.from(new Set(
      result.oracle.data.assets
        .map((a: any) => (a.ticker as string).trim())
        .filter((t: string) => t.length > 0),
    ));
    const poolAssets = assetTickers.length > 0 ? assetTickers : ["BTC", "ETH"];
    const poolResults = await Promise.allSettled(
      poolAssets.map(async (asset) => ({
        asset,
        pool: await toolkit.ballot.getPool({ asset }),
      })),
    );
    result.bettingPools = poolResults.flatMap((r) => {
      if (r.status === "rejected") return [];
      const val = r.value;
      if (!val.pool?.ok) return [];
      return [{ asset: val.asset, pool: val.pool.data }];
    });
  }

  return result;
}

/**
 * Build ApiEnrichmentData from prefetched results.
 * Replaces the need for a separate fetchApiEnrichment() call.
 */
export function buildEnrichmentFromPrefetched(data: PrefetchedData): ApiEnrichmentData {
  const enrichment: ApiEnrichmentData = {};

  if (data.agents?.ok) {
    enrichment.agentCount = data.agents.data.agents.length;
  }
  if (data.leaderboard?.ok) {
    enrichment.leaderboard = data.leaderboard.data;
  }
  if (data.oracle?.ok) {
    enrichment.oracle = data.oracle.data;

    if (data.oracle.data.polymarket) {
      enrichment.polymarket = data.oracle.data.polymarket;
    }
    const sentiments = (data.oracle.data.assets ?? [])
      .filter((a: any) => a.sentiment)
      .map((a: any) => ({
        ticker: a.ticker,
        direction: a.sentiment!.direction,
        score: a.sentiment!.score,
        posts: a.postCount,
      }));
    if (sentiments.length > 0) enrichment.assetSentiments = sentiments;

    const attestations = (data.oracle.data.assets ?? [])
      .filter((a: any) => a.price?.dahrTxHash)
      .map((a: any) => ({ ticker: a.ticker, dahrTxHash: a.price.dahrTxHash! }));
    if (attestations.length > 0) enrichment.priceAttestations = attestations;
  }
  if (data.prices?.ok) {
    enrichment.prices = data.prices.data;
  }
  if (data.signals?.ok) {
    enrichment.signals = data.signals.data;
  }

  // Betting pools from follow-up ballot fetch
  if (data.bettingPools) {
    const validPools = data.bettingPools.filter(p => p.pool?.totalBets >= 3);
    if (validPools.length > 0) {
      enrichment.bettingPools = validPools.map(p => p.pool);
      enrichment.bettingPool = validPools[0].pool;
    }
  }

  return enrichment;
}

/** Optional deps for source evidence fetching (Share stream). */
export interface SourceDeps {
  /** Colony DB with source_response_cache table. */
  db: ColonyDatabase;
  /** Agent's filtered source view from catalog. */
  sourceView: AgentSourceView;
  /** Observer for logging. Common types: "insight" (informational), "warning" (non-fatal error). */
  observe?: (type: string, msg: string, meta?: Record<string, unknown>) => void;
  /** Source fetch budget in ms (default: 15_000). */
  budgetMs?: number;
  /** Concurrent source fetches (default: 5). */
  concurrency?: number;
}

/**
 * Fetch source evidence from the catalog pipeline.
 * Returns AvailableEvidence[] from external URLs — attestation-grade data.
 */
async function fetchSourceEvidence(deps: SourceDeps): Promise<AvailableEvidence[]> {
  const observe = deps.observe ?? (() => {});
  const activeSources = deps.sourceView.sources ?? [];

  if (activeSources.length === 0) return [];

  // Fetch external sources → cache in colony DB
  await fetchSourcesParallel(
    activeSources,
    deps.db,
    observe,
    deps.budgetMs ?? 15_000,
    deps.concurrency ?? 5,
  );

  // Compute evidence from cached responses
  const catalogSources = activeSources.map(s => ({
    id: s.id,
    topics: s.topics ?? [],
    domainTags: s.domainTags,
  }));

  return computeAvailableEvidence(deps.db, catalogSources);
}

/** Result of strategy-driven observe — evidence + enrichment in one pass. */
export interface StrategyObserveResult {
  evidence: AvailableEvidence[];
  apiEnrichment: ApiEnrichmentData;
  prefetched: PrefetchedData;
}

/**
 * Strategy-driven observe: two evidence streams merged into one.
 *
 * Stream 1 (Learn): Colony API extractors — what agents think (signals, feed, oracle).
 * Stream 2 (Share): Source pipeline — external data for attestation (catalog → fetch → cache).
 *
 * Both run in parallel. Source deps are optional — templates work
 * without them (colony intelligence only, no attestation sources).
 */
export async function strategyObserve(
  toolkit: Toolkit,
  config: StrategyConfig,
  sourceDeps?: SourceDeps,
): Promise<StrategyObserveResult> {
  const categories = getActiveCategories(config);

  // Run colony API prefetch and source pipeline in parallel
  // Note: even with empty categories, we still prefetch enrichment-critical data
  // (signals, oracle, prices, leaderboard) needed by strategy rules.
  const [prefetched, sourceEvidence] = await Promise.all([
    prefetchData(toolkit, categories, config),
    sourceDeps ? fetchSourceEvidence(sourceDeps) : Promise.resolve([]),
  ]);

  // Run colony intelligence extractors with prefetched data (no new API calls)
  const extractorPromises = categories
    .map(cat => EXTRACTOR_REGISTRY[cat])
    .filter(Boolean)
    .map(extractor => extractor(toolkit, prefetched));

  const results = await Promise.all(extractorPromises);
  const colonyEvidence = results.flat();

  // Merge both evidence streams
  const evidence = [...colonyEvidence, ...sourceEvidence];

  // Build enrichment from prefetched colony data
  const apiEnrichment = buildEnrichmentFromPrefetched(prefetched);

  return { evidence, apiEnrichment, prefetched };
}
