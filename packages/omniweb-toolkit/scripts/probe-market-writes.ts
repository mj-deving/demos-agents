#!/usr/bin/env npx tsx
/**
 * probe-market-writes.ts — maintained live proof path for placeHL and placeBet.
 *
 * Default behavior is non-destructive: inspect current oracle + pool state and
 * report the candidate market actions that would be used for a live proof.
 * Passing `--execute` performs one higher-lower bet and one fixed-price bet.
 *
 * Output: JSON to stdout. Errors to stderr.
 * Exit codes: 0 = success, 1 = runtime/proof failure, 2 = invalid args.
 */

import { getNumberArg, getStringArg, hasFlag } from "./_shared.js";
import { normalizeBalance } from "./_write-proof-shared.js";
import {
  chooseFixedBetProbe,
  chooseHigherLowerProbe,
  fixedBetReadbackSatisfied,
  higherLowerReadbackSatisfied,
  type BettingPoolSnapshot,
  type HigherLowerPoolSnapshot,
  type OracleAssetSignal,
} from "./_market-write-shared.js";

const DEFAULT_ASSETS = ["BTC", "ETH", "SOL"];
const DEFAULT_HL_AMOUNT = 5;
const DEFAULT_HL_HORIZONS = ["24h", "4h", "30m", "10m"];
const DEFAULT_FIXED_HORIZONS = ["30m", "4h", "24h", "10m"];
const DEFAULT_POLL_MS = 3_000;
const DEFAULT_HL_TIMEOUT_MS = 20_000;
const DEFAULT_FIXED_TIMEOUT_MS = 20_000;

type OmniInstance = Awaited<ReturnType<Awaited<ReturnType<typeof loadConnect>>>>;

const args = process.argv.slice(2);

if (hasFlag(args, "--help", "-h")) {
  console.log(`Usage: npx tsx packages/omniweb-toolkit/scripts/probe-market-writes.ts [options]

Options:
  --assets CSV             Assets to inspect (default: ${DEFAULT_ASSETS.join(",")})
  --hl-amount N            Higher-lower DEM amount (default: ${DEFAULT_HL_AMOUNT})
  --hl-timeout-ms N        Readback timeout for higher-lower verification (default: ${DEFAULT_HL_TIMEOUT_MS})
  --fixed-timeout-ms N     Readback timeout for fixed-price verification (default: ${DEFAULT_FIXED_TIMEOUT_MS})
  --poll-ms N              Poll interval for readback polling (default: ${DEFAULT_POLL_MS})
  --only MODE              One of both, hl, fixed (default: both)
  --state-dir PATH         Override state directory for runtime guards
  --execute                Perform the real market-write proof sweep
  --help, -h               Show this help

Output: JSON market-write proof report
Exit codes: 0 = success, 1 = runtime or proof failure, 2 = invalid args`);
  process.exit(0);
}

for (const flag of ["--assets", "--hl-amount", "--hl-timeout-ms", "--fixed-timeout-ms", "--poll-ms", "--state-dir", "--only"]) {
  const index = args.indexOf(flag);
  if (index >= 0 && !args[index + 1]) {
    console.error(`Error: ${flag} requires a value`);
    process.exit(2);
  }
}

const assetList = ((getStringArg(args, "--assets") ?? DEFAULT_ASSETS.join(","))
  .split(",")
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean));
const hlAmount = getPositiveNumberArg("--hl-amount", DEFAULT_HL_AMOUNT);
const hlTimeoutMs = getPositiveIntegerArg("--hl-timeout-ms", DEFAULT_HL_TIMEOUT_MS);
const fixedTimeoutMs = getPositiveIntegerArg("--fixed-timeout-ms", DEFAULT_FIXED_TIMEOUT_MS);
const pollMs = getPositiveIntegerArg("--poll-ms", DEFAULT_POLL_MS);
const stateDir = getStringArg(args, "--state-dir") || undefined;
const execute = hasFlag(args, "--execute");
const onlyMode = (getStringArg(args, "--only") ?? "both").toLowerCase();

for (const [label, value] of [
  ["--hl-amount", hlAmount],
  ["--hl-timeout-ms", hlTimeoutMs],
  ["--fixed-timeout-ms", fixedTimeoutMs],
  ["--poll-ms", pollMs],
] as const) {
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`Error: invalid ${label} value ${value}`);
    process.exit(2);
  }
}

if (!["both", "hl", "fixed"].includes(onlyMode)) {
  console.error(`Error: invalid --only value ${onlyMode}`);
  process.exit(2);
}

