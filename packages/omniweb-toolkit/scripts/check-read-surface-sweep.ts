#!/usr/bin/env npx tsx
/**
 * check-read-surface-sweep.ts — Exercise the package's read-only colony surface
 * against the current live host and report which methods are production-ready,
 * which are auth-gated, and which remain dev-only or degraded.
 *
 * Output: structured JSON report to stdout.
 * Exit codes:
 *   0 = all production-scope reads passed
 *   1 = at least one production-scope read failed or the runtime could not initialize
 *   2 = invalid args
 */

import { DEFAULT_BASE_URL, fetchText, getNumberArg, hasFlag } from "./_shared.js";

type Verdict =
  | "pass"
  | "fail"
  | "expected_dev_only"
  | "auth_blocked"
  | "skipped";

type SampleContext = {
  samplePostTxHash: string | null;
  sampleAuthor: string | null;
  sportsFixtureId: string | null;
};

type SweepResult = {
  method: string;
  scope: "production" | "dev_only";
  verdict: Verdict;
  ok: boolean;
  status: number | null;
  summary: string;
  sample?: Record<string, unknown> | null;
  error?: string | null;
};

type ColonyReadApi = {
  getFeed(opts?: { limit?: number; category?: string }): Promise<any>;
  search(opts: { text?: string; category?: string }): Promise<any>;
  getPostDetail(txHash: string): Promise<any>;
  getOracle(opts?: { assets?: string[] }): Promise<any>;
  getPrices(assets: string[]): Promise<any>;
  getPriceHistory(asset: string, periods: number): Promise<any>;
  getBalance(): Promise<any>;
  getPool(opts?: { asset?: string; horizon?: string }): Promise<any>;
  getHigherLowerPool(opts?: { asset?: string; horizon?: string }): Promise<any>;
  getBinaryPools(opts?: { category?: string; limit?: number }): Promise<any>;
  getEthPool(opts?: { asset?: string; horizon?: string }): Promise<any>;
  getEthWinners(opts?: { asset?: string }): Promise<any>;
  getEthHigherLowerPool(opts?: { asset?: string; horizon?: string }): Promise<any>;
  getEthBinaryPools(): Promise<any>;
  getSportsMarkets(opts?: { status?: string }): Promise<any>;
  getSportsPool(fixtureId: string): Promise<any>;
  getSportsWinners(fixtureId: string): Promise<any>;
  getCommodityPool(opts?: { asset?: string; horizon?: string }): Promise<any>;
  getPredictionIntelligence(opts?: { limit?: number; stats?: boolean }): Promise<any>;
  getPredictionRecommendations(userAddress: string): Promise<any>;
  getSignals(): Promise<any>;
  getConvergence(): Promise<any>;
  getReport(opts?: { id?: string }): Promise<any>;
  getLeaderboard(opts?: { limit?: number }): Promise<any>;
  getTopPosts(opts?: { category?: string; minScore?: number; limit?: number }): Promise<any>;
  getAgents(): Promise<any>;
  getMarkets(opts?: { category?: string; limit?: number }): Promise<any>;
  getPredictions(opts?: { status?: string; asset?: string; agent?: string }): Promise<any>;
  getForecastScore(address: string): Promise<any>;
  getReactions(txHash: string): Promise<any>;
  getTipStats(txHash: string): Promise<any>;
};

type OmniWebRuntime = {
  address: string;
  colony: ColonyReadApi;
  runtime: {
    sdkBridge: {
      apiAccess: string;
    };
    getToken: () => Promise<string | null>;
  };
};

const args = process.argv.slice(2);

if (hasFlag(args, "--help", "-h")) {
  console.log(`Usage: npx tsx scripts/check-read-surface-sweep.ts [--price-history-periods N] [--search-text TEXT] [--include-dev-only]

Options:
  --price-history-periods N  Period count for getPriceHistory (default: 24)
  --include-dev-only         Probe dev-host-only mirrors and excluded reads too
  --help, -h                 Show this help

Output: JSON report of the package's read-only colony surface on the current host
Exit codes: 0 = production reads pass, 1 = production read failure, 2 = invalid args`);
  process.exit(0);
}

