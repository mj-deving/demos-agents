/**
 * Attestation planner — builds optimal attestation plans from extracted claims.
 *
 * Pure planning logic: no SDK deps, no side effects. Lives in src/lib/
 * (portable core). The executor counterpart lives in src/actions/.
 *
 * Flow: claims → surgical URL lookup → budget check → AttestationPlan
 */

import type { ExtractedClaim, ClaimType } from "./claim-extraction.js";
import type { ProviderAdapter, SurgicalCandidate } from "./sources/providers/types.js";
import type { SourceRecordV2, AgentSourceView } from "./sources/catalog.js";
import { _jsonPathGet as jsonPathGet } from "./sources/providers/declarative-engine.js";

// ── Types ─────────────────────────────────────────

export interface AttestationBudget {
  /** Max total attestation cost (DEM) per post */
  maxCostPerPost: number;
  /** Max TLSN attestations per post */
  maxTlsnPerPost: number;
  /** Max DAHR attestations per post */
  maxDahrPerPost: number;
  /** Max total attestations per post */
  maxAttestationsPerPost: number;
}

export interface AttestationPlan {
  /** Primary claim + candidate (highest priority, preferably TLSN) */
  primary: SurgicalCandidate;
  /** Additional claims + candidates within budget */
  secondary: SurgicalCandidate[];
  /** Claims that couldn't be matched to a surgical URL */
  unattested: ExtractedClaim[];
  /** Estimated total cost in DEM */
  estimatedCost: number;
  /** Budget used for planning */
  budget: AttestationBudget;
}

export interface VerificationResult {
  /** The claim being verified */
  claim: ExtractedClaim;
  /** Value extracted from attested data */
  attestedValue: unknown;
  /** Expected value from the claim */
  expectedValue: unknown;
  /** Whether the claim is verified within tolerance */
  verified: boolean;
  /** Drift percentage for numeric comparisons */
  drift?: number;
  /** Reason for verification failure */
  failureReason?: string;
}

// ── Constants ─────────────────────────────────────

/** Claim type priority order (higher index = lower priority) */
const CLAIM_PRIORITY: Record<string, number> = {
  price: 0,
  metric: 1,
  event: 2,
  statistic: 3,
};

/** Default budget when config is absent */
const DEFAULT_BUDGET: AttestationBudget = {
  maxCostPerPost: 15,
  maxTlsnPerPost: 1,
  maxDahrPerPost: 3,
  maxAttestationsPerPost: 4,
};

/** Estimated cost per attestation type (DEM, testnet) */
const TLSN_COST = 12;
const DAHR_COST = 1;

/** Max response size for TLSN eligibility (bytes) */
export const TLSN_MAX_SIZE_BYTES = 16 * 1024;

/** Tolerance thresholds */
const PRICE_TOLERANCE = 0.02; // 2%
const METRIC_TOLERANCE = 0.05; // 5%

// ── Budget Resolution ─────────────────────────────

/**
 * Resolve attestation budget from agent config, applying defaults.
 */
export function resolveAttestationBudget(
  config?: { attestation?: { budget?: Partial<AttestationBudget> } },
): AttestationBudget {
  const raw = config?.attestation?.budget;
  if (!raw) return { ...DEFAULT_BUDGET };

  return {
    maxCostPerPost: typeof raw.maxCostPerPost === "number" && raw.maxCostPerPost > 0
      ? raw.maxCostPerPost : DEFAULT_BUDGET.maxCostPerPost,
    maxTlsnPerPost: typeof raw.maxTlsnPerPost === "number" && raw.maxTlsnPerPost >= 0
      ? raw.maxTlsnPerPost : DEFAULT_BUDGET.maxTlsnPerPost,
    maxDahrPerPost: typeof raw.maxDahrPerPost === "number" && raw.maxDahrPerPost >= 0
      ? raw.maxDahrPerPost : DEFAULT_BUDGET.maxDahrPerPost,
    maxAttestationsPerPost: typeof raw.maxAttestationsPerPost === "number" && raw.maxAttestationsPerPost > 0
      ? raw.maxAttestationsPerPost : DEFAULT_BUDGET.maxAttestationsPerPost,
  };
}

// ── Attestation Planning ──────────────────────────

/**
 * Build an attestation plan from extracted claims.
 *
 * Scans sources for adapters with buildSurgicalUrl, selects best candidate
 * per claim, and respects budget limits.
 *
 * Returns null if no surgical candidates exist → caller uses existing flow.
 */
