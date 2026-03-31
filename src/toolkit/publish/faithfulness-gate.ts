import { extractClaimsRegex } from "./claim-extractor.js";
import { getAliasesForSubject } from "./subject-aliases.js";
import {
  FaithfulnessResultSchema,
  type FaithfulnessResult,
  type PublishAttestation,
  type StructuredClaim,
} from "./types.js";
import { escapeRegExp } from "../util/strings.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_VALUE_DRIFT = 0.02; // 2% tolerance

export const METRIC_UNITS: Record<string, string[]> = {
  price_usd: ["USD"],
  volume: ["USD"],
  tvl: ["USD", "TVL"],
  hash_rate: ["EH/s", "TH/s", "GH/s"],
  difficulty: ["none"],
  totalSupply: ["BTC", "ETH", "none"],
  supply: ["BTC", "ETH", "none"],
  block_count: ["blocks"],
  tx_count: ["none"],
  gas_price: ["gwei"],
  percentage: ["%"],
};

export const DEFAULT_STALENESS_THRESHOLDS_MS: Record<string, number> = {
  price: HOUR_MS,
  volume: HOUR_MS,
  hash_rate: 6 * HOUR_MS,
  difficulty: 6 * HOUR_MS,
  tvl: DAY_MS,
  supply: DAY_MS,
  block_count: HOUR_MS,
  tx_count: HOUR_MS,
  governance: 7 * DAY_MS,
  events: 7 * DAY_MS,
  default: 6 * HOUR_MS,
};

export interface FaithfulnessGateOptions {
  now?: Date;
  allClaims?: StructuredClaim[];
  stalenessThresholdsMs?: Partial<Record<string, number>>;
}

interface SupportingAttestation {
  attestation: PublishAttestation;
  attestedValue: number | null;
}

export function runFaithfulnessGate(
  draftText: string,
  primaryClaim: StructuredClaim,
  attestations: PublishAttestation[],
  options: FaithfulnessGateOptions = {},
): FaithfulnessResult {
  const supporting = findSupportingAttestation(primaryClaim, attestations);
  if (!supporting) {
    return FaithfulnessResultSchema.parse({
      pass: false,
      reason: "no attestation found for primary claim",
    });
  }

  if (!subjectPresent(primaryClaim.subject, supporting.attestation)) {
    return FaithfulnessResultSchema.parse({
      pass: false,
      reason: `attestation is not about ${primaryClaim.subject}`,
    });
  }

  if (primaryClaim.value !== null) {
    if (supporting.attestedValue === null) {
      return FaithfulnessResultSchema.parse({
        pass: false,
        reason: `attested data has no field for ${primaryClaim.identity.metric}`,
      });
    }

    const drift = calculateDrift(primaryClaim.value, supporting.attestedValue);
    if (drift > MAX_VALUE_DRIFT) {
      return FaithfulnessResultSchema.parse({
        pass: false,
        reason: `value drift ${Math.round(drift * 100)}%: draft says ${primaryClaim.value}, data says ${supporting.attestedValue}`,
        suggestedRevision: {
          field: primaryClaim.identity.metric,
          correctValue: supporting.attestedValue,
        },
      });
    }
  }

  if (primaryClaim.unit !== "none") {
    const expectedUnits = METRIC_UNITS[primaryClaim.identity.metric];
    if (expectedUnits && !expectedUnits.includes(primaryClaim.unit)) {
      return FaithfulnessResultSchema.parse({
        pass: false,
        reason: `unit mismatch: claim says ${primaryClaim.unit}, metric expects ${expectedUnits.join(", ")}`,
      });
    }
  }

  const overrides: Record<string, number> = {};
  if (options.stalenessThresholdsMs) {
    for (const [k, v] of Object.entries(options.stalenessThresholdsMs)) {
      if (v !== undefined) overrides[k] = v;
    }
  }
  const thresholds: Record<string, number> = { ...DEFAULT_STALENESS_THRESHOLDS_MS, ...overrides };
  const dataAgeMs = calculateAgeMs(supporting.attestation.timestamp, options.now);
  const maxStale = resolveStalenessThreshold(primaryClaim.identity.metric, thresholds);
  if (dataAgeMs > maxStale) {
    return FaithfulnessResultSchema.parse({
      pass: false,
      reason: `attested data is ${formatAgeHours(dataAgeMs)}h old, max ${formatAgeHours(maxStale)}h for ${primaryClaim.identity.metric}`,
      dataAge: dataAgeMs / HOUR_MS,
    });
  }

  const allClaims = options.allClaims ?? extractClaimsRegex(draftText).claims;
  const contaminatedClaims = allClaims.filter((claim) =>
    claim.type === "factual" &&
    !isSameClaim(claim, primaryClaim) &&
    !isClaimSupportedByAttestation(claim, supporting.attestation)
  );
  if (contaminatedClaims.length > 0) {
    return FaithfulnessResultSchema.parse({
      pass: false,
      reason: `draft contains ${contaminatedClaims.length} unattested factual claim(s)`,
      contaminatedClaims,
    });
  }

  return FaithfulnessResultSchema.parse({
    pass: true,
    attestationTxHash: supporting.attestation.txHash,
    matchedSubject: primaryClaim.subject,
    matchedValue: supporting.attestedValue ?? undefined,
    matchedMetric: primaryClaim.identity.metric,
    dataAge: dataAgeMs / HOUR_MS,
  });
}

