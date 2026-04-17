export interface OracleAssetSignal {
  ticker: string;
  sentimentScore: number;
  currentPrice: number;
}

export interface HigherLowerPoolSnapshot {
  asset: string;
  horizon: string;
  totalHigher: number;
  totalLower: number;
  totalDem: number;
  higherCount: number;
  lowerCount: number;
  referencePrice: number | null;
  currentPrice: number;
}

export interface BettingPoolSnapshot {
  asset: string;
  horizon: string;
  totalBets: number;
  totalDem: number;
  bets: Array<{ txHash: string; predictedPrice: number; amount: number }>;
}

export interface HigherLowerProbePlan {
  asset: string;
  horizon: string;
  direction: "higher" | "lower";
  amount: number;
  currentPrice: number;
  referencePrice: number | null;
  sentimentScore: number;
  reason: string;
}

export interface FixedBetProbePlan {
  asset: string;
  horizon: string;
  predictedPrice: number;
  currentPrice: number;
  sentimentScore: number;
  reason: string;
}

export function chooseHigherLowerProbe(
  pools: HigherLowerPoolSnapshot[],
  oracleAssets: OracleAssetSignal[],
  amount: number,
): HigherLowerProbePlan | null {
  const signals = new Map(oracleAssets.map((asset) => [asset.ticker, asset]));
  const candidates = pools
    .filter((pool) => pool.referencePrice != null)
    .map((pool) => {
      const signal = signals.get(pool.asset);
      if (!signal) return null;
      return {
        pool,
        signal,
        crowdSkew: Math.abs(pool.totalHigher - pool.totalLower),
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) => {
      const scoreDelta = Math.abs(right.signal.sentimentScore) - Math.abs(left.signal.sentimentScore);
      if (scoreDelta !== 0) return scoreDelta;
      return right.crowdSkew - left.crowdSkew;
    });

  const chosen = candidates[0];
  if (!chosen) return null;

  const direction = chosen.signal.sentimentScore < 0 ? "lower" : "higher";
  const crowdDirection = chosen.pool.totalHigher >= chosen.pool.totalLower ? "higher" : "lower";
  const reason =
    crowdDirection === direction
      ? `${chosen.pool.asset} ${chosen.pool.horizon} pool is active and oracle sentiment (${chosen.signal.sentimentScore}) aligns with the current crowd tilt.`
      : `${chosen.pool.asset} ${chosen.pool.horizon} pool is active, oracle sentiment (${chosen.signal.sentimentScore}) points ${direction}, and the current crowd tilt is ${crowdDirection}, creating a contrarian probe.`;

  return {
    asset: chosen.pool.asset,
    horizon: chosen.pool.horizon,
    direction,
    amount,
    currentPrice: chosen.signal.currentPrice,
    referencePrice: chosen.pool.referencePrice,
    sentimentScore: chosen.signal.sentimentScore,
    reason,
  };
}

export function chooseFixedBetProbe(
  pools: BettingPoolSnapshot[],
  oracleAssets: OracleAssetSignal[],
): FixedBetProbePlan | null {
  const signals = new Map(oracleAssets.map((asset) => [asset.ticker, asset]));
  const candidates = pools
    .filter((pool) => pool.totalBets > 0)
    .map((pool) => {
      const signal = signals.get(pool.asset);
      if (!signal) return null;
      return { pool, signal };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) => Math.abs(right.signal.sentimentScore) - Math.abs(left.signal.sentimentScore));

  const chosen = candidates[0];
  if (!chosen) return null;

  const multiplier = chosen.signal.sentimentScore < 0 ? 0.99 : 1.01;
  const predictedPrice = Math.max(1, Math.round(chosen.signal.currentPrice * multiplier));
  const directionWord = chosen.signal.sentimentScore < 0 ? "below" : "above";

  return {
    asset: chosen.pool.asset,
    horizon: chosen.pool.horizon,
    predictedPrice,
    currentPrice: chosen.signal.currentPrice,
    sentimentScore: chosen.signal.sentimentScore,
    reason: `${chosen.pool.asset} ${chosen.pool.horizon} fixed-price pool is active and oracle sentiment (${chosen.signal.sentimentScore}) supports a predicted close ${directionWord} current spot ${chosen.signal.currentPrice}.`,
  };
}

export function higherLowerReadbackSatisfied(
  before: HigherLowerPoolSnapshot,
  after: HigherLowerPoolSnapshot,
  direction: "higher" | "lower",
  amount: number,
): boolean {
  const totalField = direction === "higher" ? "totalHigher" : "totalLower";
  const countField = direction === "higher" ? "higherCount" : "lowerCount";

  return (
    after[countField] > before[countField]
    || after[totalField] >= before[totalField] + amount
    || after.totalDem >= before.totalDem + amount
  );
}

export function fixedBetReadbackSatisfied(
  before: BettingPoolSnapshot,
  after: BettingPoolSnapshot,
  txHash: string,
): boolean {
  return (
    after.totalBets > before.totalBets
    || after.totalDem > before.totalDem
    || after.bets.some((bet) => bet.txHash === txHash)
  );
}
