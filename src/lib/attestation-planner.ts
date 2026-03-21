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
  /** Fallback candidates if primary/secondary attestation fails */
  fallbacks: SurgicalCandidate[];
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

// ── Source Routing ────────────────────────────────

export interface SourceUsageTracker {
  /** Count of times each source was used in this session */
  usageCount: Map<string, number>;
  /** Set of providers already selected in this plan */
  providersUsed: Set<string>;
}

/**
 * Create a fresh usage tracker for a session/plan.
 */
export function createUsageTracker(): SourceUsageTracker {
  return { usageCount: new Map(), providersUsed: new Set() };
}

/**
 * Score a surgical candidate based on source health, recency of use,
 * and provider diversity. Higher score = better candidate.
 *
 * Scoring:
 *   base = source health (rating 0-100, default 70)
 *   + status bonus: active +10, degraded +0
 *   - session usage penalty: -15 per use in current session
 *   + provider diversity: +5 if provider not yet used in this plan
 */
export function scoreSurgicalCandidate(
  candidate: SurgicalCandidate,
  source: SourceRecordV2,
  tracker: SourceUsageTracker,
): number {
  // Base health score
  const healthRating = source.rating?.overall ?? 70;
  let score = healthRating;

  // Status bonus
  if (source.status === "active") score += 10;
  // degraded: +0 (implicit)

  // Session usage penalty — penalize sources already used this session
  const usageCount = tracker.usageCount.get(source.id) || 0;
  score -= usageCount * 15;

  // Provider diversity bonus — prefer different providers in the same plan
  if (!tracker.providersUsed.has(source.provider)) {
    score += 5;
  }

  return score;
}

/**
 * Record that a source was selected, updating the usage tracker.
 */
export function recordSourceUsage(tracker: SourceUsageTracker, sourceId: string, provider: string): void {
  tracker.usageCount.set(sourceId, (tracker.usageCount.get(sourceId) || 0) + 1);
  tracker.providersUsed.add(provider);
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
  tracker?: SourceUsageTracker,
): AttestationPlan | null {
  if (!claims.length || !adapters?.size) return null;

  const budget = resolveAttestationBudget(config);

  // Sort claims by priority (price first)
  const prioritized = claims
    .filter((c) => CLAIM_PRIORITY[c.type] !== undefined)
    .sort((a, b) => (CLAIM_PRIORITY[a.type] ?? 99) - (CLAIM_PRIORITY[b.type] ?? 99));

  if (prioritized.length === 0) return null;

  // Find surgical candidates for each claim — scored, with fallbacks
  const candidates: SurgicalCandidate[] = [];
  const fallbackCandidates: SurgicalCandidate[] = [];
  const unattested: ExtractedClaim[] = [];
  const usageTracker = tracker || createUsageTracker();

  for (const claim of prioritized) {
    // Collect ALL matching candidates for this claim, not just first
    const claimCandidates: { candidate: SurgicalCandidate; source: SourceRecordV2; score: number }[] = [];

    for (const source of sourceView.sources) {
      const adapter = adapters.get(source.provider);
      if (!adapter?.buildSurgicalUrl) continue;

      const candidate = adapter.buildSurgicalUrl(claim, source);
      if (candidate) {
        const score = scoreSurgicalCandidate(candidate, source, usageTracker);
        claimCandidates.push({ candidate, source, score });
      }
    }

    if (claimCandidates.length === 0) {
      unattested.push(claim);
      continue;
    }

    // Sort by score descending — best candidate first
    claimCandidates.sort((a, b) => b.score - a.score);

    // Best candidate goes to primary/secondary selection
    const best = claimCandidates[0];
    candidates.push(best.candidate);
    recordSourceUsage(usageTracker, best.source.id, best.source.provider);

    // Additional candidates become fallbacks (up to 2 per claim)
    for (let i = 1; i < Math.min(claimCandidates.length, 3); i++) {
      fallbackCandidates.push(claimCandidates[i].candidate);
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
    let method: "TLSN" | "DAHR" = canTlsn ? "TLSN" : "DAHR";
    let cost = canTlsn ? TLSN_COST : DAHR_COST;

    // If chosen method exceeds budget, try downgrading TLSN→DAHR
    if (totalCost + cost > budget.maxCostPerPost && method === "TLSN") {
      method = "DAHR";
      cost = DAHR_COST;
    }

    if (totalCost + cost > budget.maxCostPerPost) continue;
    if (method === "DAHR" && dahrCount >= budget.maxDahrPerPost) continue;

    totalCost += cost;
    if (method === "TLSN") tlsnCount++;
    else dahrCount++;

    selected.push({ ...candidate, plannedMethod: method });
  }

  if (selected.length === 0) return null;

  return {
    primary: selected[0],
    secondary: selected.slice(1),
    fallbacks: fallbackCandidates,
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

    // Missing data = attestation returned nothing useful → fail
    if (!attestResult.data) {
      results.push({
        claim: candidate.claim,
        attestedValue: undefined,
        expectedValue: candidate.claim.value,
        verified: false,
        failureReason: "Attestation returned no data",
      });
      continue;
    }

    // No extractionPath = planner config gap, can't verify → pass gracefully
    if (!candidate.extractionPath) {
      results.push({
        claim: candidate.claim,
        attestedValue: undefined,
        expectedValue: candidate.claim.value,
        verified: true,
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