const priceHistoryPeriods = getNumberArg(args, "--price-history-periods") ?? 24;
const searchText = getStringArgLoose(args, "--search-text") ?? "bitcoin";
const includeDevOnly = hasFlag(args, "--include-dev-only");

if (!Number.isInteger(priceHistoryPeriods) || priceHistoryPeriods < 1) {
  console.error("Error: --price-history-periods must be a positive integer");
  process.exit(2);
}

try {
  const connect = await loadConnect();
  const omni = await connect();
  const token = await omni.runtime.getToken().catch(() => null);

  const discoveryChecks = await runDiscoveryChecks();
  const sampleContext = await buildSampleContext(omni.colony);
  const readChecks = await runReadChecks(omni, sampleContext, {
    includeDevOnly,
    priceHistoryPeriods,
    searchText,
  });

  const productionFailures = readChecks.filter((result) => (
    result.scope === "production" && result.verdict !== "pass"
  ));
  const discoveryFailures = discoveryChecks.filter((result) => !result.ok);

  const report = {
    checkedAt: new Date().toISOString(),
    host: {
      configuredBaseUrl: DEFAULT_BASE_URL,
      sdkBridgeApiAccess: omni.runtime.sdkBridge.apiAccess,
      walletAddress: omni.address,
      authTokenAvailable: !!token,
    },
    sampleContext,
    includeDevOnly,
    discovery: {
      ok: discoveryFailures.length === 0,
      results: discoveryChecks,
    },
    reads: {
      ok: productionFailures.length === 0,
      verdictCounts: countVerdicts(readChecks),
      results: readChecks,
    },
    failures: {
      discovery: discoveryFailures.map((entry) => entry.path),
      productionReads: productionFailures.map((entry) => entry.method),
    },
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(discoveryFailures.length === 0 && productionFailures.length === 0 ? 0 : 1);
} catch (error) {
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    ok: false,
    stage: "runtime_init",
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
}

async function runDiscoveryChecks(): Promise<Array<{ path: string; ok: boolean; httpStatus: number; error?: string }>> {
  const paths = [
    "/llms-full.txt",
    "/openapi.json",
    "/.well-known/ai-plugin.json",
    "/.well-known/agents.json",
    "/.well-known/agent.json",
  ];

  const results = await Promise.all(paths.map((path) => fetchText(path, { baseUrl: DEFAULT_BASE_URL })));
  return results.map((result, index) => ({
    path: paths[index]!,
    ok: result.ok,
    httpStatus: result.status,
    error: result.error,
  }));
}

async function buildSampleContext(colony: ColonyReadApi): Promise<SampleContext> {
  const feed = await colony.getFeed({ limit: 3 });
  const posts = feed?.ok && Array.isArray(feed.data?.posts)
    ? feed.data.posts
    : [];

  const samplePost = posts[0] ?? null;
  const samplePostTxHash = readString(samplePost, ["txHash", "tx_hash"]);
  const sampleAuthor = readString(samplePost, ["author", "address"]);

  let sportsFixtureId: string | null = null;
  const sportsMarkets = await colony.getSportsMarkets({ status: "upcoming" });
  if (sportsMarkets?.ok) {
    sportsFixtureId = extractFixtureId(sportsMarkets.data);
  }

  return {
    samplePostTxHash,
    sampleAuthor,
    sportsFixtureId,
  };
}

async function runReadChecks(
  omni: OmniWebRuntime,
  sampleContext: SampleContext,
  options: {
    includeDevOnly: boolean;
    priceHistoryPeriods: number;
    searchText: string;
  },
): Promise<SweepResult[]> {
  const tasks: Array<{
    method: string;
    scope: "production" | "dev_only";
    run: () => Promise<any>;
    skip?: () => string | null;
  }> = [
    { method: "getFeed", scope: "production", run: () => omni.colony.getFeed({ limit: 3 }) },
    { method: "search", scope: "production", run: () => omni.colony.search({ text: options.searchText }) },
    {
      method: "getPostDetail",
      scope: "production",
      skip: () => sampleContext.samplePostTxHash ? null : "no sample post tx hash from feed",
      run: () => omni.colony.getPostDetail(sampleContext.samplePostTxHash!),
    },
    { method: "getSignals", scope: "production", run: () => omni.colony.getSignals() },
    { method: "getConvergence", scope: "production", run: () => omni.colony.getConvergence() },
    { method: "getReport", scope: "production", run: () => omni.colony.getReport() },
    { method: "getLeaderboard", scope: "production", run: () => omni.colony.getLeaderboard({ limit: 5 }) },
    { method: "getTopPosts", scope: "production", run: () => omni.colony.getTopPosts({ limit: 5 }) },
    { method: "getAgents", scope: "production", run: () => omni.colony.getAgents() },
    { method: "getOracle", scope: "production", run: () => omni.colony.getOracle({ assets: ["BTC"] }) },
    { method: "getPrices", scope: "production", run: () => omni.colony.getPrices(["BTC"]) },
    {
      method: "getPriceHistory",
      scope: "production",
      run: () => omni.colony.getPriceHistory("BTC", options.priceHistoryPeriods),
    },
    { method: "getBalance", scope: "production", run: () => omni.colony.getBalance() },
    { method: "getMarkets", scope: "production", run: () => omni.colony.getMarkets({ limit: 5 }) },
    { method: "getPredictions", scope: "production", run: () => omni.colony.getPredictions({}) },
    { method: "getForecastScore", scope: "production", run: () => omni.colony.getForecastScore(omni.address) },
    { method: "getPool", scope: "production", run: () => omni.colony.getPool({ asset: "BTC", horizon: "30m" }) },
    {
      method: "getHigherLowerPool",
      scope: "production",
      run: () => omni.colony.getHigherLowerPool({ asset: "BTC", horizon: "30m" }),
    },
    { method: "getBinaryPools", scope: "production", run: () => omni.colony.getBinaryPools({ limit: 5 }) },
    {
      method: "getReactions",
      scope: "production",
      skip: () => sampleContext.samplePostTxHash ? null : "no sample post tx hash from feed",
      run: () => omni.colony.getReactions(sampleContext.samplePostTxHash!),
    },
    {
      method: "getTipStats",
      scope: "production",
      skip: () => sampleContext.samplePostTxHash ? null : "no sample post tx hash from feed",
      run: () => omni.colony.getTipStats(sampleContext.samplePostTxHash!),
    },
    {
      method: "getEthPool",
      scope: "dev_only",
      run: () => omni.colony.getEthPool({ asset: "BTC", horizon: "30m" }),
    },
    {
      method: "getEthWinners",
      scope: "dev_only",
      run: () => omni.colony.getEthWinners({ asset: "BTC" }),
    },
    {
      method: "getEthHigherLowerPool",
      scope: "dev_only",
      run: () => omni.colony.getEthHigherLowerPool({ asset: "BTC", horizon: "30m" }),
    },
    { method: "getEthBinaryPools", scope: "dev_only", run: () => omni.colony.getEthBinaryPools() },
    { method: "getSportsMarkets", scope: "dev_only", run: () => omni.colony.getSportsMarkets({ status: "upcoming" }) },
    {
      method: "getSportsPool",
      scope: "dev_only",
      skip: () => sampleContext.sportsFixtureId ? null : "no sports fixture id available",
      run: () => omni.colony.getSportsPool(sampleContext.sportsFixtureId!),
    },
    {
      method: "getSportsWinners",
      scope: "dev_only",
      skip: () => sampleContext.sportsFixtureId ? null : "no sports fixture id available",
      run: () => omni.colony.getSportsWinners(sampleContext.sportsFixtureId!),
    },
    {
      method: "getCommodityPool",
      scope: "dev_only",
      run: () => omni.colony.getCommodityPool({ asset: "XAU", horizon: "30m" }),
    },
    {
      method: "getPredictionIntelligence",
      scope: "dev_only",
      run: () => omni.colony.getPredictionIntelligence({ limit: 5, stats: true }),
    },
    {
      method: "getPredictionRecommendations",
      scope: "dev_only",
      run: () => omni.colony.getPredictionRecommendations(omni.address),
    },
  ];

  const selectedTasks = options.includeDevOnly
    ? tasks
    : tasks.filter((task) => task.scope === "production");

  const results: SweepResult[] = [];
  for (const task of selectedTasks) {
    const skipReason = task.skip?.() ?? null;
    if (skipReason) {
      results.push({
        method: task.method,
        scope: task.scope,
        verdict: "skipped",
        ok: false,
        status: null,
        summary: skipReason,
        sample: null,
        error: null,
      });
      continue;
    }

    const result = await runTask(task.method, task.scope, task.run);
    results.push(result);
  }

  return results;
}

async function runTask(
  method: string,
  scope: "production" | "dev_only",
  run: () => Promise<any>,
): Promise<SweepResult> {
  try {
    const result = await run();
    if (result?.ok) {
      return {
        method,
        scope,
        verdict: "pass",
        ok: true,
        status: typeof result.status === "number" ? result.status : 200,
        summary: summarizeData(method, result.data),
        sample: buildSample(method, result.data),
        error: null,
      };
    }

    const errorText = formatError(result);
    const maybeAuthBlocked = scope === "production"
      && (result?.status === 401 || result?.status === 403 || /auth|token/i.test(errorText));
    const verdict: Verdict = scope === "dev_only"
      ? "expected_dev_only"
      : maybeAuthBlocked
        ? "auth_blocked"
        : "fail";

    return {
      method,
      scope,
      verdict,
      ok: false,
      status: typeof result?.status === "number" ? result.status : null,
      summary: verdict === "expected_dev_only"
        ? "unavailable on the current production host"
        : "read failed",
      sample: null,
      error: errorText,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      method,
      scope,
      verdict: scope === "dev_only" ? "expected_dev_only" : "fail",
      ok: false,
      status: null,
      summary: scope === "dev_only"
        ? "threw during dev-only probe on the current host"
        : "threw during production read probe",
      sample: null,
      error: message,
    };
  }
}

function summarizeData(method: string, data: unknown): string {
  if (Array.isArray(data)) {
    return `${method} returned array(${data.length})`;
  }

  if (!isRecord(data)) {
    return `${method} returned ${typeof data}`;
  }

  if (Array.isArray(data.posts)) {
    return `${method} returned ${data.posts.length} posts`;
  }

  if (Array.isArray(data.agents)) {
    return `${method} returned ${data.agents.length} agents`;
  }

  if (Array.isArray(data.markets)) {
    return `${method} returned ${data.markets.length} markets`;
  }

  if (Array.isArray(data.predictions)) {
    return `${method} returned ${data.predictions.length} predictions`;
  }

  if (Array.isArray(data.consensusAnalysis)) {
    return `${method} returned ${data.consensusAnalysis.length} consensus signals`;
  }

  if (Array.isArray(data.categories)) {
    return `${method} returned ${data.categories.length} categories`;
  }

  return `${method} returned object(${Object.keys(data).slice(0, 6).join(", ")})`;
}

function buildSample(method: string, data: unknown): Record<string, unknown> | null {
  if (!isRecord(data)) {
    return Array.isArray(data)
      ? { count: data.length }
      : null;
  }

  switch (method) {
    case "getFeed":
    case "search": {
      const posts = Array.isArray(data.posts) ? data.posts : [];
      const first = isRecord(posts[0]) ? posts[0] : null;
      return {
        postCount: posts.length,
        firstTxHash: first ? readString(first, ["txHash", "tx_hash"]) : null,
        firstCategory: first ? readNestedString(first, [["payload", "cat"], ["category"]]) : null,
      };
    }
    case "getLeaderboard": {
      const agents = Array.isArray(data.agents) ? data.agents : [];
      const first = isRecord(agents[0]) ? agents[0] : null;
      return {
        agentCount: agents.length,
        firstAgent: first ? readString(first, ["name", "address"]) : null,
      };
    }
    case "getAgents": {
      const agents = Array.isArray(data.agents) ? data.agents : [];
      return { agentCount: agents.length };
    }
    case "getMarkets":
    case "getPredictions":
    case "getPredictionIntelligence": {
      const firstArray = firstArrayValue(data);
      return {
        topLevelKeys: Object.keys(data).slice(0, 6),
        firstArrayCount: Array.isArray(firstArray) ? firstArray.length : null,
      };
    }
    default:
      return {
        topLevelKeys: Object.keys(data).slice(0, 6),
      };
  }
}

function formatError(result: any): string {
  if (!result) return "unknown error";
  if (typeof result.error === "string") {
    return summarizeErrorString(result.error, result.status);
  }
  if (isRecord(result.error)) {
    const code = typeof result.error.code === "string" ? result.error.code : null;
    const message = typeof result.error.message === "string" ? result.error.message : null;
    return summarizeErrorString([code, message].filter(Boolean).join(": ") || JSON.stringify(result.error), result.status);
  }
  return summarizeErrorString(JSON.stringify(result), result?.status);
}

function countVerdicts(results: SweepResult[]): Record<string, number> {
  return results.reduce<Record<string, number>>((acc, result) => {
    acc[result.verdict] = (acc[result.verdict] ?? 0) + 1;
    return acc;
  }, {});
}

function extractFixtureId(data: unknown): string | null {
  if (Array.isArray(data)) {
    for (const entry of data) {
      const value = extractFixtureId(entry);
      if (value) return value;
    }
    return null;
  }

  if (!isRecord(data)) {
    return null;
  }

  const direct = readString(data, ["fixtureId", "fixture_id", "id", "marketId"]);
  if (direct && /sports|nba|nfl|mlb|fixture|espn/i.test(direct)) {
    return direct;
  }

  for (const value of Object.values(data)) {
    const found = extractFixtureId(value);
    if (found) return found;
  }

  return null;
}

function firstArrayValue(data: Record<string, unknown>): unknown[] | null {
  for (const value of Object.values(data)) {
    if (Array.isArray(value)) {
      return value;
    }
  }
  return null;
}

function readString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

function readNestedString(
  obj: Record<string, unknown>,
  paths: string[][],
): string | null {
  for (const path of paths) {
    let value: unknown = obj;
    for (const key of path) {
      if (!isRecord(value) || !(key in value)) {
        value = null;
        break;
      }
      value = value[key];
    }
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getStringArgLoose(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  return args[index + 1];
}

function summarizeErrorString(value: string, status?: number | null): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (/<!DOCTYPE html>|<html/i.test(compact)) {
    return status ? `HTTP ${status} with HTML error page` : "HTML error page";
  }
  if (compact.length > 220) {
    return `${compact.slice(0, 217)}...`;
  }
  return compact;
}

async function loadConnect(): Promise<() => Promise<OmniWebRuntime>> {
  try {
    const mod = await import("../dist/index.js");
    if (typeof mod.connect === "function") {
      return mod.connect as () => Promise<OmniWebRuntime>;
    }
  } catch {
    // Fall back to source during local development before build output exists.
  }

  const mod = await import("../src/index.ts");
  if (typeof mod.connect !== "function") {
    throw new Error("connect() export not found in dist/index.js or src/index.ts");
  }
  return mod.connect as () => Promise<OmniWebRuntime>;
}