export function findSupportingAttestation(
  claim: StructuredClaim,
  attestations: PublishAttestation[],
): SupportingAttestation | null {
  const candidates = attestations
    .map((attestation) => ({
      attestation,
      attestedValue: extractNumericValue(attestation.data, claim.sourceField ?? claim.identity.metric),
    }))
    .filter(({ attestation, attestedValue }) =>
      subjectPresent(claim.subject, attestation) &&
      (claim.value === null || attestedValue !== null)
    )
    .sort((left, right) =>
      Date.parse(right.attestation.timestamp) - Date.parse(left.attestation.timestamp)
    );

  return candidates[0] ?? null;
}

export function subjectPresent(subject: string, attestation: PublishAttestation): boolean {
  const normalizedAliases = new Set<string>(getAliasesForSubject(subject));

  const haystacks = [
    attestation.sourceId.toLowerCase(),
    ...collectStringLeaves(attestation.data).map((value) => value.toLowerCase()),
  ];

  for (const alias of normalizedAliases) {
    const matcher = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i");
    if (haystacks.some((haystack) => matcher.test(haystack))) return true;
  }
  return false;
}

export function isClaimSupportedByAttestation(
  claim: StructuredClaim,
  attestation: PublishAttestation,
): boolean {
  if (!subjectPresent(claim.subject, attestation)) return false;
  if (claim.value === null) return false;

  const attestedValue = extractNumericValue(attestation.data, claim.sourceField ?? claim.identity.metric);
  if (attestedValue === null) return false;

  return calculateDrift(claim.value, attestedValue) <= MAX_VALUE_DRIFT;
}

function extractNumericValue(data: Record<string, unknown>, fieldPath: string): number | null {
  const direct = getPathValue(data, fieldPath);
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  if (typeof direct === "string") {
    const parsed = Number.parseFloat(direct);
    if (Number.isFinite(parsed)) return parsed;
  }

  if (!fieldPath.includes(".")) {
    const snakeCase = fieldPath.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
    const fallback = getPathValue(data, snakeCase);
    if (typeof fallback === "number" && Number.isFinite(fallback)) return fallback;
    if (typeof fallback === "string") {
      const parsed = Number.parseFloat(fallback);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return null;
}

function getPathValue(data: Record<string, unknown>, fieldPath: string): unknown {
  const parts = fieldPath.split(".").filter(Boolean);
  let current: unknown = data;
  for (const part of parts) {
    if (typeof current !== "object" || current === null || !(part in current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function collectStringLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((entry) => collectStringLeaves(entry));
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap((entry) => collectStringLeaves(entry));
  }
  return [];
}

function calculateDrift(claimValue: number, attestedValue: number): number {
  return Math.abs(claimValue - attestedValue) / Math.max(Math.abs(attestedValue), 1);
}

function calculateAgeMs(timestamp: string, now = new Date()): number {
  return Math.max(0, now.getTime() - Date.parse(timestamp));
}

/** Maps metric names to their staleness threshold keys in DEFAULT_STALENESS_THRESHOLDS_MS. */
const METRIC_TO_STALENESS_KEY: Record<string, string> = {
  price_usd: "price",
  volume: "volume",
  hash_rate: "hash_rate",
  difficulty: "difficulty",
  tvl: "tvl",
  totalSupply: "supply",
  supply: "supply",
  block_count: "block_count",
  tx_count: "tx_count",
  governance: "governance",
  events: "events",
};

function resolveStalenessThreshold(metric: string, thresholds: Record<string, number>): number {
  const key = METRIC_TO_STALENESS_KEY[metric];
  if (key && thresholds[key] !== undefined) return thresholds[key];
  if (metric.includes("governance") && thresholds.governance !== undefined) return thresholds.governance;
  if (metric.includes("event") && thresholds.events !== undefined) return thresholds.events;
  return thresholds.default;
}

function formatAgeHours(durationMs: number): string {
  return (durationMs / HOUR_MS).toFixed(2).replace(/\.00$/, "");
}

function isSameClaim(left: StructuredClaim, right: StructuredClaim): boolean {
  return left.subject === right.subject &&
    left.identity.metric === right.identity.metric &&
    left.value === right.value &&
    left.unit === right.unit;
}