try {
  const connect = await loadConnect();
  const omni = await connect({ stateDir });

  const [oracleResult, balanceResult, pools] = await Promise.all([
    omni.colony.getOracle({ assets: assetList }),
    omni.colony.getBalance(),
    loadMarketPools(omni, assetList),
  ]);

  if (!oracleResult?.ok) {
    throw new Error(`Oracle read failed: ${oracleResult?.error ?? "unknown_error"}`);
  }

  const oracleAssets = normalizeOracleAssets(oracleResult.data);
  const hlPlan = onlyMode === "fixed" ? null : chooseHigherLowerProbe(pools.higherLower, oracleAssets, hlAmount);
  const fixedPlan = onlyMode === "hl" ? null : chooseFixedBetProbe(pools.fixed, oracleAssets);

  if ((onlyMode !== "fixed" && !hlPlan) || (onlyMode !== "hl" && !fixedPlan)) {
    throw new Error("No viable live market-write candidate was found on the current host");
  }

  const balanceBefore = normalizeBalance(balanceResult?.ok ? balanceResult.data?.balance : null);
  const hlBefore = hlPlan ? await fetchHigherLowerPool(omni, hlPlan.asset, hlPlan.horizon) : null;
  const fixedBefore = fixedPlan ? await fetchBettingPool(omni, fixedPlan.asset, fixedPlan.horizon) : null;

  if (!execute) {
    console.log(JSON.stringify({
      attempted: false,
      ok: true,
      address: omni.address,
      balanceBefore,
      higherLower: hlPlan ? {
        plan: hlPlan,
        before: hlBefore,
      } : undefined,
      fixedBet: fixedPlan ? {
        plan: fixedPlan,
        before: fixedBefore,
      } : undefined,
      message: "Dry run only. Re-run with --execute to perform the live higher-lower and fixed-price bet proof.",
    }, null, 2));
    process.exit(0);
  }

  const hlResult = hlPlan
    ? await omni.colony.placeHL(hlPlan.asset, hlPlan.direction, {
        amount: hlPlan.amount,
        horizon: hlPlan.horizon,
      })
    : null;
  const hlVerification = hlPlan && hlResult?.ok
    ? await verifyHigherLowerReadback(omni, hlPlan, hlBefore, {
        timeoutMs: hlTimeoutMs,
        pollMs,
      })
    : { attempted: false };

  const fixedResult = fixedPlan
    ? await omni.colony.placeBet(fixedPlan.asset, fixedPlan.predictedPrice, {
        horizon: fixedPlan.horizon,
      })
    : null;
  const fixedVerification = fixedPlan && fixedResult?.ok
    ? await verifyFixedBetReadback(omni, fixedPlan, fixedBefore, fixedResult.data?.txHash, {
        timeoutMs: fixedTimeoutMs,
        pollMs,
      })
    : { attempted: false };

  const balanceAfterResult = await omni.colony.getBalance();
  const balanceAfter = normalizeBalance(balanceAfterResult?.ok ? balanceAfterResult.data?.balance : null);

  const hlOk = !hlPlan || (!!hlResult?.ok && !!hlVerification.attempted && hlVerification.ok);
  const fixedOk = !fixedPlan || (!!fixedResult?.ok && !!fixedVerification.attempted && fixedVerification.ok);
  const overallOk = hlOk && fixedOk;

  console.log(JSON.stringify({
    attempted: true,
    ok: overallOk,
    address: omni.address,
    balanceBefore,
    balanceAfter,
    estimatedSpend: balanceBefore != null && balanceAfter != null ? balanceBefore - balanceAfter : null,
    higherLower: hlPlan ? {
      plan: hlPlan,
      result: summarizeResult(hlResult),
      verification: hlVerification,
    } : undefined,
    fixedBet: fixedPlan ? {
      plan: fixedPlan,
      result: summarizeResult(fixedResult),
      verification: fixedVerification,
    } : undefined,
  }, null, 2));

  process.exit(overallOk ? 0 : 1);
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

async function loadMarketPools(
  omni: OmniInstance,
  assets: string[],
): Promise<{ higherLower: HigherLowerPoolSnapshot[]; fixed: BettingPoolSnapshot[] }> {
  const higherLower: HigherLowerPoolSnapshot[] = [];
  const fixed: BettingPoolSnapshot[] = [];

  for (const asset of assets) {
    for (const horizon of DEFAULT_HL_HORIZONS) {
      const pool = await fetchHigherLowerPool(omni, asset, horizon);
      if (pool) higherLower.push(pool);
    }
    for (const horizon of DEFAULT_FIXED_HORIZONS) {
      const pool = await fetchBettingPool(omni, asset, horizon);
      if (pool) fixed.push(pool);
    }
  }

  return { higherLower, fixed };
}

function normalizeOracleAssets(data: any): OracleAssetSignal[] {
  const assets = Array.isArray(data?.assets) ? data.assets : [];
  return assets
    .map((asset: any) => ({
      ticker: typeof asset?.ticker === "string" ? asset.ticker : "",
      sentimentScore: typeof asset?.sentiment?.score === "number" ? asset.sentiment.score : 0,
      currentPrice: typeof asset?.price?.usd === "number" ? asset.price.usd : Number.NaN,
    }))
    .filter((asset: OracleAssetSignal) => asset.ticker && Number.isFinite(asset.currentPrice));
}

async function fetchHigherLowerPool(
  omni: OmniInstance,
  asset: string,
  horizon: string,
): Promise<HigherLowerPoolSnapshot | null> {
  const result = await omni.colony.getHigherLowerPool({ asset, horizon });
  if (!result?.ok) return null;
  return {
    asset: result.data.asset,
    horizon: result.data.horizon,
    totalHigher: result.data.totalHigher,
    totalLower: result.data.totalLower,
    totalDem: result.data.totalDem,
    higherCount: result.data.higherCount,
    lowerCount: result.data.lowerCount,
    referencePrice: result.data.referencePrice,
    currentPrice: result.data.currentPrice,
  };
}

async function fetchBettingPool(
  omni: OmniInstance,
  asset: string,
  horizon: string,
): Promise<BettingPoolSnapshot | null> {
  const result = await omni.colony.getPool({ asset, horizon });
  if (!result?.ok) return null;
  return {
    asset: result.data.asset,
    horizon: result.data.horizon,
    totalBets: result.data.totalBets,
    totalDem: result.data.totalDem,
    bets: Array.isArray(result.data.bets)
      ? result.data.bets.map((bet) => ({
          txHash: bet.txHash,
          predictedPrice: bet.predictedPrice,
          amount: bet.amount,
        }))
      : [],
  };
}

async function verifyHigherLowerReadback(
  omni: OmniInstance,
  plan: ReturnType<typeof chooseHigherLowerProbe> extends infer T ? Exclude<T, null> : never,
  before: HigherLowerPoolSnapshot | null,
  opts: { timeoutMs: number; pollMs: number },
): Promise<{
  attempted: true;
  ok: boolean;
  polls: number;
  before: HigherLowerPoolSnapshot | null;
  after: HigherLowerPoolSnapshot | null;
}> {
  const deadline = Date.now() + opts.timeoutMs;
  let polls = 0;
  let after = before;

  while (Date.now() <= deadline) {
    polls += 1;
    after = await fetchHigherLowerPool(omni, plan.asset, plan.horizon);
    if (before && after && higherLowerReadbackSatisfied(before, after, plan.direction, plan.amount)) {
      return { attempted: true, ok: true, polls, before, after };
    }
    if (Date.now() + opts.pollMs > deadline) break;
    await sleep(opts.pollMs);
  }

  return { attempted: true, ok: false, polls, before, after };
}

async function verifyFixedBetReadback(
  omni: OmniInstance,
  plan: ReturnType<typeof chooseFixedBetProbe> extends infer T ? Exclude<T, null> : never,
  before: BettingPoolSnapshot | null,
  txHash: string | undefined,
  opts: { timeoutMs: number; pollMs: number },
): Promise<{
  attempted: true;
  ok: boolean;
  polls: number;
  before: BettingPoolSnapshot | null;
  after: BettingPoolSnapshot | null;
}> {
  const deadline = Date.now() + opts.timeoutMs;
  let polls = 0;
  let after = before;

  while (Date.now() <= deadline) {
    polls += 1;
    after = await fetchBettingPool(omni, plan.asset, plan.horizon);
    if (before && after && txHash && fixedBetReadbackSatisfied(before, after, txHash)) {
      return { attempted: true, ok: true, polls, before, after };
    }
    if (Date.now() + opts.pollMs > deadline) break;
    await sleep(opts.pollMs);
  }

  return { attempted: true, ok: false, polls, before, after };
}

function summarizeResult(
  result: {
    ok: boolean;
    data?: { txHash?: string; memo?: string; amount?: number; registered?: boolean; registrationError?: string };
    error?: unknown;
  } | null,
): Record<string, unknown> {
  if (result == null) {
    return { ok: false, error: "null_result" };
  }
  return result.ok
    ? { ok: true, ...result.data }
    : { ok: false, error: result.error };
}

function getPositiveIntegerArg(flag: string, fallback: number): number {
  const parsed = getNumberArg(args, flag);
  if (parsed === undefined) return fallback;
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function getPositiveNumberArg(flag: string, fallback: number): number {
  const parsed = getNumberArg(args, flag);
  return parsed === undefined ? fallback : parsed;
}

async function loadConnect(): Promise<(opts?: {
  stateDir?: string;
}) => Promise<any>> {
  try {
    const mod = await import("../dist/index.js");
    if (typeof mod.connect === "function") {
      return mod.connect;
    }
  } catch {
    // Fall back to source during local development before build output exists.
  }

  const mod = await import("../src/index.ts");
  if (typeof mod.connect !== "function") {
    throw new Error("connect() export not found in dist/index.js or src/index.ts");
  }
  return mod.connect;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