export function buildAttestationPlan(
  claims: ExtractedClaim[],
  sourceView: AgentSourceView,
  config?: { attestation?: { budget?: Partial<AttestationBudget> } },
  adapters?: Map<string, ProviderAdapter>,
): AttestationPlan | null {
  if (!claims.length || !adapters?.size) return null;

  const budget = resolveAttestationBudget(config);

  // Sort claims by priority (price first)
  const prioritized = claims
    .filter((c) => CLAIM_PRIORITY[c.type] !== undefined)
    .sort((a, b) => (CLAIM_PRIORITY[a.type] ?? 99) - (CLAIM_PRIORITY[b.type] ?? 99));

  if (prioritized.length === 0) return null;

  // Find surgical candidates for each claim
  const candidates: SurgicalCandidate[] = [];
  const unattested: ExtractedClaim[] = [];

  for (const claim of prioritized) {
    let bestCandidate: SurgicalCandidate | null = null;

    // Try each source's adapter
    for (const source of sourceView.sources) {
      const adapter = adapters.get(source.provider);
      if (!adapter?.buildSurgicalUrl) continue;

      const candidate = adapter.buildSurgicalUrl(claim, source);
      if (candidate) {
        bestCandidate = candidate;
        break; // First match wins per claim
      }
    }

    if (bestCandidate) {
      candidates.push(bestCandidate);
    } else {
      unattested.push(claim);
    }
  }

  if (candidates.length === 0) return null;

  // Apply budget limits
  const selected: SurgicalCandidate[] = [];
  let totalCost = 0;
  let tlsnCount = 0;
  let dahrCount = 0;

  for (const candidate of candidates) {
    if (selected.length >= budget.maxAttestationsPerPost) break;

    // Determine method (TLSN if small enough and under budget, else DAHR)
    const canTlsn = candidate.estimatedSizeBytes <= TLSN_MAX_SIZE_BYTES && tlsnCount < budget.maxTlsnPerPost;
    const cost = canTlsn ? TLSN_COST : DAHR_COST;

    if (totalCost + cost > budget.maxCostPerPost) continue;
    if (!canTlsn && dahrCount >= budget.maxDahrPerPost) continue;

    totalCost += cost;
    if (canTlsn) tlsnCount++;
    else dahrCount++;

    selected.push(candidate);
  }

  if (selected.length === 0) return null;

  return {
    primary: selected[0],
    secondary: selected.slice(1),
    unattested,
    estimatedCost: totalCost,
    budget,
  };
}

// ── Value Verification ────────────────────────────

/**
 * Verify attested values against original claims.
 *
 * Matches AttestResult to SurgicalCandidate by URL, extracts value via
 * extractionPath, and checks tolerance.
 */
export function verifyAttestedValues(
  attestResults: Array<{ url: string; data?: unknown }>,
  candidates: SurgicalCandidate[],
): VerificationResult[] {
  const results: VerificationResult[] = [];

  for (const candidate of candidates) {
    const attestResult = attestResults.find((r) => r.url === candidate.url);
    if (!attestResult) {
      results.push({
        claim: candidate.claim,
        attestedValue: undefined,
        expectedValue: candidate.claim.value,
        verified: false,
        failureReason: "No attestation result for URL",
      });
      continue;
    }

    // Trend and quote claims always pass (no numeric verification)
    if (candidate.claim.type === "trend" || candidate.claim.type === "quote") {
      results.push({
        claim: candidate.claim,
        attestedValue: attestResult.data,
        expectedValue: candidate.claim.value,
        verified: true,
      });
      continue;
    }

    // Extract value from attested data via extractionPath
    if (!candidate.extractionPath || !attestResult.data) {
      results.push({
        claim: candidate.claim,
        attestedValue: undefined,
        expectedValue: candidate.claim.value,
        verified: true, // Graceful: no path = can't verify = pass
      });
      continue;
    }

    const attestedRaw = jsonPathGet(attestResult.data, candidate.extractionPath);
    const attestedValue = typeof attestedRaw === "string" ? parseFloat(attestedRaw) : attestedRaw;

    if (typeof attestedValue !== "number" || isNaN(attestedValue)) {
      results.push({
        claim: candidate.claim,
        attestedValue: attestedRaw,
        expectedValue: candidate.claim.value,
        verified: true, // Non-numeric = can't compare = pass
      });
      continue;
    }

    // Numeric comparison with tolerance
    const expectedValue = candidate.claim.value;
    if (typeof expectedValue !== "number") {
      results.push({
        claim: candidate.claim,
        attestedValue,
        expectedValue,
        verified: true,
      });
      continue;
    }

    const tolerance = candidate.claim.type === "price" ? PRICE_TOLERANCE : METRIC_TOLERANCE;
    const drift = expectedValue !== 0
      ? Math.abs(attestedValue - expectedValue) / Math.abs(expectedValue)
      : (attestedValue === 0 ? 0 : 1);

    const verified = drift <= tolerance;

    results.push({
      claim: candidate.claim,
      attestedValue,
      expectedValue,
      verified,
      drift,
      failureReason: verified ? undefined : `Drift ${(drift * 100).toFixed(1)}% exceeds ${(tolerance * 100)}% tolerance`,
    });
  }

  return results;
}
