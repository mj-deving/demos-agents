import type {
  BetWriteDirection,
  BetBinaryPosition,
  BettingHorizon,
} from "./types.js";

export const VALID_BET_HORIZONS = ["10m", "30m", "4h", "24h"] as const;

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

export function normalizeAsset(asset: string): string {
  const normalized = asset.trim();
  if (!normalized) {
    throw new Error("Invalid asset — asset is required");
  }
  if (normalized.includes(":")) {
    throw new Error("Invalid asset — asset must not contain colons");
  }
  return normalized;
}

export function normalizeHorizon(horizon?: string): BettingHorizon {
  const normalized = (horizon ?? "30m").trim() as BettingHorizon;
  if (!(VALID_BET_HORIZONS as readonly string[]).includes(normalized)) {
    throw new Error(`Invalid horizon "${normalized}" — valid horizons: ${VALID_BET_HORIZONS.join(", ")}`);
  }
  return normalized;
}

export function normalizePredictedPrice(predictedPrice: number): number {
  if (!Number.isFinite(predictedPrice) || predictedPrice <= 0) {
    throw new Error("predictedPrice must be a positive finite number");
  }
  return predictedPrice;
}

export function normalizeDirection(
  direction: BetWriteDirection | Lowercase<BetWriteDirection>,
): BetWriteDirection {
  const normalized = requireNonEmpty(direction, "direction").toUpperCase();
  if (normalized !== "HIGHER" && normalized !== "LOWER") {
    throw new Error("direction must be HIGHER or LOWER");
  }
  return normalized;
}

export function normalizeBinaryPosition(
  position: BetBinaryPosition | Lowercase<BetBinaryPosition>,
): BetBinaryPosition {
  const normalized = requireNonEmpty(position, "position").toUpperCase();
  if (normalized !== "YES" && normalized !== "NO") {
    throw new Error("position must be YES or NO");
  }
  return normalized;
}

export function buildBetMemo(
  asset: string,
  predictedPrice: number,
  opts?: { horizon?: string },
): string {
  const normalizedAsset = normalizeAsset(asset);
  const normalizedPrice = normalizePredictedPrice(predictedPrice);
  const horizon = normalizeHorizon(opts?.horizon);
  return `HIVE_BET:${normalizedAsset}:${normalizedPrice}:${horizon}`;
}

export function buildHigherLowerMemo(
  asset: string,
  direction: BetWriteDirection | Lowercase<BetWriteDirection>,
  opts?: { horizon?: string },
): string {
  const normalizedAsset = normalizeAsset(asset);
  const normalizedDirection = normalizeDirection(direction);
  const horizon = normalizeHorizon(opts?.horizon);
  return `HIVE_HL:${normalizedAsset}:${normalizedDirection}:${horizon}`;
}

export function buildBinaryBetMemo(
  marketId: string,
  position: BetBinaryPosition | Lowercase<BetBinaryPosition>,
): string {
  const normalizedMarketId = requireNonEmpty(marketId, "marketId");
  if (normalizedMarketId.includes(":")) {
    throw new Error("marketId must not contain colons");
  }
  const normalizedPosition = normalizeBinaryPosition(position);
  return `HIVE_BINARY:${normalizedMarketId}:${normalizedPosition}`;
}
